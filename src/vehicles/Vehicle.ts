import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/Physics';
import { buildVehicleModel, VehicleSpec, VehicleType, VEHICLES } from './VehicleModels';

export interface DriveInput {
  throttle: number;
  steer: number;
  handbrake: boolean;
  boost: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * A drivable car (README §18): Rapier dynamic chassis + raycast-vehicle
 * suspension and tyre model, arcade assists (speed-sensitive steering,
 * downforce, air control, auto-upright) and a nitro boost.
 *
 * Chassis space: +X forward, +Y up (Rapier's default vehicle axes).
 * Model space:   +Z forward (same convention as characters).
 */
export class Vehicle {
  readonly spec: VehicleSpec;
  readonly group = new THREE.Group();
  private model: THREE.Group;
  private wheels: THREE.Object3D[];
  body: RAPIER.RigidBody;
  private ctrl: RAPIER.DynamicRayCastVehicleController;
  private collider: RAPIER.Collider;
  driver: 'none' | 'local' | 'remote' = 'none';
  /** Nitro meter 0..1 */
  nitro = 1;
  /** True while the nitro is firing (for flame effects). */
  boosting = false;
  private flipTime = 0;
  private input: DriveInput = { throttle: 0, steer: 0, handbrake: false, boost: false };
  private steerSmoothed = 0;
  private wheelSpin: number[];
  private kinematic = false;
  active = true;
  /** Network puppet target (remote driver). */
  netPos = new THREE.Vector3();
  netQuat = new THREE.Quaternion();
  netSpeed = 0;
  netSteer = 0;
  readonly home: { pos: THREE.Vector3; yaw: number };

  constructor(private physics: Physics, readonly id: number, readonly type: VehicleType, pos: THREE.Vector3, yaw: number, readonly paint: string) {
    this.spec = VEHICLES[type];
    this.home = { pos: pos.clone(), yaw };
    const built = buildVehicleModel(type, paint);
    this.model = built.root;
    this.wheels = built.wheels;
    this.wheelSpin = this.wheels.map(() => 0);
    this.model.rotation.y = Math.PI / 2; // model +Z → chassis +X
    this.group.add(this.model);
    const R = physics.R;
    const [hw, hh, hl] = this.spec.half;
    const chassisYaw = yaw - Math.PI / 2;
    _q.setFromAxisAngle(UP, chassisYaw);
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y + this.spec.rest + this.spec.wheelR, pos.z)
        .setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinearDamping(0.05)
        .setAngularDamping(1.2)
        .setCanSleep(true),
    );
    const m = this.spec.mass;
    this.collider = physics.world.createCollider(
      R.ColliderDesc.cuboid(hl, hh, hw)
        .setMassProperties(m, { x: 0, y: -hh * 0.9, z: 0 }, { x: (m * (hh * hh + hw * hw)) / 3, y: (m * (hl * hl + hw * hw)) / 3, z: (m * (hl * hl + hh * hh)) / 3 }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.4)
        .setRestitution(0.1),
      this.body,
    );
    this.ctrl = physics.world.createVehicleController(this.body);
    // hover craft and fliers do their own lift
    if (this.spec.mode === 'hover' || this.spec.mode === 'fly') this.body.setGravityScale(0, true);
    this.spec.wheels.forEach((w, i) => {
      this.ctrl.addWheel({ x: w.z, y: this.spec.wheelY, z: -w.x }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, this.spec.rest, this.spec.wheelR);
      this.ctrl.setWheelSuspensionStiffness(i, this.spec.stiffness);
      this.ctrl.setWheelFrictionSlip(i, this.spec.friction);
      this.ctrl.setWheelMaxSuspensionForce(i, m * 80);
      this.ctrl.setWheelMaxSuspensionTravel(i, this.spec.rest * 1.6);
      this.ctrl.setWheelSuspensionCompression(i, 2.4);
      this.ctrl.setWheelSuspensionRelaxation(i, 3.2);
    });
    this.sync(0);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return _v.set(t.x, t.y, t.z).clone();
  }

