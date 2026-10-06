import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/Physics';
import { buildVehicleModel, VehicleType, VEHICLES } from './VehicleModels';

interface TrafficCar {
  group: THREE.Group;
  body: RAPIER.RigidBody;
  wheels: THREE.Object3D[];
  a: THREE.Vector3;
  b: THREE.Vector3;
  t: number;
  dir: 1 | -1;
  speed: number;
  len: number;
  spin: number;
  platform: { delta: THREE.Vector3 };
  last: THREE.Vector3;
  type: VehicleType;
}

/**
 * Ambient traffic: red island buses and tuk-tuks shuttling along the bridges
 * (kinematic, lane-following, they stop for players in front of them).
 */
export class Traffic {
  private cars: TrafficCar[] = [];

  constructor(physics: Physics, scene: THREE.Scene, roads: Array<{ a: THREE.Vector3; b: THREE.Vector3 }>) {
    roads.forEach((r, i) => {
      const type: VehicleType = i % 3 === 0 ? 'bus' : i % 3 === 1 ? 'tuktuk' : 'inkbox';
      const spec = VEHICLES[type];
      const { root, wheels } = buildVehicleModel(type, spec.paint[i % spec.paint.length]);
      const group = new THREE.Group();
      group.add(root);
      scene.add(group);
      const [hw, hh, hl] = spec.half;
      const platform = { delta: new THREE.Vector3() };
      const phys = physics.addKinematicBox(r.a.clone(), new THREE.Vector3(hw, hh, hl), platform);
      this.cars.push({ group, body: phys.body, wheels, a: r.a, b: r.b, t: (i * 0.37) % 1, dir: i % 2 ? 1 : -1, speed: type === 'bus' ? 9 : 12, len: r.a.distanceTo(r.b), spin: 0, platform, last: new THREE.Vector3(), type });
    });
  }

  update(dt: number, blockers: THREE.Vector3[], camera: THREE.Vector3) {
    for (const c of this.cars) {
      const dir = c.b.clone().sub(c.a).normalize();
      const fwd = dir.clone().multiplyScalar(c.dir);
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const p = c.a.clone().lerp(c.b, c.t).addScaledVector(right, -2.4);
      // stop for anyone standing in the lane ahead
      let blocked = false;
      for (const bl of blockers) {
        const to = bl.clone().sub(p);
        const ahead = to.dot(fwd);
        if (ahead > 0 && ahead < 9 && Math.abs(to.dot(right)) < 2.4 && Math.abs(to.y) < 3) blocked = true;
      }
      if (!blocked) c.t += (c.dir * c.speed * dt) / c.len;
      if (c.t > 1 || c.t < 0) {
        c.t = THREE.MathUtils.clamp(c.t, 0, 1);
        c.dir = c.dir === 1 ? -1 : 1;
      }
      const spec = VEHICLES[c.type];
      const y = 0.08 + spec.rest * 0.6 + spec.wheelR - spec.wheelY;
      p.y = y;
      const yaw = Math.atan2(fwd.x, fwd.z);
      c.platform.delta.copy(p).sub(c.last);
      c.last.copy(p);
      c.group.position.copy(p);
      c.group.rotation.y = yaw;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      c.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      c.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      c.group.visible = p.distanceTo(camera) < 350;
      if (c.group.visible && !blocked) {
        c.spin += (c.speed / spec.wheelR) * dt;
        for (const w of c.wheels) w.rotation.x = c.spin;
      }
    }
  }

  get positions(): THREE.Vector3[] {
    return this.cars.map((c) => c.group.position);
  }
}

