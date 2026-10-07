import * as THREE from 'three';
import { CharacterRig } from '../character/CharacterRig';
import { Animator, AnimState, AttackId, packAttack } from '../character/Animator';
import { AGENT_APPEARANCE, Appearance } from '../character/Appearance';
import type { CharacterBody } from '../physics/Physics';
import type { GameContext } from '../core/GameContext';
import type { HitInfo, Hittable } from '../player/Combat';
import { TUNING, jumpVelocity } from '../../shared/tuning';
import { clamp, damp, dampAngle, makeRng } from '../core/math';
import { markerTexture } from '../world/Textures';
import type { NetAgentState } from '../../shared/protocol';

/** A potential target for agents (local player or a remote player). */
export interface AgentTarget {
  key: string;
  feet: THREE.Vector3;
  hittable: Hittable;
  canBeTargeted: boolean;
  /** For leading shots. */
  vel?: THREE.Vector3;
}

interface Bolt {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  owner: number;
}

const boltGeo = new THREE.SphereGeometry(0.12, 8, 6);
boltGeo.scale(1, 1, 3.5);

enum AIState {
  Idle,
  Chase,
  Windup,
  Strike,
  Recover,
  Lunge,
  Hit,
  Dead,
}

const KINDS = ['agent', 'runner', 'brute', 'shield', 'sniper', 'drone', 'static'] as const;
export type AgentKind = (typeof KINDS)[number];
export type BossKind = 'warden' | 'lion' | 'serpent' | 'gladiator';
export const BOSS_NAMES: Record<BossKind, string> = { warden: 'The Warden', lion: 'Lion Guardian', serpent: 'Kukulkan', gladiator: 'Gladiator King' };

const DIFFICULTY = {
  chill: { max: 3, speed: 4.4, dmg: 0.6, tokens: 1 },
  normal: { max: 6, speed: 5.4, dmg: 1, tokens: 2 },
  hard: { max: 9, speed: 6.2, dmg: 1.3, tokens: 3 },
};

const _v = new THREE.Vector3();

export class Agent implements Hittable {
  readonly key: string;
  readonly radius = 0.42;
  alive = true;
  rig: CharacterRig;
  anim: Animator;
  body: CharacterBody | null;
  feet = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp: number;
  ai = AIState.Idle;
  stateTime = 0;
  alerted = false;
  grounded = true;
  target: AgentTarget | null = null;
  hasToken = false;
  private stuckTime = 0;
  private losTimer = 0;
  private hitSet = new Set<string>();
  private attack = AttackId.Jab;
  private strafeDir = 1;
  /** Puppet mode (network): smoothed towards these. */
  netPos = new THREE.Vector3();
  netYaw = 0;
  netA = AnimState.Idle;
  netAp = 0;
  readonly kind: AgentKind;
  /** Spawned by a mission (counts towards its goals). */
  missionTag = false;
  isBoss = false;
  /** "Watcher" reveal marker. */
  private marker: THREE.Sprite | null = null;

  constructor(readonly id: number, private ctx: GameContext, spawn: THREE.Vector3, puppet: boolean, kind: AgentKind = 'agent') {
    this.key = 'agent:' + id;
    this.kind = kind;
    const look: Appearance = structuredClone(AGENT_APPEARANCE);
    if (kind === 'runner') {
      look.body = 'slim';
      look.top = 'hoodie';
      look.colors.top = '#202027';
      look.colors.accent = '#17a9a3';
      look.chest = '';
    } else if (kind === 'brute') {
      look.body = 'bulky';
      look.hat = 'beanie';
      look.colors.hat = '#2a2a30';
      look.gloves = 'fingerless';
    } else if (kind === 'shield') {
      look.body = 'bulky';
      look.hat = 'cap';
      look.colors.accent = '#ecebe7';
    } else if (kind === 'sniper') {
      look.body = 'slim';
      look.top = 'hoodie';
      look.colors.top = '#1a0d12';
      look.colors.accent = '#ff2a4a';
      look.chest = '';
    } else if (kind === 'static') {
      look.colors.top = '#e8e6e2';
      look.colors.shirt = '#e8e6e2';
      look.colors.pants = '#d8d6d2';
      look.colors.accent = '#6b2bff';
      look.colors.skin = '#111114';
    }
    this.rig = new CharacterRig(look, { agent: true });
    if (kind === 'brute') this.rig.root.scale.setScalar(1.18);
    if (kind === 'shield') this.buildShield();
    if (kind === 'drone') this.buildDrone(ctx);
    if (kind === 'sniper') {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      this.laser = new THREE.Line(g, new THREE.LineBasicMaterial({ color: '#ff2a4a', transparent: true, opacity: 0.5, depthWrite: false }));
      this.laser.frustumCulled = false;
      this.laser.visible = false;
      this.laser.userData.noMap = true;
      ctx.renderer.scene.add(this.laser);
    }
    this.anim = new Animator(this.rig);
    ctx.renderer.scene.add(this.rig.root);
    this.hp = { agent: 35, runner: 25, brute: 70, shield: 45, sniper: 25, drone: 16, static: 30 }[kind];
    this.feet.copy(spawn);
    this.netPos.copy(spawn);
    this.body = puppet ? null : ctx.physics.createCharacter(spawn, TUNING.radius, TUNING.halfHeight);
    this.rig.root.position.copy(spawn);
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
  }

  center(out: THREE.Vector3) {
    return out.copy(this.feet).add(_v.set(0, this.bossKind === 'serpent' || this.kind === 'drone' ? 0.6 : this.isBoss ? 1.8 : 1.0, 0));
  }

  // ------------------------------------------------------------ special kinds

  private shield: THREE.Object3D | null = null;
  private drone: THREE.Group | null = null;
  private laser: THREE.Line | null = null;
  /** Sniper aim / drone fire / Static blink timers. */
  private fireT = 1.5;
  private blinkT = 2.5;