  /** World-space forward direction (model +Z). */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    const r = this.body.rotation();
    return out.set(1, 0, 0).applyQuaternion(_q.set(r.x, r.y, r.z, r.w));
  }

  /** Heading in the character convention (atan2(x, z) of forward). */
  get yaw(): number {
    const f = this.forward();
    return Math.atan2(f.x, f.z);
  }

  get velocity(): THREE.Vector3 {
    const l = this.body.linvel();
    return new THREE.Vector3(l.x, l.y, l.z);
  }

  get speed(): number {
    return this.velocity.dot(this.forward());
  }

  /** What the driver is doing right now (for engine / tyre sounds). */
  get driveInput(): Readonly<DriveInput> {
    return this.input;
  }

  /** Sideways sliding speed in m/s (tyre squeal while drifting). */
  get slip(): number {
    const f = this.forward();
    const v = this.velocity;
    return Math.abs(v.x * -f.z + v.z * f.x);
  }

  /** World position of the driver seat. */
  seatWorld(out = new THREE.Vector3()): THREE.Vector3 {
    const [x, y, z] = this.spec.seat;
    return out.set(x, y, z).applyMatrix4(this.model.matrixWorld);
  }

  seatObject(): THREE.Object3D {
    return this.model;
  }

  control(i: DriveInput) {
    this.input = i;
  }

  setKinematic(k: boolean) {
    if (k === this.kinematic) return;
    this.kinematic = k;
    this.body.setBodyType(k ? this.physics.R.RigidBodyType.KinematicPositionBased : this.physics.R.RigidBodyType.Dynamic, true);
  }

  /** Teleport upright at a position/heading. */
  reset(pos: THREE.Vector3, yaw: number) {
    _q.setFromAxisAngle(UP, yaw - Math.PI / 2);
    this.body.setTranslation({ x: pos.x, y: pos.y + this.spec.rest + this.spec.wheelR + 0.3, z: pos.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  fixedUpdate(dt: number) {
    if (!this.active) return;
    if (this.driver === 'remote') {
      // puppet: follow the network pose
      const t = this.body.translation();
      const p = new THREE.Vector3(t.x, t.y, t.z).lerp(this.netPos, Math.min(1, dt * 12));
      const r = this.body.rotation();
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w).slerp(this.netQuat, Math.min(1, dt * 12));
      this.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      this.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      return;
    }
    const s = this.spec;
    const inp = this.driver === 'local' ? this.input : { throttle: 0, steer: 0, handbrake: true, boost: false };
    if (s.mode === 'hover' || s.mode === 'fly') {
      this.hoverUpdate(dt, inp);
      return;
    }
    const fwd = this.forward();
    const vel = this.velocity;
    const speed = vel.dot(fwd);
    const abs = Math.abs(speed);
    // speed-sensitive steering with smoothing
    const steerTarget = inp.steer * s.maxSteer * (1 - Math.min(0.65, (abs / s.topSpeed) * 0.65));
    this.steerSmoothed += (steerTarget - this.steerSmoothed) * Math.min(1, dt * 8);
    let engine = 0;
    let brake = 0;
    const boosting = inp.boost && this.nitro > 0.02 && inp.throttle > 0;
    this.boosting = boosting;
    if (inp.throttle > 0.05) {
      if (speed < -1) brake = s.brake;
      else if (speed < s.topSpeed * (boosting ? 1.45 : 1)) engine = s.engine * inp.throttle * (boosting ? 1.9 : 1);
    } else if (inp.throttle < -0.05) {
      if (speed > 1) brake = s.brake * -inp.throttle;
      else if (speed > -s.topSpeed * 0.4) engine = -s.engine * 0.6 * -inp.throttle;
    } else if (this.driver !== 'local' || abs < 0.5) {
      brake = s.brake * 0.3;
    }
    this.nitro = boosting ? Math.max(0, this.nitro - dt * 0.35) : Math.min(1, this.nitro + dt * 0.08);
    s.wheels.forEach((w, i) => {
      this.ctrl.setWheelSteering(i, w.steer ? this.steerSmoothed : 0);
      this.ctrl.setWheelEngineForce(i, w.drive ? engine : 0);
      const rear = w.z < 0;
      this.ctrl.setWheelBrake(i, brake + (inp.handbrake && rear ? s.brake * 1.2 : 0));
      // handbrake drift: rear tyres lose grip
      this.ctrl.setWheelFrictionSlip(i, inp.handbrake && rear ? s.friction * 0.35 : s.friction);
    });
    this.ctrl.updateVehicle(dt, undefined, undefined, (c) => c.handle !== this.collider.handle && !this.physics.isCharacter(c));
    // downforce + air control
    let contacts = 0;
    for (let i = 0; i < s.wheels.length; i++) if (this.ctrl.wheelIsInContact(i)) contacts++;
    const m = s.mass;
    // (impulse, not addForce: Rapier forces persist across steps until reset)
    if (contacts > 0) this.body.applyImpulse({ x: 0, y: -abs * abs * m * 0.012 * dt, z: 0 }, true);
    else if (this.driver === 'local') {
      const right = new THREE.Vector3(0, 0, -1).applyQuaternion(this.rot());
      const yawT = -inp.steer * m * 1.2;
      const pitchT = inp.throttle * m * 0.8;
      this.body.applyTorqueImpulse({ x: (UP.x * yawT + right.x * pitchT) * dt, y: (UP.y * yawT + right.y * pitchT) * dt, z: (UP.z * yawT + right.z * pitchT) * dt }, true);
    }
    if (boosting) this.body.applyImpulse({ x: fwd.x * m * 4 * dt, y: 0, z: fwd.z * m * 4 * dt }, true);
    if (s.lean) {
      // two-wheeler: actively hold it upright (PD on roll and pitch)
      const up = UP.clone().applyQuaternion(this.rot());
      const av = this.body.angvel();
      const fix = new THREE.Vector3().crossVectors(up, UP).multiplyScalar(m * 14);
      this.body.applyTorqueImpulse({ x: (fix.x - av.x * m * 2.2) * dt, y: 0, z: (fix.z - av.z * m * 2.2) * dt }, true);
      this.lean += (-this.steerSmoothed * Math.min(1, abs / 12) * 0.9 - this.lean) * Math.min(1, dt * 6);
    }
    // auto-upright when flipped
    const up = UP.clone().applyQuaternion(this.rot());
    if (up.y < 0.35 && abs < 4) this.flipTime += dt;
    else this.flipTime = 0;
    if (this.flipTime > 1.5) {
      const t = this.body.translation();
      this.reset(new THREE.Vector3(t.x, t.y, t.z), this.yaw);
      this.flipTime = 0;
    }
  }

  /** Garage: recolour the wheel hubs. */
  setRims(color: string) {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.85 });
    for (const w of this.wheels) {
      const hub = w.children[1] as THREE.Mesh | undefined;
      if (hub?.isMesh) hub.material = m;
    }
  }

  private cosmetic: THREE.Group | null = null;

  /** Garage extras: spoiler, decal and underglow on the model. */
  setCosmetics(o: { spoiler?: string; decal?: string; glow?: string }, tex: { splat: THREE.Texture; checker: THREE.Texture; eye: THREE.Texture; dot: THREE.Texture }) {
    if (this.cosmetic) this.model.remove(this.cosmetic);
    const g = new THREE.Group();
    const [hx, hy, hz] = this.spec.half;
    const ink = new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.4, metalness: 0.3 });
    const accent = new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.4 });
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    // spoilers sit on the tail (model +Z is forward)
    if (o.spoiler === 'lip') box(hx * 1.8, 0.06, 0.3, 0, hy + 0.04, -hz + 0.15, ink);
    else if (o.spoiler === 'wing') {
      for (const s of [-1, 1]) box(0.06, 0.32, 0.12, s * hx * 0.6, hy + 0.16, -hz + 0.2, ink);
      box(hx * 2.1, 0.05, 0.42, 0, hy + 0.34, -hz + 0.18, accent).rotation.x = -0.12;
    } else if (o.spoiler === 'fin') {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 3), ink);
      fin.scale.set(0.15, 1, 1);
      fin.position.set(0, hy + 0.4, -hz * 0.5);
      fin.rotation.x = -0.5;
      g.add(fin);
    }
    // decals on both doors (or the bonnet)
    const decal = (map: THREE.Texture, color: string, size: number) => {
      const m = new THREE.MeshStandardMaterial({ map, color, transparent: true, alphaTest: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
        p.position.set(s * (hx + 0.012), 0, 0);
        p.rotation.y = s * Math.PI / 2;
        g.add(p);
      }
    };
    if (o.decal === 'splat') decal(tex.splat, '#111114', Math.min(hz * 1.4, 1.6));
    else if (o.decal === 'eye') decal(tex.eye, '#ffffff', Math.min(hz, 1.1));
    else if (o.decal === 'checker') {
      const m = new THREE.MeshStandardMaterial({ map: tex.checker, polygonOffset: true, polygonOffsetFactor: -2 });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(hx * 0.7, hz * 1.9), m);
      p.rotation.x = -Math.PI / 2;
      p.position.set(0, hy + 0.012, 0);
      g.add(p);
    } else if (o.decal === 'stripes') {
      for (const s of [-1, 1]) box(0.16, 0.012, hz * 1.96, s * 0.16, hy + 0.006, 0, accent);
    }
    // underglow: an additive glow pool under the chassis
    if (o.glow && o.glow !== 'off') {
      const m = new THREE.MeshBasicMaterial({ map: tex.dot, color: o.glow, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(hx * 3.4, hz * 3), m);
      p.rotation.x = -Math.PI / 2;
      p.position.set(0, -hy - this.spec.rest - this.spec.wheelR + 0.35, 0);
      p.userData.noMap = true;
      g.add(p);
    }
    this.cosmetic = g;
    this.model.add(g);
  }

  /** Visual lean (two-wheelers) and bank (hover / fly). */
  private lean = 0;
  private pitchVis = 0;

  /**
   * Hover and flight model: keeps a cushion over the ground (spring-damper on
   * a downward ray), steers by yaw rate, and either falls (board), holds its
   * height over gaps (skiff) or flies (glider: Space climbs, let go to sink).
   */
  private hoverUpdate(dt: number, inp: DriveInput) {
    const s = this.spec;
    const t = this.body.translation();
    const pos = new THREE.Vector3(t.x, t.y, t.z);
    const lv = this.body.linvel();
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const yaw = this.yaw;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const hh = s.half[1];
    const ground = this.physics.raycast(pos, new THREE.Vector3(0, -1, 0), (s.hoverH ?? 0.6) + hh + 6);
    const h = ground ? ground.distance - hh : Infinity;
    const boosting = inp.boost && this.nitro > 0.02 && inp.throttle > 0;
    this.boosting = boosting;
    this.nitro = boosting ? Math.max(0, this.nitro - dt * 0.35) : Math.min(1, this.nitro + dt * 0.08);
    // horizontal: thrust along the nose, grip sideways (handbrake = drift)
    let along = vel.dot(fwd);
    let side = vel.dot(right);
    const top = s.topSpeed * (boosting ? 1.4 : 1);
    const want = inp.throttle >= 0 ? inp.throttle * top : inp.throttle * top * 0.4;
    along += (want - along) * Math.min(1, dt * (Math.abs(want) > Math.abs(along) ? 1.6 : 1.1));
    side *= 1 - Math.min(1, dt * (inp.handbrake && s.mode === 'hover' ? 0.8 : 5));
    // vertical
    let vy = vel.y;
    const H = s.hoverH ?? 0.6;
    if (s.mode === 'fly') {
      const target = inp.handbrake ? 7 : inp.throttle > 0.1 ? -1.2 : -3;
      vy += (target - vy) * Math.min(1, dt * 2);
      if (h < H) vy = Math.max(vy, (H - h) * 6);
    } else if (h < H + 1.5) {
      vy += ((H - h) * 30 - vy * 6) * dt;
    } else if (s.holdAlt) {
      vy += (-0.5 - vy) * Math.min(1, dt * 2);
    } else {
      vy -= 24 * dt;
    }
    const nv = fwd.clone().multiplyScalar(along).addScaledVector(right, side);
    this.body.setLinvel({ x: nv.x, y: vy, z: nv.z }, true);
    // steer by yaw rate, stay level (visual bank only)
    const turn = inp.steer * s.maxSteer * (along < -0.5 ? -1 : 1) * (s.mode === 'fly' ? 1 : Math.min(1, 0.35 + Math.abs(along) / 8));
    const ny = yaw + turn * dt;
    _q.setFromAxisAngle(UP, ny - Math.PI / 2);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.lean += (-inp.steer * (s.mode === 'fly' ? 0.6 : 0.25) - this.lean) * Math.min(1, dt * 5);
    this.pitchVis += ((s.mode === 'fly' ? (inp.handbrake ? -0.25 : 0.1) : 0) - this.pitchVis) * Math.min(1, dt * 4);
  }

  private rot(): THREE.Quaternion {
    const r = this.body.rotation();
    return new THREE.Quaternion(r.x, r.y, r.z, r.w);
  }

  /** Copy physics to visuals; spin and steer the wheels. */
  sync(dt: number) {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.group.position.set(t.x, t.y, t.z);
    this.group.quaternion.set(r.x, r.y, r.z, r.w);
    const s = this.spec;
    const speed = this.driver === 'remote' ? this.netSpeed : this.speed;
    // lean / bank the body around the forward axis (model is turned +90° into chassis space)
    this.model.rotation.set(this.pitchVis, Math.PI / 2, this.lean, 'YXZ');
    if (s.mode === 'hover') this.model.position.y = Math.sin(performance.now() * 0.004 + this.id) * 0.04;
    this.wheels.forEach((w, i) => {
      const susp = this.driver === 'remote' || this.kinematic ? s.rest * 0.6 : (this.ctrl.wheelSuspensionLength(i) ?? s.rest);
      w.position.y = s.wheelY - susp;
      const steer = this.driver === 'remote' ? (s.wheels[i].steer ? this.netSteer : 0) : (this.ctrl.wheelSteering(i) ?? 0);
      this.wheelSpin[i] += (speed / s.wheelR) * dt;
      w.rotation.set(this.wheelSpin[i], steer, 0, 'YXZ');
    });
  }

  dispose() {
    this.group.removeFromParent();
    this.physics.world.removeVehicleController(this.ctrl);
    this.physics.world.removeRigidBody(this.body);
  }
}
