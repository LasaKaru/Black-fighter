import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/Physics';
import type { WorldMaterials } from './Materials';

/** Arc-length parametrised polyline. */
class PathCurve {
  private cum: number[] = [0];
  readonly length: number;
  constructor(readonly pts: THREE.Vector3[], readonly closed: boolean) {
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) this.cum.push(this.cum[i] + pts[i].distanceTo(pts[(i + 1) % pts.length]));
    this.length = this.cum[this.cum.length - 1];
  }
  /** Position and heading at distance d along the path. */
  at(d: number, out: THREE.Vector3): number {
    if (this.closed) d = ((d % this.length) + this.length) % this.length;
    else d = THREE.MathUtils.clamp(d, 0, this.length);
    let i = 0;
    while (i < this.cum.length - 2 && this.cum[i + 1] < d) i++;
    const a = this.pts[i];
    const b = this.pts[(i + 1) % this.pts.length];
    const t = (d - this.cum[i]) / Math.max(1e-6, this.cum[i + 1] - this.cum[i]);
    out.lerpVectors(a, b, t);
    return Math.atan2(b.x - a.x, b.z - a.z);
  }
}

interface Car {
  group: THREE.Group;
  body: RAPIER.RigidBody;
  platform: { delta: THREE.Vector3 };
  last: THREE.Vector3;
}

/**
 * The Ella train: a blue locomotive and carriages looping the viaduct and
 * crossing the Nine Arch Bridge. Each carriage is a kinematic body, so you
 * can land on the roof and ride it (moving platform).
 */
export class Train {
  readonly group = new THREE.Group();
  private path: PathCurve;
  private cars: Car[] = [];
  private d = 0;
  speed = 11;
  readonly carLen = 9;
  readonly gap = 1.2;

  constructor(physics: Physics, mats: WorldMaterials, points: THREE.Vector3[], count = 5) {
    this.path = new PathCurve(points, true);
    for (let i = 0; i < count; i++) {
      const g = new THREE.Group();
      const loco = i === 0;
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 2.6, this.carLen), loco ? mats.trainRed : mats.trainBlue);
      body.position.y = 1.7;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.35, this.carLen + 0.2), mats.grey);
      roof.position.y = 3.15;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.95, 0.35, this.carLen + 0.02), loco ? mats.marble : mats.trainRed);
      stripe.position.y = 1.2;
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, this.carLen - 0.6), mats.black);
      skirt.position.y = 0.3;
      g.add(body, roof, stripe, skirt);
      for (let w = 0; w < 5; w++) {
        for (const s of [-1, 1]) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 1.1), mats.glass);
          win.position.set(s * 1.46, 2.2, -3.4 + w * 1.7);
          g.add(win);
        }
      }
      if (loco) {
        const nose = new THREE.Mesh(new THREE.BoxGeometry(2.9, 1.6, 1.2), mats.trainRed);
        nose.position.set(0, 1.2, this.carLen / 2 + 0.5);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mats.lamp);
        lamp.position.set(0, 2.4, this.carLen / 2 + 0.05);
        g.add(nose, lamp);
      }
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.group.add(g);
      const platform = { delta: new THREE.Vector3() };
      const pos = new THREE.Vector3();
      this.path.at(-i * (this.carLen + this.gap), pos);
      const phys = physics.addKinematicBox(pos.clone().setY(pos.y + 1.7), new THREE.Vector3(1.45, 1.65, this.carLen / 2), platform);
      this.cars.push({ group: g, body: phys.body, platform, last: pos.clone() });
    }
  }

  /** Front of the train (for missions and camera shots). */
  get front(): THREE.Vector3 {
    return this.cars[0].group.position;
  }

  update(dt: number) {
    this.d += this.speed * dt;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      const s = this.d - i * (this.carLen + this.gap);
      // orient by the chord between the car's two bogies
      const front = new THREE.Vector3();
      const back = new THREE.Vector3();
      this.path.at(s + this.carLen * 0.4, front);
      this.path.at(s - this.carLen * 0.4, back);
      p.copy(front).add(back).multiplyScalar(0.5);
      const yaw = Math.atan2(front.x - back.x, front.z - back.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      c.platform.delta.copy(p).sub(c.last);
      c.last.copy(p);
      c.group.position.copy(p);
      c.group.quaternion.copy(q);
      c.body.setNextKinematicTranslation({ x: p.x, y: p.y + 1.7, z: p.z });
      c.body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
  }
}

/** Corcovado cable car: an open gondola shuttling between the beach and the summit. */
export class CableCar {
  readonly group = new THREE.Group();
  private t = 0;
  private dir = 1;
  private wait = 3;
  private body: RAPIER.RigidBody;
  private platform = { delta: new THREE.Vector3() };
  private last = new THREE.Vector3();
  private len: number;
  speed = 6;

  constructor(physics: Physics, mats: WorldMaterials, private a: THREE.Vector3, private b: THREE.Vector3) {
    this.len = a.distanceTo(b);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 4), mats.dark);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.25, 4.2), mats.trainRed);
    roof.position.y = 2.9;
    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.8, 6), mats.metal);
    hanger.position.y = 3.9;
    this.group.add(floor, roof, hanger);
    for (const [x, z] of [[-1.9, -1.9], [1.9, -1.9], [-1.9, 1.9], [1.9, 1.9]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.8, 0.12), mats.metal);
      post.position.set(x, 1.4, z);
      this.group.add(post);
    }
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4, 0.1, 0.1), mats.metal);
      rail.position.set(0, 1.0, s * 1.95);
      this.group.add(rail);
    }
    this.group.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : 0));
    const phys = physics.addKinematicBox(a.clone(), new THREE.Vector3(2, 0.15, 2), this.platform);
    this.body = phys.body;
    for (const s of [-1, 1]) {
      physics.addPlatformPart(this.body, new THREE.Vector3(0, 0.6, s * 1.95), new THREE.Vector3(2, 0.5, 0.06), this.platform);
    }
    this.last.copy(a);
    this.group.position.copy(a);
  }

  update(dt: number) {
    if (this.wait > 0) {
      this.wait -= dt;
      this.platform.delta.set(0, 0, 0);
      return;
    }
    this.t += (this.dir * this.speed * dt) / this.len;
    if (this.t >= 1 || this.t <= 0) {
      this.t = THREE.MathUtils.clamp(this.t, 0, 1);
      this.dir *= -1;
      this.wait = 4;
    }
    const p = this.a.clone().lerp(this.b, this.t);
    this.platform.delta.copy(p).sub(this.last);
    this.last.copy(p);
    this.group.position.copy(p);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
  }
}
