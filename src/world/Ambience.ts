import * as THREE from 'three';
import type { Effects } from '../vfx/Effects';
import type { AudioEngine } from '../audio/Audio';
import type { IslandInfo } from './islands/types';
import { makeRng } from '../core/math';
import { PALETTE } from './Materials';

interface Pigeon {
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  state: 'peck' | 'fly' | 'gone';
  t: number;
  phase: number;
}

interface Eye {
  group: THREE.Group;
  pupil: THREE.Object3D;
  base: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  size: number;
  blink: number;
}

/**
 * Small life in the city: pigeon flocks that burst into the air when you
 * run through them, laundry lines and hanging signs swaying in the wind,
 * steam vents, and 3D wall eyes that follow you and blink.
 */
export class Ambience {
  private pigeons: Pigeon[] = [];
  private pigeonMesh: THREE.InstancedMesh;
  private sway: Array<{ obj: THREE.Object3D; amp: number; phase: number; axis: 'x' | 'z'; pos: THREE.Vector3 }> = [];
  private vents: Array<{ pos: THREE.Vector3; t: number }> = [];
  private eyes: Eye[] = [];
  private time = 0;
  wind = 1;

  constructor(private scene: THREE.Scene, private effects: Effects, private audio: AudioEngine, islands: IslandInfo[], hubCenter: THREE.Vector3) {
    const rng = makeRng(2024);
    // pigeons: flocks on the hub plaza and every island's arrival plaza
    const flocks: THREE.Vector3[] = [hubCenter.clone().add(new THREE.Vector3(-6, 0, 30)), hubCenter.clone().add(new THREE.Vector3(14, 0, 12))];
    for (const i of islands) flocks.push(i.spawn.clone().add(new THREE.Vector3(rng.range(-8, 8), 0, rng.range(-8, 8))).setY(0));
    for (const f of flocks) {
      const n = rng.int(6, 10);
      for (let k = 0; k < n; k++) {
        const home = f.clone().add(new THREE.Vector3(rng.range(-3, 3), 0, rng.range(-3, 3)));
        this.pigeons.push({ home, pos: home.clone(), vel: new THREE.Vector3(), yaw: rng.range(0, 6.3), state: 'peck', t: 0, phase: rng.range(0, 10) });
      }
    }
    const body = new THREE.SphereGeometry(0.13, 8, 6);
    body.scale(1, 0.8, 1.5);
    const head = new THREE.SphereGeometry(0.075, 8, 6);
    head.translate(0, 0.11, 0.15);
    const tail = new THREE.ConeGeometry(0.06, 0.18, 4);
    tail.rotateX(-Math.PI / 2 - 0.3);
    tail.translate(0, 0.02, -0.2);
    const geo = mergeSimple([body, head, tail]);
    this.pigeonMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#8d8b92', roughness: 0.8, flatShading: true }), this.pigeons.length);
    this.pigeonMesh.frustumCulled = false;
    this.pigeonMesh.castShadow = true;
    const tint = new THREE.Color();
    this.pigeons.forEach((_, i) => this.pigeonMesh.setColorAt(i, tint.setScalar(rng.range(0.55, 1.15))));
    scene.add(this.pigeonMesh);

    // laundry lines, hanging signs, vents and wall eyes on the district towers
    const cloth = [new THREE.MeshStandardMaterial({ color: '#eceae6', side: THREE.DoubleSide, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: '#141418', side: THREE.DoubleSide, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: PALETTE.routeTeal, side: THREE.DoubleSide, roughness: 0.9 }), new THREE.MeshStandardMaterial({ color: PALETTE.voidPurple, side: THREE.DoubleSide, roughness: 0.9 })];
    const lineMat = new THREE.LineBasicMaterial({ color: '#141418' });
    const signMat = new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.5 });
    for (const isl of islands) {
      const towers = isl.towers;
      // laundry between close tower pairs
      let lines = 0;
      for (let a = 0; a < towers.length && lines < 3; a++) {
        for (let b = a + 1; b < towers.length && lines < 3; b++) {
          const A = towers[a];
          const B = towers[b];
          const ca = new THREE.Vector3((A.x0 + A.x1) / 2, 0, (A.z0 + A.z1) / 2);
          const cb = new THREE.Vector3((B.x0 + B.x1) / 2, 0, (B.z0 + B.z1) / 2);
          const d = ca.distanceTo(cb);
          const y = Math.min(A.h, B.h) - 1.6;
          if (d < 7 || d > 14 || y < 3.5) continue;
          // attach at the faces: shrink the segment by half each footprint
          const dir = cb.clone().sub(ca).normalize();
          const p0 = ca.clone().addScaledVector(dir, Math.min((A.x1 - A.x0) / 2 / Math.max(0.2, Math.abs(dir.x)), (A.z1 - A.z0) / 2 / Math.max(0.2, Math.abs(dir.z)))).setY(y);
          const p1 = cb.clone().addScaledVector(dir, -Math.min((B.x1 - B.x0) / 2 / Math.max(0.2, Math.abs(dir.x)), (B.z1 - B.z0) / 2 / Math.max(0.2, Math.abs(dir.z)))).setY(y);
          if (p0.distanceTo(p1) < 3) continue;
          const sag = 0.5;
          const pts: THREE.Vector3[] = [];
          for (let k = 0; k <= 10; k++) pts.push(p0.clone().lerp(p1, k / 10).add(new THREE.Vector3(0, -Math.sin((k / 10) * Math.PI) * sag, 0)));
          scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
          const n = rng.int(3, 6);
          for (let k = 0; k < n; k++) {
            const t = (k + 1) / (n + 1);
            const at = p0.clone().lerp(p1, t).add(new THREE.Vector3(0, -Math.sin(t * Math.PI) * sag, 0));
            const w = rng.range(0.5, 0.9);
            const hgt = rng.range(0.6, 1.1);
            const g = new THREE.Group();
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), cloth[rng.int(0, 3)]);
            m.position.y = -hgt / 2;
            g.add(m);
            g.position.copy(at);
            g.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
            scene.add(g);
            this.sway.push({ obj: g, amp: 0.35, phase: rng.range(0, 6), axis: 'x', pos: at });
          }
          lines++;
        }
      }
      // hanging signs and wall eyes on tower faces, vents at the bases
      let signs = 0;
      let eyes = 0;
      for (const t of towers) {
        if (t.h < 6) continue;
        const face = rng.int(0, 3);
        const n = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)][face];
        const cx = (t.x0 + t.x1) / 2;
        const cz = (t.z0 + t.z1) / 2;
        const fx = n.x > 0 ? t.x1 : n.x < 0 ? t.x0 : cx;
        const fz = n.z > 0 ? t.z1 : n.z < 0 ? t.z0 : cz;
        if (signs < 3 && rng.chance(0.4)) {
          const y = rng.range(3.5, Math.min(t.h - 1, 9));
          const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.3), signMat);
          bracket.position.set(fx + n.x * 0.65, y, fz + n.z * 0.65);
          bracket.rotation.y = Math.atan2(n.x, n.z);
          scene.add(bracket);
          const pivot = new THREE.Group();
          pivot.position.set(fx + n.x * 1.1, y - 0.03, fz + n.z * 1.1);
          pivot.rotation.y = Math.atan2(n.x, n.z) + Math.PI / 2;
          const board = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.06), signMat);
          board.position.y = -0.4;
          const eye = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), new THREE.MeshStandardMaterial({ color: '#f6f5f2', emissive: rng.pick([PALETTE.eyeFire, PALETTE.routeTeal, PALETTE.voidPurple]), emissiveIntensity: 0.9 }));
          eye.position.set(0, -0.4, 0.035);
          const eye2 = eye.clone();
          eye2.position.z = -0.035;
          eye2.rotation.y = Math.PI;
          pivot.add(board, eye, eye2);
          scene.add(pivot);
          this.sway.push({ obj: pivot, amp: 0.18, phase: rng.range(0, 6), axis: 'z', pos: pivot.position.clone() });
          signs++;
        } else if (eyes < 2 && rng.chance(0.35)) {
          const y = rng.range(3, Math.min(t.h - 1.2, 12));
          this.addEye(new THREE.Vector3(fx + n.x * 0.04, y, fz + n.z * 0.04), n, rng.range(0.7, 1.2), rng.pick([PALETTE.eyeFire, PALETTE.voidPurple, PALETTE.routeTeal, '#111114']));
          eyes++;
        }
      }
      for (let k = 0; k < Math.min(3, towers.length); k++) {
        const t = towers[rng.int(0, towers.length - 1)];
        const p = new THREE.Vector3(rng.chance(0.5) ? t.x0 - 0.8 : t.x1 + 0.8, 0.05, rng.range(t.z0, t.z1));
        const grate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), signMat);
        grate.position.copy(p);
        scene.add(grate);
        this.vents.push({ pos: p, t: rng.range(0, 3) });
      }
    }
  }

  private addEye(pos: THREE.Vector3, normal: THREE.Vector3, size: number, iris: string) {
    const g = new THREE.Group();
    const sclera = new THREE.Mesh(new THREE.CircleGeometry(size, 24), new THREE.MeshStandardMaterial({ color: '#f6f5f2', roughness: 0.6 }));
    sclera.scale.y = 0.7;
    const rim = new THREE.Mesh(new THREE.RingGeometry(size * 0.98, size * 1.12, 24), new THREE.MeshBasicMaterial({ color: '#111114' }));
    rim.scale.y = 0.7;
    const pupil = new THREE.Group();
    const irisM = new THREE.Mesh(new THREE.CircleGeometry(size * 0.42, 20), new THREE.MeshStandardMaterial({ color: iris, emissive: iris, emissiveIntensity: iris === PALETTE.eyeFire ? 1.6 : 0.3 }));
    const pup = new THREE.Mesh(new THREE.CircleGeometry(size * 0.2, 16), new THREE.MeshBasicMaterial({ color: '#0b0b0d' }));
    irisM.position.z = 0.005;
    pup.position.z = 0.01;
    pupil.add(irisM, pup);
    g.add(sclera, rim, pupil);
    g.position.copy(pos);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.scene.add(g);
    this.eyes.push({ group: g, pupil, base: pos.clone(), right: new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion), up: new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion), size, blink: 2 + Math.random() * 6 });
  }

  update(dt: number, focus: THREE.Vector3, speed: number) {
    this.time += dt;
    const t = this.time;
    // pigeons
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    let scattered = false;
    this.pigeons.forEach((p, i) => {
      if (p.state === 'peck') {
        const d = Math.hypot(p.pos.x - focus.x, p.pos.z - focus.z);
        if (d < (speed > 4 ? 5 : 2.2) && Math.abs(focus.y - p.pos.y) < 3) {
          p.state = 'fly';
          p.t = 0;
          const away = p.pos.clone().sub(focus).setY(0).normalize();
          p.vel.set(away.x * 4 + (Math.random() - 0.5) * 3, 5 + Math.random() * 2, away.z * 4 + (Math.random() - 0.5) * 3);
          scattered = true;
        } else {
          // waddle + peck
          const peck = Math.max(0, Math.sin(t * 3 + p.phase * 3));
          p.yaw += Math.sin(t * 0.7 + p.phase) * dt;
          p.pos.x = p.home.x + Math.sin(t * 0.3 + p.phase) * 0.4;
          p.pos.z = p.home.z + Math.cos(t * 0.27 + p.phase) * 0.4;
          q.setFromEuler(new THREE.Euler(peck * 0.5, p.yaw, 0));
          s.set(1, 1, 1);
          m.compose(p.pos.clone().setY(p.home.y + 0.1), q, s);
        }
      }
      if (p.state === 'fly') {
        p.t += dt;
        p.vel.y += dt * 1.5;
        p.pos.addScaledVector(p.vel, dt);
        const flap = Math.sin(t * 30 + p.phase) * 0.35;
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.vel.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), flap));
        s.set(1.3, 1, 1);
        m.compose(p.pos, q, s);
        if (p.t > 6) {
          p.state = 'gone';
          p.t = 0;
        }
      }
      if (p.state === 'gone') {
        p.t += dt;
        s.setScalar(0);
        m.compose(p.home, q.identity(), s);
        if (p.t > 25 && Math.hypot(p.home.x - focus.x, p.home.z - focus.z) > 25) {
          p.state = 'peck';
          p.pos.copy(p.home);
        }
      }
      this.pigeonMesh.setMatrixAt(i, m);
    });
    this.pigeonMesh.instanceMatrix.needsUpdate = true;
    if (scattered) this.audio.play('whoosh', { pitch: 2.2, vol: 0.45 });
    // swaying cloth and signs (only near the camera)
    for (const w of this.sway) {
      if (Math.abs(w.pos.x - focus.x) + Math.abs(w.pos.z - focus.z) > 160) continue;
      const a = (Math.sin(t * 1.7 + w.phase) * 0.6 + Math.sin(t * 3.1 + w.phase * 2) * 0.4) * w.amp * this.wind;
      if (w.axis === 'x') w.obj.rotation.x = a;
      else w.obj.rotation.z = a;
    }
    // steam vents
    for (const v of this.vents) {
      if (Math.abs(v.pos.x - focus.x) + Math.abs(v.pos.z - focus.z) > 70) continue;
      v.t -= dt;
      if (v.t <= 0) {
        v.t = 0.12;
        this.effects.dust(v.pos, 1, '#f2f2f4', 0.9, 0.4);
      }
    }
    // wall eyes follow and blink
    for (const e of this.eyes) {
      if (Math.abs(e.base.x - focus.x) + Math.abs(e.base.z - focus.z) > 120) continue;
      const to = focus.clone().add(up).sub(e.base).normalize();
      const x = THREE.MathUtils.clamp(to.dot(e.right), -0.6, 0.6);
      const y = THREE.MathUtils.clamp(to.dot(e.up), -0.6, 0.6);
      e.pupil.position.set(x * e.size * 0.9, y * e.size * 0.5, 0.004);
      e.blink -= dt;
      const closed = e.blink < 0.12 && e.blink > 0;
      e.group.scale.y = closed ? 0.08 : 1;
      if (e.blink <= 0) e.blink = 2.5 + Math.random() * 6;
    }
  }
}

function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
