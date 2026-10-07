import * as THREE from 'three';
import type { Hittable } from '../player/Combat';
import { queryHits } from '../player/Combat';
import type { Physics } from '../physics/Physics';
import type { Effects } from '../vfx/Effects';
import type { AudioEngine } from '../audio/Audio';
import type { Player } from '../player/Player';
import { WEAPONS, WEAPON_ORDER, WeaponId, Profile } from './Profile';
import { PALETTE } from '../world/Materials';

export interface WeaponHost {
  scene: THREE.Scene;
  physics: Physics;
  effects: Effects;
  audio: AudioEngine;
  profile: Profile;
  player: Player;
  camera: THREE.Camera;
  targets(): Iterable<Hittable>;
  explode(pos: THREE.Vector3, radius: number, damage: number, color: string, hurtPlayer: boolean): void;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  hitstop(t: number): void;
  /** Progression hook (counters, challenges). */
  event(name: string): void;
}

interface Shot {
  kind: 'pellet' | 'sticky' | 'cap';
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  life: number;
  /** Targets already hit (per leg for the cap). */
  hit: Set<string>;
  stuck?: { target: Hittable | null; offset: THREE.Vector3 };
  fuse?: number;
  /** Cap: seconds left on the outbound leg; returns once ≤ 0. */
  out?: number;
  side?: THREE.Vector3;
}

const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Weapons and throwables (T to use, Z to switch): the Boomerang Cap (free,
 * comes back), Ink Pistol (hold to fire), Paint Roller (two-handed sweep that
 * paints the street) and Sticky Grenade (sticks, then bursts).
 */