  private buildShield() {
    const g = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.25, 0.07), new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.35, metalness: 0.5 }));
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.32, 0.04), new THREE.MeshStandardMaterial({ color: '#ecebe7', roughness: 0.5 }));
    rim.position.z = -0.03;
    const eye = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color: '#ff2a4a' }));
    eye.position.z = 0.04;
    eye.position.y = 0.15;
    g.add(rim, plate, eye);
    g.position.set(0.12, 1.0, 0.5);
    g.traverse((o) => (o.castShadow = true));
    this.rig.root.add(g);
    this.shield = g;
  }

  private buildDrone(ctx: GameContext) {
    this.rig.root.visible = false;
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.4, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), dark);
    body.scale.set(1, 0.7, 1);
    const eyeW = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), new THREE.MeshBasicMaterial({ color: '#f6f5f2' }));
    eyeW.position.set(0, 0, 0.3);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), new THREE.MeshBasicMaterial({ color: '#ff2a4a' }));
    pupil.position.set(0, 0, 0.31);
    g.add(body, eyeW, pupil);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.06), dark);
      arm.position.set(Math.cos(a) * 0.35, 0.05, Math.sin(a) * 0.35);
      arm.rotation.y = -a;
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 12), new THREE.MeshBasicMaterial({ color: '#2a2a30', transparent: true, opacity: 0.6 }));
      rotor.position.set(Math.cos(a) * 0.6, 0.1, Math.sin(a) * 0.6);
      rotor.name = 'rotor';
      g.add(arm, rotor);
    }
    g.traverse((o) => (o.castShadow = true));
    ctx.renderer.scene.add(g);
    this.drone = g;
  }

  /**
   * Snipers hold 13–22 m and paint you with a laser before firing a fast
   * round; drones circle overhead and spit slow ink bolts.
   */
  private rangedChase(dt: number, mgr: AgentManager, tgt: AgentTarget, wish: THREE.Vector3, dist: number, maxSpeed: number, dmgMul: number) {
    const ctx = this.ctx;
    const drone = this.kind === 'drone';
    const move = new THREE.Vector3();
    if (drone) {
      const a = this.stateTime * 0.7 + this.id;
      const want = tgt.feet.clone().add(_v.set(Math.cos(a) * 5, 2.8 + Math.sin(this.stateTime * 2) * 0.4, Math.sin(a) * 5));
      move.copy(want).sub(this.feet).setY(0);
      if (move.length() > 1) move.normalize();
      this.vel.y = clamp((want.y - this.feet.y) * 2.5, -5, 5);
    } else {
      move.copy(wish).multiplyScalar(dist > 22 ? 1 : dist < 13 ? -1 : 0);
      if (dist >= 13 && dist <= 22) move.set(-wish.z, 0, wish.x).multiplyScalar(this.strafeDir * 0.25);
    }
    const speed = maxSpeed * (drone ? 1.1 : 0.8);
    const k = drone || this.grounded ? 20 : 6;
    this.vel.x += clamp(move.x * speed - this.vel.x, -k * dt, k * dt);
    this.vel.z += clamp(move.z * speed - this.vel.z, -k * dt, k * dt);
    this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), 8, dt);
    // line of sight (cheap: shared with perception cadence)
    const eye = this.feet.clone().add(_v.set(0, drone ? 0.6 : 1.5, 0));
    const aim = tgt.hittable.center(new THREE.Vector3());
    const to = aim.clone().sub(eye);
    const d = to.length();
    const los = d < (drone ? 20 : 32) && !ctx.physics.raycast(eye, to.clone().divideScalar(d), d - 0.6);
    if (!los) {
      this.fireT = Math.max(this.fireT, drone ? 0.6 : 1.2);
      if (this.laser) this.laser.visible = false;
      return;
    }
    this.fireT -= dt;
    if (this.laser) {
      const pos = this.laser.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, eye.x, eye.y, eye.z);
      pos.setXYZ(1, aim.x, aim.y, aim.z);
      pos.needsUpdate = true;
      this.laser.geometry.computeBoundingSphere();
      this.laser.visible = true;
      const m = this.laser.material as THREE.LineBasicMaterial;
      m.opacity = this.fireT < 0.4 ? (Math.sin(this.fireT * 60) > 0 ? 1 : 0.3) : 0.35 + (1 - Math.min(1, this.fireT / 2)) * 0.5;
    }
    if (this.fireT <= 0) {
      // lead the target a little (snipers only)
      const lead = drone ? aim : aim.clone().addScaledVector(tgt.vel ?? _v.set(0, 0, 0), d / 60 * 0.6);
      mgr.fireBolt(this, eye, lead, drone ? 20 : 60, (drone ? 6 : 16) * dmgMul, drone ? '#6b2bff' : '#ff2a4a');
      ctx.audio.play(drone ? 'dash' : 'shock', { pitch: drone ? 2 : 1.6, vol: 0.5 });
      this.fireT = drone ? 1.4 : 2.6;
    }
  }

  /** Static: glitch out and reappear right next to the target, already swinging. */
  private tryBlink(dt: number, tgt: AgentTarget, dist: number): boolean {
    this.blinkT -= dt;
    if (this.blinkT > 0 || dist > 16 || !this.grounded || !this.body) return false;
    this.blinkT = 3 + Math.random() * 2;
    const ctx = this.ctx;
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      const p = tgt.feet.clone().add(_v.set(Math.cos(a) * 2.2, 3, Math.sin(a) * 2.2));
      const down = ctx.physics.raycast(p, new THREE.Vector3(0, -1, 0), 6);
      if (!down || Math.abs(down.point.y - tgt.feet.y) > 1.5) continue;
      ctx.effects.inkBurst(this.center(new THREE.Vector3()), new THREE.Vector3(0, 1, 0), '#6b2bff', 18);
      this.feet.copy(down.point).setY(down.point.y + 0.05);
      ctx.physics.placeCharacter(this.body, this.feet);
      this.vel.set(0, 0, 0);
      this.yaw = Math.atan2(tgt.feet.x - this.feet.x, tgt.feet.z - this.feet.z);
      ctx.effects.inkBurst(this.center(new THREE.Vector3()), new THREE.Vector3(0, 1, 0), '#6b2bff', 18);
      ctx.audio.play('blink', { pitch: 1.4, vol: 0.7 });
      this.attack = AttackId.Jab;
      this.hasToken = true;
      this.setAI(AIState.Windup);
      return true;
    }
    return false;
  }

  /** Shields soak frontal blows until something heavy enough breaks them. */
  private blocks(h: HitInfo): boolean {
    if (!this.shield) return false;
    const front = this.facingDir(_v).dot(h.dir) < -0.35;
    if (!front) return false;
    if (h.kind === 'tackle' || h.kind === 'shock' || h.kind === 'stomp' || h.kind === 'dash' || h.damage >= 40) {
      // guard break: the shield clatters away
      const s = this.shield;
      this.shield = null;
      s.removeFromParent();
      this.ctx.effects.sparks3(this.center(new THREE.Vector3()), '#ffffff', 24, 7, 0.25, 8);
      this.ctx.audio.play('smash', { pitch: 1.3 });
      this.ctx.onDamage(this.center(new THREE.Vector3()).add(_v.set(0, 1.2, 0)), 0, true, false, 'GUARD BREAK');
      return false;
    }
    return true;
  }

  /** Which island boss this is (null for regular Agents). */
  bossKind: BossKind | null = null;
  maxHp = 0;
  private special: { kind: 'pounce' | 'roar' | 'spin' | 'dive' | 'stun' | 'windup'; t: number; next?: 'pounce' | 'spin' | 'dive'; land?: boolean } | null = null;
  private specialCd = 4;
  private roared = false;
  private serpent: { segs: THREE.Object3D[]; trail: THREE.Vector3[] } | null = null;
  private home = new THREE.Vector3();

  get bossName(): string {
    return BOSS_NAMES[this.bossKind ?? 'warden'];
  }

  /** Turn this agent into an island boss (the Warden by default). */
  makeBoss(kind: BossKind = 'warden') {
    this.isBoss = true;
    this.bossKind = kind;
    this.alerted = true;
    this.home.copy(this.feet);
    this.hp = { warden: 420, lion: 380, serpent: 320, gladiator: 450 }[kind];
    this.maxHp = this.hp;
    if (kind === 'warden') this.rig.root.scale.setScalar(1.9);
    else if (kind === 'lion') this.buildLion();
    else if (kind === 'gladiator') {
      this.rig.root.scale.setScalar(2.0);
      this.buildShield();
    } else this.buildSerpent();
  }

  private buildLion() {
    this.rig.root.scale.setScalar(2.1);
    // a ring of golden ink flames for a mane, and a crown
    const gold = new THREE.MeshStandardMaterial({ color: '#d8a040', roughness: 0.5, emissive: '#7a4a10', emissiveIntensity: 0.6 });
    const mane = new THREE.Group();
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 5), gold);
      c.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.3, -0.05);
      c.rotation.z = a - Math.PI / 2;
      mane.add(c);
    }
    mane.position.set(0, 0.05, 0);
    this.rig.joints.head.add(mane);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 6, 1, true), gold);
    crown.position.set(0, 0.32, 0);
    this.rig.joints.head.add(crown);
  }

  private buildSerpent() {
    // the agent is the head: flies like a drone; feathered segments trail behind
    this.rig.root.visible = false;
    const scene = this.ctx.renderer.scene;
    const scale = new THREE.MeshStandardMaterial({ color: '#17a9a3', roughness: 0.45, emissive: '#0b4e4b', emissiveIntensity: 0.7, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.5, flatShading: true });
    const feather = new THREE.MeshStandardMaterial({ color: '#6b2bff', roughness: 0.4, emissive: '#3a12a8', emissiveIntensity: 0.9, side: THREE.DoubleSide });
    const segs: THREE.Object3D[] = [];
    const head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), dark);
    skull.scale.set(1, 0.75, 1.4);
    const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 6), scale);
    jaw.rotation.x = Math.PI / 2;
    jaw.position.set(0, -0.25, 0.9);
    head.add(skull, jaw);
    for (const sx of [-0.45, 0.45]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff7a1a' }));
      eye.position.set(sx, 0.3, 0.75);
      head.add(eye);
    }
    for (let k = 0; k < 9; k++) {
      const a = (k / 8 - 0.5) * Math.PI * 1.2;
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.3), feather);
      f.position.set(Math.sin(a) * 0.9, 0.5 + Math.cos(a) * 0.5, -0.3);
      f.rotation.set(-0.4, 0, -a);
      head.add(f);
    }
    segs.push(head);
    for (let i = 0; i < 16; i++) {
      const r = 0.75 - i * 0.035;
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), i % 3 === 0 ? dark : scale);
      if (i % 4 === 1) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.9), feather);
        f.position.y = r;
        m.add(f);
      }
      segs.push(m);
    }
    for (const sg of segs) {
      sg.traverse((o) => (o.castShadow = true));
      sg.userData.noMap = true;
      scene.add(sg);
    }
    this.serpent = { segs, trail: Array.from({ length: 140 }, () => this.feet.clone()) };
  }

  /** Watcher upgrade III: revealed Agents take extra damage. */
  private exposed(): number {
    return this.marker?.visible && this.ctx.upgrade('watcher') >= 3 ? 1.25 : 1;
  }

  /** Damage multiplier from armour (serpent only takes full damage while stunned). */
  private bossArmour(): number {
    if (this.bossKind === 'serpent') return this.special?.kind === 'stun' ? 1.4 : 0.3;
    return 1;
  }

  /**
   * Island boss moves on top of the normal brawler AI. Returns true while a
   * special move owns the body this step.
   */
  private bossThink(dt: number, mgr: AgentManager, tgt: AgentTarget, wish: THREE.Vector3, dist: number, dmgMul: number): boolean {
    const ctx = this.ctx;
    const k = this.bossKind;
    if (!k || k === 'warden') return false;
    const sp = this.special;
    // half-health roar: knock everyone back and call in help
    if (!this.roared && this.hp < this.maxHp * 0.5 && k !== 'serpent') {
      this.roared = true;
      this.special = { kind: 'roar', t: 0 };
      ctx.effects.shockwave(this.feet.clone().setY(this.feet.y + 0.3), '#ff7a1a', 9);
      ctx.audio.play('shock', { pitch: 0.4 });
      ctx.cameraRig.addShake(0.6);
      if (tgt.feet.distanceTo(this.feet) < 9) tgt.hittable.receiveHit({ dir: tgt.feet.clone().sub(this.feet).setY(0).normalize(), damage: 10 * dmgMul, knock: 14, lift: 6, kind: 'agent' });
      for (let i = 0; i < 2; i++) mgr.spawnAt(this.feet.clone().add(_v.set(i ? 4 : -4, 0.3, 2)), false, k === 'lion' ? 'runner' : 'shield');
      return true;
    }
    if (sp) {
      sp.t += dt;
      switch (sp.kind) {
        case 'roar':
          this.vel.x = this.vel.z = 0;
          if (sp.t > 1.2) this.special = null;
          return true;
        case 'windup': {
          this.vel.x *= 1 - dt * 8;
          this.vel.z *= 1 - dt * 8;
          this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), 10, dt);
          if (k === 'serpent') this.vel.y = 2;
          if (sp.t > (k === 'serpent' ? 0.7 : 0.8)) {
            if (sp.next === 'pounce') {
              // ballistic leap to where the target is
              const to = tgt.feet.clone().sub(this.feet);
              const T = 0.8;
              this.vel.set(to.x / T, 12, to.z / T);
              this.grounded = false;
              ctx.audio.play('whoosh', { pitch: 0.4 });
              this.special = { kind: 'pounce', t: 0 };
            } else if (sp.next === 'dive') {
              const to = tgt.hittable.center(new THREE.Vector3()).sub(this.feet).normalize();
              this.vel.copy(to.multiplyScalar(26));
              ctx.audio.play('whoosh', { pitch: 0.3 });
              this.special = { kind: 'dive', t: 0 };
            } else {
              this.special = { kind: 'spin', t: 0 };
              this.hitSet.clear();
              ctx.audio.play('whoosh', { pitch: 0.5 });
            }
          }
          return true;
        }
        case 'pounce': {
          if ((this.grounded && sp.t > 0.25) || sp.t > 1.6) {
            ctx.effects.shockwave(this.feet.clone().setY(this.feet.y + 0.2), '#d8a040', 6);
            ctx.effects.dust(this.feet, 20, '#d8c2a0', 1.4, 4);
            ctx.audio.play('heavyHit');
            ctx.cameraRig.addShake(0.5);
            const d = tgt.feet.distanceTo(this.feet);
            if (d < 5.5 && tgt.feet.y - this.feet.y < 2.5) tgt.hittable.receiveHit({ dir: tgt.feet.clone().sub(this.feet).setY(0).normalize(), damage: 20 * dmgMul, knock: 12, lift: 6, kind: 'agent' });
            this.special = null;
            this.specialCd = 5 + Math.random() * 3;
          }
          return true;
        }
        case 'spin': {
          // 360° sweep: two full turns, hitting anything in reach once
          this.yaw += dt * 14;
          this.vel.x = wish.x * 2.5;
          this.vel.z = wish.z * 2.5;
          if (!this.hitSet.has(tgt.key) && dist < 4.2) {
            this.hitSet.add(tgt.key);
            tgt.hittable.receiveHit({ dir: wish.clone(), damage: 16 * dmgMul, knock: 13, lift: 5, kind: 'agent' });
            ctx.audio.play('hit', { pitch: 0.6 });
          }
          if (Math.random() < 0.5) ctx.effects.dust(this.feet, 2, '#e8e6e2', 0.8, 3);
          if (sp.t > 1.2) {
            this.special = null;
            this.specialCd = 5 + Math.random() * 3;
          }
          return true;
        }
        case 'dive': {
          const c = tgt.hittable.center(new THREE.Vector3());
          if (!this.hitSet.has(tgt.key) && c.distanceTo(this.center(_v)) < 2.4) {
            this.hitSet.add(tgt.key);
            tgt.hittable.receiveHit({ dir: this.vel.clone().setY(0).normalize(), damage: 22 * dmgMul, knock: 14, lift: 6, kind: 'agent' });
          }
          if (this.grounded || sp.t > 1.0 || this.feet.y < tgt.feet.y + 0.3) {
            // crashes into the ground: dazed and open to attack
            this.vel.set(0, 0, 0);
            ctx.effects.shockwave(this.feet.clone().setY(this.feet.y + 0.2), '#17a9a3', 5);
            ctx.audio.play('smash', { pitch: 0.6 });
            ctx.cameraRig.addShake(0.4);
            this.special = { kind: 'stun', t: 0 };
          }
          return true;
        }
        case 'stun':
          this.vel.x *= 1 - dt * 6;
          this.vel.z *= 1 - dt * 6;
          this.vel.y = Math.min(this.vel.y, 0) - dt * 10;
          if (Math.random() < 0.2) ctx.effects.sparks3(this.center(new THREE.Vector3()).add(_v.set(0, 1, 0)), '#ffd24a', 2, 2, 0.2, 0);
          if (sp.t > 2.4) {
            this.special = null;
            this.specialCd = 3.5;
          }
          return true;
      }
    }
    // serpent: circle the target from the air between dives
    if (k === 'serpent') {
      const a = this.stateTime * 0.8;
      const want = tgt.feet.clone().add(_v.set(Math.cos(a) * 9, 5.5, Math.sin(a) * 9));
      const mv = want.clone().sub(this.feet);
      this.vel.x += clamp(mv.x * 1.5 - this.vel.x, -12 * dt, 12 * dt);
      this.vel.z += clamp(mv.z * 1.5 - this.vel.z, -12 * dt, 12 * dt);
      this.vel.y = clamp(mv.y * 2, -6, 6);
      this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 6, dt);
      if (this.specialCd <= 0 && dist < 18) {
        this.hitSet.clear();
        this.special = { kind: 'windup', t: 0, next: 'dive' };
      }
      return true;
    }
    if (this.specialCd <= 0 && this.grounded) {
      if (k === 'lion' && dist > 1.2 && dist < 16) {
        this.special = { kind: 'windup', t: 0, next: 'pounce' };
        ctx.audio.play('spot', { pitch: 0.5 });
        return true;
      }
      if (k === 'gladiator') {
        if (dist < 5) {
          this.special = { kind: 'windup', t: 0, next: 'spin' };
          return true;
        }
        if (dist < 22) {
          // hurl a spear
          const from = this.feet.clone().add(_v.set(0, 2.6, 0));
          mgr.fireBolt(this, from, tgt.hittable.center(new THREE.Vector3()), 34, 14 * dmgMul, '#e8e6e2');
          ctx.audio.play('whoosh', { pitch: 0.7 });
          this.specialCd = 3.5;
        }
      }
    }
    return false;
  }

  setRevealed(on: boolean) {
    if (on && !this.marker) {
      this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture('#ffd24a', '◉'), depthTest: false }));
      this.marker.scale.set(0.9, 0.9, 1);
      this.marker.renderOrder = 12;
      this.ctx.renderer.scene.add(this.marker);
    }
    if (this.marker) this.marker.visible = on;
  }

  receiveHit(h: HitInfo): boolean {
    if (!this.alive || this.ai === AIState.Dead) return false;
    if (this.blocks(h)) {
      this.ctx.effects.sparks3(this.center(new THREE.Vector3()).addScaledVector(this.facingDir(_v), 0.6), '#ffffff', 10, 5, 0.18, 6);
      this.ctx.audio.play('hit', { pitch: 2.4, vol: 0.6 });
      this.ctx.onDamage(this.center(new THREE.Vector3()).add(_v.set(0, 0.9, 0)), 0, false, false, 'BLOCKED');
      this.alerted = true;
      return true;
    }
    // local feedback is immediate; the authority applies the damage
    this.rig.setExpression('wince', 0.4);
    const dmg = h.damage * (this.kind === 'brute' && h.kind === 'light' ? 0.4 : 1) * (this.isBoss ? 0.6 * this.bossArmour() : 1) * this.exposed();
    this.ctx.onDamage(this.center(new THREE.Vector3()).add(new THREE.Vector3(0, 0.9, 0)), dmg, h.kind !== 'light', !!this.body && this.hp - dmg <= 0);
    if (!this.body) {
      this.onPuppetHit?.(this, h);
      this.anim.land(0.6);
      return true;
    }
    this.applyHit(h);
    return true;
  }

  /** Reeling from a hit (finisher window). */
  get staggered(): boolean {
    return this.alive && this.ai === AIState.Hit;
  }

  /** Where the Agent is looking (XZ). */
  facingDir(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Set by the manager for puppets (forwards the hit to the host). */
  onPuppetHit: ((a: Agent, h: HitInfo) => void) | null = null;

  applyHit(h: HitInfo) {
    if (!this.alive) return;
    const resist = (this.kind === 'brute' && h.kind === 'light' ? 0.4 : 1) * (this.isBoss ? 0.6 * this.bossArmour() : 1) * this.exposed();
    this.hp -= h.damage * resist;
    this.alerted = true;
    const knock = h.knock * (this.isBoss ? 0.15 : this.kind === 'brute' ? 0.45 : 1);
    this.vel.set(h.dir.x * knock, h.lift * (this.kind === 'brute' ? 0.4 : 1), h.dir.z * knock);
    this.yaw = Math.atan2(-h.dir.x, -h.dir.z);
    this.grounded = false;
    if (this.hp <= 0) {
      this.die(h.dir);
    } else if (!this.special && !(this.kind === 'brute' && h.kind === 'light') && !(this.isBoss && h.kind !== 'dash' && h.kind !== 'shock')) {
      this.setAI(AIState.Hit);
    }
  }

  die(dir: THREE.Vector3) {
    if (!this.alive) return;
    this.alive = false;
    this.setAI(AIState.Dead);
    this.releaseToken();
    const c = this.center(new THREE.Vector3());
    this.ctx.effects.inkBurst(c, dir, '#111114', this.isBoss ? 140 : this.kind === 'brute' ? 60 : 40);
    this.marker?.removeFromParent();
    this.ctx.audio.play('ink');
    this.ctx.cameraRig.addShake(0.25);
    this.ctx.broadcastFx('ink', c, dir);
    this.ctx.emit('defeat', this);
  }

  releaseToken() {
    this.hasToken = false;
  }

  private setAI(s: AIState) {
    this.ai = s;
    this.stateTime = 0;
  }

  /** Authoritative AI update. */
  think(dt: number, mgr: AgentManager) {
    if (!this.body) return;
    const ctx = this.ctx;
    this.stateTime += dt;
    const diff = DIFFICULTY[ctx.settings.difficulty];
    const speedMul = this.kind === 'runner' ? 1.25 : this.kind === 'brute' ? 0.7 : 1;
    const maxSpeed = diff.speed * speedMul * mgr.slowAt(this.feet) * (this.isBoss ? 1.05 : 1);
    if (mgr.blindTime > 0 && !this.missionTag) {
      this.alerted = false;
      this.releaseToken();
    }
    const tgt = this.target;
    const wish = new THREE.Vector3();
    let dist = Infinity;
    if (tgt) {
      wish.copy(tgt.feet).sub(this.feet);
      dist = Math.hypot(wish.x, wish.z);
      wish.y = 0;
      if (dist > 0.01) wish.divideScalar(dist);
    }

    // boss special-move cooldown ticks in every state (melee loops rarely sit in Chase)
    if (this.bossKind && !this.special) this.specialCd -= dt;
    // perception
    this.losTimer -= dt;
    if (this.missionTag) this.alerted = true;
    if (!this.alerted && mgr.blindTime <= 0 && tgt && dist < 20 && this.losTimer <= 0) {
      this.losTimer = 0.3;
      const eye = this.feet.clone().add(_v.set(0, 1.6, 0));
      const to = tgt.feet.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(eye);
      const d = to.length();
      const hit = ctx.physics.raycast(eye, to.normalize(), d);
      if (!hit) {
        this.alerted = true;
        ctx.audio.play('spot', { vol: clamp(1 - dist / 25, 0.15, 1) });
      }
    }

    switch (this.ai) {
      case AIState.Idle: {
        this.vel.x *= 1 - dt * 6;
        this.vel.z *= 1 - dt * 6;
        if (this.kind === 'drone') this.vel.y *= 1 - dt * 4;
        if (this.alerted && tgt) this.setAI(AIState.Chase);
        break;
      }
      case AIState.Chase: {
        if (!tgt || !tgt.canBeTargeted) {
          this.setAI(AIState.Idle);
          if (this.laser) this.laser.visible = false;
          break;
        }
        if (this.kind === 'sniper' || this.kind === 'drone') {
          this.rangedChase(dt, mgr, tgt, wish, dist, maxSpeed, diff.dmg);
          break;
        }
        if (this.kind === 'static' && this.tryBlink(dt, tgt, dist)) break;
        if (this.bossKind && this.bossThink(dt, mgr, tgt, wish, dist, diff.dmg)) break;
        const dy = tgt.feet.y - this.feet.y;
        // take/keep an attack token when close
        if (dist < 4.5 && !this.hasToken) this.hasToken = mgr.requestToken(this);
        if (dist > 7) this.releaseToken();
        let move = wish.clone();
        let speed = maxSpeed;
        if (!this.hasToken && dist < 4) {
          // circle around the target, taunting (attack-token fairness rule)
          const tangent = new THREE.Vector3(-wish.z, 0, wish.x).multiplyScalar(this.strafeDir);
          move = tangent.addScaledVector(wish, dist < 3 ? -0.6 : 0.2).normalize();
          speed = maxSpeed * 0.45;
        }
        // separation from other agents
        for (const o of mgr.agents.values()) {
          if (o === this || !o.alive) continue;
          const dx = this.feet.x - o.feet.x;
          const dz = this.feet.z - o.feet.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.4 && d > 0.01) move.add(_v.set(dx / d, 0, dz / d).multiplyScalar((1.4 - d) * 1.5));
        }
        move.y = 0;
        if (move.lengthSq() > 1) move.normalize();
        const k = this.grounded ? 30 : 8;
        this.vel.x += clamp(move.x * speed - this.vel.x, -k * dt, k * dt);
        this.vel.z += clamp(move.z * speed - this.vel.z, -k * dt, k * dt);
        this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), 10, dt);
        // jump when blocked or when the target is above us
        const hs = Math.hypot(this.vel.x, this.vel.z);
        if (this.grounded) {
          if (hs < 1.0 && dist > 1.8) this.stuckTime += dt;
          else this.stuckTime = 0;
          if (this.stuckTime > 0.35 || (dy > 1.2 && dy < 3 && dist < 3.5)) {
            this.vel.y = jumpVelocity(this.kind === 'runner' ? 2.4 : 1.9);
            this.vel.x += wish.x * 2;
            this.vel.z += wish.z * 2;
            this.grounded = false;
            this.stuckTime = 0;
          }
        }
        // attacks
        if (this.hasToken && this.grounded && Math.abs(dy) < 1.4) {
          if (dist < (this.isBoss ? 3.2 : 1.7)) {
            this.attack = Math.random() < 0.6 ? AttackId.Jab : AttackId.Kick;
            this.setAI(AIState.Windup);
          } else if (dist > 3 && dist < 5.5 && Math.random() < dt * 0.8 && this.kind !== 'brute') {
            this.attack = AttackId.FlyingKick;
            this.setAI(AIState.Windup);
          }
        }
        break;
      }
      case AIState.Windup: {
        this.vel.x *= 1 - dt * 10;
        this.vel.z *= 1 - dt * 10;
        if (tgt) this.yaw = dampAngle(this.yaw, Math.atan2(wish.x, wish.z), 12, dt);
        const wind = this.kind === 'brute' ? 0.55 : this.attack === AttackId.FlyingKick ? 0.3 : 0.32;
        if (this.stateTime > wind) {
          this.hitSet.clear();
          if (this.attack === AttackId.FlyingKick) {
            const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
            this.vel.set(f.x * 10, 4.5, f.z * 10);
            this.grounded = false;
            this.setAI(AIState.Lunge);
          } else {
            this.setAI(AIState.Strike);
          }
          ctx.audio.play('whoosh', { pitch: 0.8, vol: 0.6 });
        }
        break;
      }
      case AIState.Strike:
      case AIState.Lunge: {
        const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        if (this.ai === AIState.Strike) {
          this.vel.x = f.x * 2;
          this.vel.z = f.z * 2;
        }
        const active = this.ai === AIState.Strike ? this.stateTime < 0.18 : this.stateTime > 0.05 && this.stateTime < 0.45;
        if (active && tgt) {
          const c = tgt.hittable.center(new THREE.Vector3());
          const origin = this.feet.clone().add(_v.set(0, 1, 0)).addScaledVector(f, 0.7);
          if (!this.hitSet.has(tgt.key) && c.distanceTo(origin) < (this.isBoss ? 2.6 : 1.25)) {
            this.hitSet.add(tgt.key);
            const dir = c.clone().sub(this.feet).setY(0).normalize();
            const dmg = (this.attack === AttackId.Kick ? 12 : this.attack === AttackId.FlyingKick ? 14 : 9) * diff.dmg * (this.isBoss ? 2.4 : this.kind === 'brute' ? 1.8 : 1);
            if (tgt.hittable.receiveHit({ dir, damage: dmg, knock: this.kind === 'brute' ? 11 : 6, lift: 3, kind: 'agent' })) {
              ctx.audio.play('hit', { pitch: 0.8 });
            }
          }
        }
        if ((this.ai === AIState.Strike && this.stateTime > 0.22) || (this.ai === AIState.Lunge && (this.stateTime > 0.75 || (this.grounded && this.stateTime > 0.2)))) {
          this.setAI(AIState.Recover);
        }
        break;
      }
      case AIState.Recover: {
        this.vel.x *= 1 - dt * 8;
        this.vel.z *= 1 - dt * 8;
        if (this.stateTime > (this.kind === 'brute' ? 0.7 : 0.45)) {
          if (Math.random() < 0.4) this.releaseToken();
          this.setAI(AIState.Chase);
        }
        break;
      }
      case AIState.Hit: {
        this.vel.x *= 1 - dt * 4;
        this.vel.z *= 1 - dt * 4;
        if (this.kind === 'drone') {
          this.vel.y *= 1 - dt * 4;
          if (this.stateTime > 0.45) this.setAI(AIState.Chase);
        }
        if (this.stateTime > 0.45 && this.grounded) this.setAI(AIState.Chase);
        break;
      }
      case AIState.Dead:
        return;
    }

    const g = this.vel.y > 0 ? TUNING.gravityUp : TUNING.gravityDown;
    const flies = this.kind === 'drone' || (this.bossKind === 'serpent' && this.special?.kind !== 'stun' && this.alive);
    if (!flies) this.vel.y = Math.max(-TUNING.terminalVelocity, this.vel.y - g * dt);
    const actual = new THREE.Vector3();
    const res = ctx.physics.moveCharacter(this.body, this.vel.clone().multiplyScalar(dt), actual);
    this.feet.add(actual);
    this.grounded = res.grounded && this.vel.y <= 0.5;
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    if (res.hitCeiling && this.vel.y > 0) this.vel.y = 0;
    if (this.feet.y < TUNING.killPlaneY) this.die(new THREE.Vector3(0, 1, 0));
  }

  animState(): { a: AnimState; ap: number } {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    switch (this.ai) {
      case AIState.Idle:
        return { a: hs > 0.5 ? AnimState.Move : AnimState.Idle, ap: 0 };
      case AIState.Chase:
        return { a: this.grounded ? (hs > 0.4 ? AnimState.Move : AnimState.Idle) : AnimState.Air, ap: 0 };
      case AIState.Windup:
        return { a: AnimState.Attack, ap: packAttack(this.attack, 0.12) };
      case AIState.Strike:
        return { a: AnimState.Attack, ap: packAttack(this.attack, 0.3 + this.stateTime * 1.5) };
      case AIState.Lunge:
        return { a: AnimState.Attack, ap: packAttack(AttackId.FlyingKick, clamp(0.3 + this.stateTime, 0, 0.95)) };
      case AIState.Recover:
        return { a: AnimState.Attack, ap: packAttack(this.attack, clamp(0.65 + this.stateTime * 0.6, 0, 0.99)) };
      case AIState.Hit:
        return { a: AnimState.Hit, ap: 1 };
      default:
        return { a: AnimState.KO, ap: 0 };
    }
  }

  /** Visual update (both modes). */
  render(dt: number) {
    if (!this.body) {
      // puppet: smooth towards network state
      this.feet.lerp(this.netPos, damp(14, dt));
      this.yaw = dampAngle(this.yaw, this.netYaw, 14, dt);
      const hs = this.netPos.distanceTo(this.feet) / Math.max(dt, 1e-3);
      this.anim.update(dt, { state: this.netA, param: this.netAp, speed: Math.min(hs, 9), vy: 0, grounded: true });
    } else {
      const s = this.animState();
      this.anim.update(dt, { state: s.a, param: s.ap, speed: Math.hypot(this.vel.x, this.vel.z), vy: this.vel.y, grounded: this.grounded });
    }
    this.rig.root.position.copy(this.feet);
    this.rig.root.rotation.y = this.yaw;
    if (this.drone) {
      this.drone.position.copy(this.feet).add(_v.set(0, 0.6 + Math.sin(performance.now() * 0.004 + this.id) * 0.08, 0));
      this.drone.rotation.y = this.yaw;
      this.drone.rotation.z = THREE.MathUtils.clamp(-this.vel.x * 0.04, -0.3, 0.3);
      for (const c of this.drone.children) if (c.name === 'rotor') c.rotation.y += dt * 40;
    }
    if (this.kind === 'static' && this.alive) {
      // signal noise: flicker and jitter
      this.rig.root.visible = Math.random() > 0.07;
      if (Math.random() < 0.05) this.rig.root.position.x += (Math.random() - 0.5) * 0.25;
    }
    if (this.laser && !this.alive) this.laser.visible = false;
    if (this.serpent) {
      const sr = this.serpent;
      const headPos = this.feet.clone().add(_v.set(0, 0.6, 0));
      if (headPos.distanceTo(sr.trail[0]) > 0.12) {
        sr.trail.pop();
        sr.trail.unshift(headPos);
      }
      sr.segs[0].position.copy(headPos);
      sr.segs[0].rotation.y = this.yaw;
      const stunned = this.special?.kind === 'stun';
      sr.segs[0].rotation.x = stunned ? 0.5 : 0;
      for (let i = 1; i < sr.segs.length; i++) {
        const p = sr.trail[Math.min(sr.trail.length - 1, i * 8)];
        sr.segs[i].position.copy(p);
        sr.segs[i].position.y += Math.sin(performance.now() * 0.005 - i * 0.6) * 0.15;
      }
    }
    if (this.marker) this.marker.position.copy(this.feet).add(_v.set(0, this.isBoss ? 4.6 : 2.6, 0));
  }

  dispose() {
    this.marker?.removeFromParent();
    this.drone?.removeFromParent();
    if (this.serpent) for (const sg of this.serpent.segs) sg.removeFromParent();
    this.laser?.removeFromParent();
    this.rig.dispose();
    if (this.body) this.ctx.physics.removeCharacter(this.body);
    this.body = null;
  }
}

