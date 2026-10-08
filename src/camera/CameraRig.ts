import * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import { clamp, damp, lerp, noise1, wrapAngle } from '../core/math';
import { LAYER_FP_HIDDEN } from '../character/CharacterRig';

export type CameraMode = 'tp' | 'fp' | 'menu' | 'custom';

export interface CameraTarget {
  feet: THREE.Vector3;
  vel: THREE.Vector3;
  facingYaw: number;
  headWorld: THREE.Vector3;
  grounded: boolean;
  inCombat: boolean;
  wallSide: number;
  airborneFall: boolean;
}

interface Cinematic {
  kind: 'catch' | 'absorb' | 'launch' | 'finisher';
  t: number;
  dur: number;
  focus: () => THREE.Vector3;
  faceYaw: number;
}

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export class CameraRig {
  yaw = Math.PI;
  pitch = -0.08;
  mode: CameraMode = 'menu';
  private dist = 3.2;
  private trauma = 0;
  private fovKick = 0;
  private roll = 0;
  private time = 0;
  private idleLook = 0;
  private cine: Cinematic | null = null;
  private cineWeight = 0;
  private fpBlend = 0;
  baseFov = 70;
  fpFov = 90;
  shakeScale = 1;
  headBob = 0.4;
  cinematicEnabled = true;
  shoulder = 0.38;
  /** >0 while driving: chase-cam distance for the current vehicle. */
  vehicleDist = 0;
  sensitivity = 1;
  padSensitivity = 1;
  invertY = false;
  invertX = false;
  /** Third-person distance multiplier (settings). */
  distanceScale = 1;
  /** 0 = raw look .. 1 = very smooth. */
  smoothing = 0.2;
  /** Drift behind the player while moving. */
  autoFollow = true;
  /** Called with the shake amount (controller rumble). */
  onShake: ((amount: number) => void) | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  /** Orbit centre for the menu/customize camera. */
  menuCenter = new THREE.Vector3(0, 1, 30);
  menuDistance = 4.5;
  menuHeight = 1.2;
  /** Height of the look-at point above the menu centre. */
  menuLook = 0.6;
  /** Sideways shift of the look-at point so the character clears the menu panels (+ = character moves left on screen). */
  menuShift = 0;

  constructor(private camera: THREE.PerspectiveCamera, private physics: Physics) {}

  addShake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount * this.shakeScale);
    this.onShake?.(amount);
  }

  kickFov(amount: number) {
    this.fovKick = Math.max(this.fovKick, amount);
  }

  startCinematic(kind: Cinematic['kind'], dur: number, focus: () => THREE.Vector3, faceYaw: number) {
    if (!this.cinematicEnabled || this.mode !== 'tp') return;
    this.cine = { kind, t: 0, dur, focus, faceYaw };
  }

  get inCinematic() {
    return this.cine !== null;
  }

  /** Apply mouse/stick look. */
  look(dx: number, dy: number, padX: number, padY: number, dt: number) {
    const s = 0.0022 * this.sensitivity;
    const inv = this.invertY ? -1 : 1;
    const invX = this.invertX ? -1 : 1;
    // stick input gets a response curve: fine aim near the centre, fast turns at the edge
    const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.6);
    const wantYaw = (dx * s + curve(padX) * 3.4 * this.padSensitivity * dt) * invX;
    const wantPitch = (dy * s + curve(padY) * 2.5 * this.padSensitivity * dt) * inv;
    // optional smoothing: the camera eases toward the requested rotation
    const k = this.smoothing <= 0.01 ? 1 : damp(40 * (1 - this.smoothing) + 6, dt);
    this.lookYaw += wantYaw;
    this.lookPitch += wantPitch;
    const ay = this.lookYaw * k;
    const ap = this.lookPitch * k;
    this.lookYaw -= ay;
    this.lookPitch -= ap;
    this.yaw -= ay;
    this.pitch -= ap;
    this.pitch = clamp(this.pitch, -1.35, 1.2);
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(padX) + Math.abs(padY) > 0.01) this.idleLook = 0;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  update(dt: number, target: CameraTarget | null) {
    this.time += dt;
    this.idleLook += dt;
    const cam = this.camera;

    if (this.mode === 'custom') return;
    if (this.mode === 'menu' || !target) {
      const a = this.time * 0.12;
      const c = this.menuCenter;
      cam.position.set(c.x + Math.sin(a) * this.menuDistance, c.y + this.menuHeight, c.z + Math.cos(a) * this.menuDistance);
      // camera right vector for a camera orbiting at angle a and looking at the centre
      const rx = Math.cos(a);
      const rz = -Math.sin(a);
      cam.lookAt(c.x + rx * this.menuShift, c.y + this.menuLook, c.z + rz * this.menuShift);
      cam.fov = lerp(cam.fov, 45, damp(4, dt));
      cam.updateProjectionMatrix();
      cam.layers.enable(LAYER_FP_HIDDEN);
      return;
    }
    const speed = Math.hypot(target.vel.x, target.vel.z);

    // auto-follow: drift yaw behind movement when the player is not steering the camera
    const driving = this.vehicleDist > 0;
    if (this.mode === 'tp' && (this.autoFollow || driving) && (driving ? this.idleLook > 0.5 && speed > 2 : this.idleLook > 1.2 && speed > 3) && !target.inCombat) {
      const want = driving ? target.facingYaw : Math.atan2(target.vel.x, target.vel.z);
      this.yaw += wrapAngle(want - this.yaw) * damp(driving ? 3 : 0.8, dt);
      if (driving) this.pitch += (-0.16 - this.pitch) * damp(1.5, dt);
    }
    // look-down assist when dropping
    let pitchBias = 0;
    if (target.airborneFall && this.mode === 'tp') pitchBias = -0.35;

    this.fpBlend = lerp(this.fpBlend, this.mode === 'fp' ? 1 : 0, damp(10, dt));

    const pitch = clamp(this.pitch + pitchBias * 0.5, -1.35, 1.2);
    _dir.set(Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(this.yaw) * Math.cos(pitch));
    _right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));

    // ---------- third person spring arm
    let wantDist = speed > 7.5 ? 3.9 : speed > 2 ? 3.4 : 3.1;
    if (target.inCombat) wantDist = 2.7;
    if (!target.grounded) wantDist = target.vel.y > 8 ? 5.5 : 4.2;
    if (driving) wantDist = this.vehicleDist + Math.min(4, speed * 0.08);
    wantDist *= this.distanceScale;
    const pivotH = driving ? 2.2 : 1.42 - Math.min(0.15, speed * 0.02);
    _pivot.copy(target.feet).add(new THREE.Vector3(0, pivotH, 0)).addScaledVector(_right, driving ? 0 : this.shoulder);
    const castDir = _dir.clone().multiplyScalar(-1);
    const safe = this.physics.sphereCast(_pivot, castDir, 0.22, wantDist);
    const d = Math.min(wantDist, safe);
    // pull in fast, ease out slowly
    this.dist = d < this.dist ? lerp(this.dist, d, damp(25, dt)) : lerp(this.dist, d, damp(3, dt));
    _desired.copy(_pivot).addScaledVector(_dir, -this.dist);
    // wall-run roll
    this.roll = lerp(this.roll, target.wallSide * 0.09, damp(6, dt));

    // ---------- first person
    const fpPos = target.headWorld.clone();
    fpPos.y += 0.04;
    fpPos.addScaledVector(_dir, 0.08);
    // head-bob stabilisation: blend toward a smooth eye height
    const smoothEye = target.feet.clone().add(new THREE.Vector3(0, 1.62, 0)).addScaledVector(_dir.clone().setY(0).normalize(), 0.12);
    fpPos.lerp(smoothEye, 1 - this.headBob);

    cam.position.lerpVectors(_desired, fpPos, this.fpBlend);
    _look.copy(cam.position).add(_dir);
    cam.up.set(0, 1, 0);
    cam.lookAt(_look);
    if (this.fpBlend > 0.6) cam.layers.disable(LAYER_FP_HIDDEN);
    else cam.layers.enable(LAYER_FP_HIDDEN);

    // ---------- cinematic close-ups (systemic, short)
    if (this.cine) {
      this.cine.t += dt;
      const c = this.cine;
      const p = c.t / c.dur;
      const w = p < 0.25 ? p / 0.25 : p > 0.8 ? (1 - p) / 0.2 : 1;
      this.cineWeight = clamp(w, 0, 1);
      const focus = c.focus();
      const f = new THREE.Vector3(Math.sin(c.faceYaw), 0, Math.cos(c.faceYaw));
      const r = new THREE.Vector3(-f.z, 0, f.x);
      let cp: THREE.Vector3;
      if (c.kind === 'launch') {
        cp = target.feet.clone().addScaledVector(f, -2.2).addScaledVector(r, 1.2).add(new THREE.Vector3(0, 0.25, 0));
      } else if (c.kind === 'finisher') {
        cp = focus.clone().addScaledVector(r, 3).addScaledVector(f, 1).add(new THREE.Vector3(0, 0.6, 0));
      } else {
        const orbit = c.kind === 'absorb' ? 0.2 : 0.55 - p * 0.3;
        cp = focus.clone().addScaledVector(f, 1.15).addScaledVector(r, orbit).add(new THREE.Vector3(0, c.kind === 'absorb' ? 0.05 : -0.05, 0));
      }
      const safeC = this.physics.raycast(focus, cp.clone().sub(focus).normalize(), cp.distanceTo(focus));
      if (safeC) cp = focus.clone().lerp(safeC.point, 0.85);
      _m.lookAt(cp, focus, new THREE.Vector3(0, 1, 0));
      _q.setFromRotationMatrix(_m);
      _q2.copy(cam.quaternion).slerp(_q, this.cineWeight);
      cam.position.lerp(cp, this.cineWeight);
      cam.quaternion.copy(_q2);
      if (c.t >= c.dur) {
        this.cine = null;
        this.cineWeight = 0;
      }
    }

    // ---------- roll + shake
    cam.rotateZ(this.roll * (1 - this.fpBlend * 0.5));
    if (this.trauma > 0) {
      const sh = this.trauma * this.trauma;
      const t = this.time * 22;
      cam.rotateX(noise1(t, 1) * 0.045 * sh);
      cam.rotateY(noise1(t, 2) * 0.045 * sh);
      cam.rotateZ(noise1(t, 3) * 0.03 * sh);
      cam.position.addScaledVector(_right, noise1(t, 4) * 0.12 * sh);
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }

    // ---------- FOV: sprint +6, dash/jump kicks
    const base = lerp(this.baseFov, this.fpFov, this.fpBlend);
    const speedFov = clamp((speed - 6) / 3, 0, 1) * 6;
    this.fovKick = Math.max(0, this.fovKick - dt * 25);
    const cineFov = this.cineWeight * -18;
    const want = base + speedFov + this.fovKick + cineFov;
    cam.fov = lerp(cam.fov, want, damp(8, dt));
    cam.updateProjectionMatrix();
  }
}
