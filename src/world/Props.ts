import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/Physics';
import type { Effects } from '../vfx/Effects';
import type { AudioEngine } from '../audio/Audio';
import type { PropSpot } from './islands/types';
import type { HitInfo, Hittable } from '../player/Combat';
import type { Player } from '../player/Player';
import { hazardTexture, wallEyeTexture } from './Textures';
import { PALETTE } from './Materials';
import { jumpVelocity } from '../../shared/tuning';

export interface PropsHost {
  scene: THREE.Scene;
  physics: Physics;
  effects: Effects;
  audio: AudioEngine;
  explode(pos: THREE.Vector3, radius: number, damage: number, color: string, hurtPlayer: boolean): void;
  dropInk(pos: THREE.Vector3, n: number): void;
  /** Vending machine purchase; returns a message or null if you can't pay. */
  vend(): string | null;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  /** Progress counters (achievements). */
  event?(name: string): void;
}

interface Breakable {
  kind: 'crate' | 'barrel' | 'xbarrel' | 'glass';
  group: THREE.Group;
  pos: THREE.Vector3;
  half: THREE.Vector3;
  colliders: RAPIER.Collider[];
  broken: boolean;
  respawn: number;
  fuse: number;
  target: Hittable;
}

interface Junk {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  target: Hittable;
}