/**
 * Agent Command (README §12.2): spawns agents, hands out attack tokens and
 * picks targets. In multiplayer only the host runs the AI; other clients
 * render puppets from snapshots and forward their hits to the host.
 */
export class AgentManager {
  readonly agents = new Map<number, Agent>();
  private nextId = 1;
  private spawnTimer = 1.5;
  private rng = makeRng(99);
  authoritative = true;
  enabled = true;
  defeated = 0;
  /** Called on puppets when the local player hits them. */
  onPuppetHit: ((id: number, h: HitInfo) => void) | null = null;
  /** Smudge cloud: agents can't see anyone for a while. */
  blindTime = 0;
  /** Slow zones (Tide paint, BLACKEYE storm): centre, radius, factor. */
  slowZones: Array<{ c: THREE.Vector3; r: number; f: number }> = [];
  revealed = false;
  private bolts: Bolt[] = [];
  private boltMats = new Map<string, THREE.MeshBasicMaterial>();

  /** Sniper rounds and drone bolts: real projectiles you can dodge or outrun. */
  fireBolt(from: Agent, at: THREE.Vector3, to: THREE.Vector3, speed: number, dmg: number, color: string) {
    if (!this.boltMats.has(color)) this.boltMats.set(color, new THREE.MeshBasicMaterial({ color }));
    const mesh = new THREE.Mesh(boltGeo, this.boltMats.get(color)!);
    mesh.position.copy(at);
    mesh.lookAt(to);
    mesh.userData.noMap = true;
    this.ctx.renderer.scene.add(mesh);
    const vel = to.clone().sub(at).normalize().multiplyScalar(speed);
    this.bolts.push({ mesh, vel, life: 2.2, dmg, owner: from.id });
    this.ctx.effects.sparks3(at, color, 6, 3, 0.15, 0);
  }

