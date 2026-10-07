import * as THREE from 'three';
import type { Agent, AgentManager } from '../ai/Agents';
import type { Player } from '../player/Player';
import { PState } from '../player/Player';
import { AttackId } from '../character/Animator';
import type { Input } from '../core/Input';
import type { Effects } from '../vfx/Effects';
import type { AudioEngine } from '../audio/Audio';
import type { CameraRig } from '../camera/CameraRig';

export interface TakedownHost {
  player: Player;
  agents: AgentManager;
  input: Input;
  effects: Effects;
  audio: AudioEngine;
  cameraRig: CameraRig;
  slowmo(scale: number, seconds: number): void;
  hitstop(t: number): void;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  pop(text: string, at: THREE.Vector3): void;
  event(name: string): void;
}

type Kind = 'stealth' | 'drop' | 'finisher';

const LABEL: Record<Kind, string> = { stealth: 'TAKEDOWN', drop: 'DROP TAKEDOWN', finisher: 'INK FINISHER' };
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/**
 * Takedowns and finishers:
 * - Stealth: sneak up behind an Agent who hasn't spotted you, LMB.
 * - Drop: fall onto an Agent from above (≥ 2.5 m), LMB while airborne.
 * - Ink Finisher: RMB on a reeling, nearly-inked Agent (ground-and-pound).
 * Bosses can't be one-shot: they take a heavy chunk instead.
 */
export class Takedowns {
  /** Current opportunity (drives the HUD prompt and the screen marker). */
  option: { kind: Kind; agent: Agent } | null = null;
  private pending: { kind: Kind; agent: Agent; t: number } | null = null;

  constructor(private h: TakedownHost) {}

  get prompt(): string | null {
    if (!this.option) return null;
    const btn = this.option.kind === 'finisher' ? 'RMB' : 'LMB';
    return `${btn} · ${LABEL[this.option.kind]}`;
  }

  /** Runs before the player's step so it can claim the attack press. */
  update(dt: number) {
    const pl = this.h.player;
    this.resolvePending(dt);
    this.option = this.pending ? null : this.find(pl);
    if (!this.option) return;
    const o = this.option;
    const input = this.h.input;
    if (o.kind === 'finisher' ? input.buffered('heavy') : input.buffered('light')) {
      input.consume(o.kind === 'finisher' ? 'heavy' : 'light');
      this.start(o.kind, o.agent);
      this.option = null;
    }
  }

  private find(pl: Player): { kind: Kind; agent: Agent } | null {
    if (pl.busy || pl.state === PState.Attack) return null;
    const ground = pl.state === PState.Ground;
    const air = pl.state === PState.Air && pl.vel.y < 1;
    if (!ground && !air) return null;
    let best: { kind: Kind; agent: Agent } | null = null;
    let bestD = Infinity;
    for (const a of this.h.agents.agents.values()) {
      if (!a.alive) continue;
      const to = _a.copy(pl.feet).sub(a.feet);
      const dy = -to.y;
      const dh = Math.hypot(to.x, to.z);
      let kind: Kind | null = null;
      if (air) {
        if (dy < -2.5 && dy > -10 && dh < 3 + -dy * 0.25) kind = 'drop';
      } else if (Math.abs(dy) < 1 && dh < 2.1) {
        const behind = a.facingDir(_b).dot(to.setY(0).normalize()) < -0.25;
        if (a.staggered && a.hp <= (a.kind === 'brute' ? 30 : 20)) kind = 'finisher';
        else if (!a.alerted && behind && !a.isBoss) kind = 'stealth';
      }
      if (kind && dh < bestD) {
        bestD = dh;
        best = { kind, agent: a };
      }
    }
    return best;
  }

  private start(kind: Kind, agent: Agent) {
    const pl = this.h.player;
    const to = _a.copy(agent.feet).sub(pl.feet);
    const yaw = Math.atan2(to.x, to.z);
    if (kind === 'drop') {
      // dive at the target
      const t = 0.32;
      const vel = new THREE.Vector3(to.x / t, Math.min(-6, to.y / t), to.z / t);
      pl.finisherAttack(AttackId.Stomp, yaw, vel);
      this.h.audio.play('whoosh', { pitch: 0.6 });
    } else if (kind === 'stealth') {
      pl.finisherAttack(AttackId.Uppercut, yaw, new THREE.Vector3(to.x * 2, 0, to.z * 2));
      this.h.cameraRig.startCinematic('finisher', 0.9, () => agent.center(new THREE.Vector3()), yaw);
      this.h.slowmo(0.45, 0.5);
    } else {
      pl.finisherAttack(AttackId.Stomp, yaw, new THREE.Vector3(to.x * 2.5, 2, to.z * 2.5));
      this.h.cameraRig.startCinematic('finisher', 1.0, () => agent.center(new THREE.Vector3()), yaw);
      this.h.slowmo(0.4, 0.6);
    }
    this.pending = { kind, agent, t: kind === 'drop' ? 0.45 : 0.22 };
  }

  private resolvePending(dt: number) {
    const p = this.pending;
    if (!p) return;
    p.t -= dt;
    const pl = this.h.player;
    const close = p.agent.feet.distanceTo(pl.feet) < 1.6;
    if (p.t > 0 && !(p.kind === 'drop' && close)) return;
    this.pending = null;
    const a = p.agent;
    const c = a.center(new THREE.Vector3());
    this.h.pop(LABEL[p.kind] + '!', c.clone().add(new THREE.Vector3(0, 1.2, 0)));
    this.h.event('takedowns');
    // the move's own hit may already have finished them off
    if (!a.alive) return;
    const dir = _a.copy(a.feet).sub(pl.feet).setY(0);
    if (dir.lengthSq() < 1e-4) pl.facing(dir);
    dir.normalize();
    const dmg = a.isBoss ? 60 : 999;
    a.receiveHit({ dir: dir.clone(), damage: dmg, knock: p.kind === 'drop' ? 4 : 9, lift: p.kind === 'stealth' ? 7 : 3, kind: p.kind === 'drop' ? 'stomp' : 'heavy' });
    this.h.effects.inkBurst(c, new THREE.Vector3(0, 1, 0), '#111114', 60);
    this.h.effects.shockwave(a.feet.clone().setY(a.feet.y + 0.2), '#2a2a30', p.kind === 'drop' ? 5 : 3);
    this.h.audio.play('heavyHit');
    this.h.audio.play('ink', { pitch: 0.7 });
    this.h.cameraRig.addShake(p.kind === 'drop' ? 0.5 : 0.3);
    this.h.hitstop(0.12);
    // drop takedowns knock everyone nearby off their feet
    if (p.kind === 'drop') {
      for (const o of this.h.agents.agents.values()) {
        if (o === a || !o.alive || o.feet.distanceTo(a.feet) > 4.5) continue;
        const d = o.feet.clone().sub(a.feet).setY(0).normalize();
        o.receiveHit({ dir: d, damage: 15, knock: 9, lift: 5, kind: 'shock' });
      }
    }
  }
}
