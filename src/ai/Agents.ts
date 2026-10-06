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
}

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

const KINDS = ['agent', 'runner', 'brute'] as const;
type AgentKind = (typeof KINDS)[number];

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
    }
    this.rig = new CharacterRig(look, { agent: true });
    if (kind === 'brute') this.rig.root.scale.setScalar(1.18);
    this.anim = new Animator(this.rig);
    ctx.renderer.scene.add(this.rig.root);
    this.hp = kind === 'brute' ? 70 : kind === 'runner' ? 25 : 35;
    this.feet.copy(spawn);
    this.netPos.copy(spawn);
    this.body = puppet ? null : ctx.physics.createCharacter(spawn, TUNING.radius, TUNING.halfHeight);
    this.rig.root.position.copy(spawn);
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
  }

  center(out: THREE.Vector3) {
    return out.copy(this.feet).add(_v.set(0, this.isBoss ? 1.8 : 1.0, 0));
  }

  /** Turn this agent into the Warden boss. */
  makeBoss() {
    this.isBoss = true;
    this.hp = 420;
    this.rig.root.scale.setScalar(1.9);
    this.alerted = true;
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
    // local feedback is immediate; the authority applies the damage
    this.rig.setExpression('wince', 0.4);
    if (!this.body) {
      this.onPuppetHit?.(this, h);
      this.anim.land(0.6);
      return true;
    }
    this.applyHit(h);
    return true;
  }

  /** Set by the manager for puppets (forwards the hit to the host). */
  onPuppetHit: ((a: Agent, h: HitInfo) => void) | null = null;

  applyHit(h: HitInfo) {
    if (!this.alive) return;
    const resist = (this.kind === 'brute' && h.kind === 'light' ? 0.4 : 1) * (this.isBoss ? 0.6 : 1);
    this.hp -= h.damage * resist;
    this.alerted = true;
    const knock = h.knock * (this.isBoss ? 0.15 : this.kind === 'brute' ? 0.45 : 1);
    this.vel.set(h.dir.x * knock, h.lift * (this.kind === 'brute' ? 0.4 : 1), h.dir.z * knock);
    this.yaw = Math.atan2(-h.dir.x, -h.dir.z);
    this.grounded = false;
    if (this.hp <= 0) {
      this.die(h.dir);
    } else if (!(this.kind === 'brute' && h.kind === 'light') && !(this.isBoss && h.kind !== 'dash' && h.kind !== 'shock')) {
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
        if (this.alerted && tgt) this.setAI(AIState.Chase);
        break;
      }
      case AIState.Chase: {
        if (!tgt || !tgt.canBeTargeted) {
          this.setAI(AIState.Idle);
          break;
        }
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
        if (this.stateTime > 0.45 && this.grounded) this.setAI(AIState.Chase);
        break;
      }
      case AIState.Dead:
        return;
    }

    const g = this.vel.y > 0 ? TUNING.gravityUp : TUNING.gravityDown;
    this.vel.y = Math.max(-TUNING.terminalVelocity, this.vel.y - g * dt);
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
    if (this.marker) this.marker.position.copy(this.feet).add(_v.set(0, this.isBoss ? 4.6 : 2.6, 0));
  }

  dispose() {
    this.marker?.removeFromParent();
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

  slowAt(p: THREE.Vector3): number {
    let f = 1;
    for (const z of this.slowZones) if (z.c.distanceTo(p) < z.r) f = Math.min(f, z.f);
    return f;
  }

  /** Mission-controlled agent (always alerted, counted by the mission). */
  spawnAt(pos: THREE.Vector3, boss = false): Agent {
    const a = new Agent(this.nextId++, this.ctx, pos.clone(), false, boss ? 'brute' : this.rng.chance(0.3) ? 'runner' : 'agent');
    a.missionTag = true;
    a.alerted = true;
    if (boss) a.makeBoss();
    this.agents.set(a.id, a);
    this.ctx.effects.inkBurst(pos.clone().add(_v.set(0, 1, 0)), new THREE.Vector3(0, 1, 0), '#111114', boss ? 40 : 14);
    return a;
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
    const r = this.rng.next();
    const kind = r < 0.15 ? 'brute' : r < 0.4 ? 'runner' : 'agent';
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
      out.push({ id: a.id, p: [round(a.feet.x), round(a.feet.y), round(a.feet.z)], yaw: round(a.yaw), a: s.a, ap: round(s.ap) });
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
        a = new Agent(s.id, this.ctx, new THREE.Vector3(...s.p), true);
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
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