export class Weapons {
  private shots: Shot[] = [];
  /** Accessibility: 0 = no aim assist, 1 = strong. */
  assist = 0.6;
  private cooldown = 0;
  private emptyNag = 0;
  private sweep: { t: number; done: boolean } | null = null;
  private held = new Map<WeaponId, THREE.Object3D>();
  private pelletGeo = new THREE.SphereGeometry(0.09, 6, 4);
  private pelletMat = new THREE.MeshBasicMaterial({ color: '#111114' });
  private stickyMat = new THREE.MeshStandardMaterial({ color: '#2a1a4a', roughness: 0.3, emissive: PALETTE.voidPurple, emissiveIntensity: 1.2 });
  private capMat = new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.6 });

  constructor(private h: WeaponHost) {
    this.buildHeld();
  }

  get current(): WeaponId {
    return this.h.profile.data.weapon;
  }

  /** True while the cap is out (it is the one you throw). */
  get capOut(): boolean {
    return this.shots.some((s) => s.kind === 'cap');
  }

  hud(): { key: string; name: string; ammo: string; empty: boolean } {
    const w = this.current;
    const def = WEAPONS[w];
    const n = this.h.profile.data.ammo[w];
    const ammo = w === 'boomerang' ? (this.capOut ? 'in flight' : '∞') : `${n}`;
    return { key: 'T', name: def.name, ammo, empty: w !== 'boomerang' && n <= 0 };
  }

  /** Z: next weapon you have ammo for (the cap is always there). */
  cycle(dir = 1) {
    const p = this.h.profile.data;
    let i = WEAPON_ORDER.indexOf(p.weapon);
    for (let k = 0; k < WEAPON_ORDER.length; k++) {
      i = (i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length;
      const w = WEAPON_ORDER[i];
      if (w === 'boomerang' || p.ammo[w] > 0) break;
    }
    p.weapon = WEAPON_ORDER[i];
    this.h.profile.save();
    this.h.audio.play('ui', { pitch: 1.3 });
    this.h.toast(`${WEAPONS[p.weapon].name} · ${this.hud().ammo}`, 'info');
  }

  select(w: WeaponId) {
    this.h.profile.data.weapon = w;
    this.h.profile.save();
  }

  /** Called every fixed step with the current T state (held). */
  update(dt: number, triggerHeld: boolean, triggerPressed: boolean) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.emptyNag = Math.max(0, this.emptyNag - dt);
    const pl = this.h.player;
    const can = !pl.busy && pl.health > 0;
    const w = this.current;
    const fire = w === 'pistol' ? triggerHeld : triggerPressed;
    if (can && fire && this.cooldown <= 0) this.use(w);
    this.updateSweep(dt);
    this.updateShots(dt);
    this.updateHeld();
  }

  private use(w: WeaponId) {
    const prof = this.h.profile.data;
    if (w !== 'boomerang' && prof.ammo[w] <= 0) {
      if (this.emptyNag <= 0) {
        this.h.toast(`Out of ${WEAPONS[w].name} ${WEAPONS[w].unit} — open crates or buy packs (I). Z to switch.`, 'warn');
        this.emptyNag = 2.5;
      }
      this.cooldown = 0.3;
      return;
    }
    if (w === 'boomerang' && this.capOut) return;
    if (w !== 'boomerang') {
      prof.ammo[w]--;
      this.h.profile.save();
    }
    const { origin, dir } = this.aim(w === 'pistol' ? 45 : 30);
    const pl = this.h.player;
    pl.yaw = Math.atan2(dir.x, dir.z);
    // the pistol counts once per six shots (each event saves the profile)
    if (w !== 'pistol' || prof.ammo.pistol % 6 === 0) this.h.event('weaponUses');
    switch (w) {
      case 'pistol': {
        this.cooldown = 0.14;
        pl.anim.gesture('aim', 0.35);
        const mesh = new THREE.Mesh(this.pelletGeo, this.pelletMat);
        mesh.position.copy(origin);
        this.h.scene.add(mesh);
        const spread = _d.set((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03);
        this.shots.push({ kind: 'pellet', mesh, vel: dir.clone().add(spread).normalize().multiplyScalar(58), life: 0.9, hit: new Set() });
        this.h.effects.sparks3(origin, '#111114', 3, 3, 0.12, 0);
        this.h.audio.play('hit', { pitch: 2.2, vol: 0.35 });
        break;
      }
      case 'roller':
        this.cooldown = 0.75;
        pl.anim.gesture('sweep', 0.55);
        this.sweep = { t: 0, done: false };
        this.h.audio.play('whoosh', { pitch: 0.7 });
        break;
      case 'sticky': {
        this.cooldown = 0.6;
        pl.anim.gesture('throw', 0.45);
        const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), this.stickyMat);
        mesh.position.copy(origin);
        this.h.scene.add(mesh);
        this.shots.push({ kind: 'sticky', mesh, vel: dir.clone().multiplyScalar(19).add(_p.set(0, 4, 0)).addScaledVector(pl.vel, 0.4), life: 4, hit: new Set(), fuse: 2.6 });
        this.h.audio.play('whoosh');
        break;
      }
      case 'boomerang': {
        this.cooldown = 0.35;
        pl.anim.gesture('throw', 0.4);
        const cap = this.capMesh();
        cap.position.copy(origin);
        this.h.scene.add(cap);
        const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
        this.shots.push({ kind: 'cap', mesh: cap, vel: dir.clone().multiplyScalar(27), life: 6, hit: new Set(), out: 0.62, side });
        this.h.audio.play('whoosh', { pitch: 1.4 });
        break;
      }
    }
  }

  /** Camera ray with aim assist towards the best Agent inside a small cone. */
  private aim(range: number): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    const pl = this.h.player;
    const origin = pl.feet.clone().add(_p.set(0, 1.35, 0)).addScaledVector(pl.facing(_d), 0.45);
    const cam = this.h.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    let best: THREE.Vector3 | null = null;
    if (this.assist <= 0.01) range = 0;
    let bestCos = Math.cos(THREE.MathUtils.degToRad(3 + this.assist * 14));
    for (const t of this.h.targets()) {
      if (!t.alive || t.isProp) continue;
      t.center(_c);
      const to = _c.clone().sub(cam.position);
      const d = to.length();
      if (d > range + 8) continue;
      const cos = to.dot(fwd) / d;
      if (cos < bestCos) continue;
      const fromHand = _c.clone().sub(origin);
      const ld = fromHand.length();
      const block = this.h.physics.raycast(origin, fromHand.divideScalar(ld), ld - t.radius);
      if (block) continue;
      bestCos = cos;
      best = _c.clone();
    }
    if (best) return { origin, dir: best.sub(origin).normalize() };
    // no target: aim where the camera looks (the point it sees, not parallel to it)
    const hit = this.h.physics.raycast(cam.position, fwd, 120);
    const at = hit ? hit.point : cam.position.clone().addScaledVector(fwd, 60);
    const dir = at.sub(origin).normalize();
    // never shoot backwards into the camera when it sits in front of the hand
    if (dir.dot(fwd) < 0.2) dir.copy(fwd);
    return { origin, dir };
  }

  // ------------------------------------------------------------ roller

  private updateSweep(dt: number) {
    const s = this.sweep;
    if (!s) return;
    s.t += dt;
    const pl = this.h.player;
    if (!s.done && s.t > 0.2) {
      s.done = true;
      const f = pl.facing(new THREE.Vector3());
      const origin = pl.feet.clone().add(_p.set(0, 0.8, 0)).addScaledVector(f, 1.2);
      const hits = queryHits(origin, f, 2.4, -0.1, this.h.targets(), new Set());
      for (const t of hits) {
        const dir = t.center(new THREE.Vector3()).sub(pl.feet).setY(0).normalize();
        t.receiveHit({ dir, damage: 24, knock: 11, lift: 3.5, kind: 'heavy' });
        this.h.effects.inkBurst(t.center(new THREE.Vector3()), dir, PALETTE.routeTeal, 14);
      }
      if (hits.length) {
        this.h.audio.play('heavyHit', { vol: 0.8 });
        this.h.hitstop(0.07);
      }
      // paint a strip of ink in front: teal and purple stripes
      for (let i = 0; i < 6; i++) {
        const p = pl.feet.clone().addScaledVector(f, 1 + i * 1.1).add(_d.set(-f.z, 0, f.x).multiplyScalar((i % 2 ? 0.6 : -0.6)));
        const down = this.h.physics.raycast(p.clone().setY(p.y + 1.5), _c.set(0, -1, 0), 4);
        if (down) this.h.effects.splat(down.point.add(_c.set(0, 0.03, 0)), down.normal, i % 3 === 2 ? PALETTE.voidPurple : PALETTE.routeTeal, 1.6 + Math.random() * 0.6);
      }
      this.h.audio.play('ink', { vol: 0.5 });
    }
    if (s.t > 0.55) this.sweep = null;
  }

  // ------------------------------------------------------------ projectiles

  private updateShots(dt: number) {
    const pl = this.h.player;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.life -= dt;
      let dead = s.life <= 0;
      if (s.kind === 'pellet') dead = this.stepPellet(s, dt) || dead;
      else if (s.kind === 'sticky') {
        if (this.stepSticky(s, dt)) {
          this.h.explode(s.mesh.position.clone(), 5, 55, PALETTE.voidPurple, false);
          dead = true;
        } else if (dead) {
          this.h.explode(s.mesh.position.clone(), 5, 55, PALETTE.voidPurple, false);
        }
      } else if (s.kind === 'cap') {
        const caught = this.stepCap(s, dt, pl);
        if (caught) {
          this.h.audio.play('catch', { vol: 0.6, pitch: 1.3 });
          dead = true;
        }
      }
      if (dead) {
        s.mesh.removeFromParent();
        this.shots.splice(i, 1);
      }
    }
  }

  /** Swept sphere test from a to b against hittables; returns the first new one. */
  private sweepHit(a: THREE.Vector3, b: THREE.Vector3, r: number, skip: Set<string>): Hittable | null {
    const ab = _d.copy(b).sub(a);
    const len2 = ab.lengthSq() || 1;
    let best: Hittable | null = null;
    let bt = Infinity;
    for (const t of this.h.targets()) {
      if (!t.alive || skip.has(t.key)) continue;
      t.center(_c);
      const tt = THREE.MathUtils.clamp(_p.copy(_c).sub(a).dot(ab) / len2, 0, 1);
      const q = _p.copy(a).addScaledVector(ab, tt);
      const rr = r + t.radius + (t.isProp ? 0 : 0.25);
      if (q.distanceToSquared(_c) < rr * rr && tt < bt) {
        bt = tt;
        best = t;
      }
    }
    return best;
  }

  private stepPellet(s: Shot, dt: number): boolean {
    s.vel.y -= 4 * dt;
    const a = s.mesh.position.clone();
    const b = a.clone().addScaledVector(s.vel, dt);
    const len = a.distanceTo(b);
    const wall = this.h.physics.raycast(a, s.vel.clone().normalize(), len);
    const tgt = this.sweepHit(a, wall ? wall.point : b, 0.1, s.hit);
    if (tgt) {
      const dir = s.vel.clone().setY(0).normalize();
      if (tgt.receiveHit({ dir, damage: 7, knock: 1.6, lift: 0.4, kind: 'light' })) this.h.audio.play('hit', { pitch: 1.6, vol: 0.4 });
      this.h.effects.inkBurst(tgt.center(new THREE.Vector3()), dir.negate(), '#111114', 6);
      return true;
    }
    if (wall) {
      this.h.effects.splat(wall.point.addScaledVector(wall.normal, 0.02), wall.normal, '#111114', 0.35 + Math.random() * 0.2);
      return true;
    }
    s.mesh.position.copy(b);
    return false;
  }

  /** Returns true when the fuse runs out. */
  private stepSticky(s: Shot, dt: number): boolean {
    const m = s.mesh as THREE.Mesh;
    if (s.stuck) {
      s.fuse! -= dt;
      if (s.stuck.target) {
        if (!s.stuck.target.alive) s.stuck.target = null;
        else s.mesh.position.copy(s.stuck.target.center(_c)).add(s.stuck.offset);
      }
      // blink faster as it is about to go
      const blink = Math.sin((1.6 - s.fuse!) * (8 + (1.6 - s.fuse!) * 18)) > 0;
      this.stickyMat.emissiveIntensity = blink ? 3 : 0.6;
      m.scale.setScalar(1 + (blink ? 0.15 : 0));
      if (Math.random() < 0.3) this.h.effects.sparks3(s.mesh.position, PALETTE.voidPurple, 1, 1.5, 0.15, 0);
      return s.fuse! <= 0;
    }
    s.vel.y -= 20 * dt;
    const a = s.mesh.position.clone();
    const b = a.clone().addScaledVector(s.vel, dt);
    const len = a.distanceTo(b);
    const tgt = this.sweepHit(a, b, 0.2, s.hit);
    if (tgt) {
      s.stuck = { target: tgt, offset: a.clone().sub(tgt.center(_c)).setLength(Math.max(0.3, tgt.radius * 0.8)) };
      s.fuse = 1.5;
      this.h.audio.play('ink', { pitch: 1.8, vol: 0.5 });
      return false;
    }
    const wall = len > 0 ? this.h.physics.raycast(a, s.vel.clone().normalize(), len + 0.2) : null;
    if (wall) {
      s.mesh.position.copy(wall.point).addScaledVector(wall.normal, 0.15);
      s.stuck = { target: null, offset: new THREE.Vector3() };
      s.fuse = 1.5;
      this.h.effects.splat(wall.point.addScaledVector(wall.normal, 0.02), wall.normal, PALETTE.voidPurple, 0.6);
      this.h.audio.play('ink', { pitch: 1.8, vol: 0.5 });
      return false;
    }
    s.mesh.position.copy(b);
    s.mesh.rotation.x += dt * 9;
    return false;
  }

  /** Returns true once the cap is back in your hand. */
  private stepCap(s: Shot, dt: number, pl: Player): boolean {
    const a = s.mesh.position.clone();
    const hand = pl.feet.clone().add(_p.set(0, 1.3, 0));
    if (s.out! > 0) {
      s.out! -= dt;
      // curve out to the side and slow down at the far end
      s.vel.addScaledVector(s.side!, 10 * dt).multiplyScalar(1 - dt * 0.8);
      const wall = this.h.physics.raycast(a, s.vel.clone().normalize(), s.vel.length() * dt + 0.3);
      if (wall) {
        this.h.effects.sparks3(wall.point, '#ffffff', 6, 4, 0.15, 6);
        s.out = 0;
      }
      if (s.out! <= 0) s.hit.clear(); // fresh leg: everything can be hit again on the way back
    } else {
      // home in on the thrower
      const to = hand.clone().sub(a);
      const d = to.length();
      if (d < 1.1) return true;
      const sp = Math.min(34, 14 + (0.62 - s.out!) * 30);
      s.out! -= dt;
      s.vel.lerp(to.divideScalar(d).multiplyScalar(sp), Math.min(1, dt * 7));
    }
    const b = a.clone().addScaledVector(s.vel, dt);
    for (let k = 0; k < 3; k++) {
      const tgt = this.sweepHit(a, b, 0.35, s.hit);
      if (!tgt) break;
      s.hit.add(tgt.key);
      const dir = s.vel.clone().setY(0).normalize();
      if (tgt.receiveHit({ dir, damage: 12, knock: 6, lift: 2, kind: 'light' })) {
        this.h.audio.play('hit', { pitch: 1.2, vol: 0.6 });
        this.h.effects.inkBurst(tgt.center(new THREE.Vector3()), dir, '#111114', 10);
      }
    }
    s.mesh.position.copy(b);
    s.mesh.rotation.y += dt * 24;
    if (Math.random() < 0.6) this.h.effects.trailPoint(s.mesh.position);
    return s.life <= 0.05 && s.mesh.position.distanceTo(hand) < 3;
  }

  // ------------------------------------------------------------ held models

  private capMesh(): THREE.Object3D {
    const g = new THREE.Group();
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.capMat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 12, 1, false, -Math.PI / 2, Math.PI), this.capMat);
    brim.scale.set(1, 1, 1.6);
    brim.position.z = 0.08;
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.07, 10), new THREE.MeshBasicMaterial({ color: '#ff7a1a' }));
    eye.position.set(0, 0.12, 0.16);
    eye.rotation.x = -0.6;
    g.add(crown, brim, eye);
    g.userData.noMap = true;
    return g;
  }

  private buildHeld() {
    const dark = new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.4, metalness: 0.4 });
    const teal = new THREE.MeshStandardMaterial({ color: PALETTE.routeTeal, roughness: 0.5, emissive: '#0b4e4b', emissiveIntensity: 0.6 });
    // pistol: grip + barrel with a teal ink tank
    const pistol = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.08), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.26), dark);
    barrel.position.set(0, 0.07, 0.08);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8), teal);
    tank.position.set(0, 0.14, 0.02);
    pistol.add(grip, barrel, tank);
    // roller: long handle and a teal roll
    const roller = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), dark);
    handle.rotation.x = Math.PI / 2;
    handle.position.z = 0.5;
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 12), teal);
    roll.rotation.z = Math.PI / 2;
    roll.position.z = 1.08;
    roller.add(handle, roll);
    // grenade in the palm
    const sticky = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 1), this.stickyMat);
    for (const [id, m] of [['pistol', pistol], ['roller', roller], ['sticky', sticky]] as const) {
      m.visible = false;
      m.traverse((o) => {
        o.castShadow = true;
      });
      this.h.player.rig.joints.handR.add(m);
      this.held.set(id, m);
    }
  }

  private updateHeld() {
    const pl = this.h.player;
    const show = !pl.busy && !pl.firstPerson;
    for (const [id, m] of this.held) m.visible = show && id === this.current && (id !== 'sticky' || this.h.profile.data.ammo.sticky > 0);
  }
}