  private updateBolts(dt: number, targets: AgentTarget[]) {
    const c = new THREE.Vector3();
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      const a = b.mesh.position.clone();
      const step = b.vel.clone().multiplyScalar(dt);
      const len = step.length();
      let done = b.life <= 0;
      for (const t of targets) {
        if (done || !t.canBeTargeted) continue;
        t.hittable.center(c);
        // closest approach along this step
        const ab = step;
        const tt = clamp(c.clone().sub(a).dot(ab) / (len * len || 1), 0, 1);
        if (a.clone().addScaledVector(ab, tt).distanceTo(c) < 0.55) {
          const dir = b.vel.clone().setY(0).normalize();
          t.hittable.receiveHit({ dir, damage: b.dmg, knock: 4, lift: 1.5, kind: 'agent' });
          this.ctx.effects.inkBurst(c, dir.negate(), '#111114', 10);
          done = true;
        }
      }
      if (!done) {
        const wall = this.ctx.physics.raycast(a, step.clone().divideScalar(len || 1), len);
        if (wall) {
          this.ctx.effects.splat(wall.point.addScaledVector(wall.normal, 0.02), wall.normal, '#111114', 0.4);
          done = true;
        }
      }
      if (done) {
        b.mesh.removeFromParent();
        this.bolts.splice(i, 1);
      } else b.mesh.position.add(step);
    }
  }

  slowAt(p: THREE.Vector3): number {
    let f = 1;
    for (const z of this.slowZones) if (z.c.distanceTo(p) < z.r) f = Math.min(f, z.f);
    return f;
  }

  /** Mission-controlled agent (always alerted, counted by the mission). */
  spawnAt(pos: THREE.Vector3, boss: boolean | BossKind = false, kind?: AgentKind): Agent {
    const a = new Agent(this.nextId++, this.ctx, pos.clone(), false, boss ? 'brute' : (kind ?? this.pickKind()));
    a.missionTag = true;
    a.alerted = true;
    if (boss) a.makeBoss(boss === true ? 'warden' : boss);
    this.agents.set(a.id, a);
    this.ctx.effects.inkBurst(pos.clone().add(_v.set(0, 1, 0)), new THREE.Vector3(0, 1, 0), '#111114', boss ? 40 : 14);
    return a;
  }

  /** Squad mix: mostly suits, then runners, brutes and the specialists. */
  pickKind(): AgentKind {
    const r = this.rng.next();
    return r < 0.12 ? 'brute' : r < 0.3 ? 'runner' : r < 0.4 ? 'shield' : r < 0.48 ? 'sniper' : r < 0.56 ? 'drone' : r < 0.62 ? 'static' : 'agent';
  }

  /** Remove one agent right away (pursuit squads leaving). */
  remove(a: Agent) {
    if (!this.agents.has(a.id)) return;
    if (a.alive) this.ctx.effects.inkBurst(a.feet.clone().add(_v.set(0, 1, 0)), new THREE.Vector3(0, 1, 0), '#111114', 10);
    a.dispose();
    this.agents.delete(a.id);
  }

  clearMission() {
    for (const [id, a] of this.agents) {
      if (a.missionTag) {
        a.dispose();
        this.agents.delete(id);
      }
    }
  }

  constructor(private ctx: GameContext) {}

  get alertedCount(): number {
    let n = 0;
    for (const a of this.agents.values()) if (a.alive && a.alerted) n++;
    return n;
  }

  requestToken(a: Agent): boolean {
    if (a.isBoss) return true;
    const max = DIFFICULTY[this.ctx.settings.difficulty].tokens;
    let n = 0;
    for (const o of this.agents.values()) if (o !== a && o.hasToken && o.alive) n++;
    return n < max;
  }

  private spawn(targets: AgentTarget[]) {
    const spawns = this.ctx.world.agentSpawns;
    // pick a spawn point near a player, but not on top of anyone
    const list = spawns.filter((s) => targets.some((t) => t.feet.distanceTo(s) < 70) && targets.every((t) => t.feet.distanceTo(s) > 12));
    if (!list.length) return;
    const p = this.rng.pick(list).clone();
    p.x += this.rng.range(-1.5, 1.5);
    p.z += this.rng.range(-1.5, 1.5);
    const kind = this.pickKind();
    const a = new Agent(this.nextId++, this.ctx, p, false, kind);
    a.yaw = this.rng.range(-Math.PI, Math.PI);
    this.agents.set(a.id, a);
    this.ctx.effects.inkBurst(p.clone().add(_v.set(0, 1, 0)), new THREE.Vector3(0, 1, 0), '#111114', 14);
  }

  update(dt: number, targets: AgentTarget[]) {
    if (!this.authoritative) return;
    // cleanup dead
    for (const [id, a] of this.agents) {
      if (!a.alive) {
        a.dispose();
        this.agents.delete(id);
        this.defeated++;
      }
    }
    this.blindTime = Math.max(0, this.blindTime - dt);
    this.updateBolts(dt, targets);
    for (const a of this.agents.values()) a.setRevealed(this.revealed);
    // forget roaming agents that are far from every player
    for (const [id, a] of this.agents) {
      if (!a.missionTag && targets.length && targets.every((t) => t.feet.distanceTo(a.feet) > 110)) {
        a.dispose();
        this.agents.delete(id);
      }
    }
    if (!this.enabled) {
      for (const a of this.agents.values()) if (a.missionTag) this.thinkOne(a, targets, dt);
      return;
    }
    const max = DIFFICULTY[this.ctx.settings.difficulty].max + Math.max(0, targets.length - 1) * 2;
    this.spawnTimer -= dt;
    if (this.agents.size < max && this.spawnTimer <= 0 && targets.length) {
      this.spawn(targets);
      this.spawnTimer = 2.5 + this.rng.range(0, 2);
    }
    for (const a of this.agents.values()) this.thinkOne(a, targets, dt);
  }

  private thinkOne(a: Agent, targets: AgentTarget[], dt: number) {
    // nearest valid target
    let best: AgentTarget | null = null;
    let bd = Infinity;
    for (const t of targets) {
      if (!t.canBeTargeted) continue;
      const d = t.feet.distanceToSquared(a.feet);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (a.target?.key !== best?.key) a.releaseToken();
    a.target = best;
    a.think(dt, this);
  }

  render(dt: number) {
    for (const a of this.agents.values()) a.render(dt);
  }

  // ------------------------------------------------------------ networking

  netStates(): NetAgentState[] {
    const out: NetAgentState[] = [];
    for (const a of this.agents.values()) {
      if (!a.alive) continue;
      const s = a.animState();
      out.push({ id: a.id, p: [round(a.feet.x), round(a.feet.y), round(a.feet.z)], yaw: round(a.yaw), a: s.a, ap: round(s.ap), k: a.kind === 'agent' ? undefined : a.kind });
    }
    return out;
  }

  applyNet(list: NetAgentState[]) {
    if (this.authoritative) return;
    const seen = new Set<number>();
    for (const s of list) {
      seen.add(s.id);
      let a = this.agents.get(s.id);
      if (!a) {
        a = new Agent(s.id, this.ctx, new THREE.Vector3(...s.p), true, (KINDS as readonly string[]).includes(s.k ?? '') ? (s.k as AgentKind) : 'agent');
        a.onPuppetHit = (ag, h) => this.onPuppetHit?.(ag.id, h);
        this.agents.set(s.id, a);
      }
      a.netPos.set(...s.p);
      a.netYaw = s.yaw;
      a.netA = s.a as AnimState;
      a.netAp = s.ap;
    }
    for (const [id, a] of this.agents) {
      if (!seen.has(id)) {
        a.dispose();
        this.agents.delete(id);
      }
    }
  }

  /** Host: a remote player hit one of our agents. */
  applyRemoteHit(id: number, dir: THREE.Vector3, power: number) {
    const a = this.agents.get(id);
    if (!a || !a.alive) return;
    a.applyHit({ dir, damage: power, knock: clamp(power * 0.35, 3, 14), lift: clamp(power * 0.15, 1, 6), kind: power >= 25 ? 'heavy' : 'light' });
    a.rig.setExpression('wince', 0.4);
    this.ctx.effects.sparks3(a.center(new THREE.Vector3()), '#ffffff', 8, 5);
  }

  /** Switch between host (authoritative) and puppet mode; clears agents. */
  setAuthoritative(auth: boolean) {
    if (auth === this.authoritative) return;
    this.clear();
    this.authoritative = auth;
  }

  clear() {
    for (const a of this.agents.values()) a.dispose();
    this.agents.clear();
    for (const b of this.bolts) b.mesh.removeFromParent();
    this.bolts = [];
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