interface Debris {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  life: number;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a1fe0';
  g.fillRect(0, 0, 64, 128);
  g.strokeStyle = '#e8dcff';
  g.lineWidth = 10;
  for (const y of [40, 104]) {
    g.beginPath();
    g.moveTo(8, y);
    g.lineTo(32, y - 22);
    g.lineTo(56, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Interactive street furniture: breakables (crates, barrels, glass) that
 * are hit like enemies, explosive ink barrels with chain reactions, a
 * vending machine, jump pads, goo boost strips, grind rails and physics
 * junk you can kick, punch or drive through.
 */
export class Props {
  private breakables: Breakable[] = [];
  private junk: Junk[] = [];
  private debris: Debris[] = [];
  private pads: Array<{ pos: THREE.Vector3; cap: THREE.Object3D; vy: number; squash: number }> = [];
  /** Fire hydrants: hit one and it erupts into a geyser you can ride up for a few seconds. */
  private hydrants: Array<{ pos: THREE.Vector3; cap: THREE.Object3D; t: number; cd: number; jet: THREE.Mesh; target?: Hittable; rode?: boolean }> = [];
  private boosts: Array<{ pos: THREE.Vector3; yaw: number; mesh: THREE.Mesh }> = [];
  private vendors: THREE.Vector3[] = [];
  private visuals: Array<{ obj: THREE.Object3D; pos: THREE.Vector3 }> = [];
  private time = 0;
  private boostTex = chevronTexture();
  private m = {
    crate: new THREE.MeshStandardMaterial({ color: '#cfc9be', roughness: 0.8 }),
    crateEdge: new THREE.MeshStandardMaterial({ color: '#2a2a30', roughness: 0.7 }),
    barrel: new THREE.MeshStandardMaterial({ color: '#2a2a30', roughness: 0.45, metalness: 0.3 }),
    band: new THREE.MeshStandardMaterial({ color: '#e9e7e2', roughness: 0.5 }),
    xbarrel: new THREE.MeshStandardMaterial({ color: PALETTE.voidPurple, emissive: '#3a12a8', emissiveIntensity: 1.2, roughness: 0.35 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: '#58c9c3', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45 }),
    frame: new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.5 }),
    pad: new THREE.MeshStandardMaterial({ color: PALETTE.routeTeal, emissive: '#0b6e69', emissiveIntensity: 1.4, roughness: 0.3, flatShading: true }),
    stalk: new THREE.MeshStandardMaterial({ color: '#e6e4e0', roughness: 0.7, flatShading: true }),
    rail: new THREE.MeshStandardMaterial({ color: '#c8cad0', metalness: 0.85, roughness: 0.25 }),
    cone: new THREE.MeshStandardMaterial({ color: '#f1efea', roughness: 0.6 }),
    coneBand: new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.6 }),
    bin: new THREE.MeshStandardMaterial({ color: '#3a3a40', roughness: 0.6, metalness: 0.2 }),
    card: new THREE.MeshStandardMaterial({ color: '#a8a39a', roughness: 0.9 }),
  };

  constructor(private host: PropsHost, spots: PropSpot[]) {
    for (const s of spots) this.create(s);
  }

  // ------------------------------------------------------------ building

  private track(obj: THREE.Object3D, pos: THREE.Vector3) {
    this.host.scene.add(obj);
    this.visuals.push({ obj, pos: pos.clone() });
  }

  private target(key: string, center: () => THREE.Vector3, radius: number, onHit: (h: HitInfo) => void): Hittable {
    const t = {
      key,
      radius,
      alive: true,
      isProp: true,
      center: (out: THREE.Vector3) => out.copy(center()),
      receiveHit: (h: HitInfo) => {
        onHit(h);
        return true;
      },
    };
    return t;
  }

  private create(s: PropSpot) {
    const { physics } = this.host;
    const yaw = s.yaw ?? 0;
    const id = `prop:${this.breakables.length + this.junk.length + this.pads.length + this.boosts.length + this.vendors.length}`;
    if (s.kind === 'crate' || s.kind === 'barrel' || s.kind === 'xbarrel') {
      const n = Math.max(1, s.variant ?? 1);
      for (let i = 0; i < n; i++) {
        const g = new THREE.Group();
        const pos = s.pos.clone().add(new THREE.Vector3(Math.cos(yaw + i * 2.1) * (i ? 1.05 : 0), 0, Math.sin(yaw + i * 2.1) * (i ? 1.05 : 0)));
        let half: THREE.Vector3;
        if (s.kind === 'crate') {
          const box = new THREE.Mesh(BOX, this.m.crate);
          box.scale.setScalar(0.95);
          const edge = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 1), this.m.crateEdge);
          edge.position.y = 0.42;
          const edge2 = edge.clone();
          edge2.position.y = -0.42;
          g.add(box, edge, edge2);
          g.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
          half = new THREE.Vector3(0.5, 0.5, 0.5);
        } else {
          const ex = s.kind === 'xbarrel' && i === 0;
          const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14), ex ? this.m.xbarrel : this.m.barrel);
          const band = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.16, 14), ex ? this.m.hazard : this.m.band);
          g.add(body, band);
          g.position.copy(pos).add(new THREE.Vector3(0, 0.53, 0));
          half = new THREE.Vector3(0.42, 0.53, 0.42);
        }
        g.rotation.y = yaw + i;
        g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o.castShadow = true), (o.receiveShadow = true)) : 0));
        this.track(g, g.position);
        const col = physics.addStaticBox(g.position.clone(), half.clone().multiplyScalar(2), 'wood');
        const kind = s.kind === 'xbarrel' && i > 0 ? 'barrel' : s.kind;
        const b: Breakable = { kind, group: g, pos: g.position.clone(), half, colliders: [col], broken: false, respawn: 0, fuse: -1, target: null! };
        b.target = this.target(`${id}:${i}`, () => b.pos, 0.6, (h) => this.hit(b, h));
        this.breakables.push(b);
      }
      return;
    }
    if (s.kind === 'glass') {
      const g = new THREE.Group();
      const pane = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 0.06), this.m.glass);
      pane.position.y = 1.6;
      g.add(pane);
      for (const x of [-1.25, 1.25]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.7, 0.12), this.m.frame);
        post.position.set(x, 1.35, 0);
        g.add(post);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.14), this.m.frame);
      top.position.y = 2.65;
      g.add(top);
      g.position.copy(s.pos);
      g.rotation.y = yaw;
      this.track(g, s.pos);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const col = physics.addStaticBox(s.pos.clone().add(new THREE.Vector3(0, 1.6, 0)), new THREE.Vector3(2.4, 2, 0.12), 'glass', q);
      const b: Breakable = { kind: 'glass', group: g, pos: s.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), half: new THREE.Vector3(1.2, 1, 0.06), colliders: [col], broken: false, respawn: 0, fuse: -1, target: null! };
      b.target = this.target(id, () => b.pos, 1.1, (h) => this.hit(b, h));
      this.breakables.push(b);
      return;
    }
    if (s.kind === 'vending') {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.1, 0.8), this.m.frame);
      body.position.y = 1.05;
      const tex = wallEyeTexture(PALETTE.routeTeal, true);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.2), new THREE.MeshStandardMaterial({ color: '#0a2b29', emissive: '#17a9a3', emissiveMap: tex, emissiveIntensity: 1.3, map: tex }));
      screen.position.set(0, 1.25, 0.41);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.05), this.m.band);
      slot.position.set(0, 0.35, 0.41);
      g.add(body, screen, slot);
      g.position.copy(s.pos);
      g.rotation.y = yaw;
      g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : 0));
      this.track(g, s.pos);
      physics.addStaticBox(s.pos.clone().add(new THREE.Vector3(0, 1.05, 0)), new THREE.Vector3(1.1, 2.1, 0.8), 'concrete', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      this.vendors.push(s.pos.clone().add(new THREE.Vector3(Math.sin(yaw) * 0.9, 0, Math.cos(yaw) * 0.9)));
      return;
    }
    if (s.kind === 'hydrant') {
      const g = new THREE.Group();
      const red = new THREE.MeshStandardMaterial({ color: '#d8352a', roughness: 0.45, metalness: 0.2 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.75, 12), red);
      body.position.y = 0.38;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), red);
      cap.position.y = 0.75;
      for (const s2 of [-1, 1]) {
        const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 8), this.m.frame);
        nozzle.rotation.z = Math.PI / 2;
        nozzle.position.set(s2 * 0.25, 0.5, 0);
        g.add(nozzle);
      }
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.18, 1, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#bfeff2', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
      jet.visible = false;
      g.add(body, cap, jet);
      g.position.copy(s.pos);
      g.rotation.y = yaw;
      g.traverse((o) => ((o as THREE.Mesh).isMesh && o !== jet ? (o.castShadow = true) : 0));
      this.track(g, s.pos);
      physics.addStaticCylinder(s.pos.clone().add(new THREE.Vector3(0, 0.4, 0)), 0.25, 0.8, 'concrete');
      const hy: (typeof this.hydrants)[number] = { pos: s.pos.clone(), cap, t: 0, cd: 0, jet };
      this.hydrants.push(hy);
      hy.target = this.target(`${id}:hydrant`, () => hy.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 0.5, () => {
        if (hy.t > 0 || hy.cd > 0) return;
        hy.t = 7;
        hy.rode = false;
        this.host.audio.play('splash', { vol: 0.9 });
        this.host.effects.shockwave(hy.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), '#bfeff2', 2.5);
      });
      return;
    }
    if (s.kind === 'pad') {
      // bounce mushroom: white stalk, glowing teal cap you land on
      const g = new THREE.Group();
      const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.7, 8), this.m.stalk);
      stalk.position.y = 0.35;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.25, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), this.m.pad);
      cap.position.y = 0.45;
      cap.scale.y = 0.7;
      g.add(stalk, cap);
      g.position.copy(s.pos);
      g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : 0));
      this.track(g, s.pos);
      physics.addStaticCylinder(s.pos.clone().add(new THREE.Vector3(0, 0.45, 0)), 1.15, 0.9, 'goo');
      this.pads.push({ pos: s.pos.clone(), cap, vy: jumpVelocity(Math.max(6, (s.variant ?? 7) + 2.5)), squash: 0 });
      return;
    }
    if (s.kind === 'boost') {
      const mat = new THREE.MeshStandardMaterial({ map: this.boostTex.clone(), emissive: '#6b2bff', emissiveIntensity: 0.9, roughness: 0.2 });
      (mat.map as THREE.Texture).repeat.set(1, 4);
      (mat.map as THREE.Texture).needsUpdate = true;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 8), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = -yaw;
      mesh.position.copy(s.pos).add(new THREE.Vector3(0, 0.04, 0));
      mesh.receiveShadow = true;
      this.track(mesh, s.pos);
      this.boosts.push({ pos: s.pos.clone(), yaw, mesh });
      return;
    }
    if (s.kind === 'rail' && s.to) {
      const a = s.pos.clone().setY(s.pos.y + 0.9);
      const bb = s.to.clone().setY(s.to.y + 0.9);
      const len = a.distanceTo(bb);
      const g = new THREE.Group();
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 8), this.m.rail);
      pipe.position.copy(a).add(bb).multiplyScalar(0.5);
      pipe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bb.clone().sub(a).normalize());
      g.add(pipe);
      const n = Math.max(2, Math.round(len / 4));
      for (let k = 0; k <= n; k++) {
        const p = a.clone().lerp(bb, k / n);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), this.m.frame);
        post.position.copy(p).add(new THREE.Vector3(0, -0.45, 0));
        g.add(post);
      }
      g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : 0));
      this.track(g, pipe.position);
      return;
    }
    if (s.kind === 'junk') {
      const v = s.variant ?? 0;
      let mesh: THREE.Mesh;
      let half: THREE.Vector3;
      if (v === 0) {
        mesh = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 10), this.m.cone);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 10), this.m.coneBand);
        mesh.add(band);
        half = new THREE.Vector3(0.24, 0.37, 0.24);
      } else if (v === 1) {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.9, 12), this.m.bin);
        half = new THREE.Vector3(0.3, 0.45, 0.3);
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.55), this.m.card);
        half = new THREE.Vector3(0.35, 0.25, 0.27);
      }
      mesh.castShadow = true;
      const start = s.pos.clone().add(new THREE.Vector3(0, half.y + 0.02, 0));
      mesh.position.copy(start);
      mesh.userData.home = start.clone();
      this.host.scene.add(mesh);
      const { body } = physics.addDebris(start, half, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      body.sleep();
      const j: Junk = { mesh, body, target: null! };
      j.target = this.target(`${id}:junk`, () => mesh.position, 0.4, (h) => this.kick(j, h.dir.clone().multiplyScalar(h.knock * 0.8).setY(h.lift + 2)));
      this.junk.push(j);
    }
  }

  // ------------------------------------------------------------ interaction

  /** Breakables and junk near a point (for attacks, bombs, explosions). */
  targets(near: THREE.Vector3, radius = 30): Hittable[] {
    const out: Hittable[] = [];
    for (const b of this.breakables) if (!b.broken && b.pos.distanceToSquared(near) < radius * radius) out.push(b.target);
    for (const j of this.junk) if (j.mesh.position.distanceToSquared(near) < radius * radius) out.push(j.target);
    for (const hy of this.hydrants) if (hy.target && hy.pos.distanceToSquared(near) < radius * radius) out.push(hy.target);
    return out;
  }

  prompt(feet: THREE.Vector3): string | null {
    return this.vendors.some((v) => v.distanceTo(feet) < 1.8) ? 'F · Vending machine: random item (25 Ink)' : null;
  }

  interact(feet: THREE.Vector3): boolean {
    if (!this.vendors.some((v) => v.distanceTo(feet) < 1.8)) return false;
    const msg = this.host.vend();
    this.host.toast(msg ?? 'Need 25 Ink', msg ? 'info' : 'warn');
    this.host.audio.play(msg ? 'ui' : 'hurt', { pitch: msg ? 1.3 : 1 });
    return true;
  }

  private hit(b: Breakable, h: HitInfo) {
    if (b.broken) return;
    if (b.kind === 'xbarrel') {
      if (b.fuse < 0) {
        b.fuse = 0.55;
        this.host.audio.play('spot', { pitch: 1.6, vol: 0.6 });
      }
      return;
    }
    this.smash(b, h.dir);
  }

  private smash(b: Breakable, dir: THREE.Vector3) {
    const h = this.host;
    b.broken = true;
    b.group.visible = false;
    for (const c of b.colliders) h.physics.removeCollider(c);
    b.colliders = [];
    b.respawn = 90;
    const glass = b.kind === 'glass';
    h.audio.play('smash', { pitch: glass ? 1.7 : b.kind === 'barrel' ? 0.8 : 1.1, vol: 0.7 });
    h.effects.dust(b.pos, glass ? 6 : 14, glass ? '#bdf3f0' : '#d8d4cc', 0.4, 2.5);
    // chunks
    const n = glass ? 10 : 6;
    for (let i = 0; i < n; i++) {
      const s = glass ? 0.22 + Math.random() * 0.3 : 0.25 + Math.random() * 0.25;
      const half = glass ? new THREE.Vector3(s, s * 0.8, 0.03) : new THREE.Vector3(s, s * 0.6, s * 0.7);
      const p = b.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * b.half.x * 1.6, (Math.random() - 0.5) * b.half.y * 1.6, (Math.random() - 0.5) * b.half.z * 1.6));
      const { body } = h.physics.addDebris(p, half, _q.setFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3)));
      const imp = dir.clone().setY(0).normalize().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3));
      body.applyImpulse({ x: imp.x * body.mass(), y: imp.y * body.mass(), z: imp.z * body.mass() }, true);
      const mesh = new THREE.Mesh(BOX, glass ? this.m.glass : b.kind === 'crate' ? this.m.crate : this.m.barrel);
      mesh.scale.copy(half).multiplyScalar(2);
      mesh.castShadow = !glass;
      h.scene.add(mesh);
      this.debris.push({ mesh, body, life: 3.5 + Math.random() });
    }
    if (b.kind !== 'glass') h.dropInk(b.pos, 1 + Math.floor(Math.random() * 3));
  }

  private kick(j: Junk, impulse: THREE.Vector3) {
    const m = j.body.mass();
    j.body.wakeUp();
    j.body.applyImpulse({ x: impulse.x * m, y: impulse.y * m, z: impulse.z * m }, true);
    j.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 0.6, y: (Math.random() - 0.5) * m * 0.6, z: (Math.random() - 0.5) * m * 0.6 }, true);
  }

  // ------------------------------------------------------------ per frame

  update(dt: number, player: Player | null) {
    this.time += dt;
    const h = this.host;
    const feet = player?.feet ?? _v.set(0, -999, 0);
    for (const v of this.visuals) v.obj.visible = Math.abs(v.pos.x - feet.x) + Math.abs(v.pos.z - feet.z) < 180;
    // breakables: fuses, respawns, vehicles smashing through
    const veh = player?.vehicle ?? null;
    for (const b of this.breakables) {
      if (b.fuse >= 0) {
        b.fuse -= dt;
        (b.group.children[0] as THREE.Mesh).scale.setScalar(1 + Math.sin(this.time * 40) * 0.06);
        if (b.fuse < 0) {
          b.broken = true;
          b.group.visible = false;
          for (const c of b.colliders) h.physics.removeCollider(c);
          b.colliders = [];
          b.respawn = 90;
          h.explode(b.pos.clone(), 5.5, 45, PALETTE.voidPurple, true);
          // chain reaction
          for (const o of this.breakables) if (o !== b && !o.broken && o.kind === 'xbarrel' && o.fuse < 0 && o.pos.distanceTo(b.pos) < 6) o.fuse = 0.25 + Math.random() * 0.2;
          for (const o of this.breakables) if (o !== b && !o.broken && o.kind !== 'xbarrel' && o.pos.distanceTo(b.pos) < 4) this.smash(o, o.pos.clone().sub(b.pos).normalize());
        }
      }
      if (b.broken && b.fuse < 0) {
        b.respawn -= dt;
        if (b.respawn <= 0 && b.pos.distanceTo(feet) > 30) {
          b.broken = false;
          b.group.visible = true;
          (b.group.children[0] as THREE.Mesh).scale.setScalar(b.kind === 'crate' ? 0.95 : 1);
          b.colliders = [h.physics.addStaticBox(b.pos.clone(), b.half.clone().multiplyScalar(2), b.kind === 'glass' ? 'glass' : 'wood')];
        }
      }
      if (veh && !b.broken && Math.abs(veh.speed) > 4 && b.pos.distanceTo(veh.position) < 2.3) {
        if (b.kind === 'xbarrel') b.fuse = Math.min(b.fuse < 0 ? 0.15 : b.fuse, 0.15);
        else this.smash(b, veh.forward());
      }
    }
    // junk: kicked by running into it or by the car
    const hs = player ? Math.hypot(player.vel.x, player.vel.z) : 0;
    for (const j of this.junk) {
      const t = j.body.translation();
      const r = j.body.rotation();
      j.mesh.position.set(t.x, t.y, t.z);
      j.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (!player) continue;
      if (veh) {
        if (Math.abs(veh.speed) > 3 && j.mesh.position.distanceTo(veh.position) < 2.4) this.kick(j, veh.forward().multiplyScalar(Math.abs(veh.speed) * 0.7).setY(4));
      } else if (hs > 2 && j.mesh.position.distanceTo(feet.clone().setY(feet.y + 0.4)) < 0.95) {
        this.kick(j, player.vel.clone().setY(0).multiplyScalar(0.7).setY(2.5));
        h.audio.play('step', { pitch: 1.6, vol: 0.5 });
      }
      if (t.y < -60) {
        // fell off the island: put it back where it was
        j.body.setTranslation({ x: j.mesh.userData.home?.x ?? t.x, y: 5, z: j.mesh.userData.home?.z ?? t.z }, true);
      }
    }
    // hydrant geysers: the cap pops, water shoots up, standing in it lifts you high
    for (const hy of this.hydrants) {
      hy.cd = Math.max(0, hy.cd - dt);
      if (hy.t <= 0) continue;
      hy.t -= dt;
      const on = hy.t > 0;
      hy.jet.visible = on;
      hy.cap.position.y = on ? 0.75 + 6 + Math.sin(this.time * 9) * 0.3 : 0.75;
      const height = 7 + Math.sin(this.time * 6) * 0.6;
      hy.jet.scale.set(1, height, 1);
      hy.jet.position.y = 0.75 + height / 2;
      if (Math.random() < 0.6) h.effects.dust(hy.pos.clone().add(new THREE.Vector3(0, height * Math.random(), 0)), 2, '#dff7f9', 0.35, 1.2);
      if (!on) hy.cd = 20;
      if (on && player && !veh) {
        const d = Math.hypot(feet.x - hy.pos.x, feet.z - hy.pos.z);
        if (d < 0.9 && feet.y < hy.pos.y + height && player.vel.y < 9) {
          player.launch(Math.max(player.vel.y, 13));
          if (!hy.rode) {
            hy.rode = true;
            h.event?.('geysers');
          }
        }
      }
    }
    // jump pads
    for (const p of this.pads) {
      p.squash = Math.max(0, p.squash - dt * 4);
      p.cap.scale.set(1 + p.squash * 0.25, 0.7 - p.squash * 0.35, 1 + p.squash * 0.25);
      if (!player || veh) continue;
      const d = Math.hypot(feet.x - p.pos.x, feet.z - p.pos.z);
      if (d < 1.3 && feet.y > p.pos.y + 0.5 && feet.y < p.pos.y + 1.6 && player.vel.y <= 0.5) {
        player.launch(p.vy);
        p.squash = 1;
        h.audio.play('jump', { pitch: 0.7, vol: 0.9 });
        h.effects.shockwave(p.pos.clone().add(new THREE.Vector3(0, 0.9, 0)), PALETTE.routeTeal, 2.5);
      }
    }
    // boost strips (scrolling chevrons)
    for (const b of this.boosts) {
      (b.mesh.material as THREE.MeshStandardMaterial).map!.offset.y -= dt * 1.6;
      if (!player || veh || !player.grounded) continue;
      const dx = feet.x - b.pos.x;
      const dz = feet.z - b.pos.z;
      const along = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
      const side = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw);
      if (Math.abs(along) < 4 && Math.abs(side) < 0.95 && Math.abs(feet.y - b.pos.y) < 0.6) {
        if (player.boostT < 0.3) h.audio.play('whoosh', { pitch: 1.5, vol: 0.5 });
        player.boost(1.8);
        if (Math.random() < 0.5) h.effects.dust(feet, 2, PALETTE.voidPurple, 0.3, 1);
      }
    }
    // debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      const t = d.body.translation();
      const r = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (d.life < 0.4) d.mesh.scale.multiplyScalar(0.9);
      if (d.life <= 0) {
        h.physics.removeBody(d.body);
        d.mesh.removeFromParent();
        this.debris.splice(i, 1);
      }
    }
  }
}
