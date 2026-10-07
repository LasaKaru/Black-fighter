import * as THREE from 'three';
import type { Agent, AgentKind, AgentManager } from '../ai/Agents';
import type { Physics } from '../physics/Physics';
import type { World } from '../world/World';
import type { Profile } from './Profile';

export interface PursuitDeps {
  agents: AgentManager;
  physics: Physics;
  world: World;
  profile: Profile;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  /** Player feet, or null when a pursuit may not start (driving, busy, in a mission…). */
  player(): { feet: THREE.Vector3; ko: boolean; free: boolean };
  onReward(ink: number, outcome: 'won' | 'escaped' | 'timeout'): void;
}

const ESCAPE_DIST = 60;
const MAX_HEAT = 5;
/** Who comes for you at each wanted level (cumulative pools). */
const SQUADS: AgentKind[][] = [
  ['agent', 'runner'],
  ['agent', 'runner', 'agent'],
  ['agent', 'runner', 'shield'],
  ['shield', 'runner', 'sniper', 'brute'],
  ['shield', 'sniper', 'brute', 'drone', 'runner'],
  ['shield', 'sniper', 'brute', 'drone', 'static', 'drone'],
];
const ESCAPE_HOLD = 4;
const TIME_LIMIT = 75;

/**
 * Free-roam ambushes (reference: the whole clip is a chase). Every minute or
 * two an Agent squad drops in behind you. Lose them across the rooftops or
 * ink every one of them for a reward.
 */
export class Pursuit {
  active = false;
  private squad: Agent[] = [];
  private cooldown = 45;
  private t = 0;
  private away = 0;
  private rng = Math.random;
  /** Wanted level 0..5 (fractional; stars = ceil). Builds with violence, cools while you lie low. */
  heat = 0;
  private calm = 0;

  constructor(private d: PursuitDeps) {}

  get stars(): number {
    return Math.min(MAX_HEAT, Math.ceil(this.heat - 0.05));
  }

  addHeat(n: number) {
    const before = this.stars;
    this.heat = Math.min(MAX_HEAT, this.heat + n);
    this.calm = 0;
    if (this.stars > before && this.stars >= 2) this.d.toast(`WANTED ${'★'.repeat(this.stars)} — the Agents are sending ${this.stars >= 4 ? 'drones' : this.stars >= 3 ? 'snipers' : 'shields'} now`, 'warn');
    // at high heat the next ambush comes sooner
    if (!this.active) this.cooldown = Math.min(this.cooldown, 120 - this.stars * 18);
  }

  get left(): number {
    return this.squad.filter((a) => a.alive).length;
  }

  hud(): { text: string; hint: string; progress: string; time: number } | null {
    if (!this.active) return null;
    const far = this.away > 0 ? ` · escaping ${Math.ceil(ESCAPE_HOLD - this.away)}…` : '';
    return { text: `PURSUIT ${'★'.repeat(Math.max(1, this.stars))}`, hint: `Lose them (${ESCAPE_DIST} m) or ink them all${far}`, progress: `${this.left} AGENTS ON YOU`, time: Math.max(0, TIME_LIMIT - this.t) };
  }

  /** Nearest pursuer (for the compass). */
  target(from: THREE.Vector3): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bd = Infinity;
    for (const a of this.squad) {
      if (!a.alive) continue;
      const dd = a.feet.distanceTo(from);
      if (dd < bd) {
        bd = dd;
        best = a.feet;
      }
    }
    return best;
  }

  reset(cooldown = 45) {
    this.end(null);
    this.cooldown = cooldown;
  }

  /** Start right away (debug / tests). */
  trigger(): boolean {
    const p = this.d.player();
    return this.start(p.feet);
  }

  update(dt: number, allowed: boolean) {
    const p = this.d.player();
    if (!this.active) {
      // lie low: one star cools off every 45 s without trouble
      this.calm += dt;
      if (this.calm > 45 && this.heat > 0) {
        this.heat = Math.max(0, this.heat - 1);
        this.calm = 0;
      }
      if (!allowed || !p.free) return;
      this.cooldown -= dt;
      if (this.cooldown <= 0) {
        if (!this.start(p.feet)) this.cooldown = 10;
      }
      return;
    }
    this.t += dt;
    if (!allowed || p.ko) {
      this.end('They lost you.', 0);
      return;
    }
    const alive = this.squad.filter((a) => a.alive && this.d.agents.agents.has(a.id));
    if (!alive.length) {
      this.end('Pursuit won! Every Agent inked.', Math.round(70 * (1 + this.stars * 0.3)), 'won');
      this.addHeat(0.6);
      return;
    }
    const nearest = Math.min(...alive.map((a) => a.feet.distanceTo(p.feet)));
    this.away = nearest > ESCAPE_DIST ? this.away + dt : 0;
    if (this.away >= ESCAPE_HOLD) {
      this.end('Escaped! The Agents lost your trail.', Math.round(45 * (1 + this.stars * 0.3)), 'escaped');
      this.heat = Math.max(0, this.heat - 1);
      return;
    }
    if (this.t >= TIME_LIMIT) this.end('The Agents gave up the chase.', 15, 'timeout');
  }

  private start(feet: THREE.Vector3): boolean {
    // drop points: behind and around the player, on solid ground
    const spots: THREE.Vector3[] = [];
    for (const s of this.d.world.agentSpawns) {
      const dd = s.distanceTo(feet);
      if (dd > 16 && dd < 45) spots.push(s.clone());
    }
    for (let i = 0; spots.length < 6 && i < 24; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = 18 + this.rng() * 10;
      const probe = new THREE.Vector3(feet.x + Math.cos(a) * r, feet.y + 25, feet.z + Math.sin(a) * r);
      const hit = this.d.physics.raycast(probe, new THREE.Vector3(0, -1, 0), 60);
      if (hit && hit.normal.y > 0.7 && Math.abs(hit.point.y - feet.y) < 12) spots.push(hit.point.clone());
    }
    if (spots.length < 2) return false;
    if (this.heat < 1) this.heat = 1;
    const pool = SQUADS[this.stars];
    const n = 3 + Math.floor(this.rng() * 2) + Math.floor(this.stars / 2);
    this.squad = [];
    for (let i = 0; i < n; i++) {
      const s = spots[i % spots.length].clone().add(new THREE.Vector3((this.rng() - 0.5) * 3, 0.1, (this.rng() - 0.5) * 3));
      this.squad.push(this.d.agents.spawnAt(s, false, pool[i % pool.length]));
    }
    this.active = true;
    this.t = 0;
    this.away = 0;
    this.d.toast(`PURSUIT ${'★'.repeat(this.stars)}! ${n} Agents dropped in. Lose them or ink them all.`, 'warn');
    return true;
  }

  private end(msg: string | null, ink = 0, outcome: 'won' | 'escaped' | 'timeout' = 'timeout') {
    if (this.active) {
      for (const a of this.squad) this.d.agents.remove(a);
      if (msg) this.d.toast(ink > 0 ? `${msg}  +${ink} Ink` : msg, ink > 0 ? 'power' : 'info');
      if (ink > 0) {
        this.d.profile.addInk(ink);
        this.d.onReward(ink, outcome);
      }
    }
    this.squad = [];
    this.active = false;
    this.cooldown = (70 + this.rng() * 50) * (1 - this.stars * 0.1);
    this.t = 0;
    this.away = 0;
  }
}
