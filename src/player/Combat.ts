import * as THREE from 'three';
import { AttackId } from '../character/Animator';

export type HitKind = 'light' | 'heavy' | 'tackle' | 'dash' | 'shock' | 'stomp' | 'agent';

export interface HitInfo {
  dir: THREE.Vector3;
  damage: number;
  knock: number;
  lift: number;
  kind: HitKind;
}

/** Anything that can be hit: agents, remote players, the local player. */
export interface Hittable {
  readonly key: string;
  readonly radius: number;
  alive: boolean;
  center(out: THREE.Vector3): THREE.Vector3;
  /** Returns true if the hit landed (not dodged / invulnerable). */
  receiveHit(h: HitInfo): boolean;
  /** Breakable scenery: hittable, but never a lock-on target. */
  readonly isProp?: boolean;
}

export interface AttackDef {
  dur: number;
  hitStart: number;
  hitEnd: number;
  range: number;
  arc: number;
  damage: number;
  knock: number;
  lift: number;
  lunge: number;
  kind: HitKind;
  hitstop: number;
}

/** Attack table (README §10.2). Times are fractions of `dur`. */
export const ATTACKS: Record<AttackId, AttackDef> = {
  [AttackId.Jab]: { dur: 0.3, hitStart: 0.3, hitEnd: 0.55, range: 1.45, arc: 0.55, damage: 10, knock: 3, lift: 1, lunge: 2.5, kind: 'light', hitstop: 0.045 },
  [AttackId.Cross]: { dur: 0.32, hitStart: 0.3, hitEnd: 0.55, range: 1.45, arc: 0.55, damage: 10, knock: 3.5, lift: 1, lunge: 2.5, kind: 'light', hitstop: 0.05 },
  [AttackId.Kick]: { dur: 0.48, hitStart: 0.32, hitEnd: 0.58, range: 1.75, arc: 0.45, damage: 15, knock: 9, lift: 3.5, lunge: 3, kind: 'heavy', hitstop: 0.1 },
  [AttackId.Tackle]: { dur: 0.5, hitStart: 0.05, hitEnd: 0.85, range: 1.35, arc: 0.2, damage: 30, knock: 12, lift: 4, lunge: 11, kind: 'tackle', hitstop: 0.08 },
  [AttackId.Uppercut]: { dur: 0.52, hitStart: 0.38, hitEnd: 0.6, range: 1.5, arc: 0.5, damage: 25, knock: 3, lift: 9, lunge: 1.5, kind: 'heavy', hitstop: 0.1 },
  [AttackId.Stomp]: { dur: 1.2, hitStart: 0, hitEnd: 1, range: 2.8, arc: -1, damage: 20, knock: 6, lift: 5, lunge: 0, kind: 'stomp', hitstop: 0.08 },
  [AttackId.AirKick]: { dur: 0.42, hitStart: 0.25, hitEnd: 0.65, range: 1.7, arc: 0.4, damage: 14, knock: 7, lift: 2, lunge: 4, kind: 'heavy', hitstop: 0.07 },
  [AttackId.SlideKick]: { dur: 0.45, hitStart: 0.05, hitEnd: 0.7, range: 1.5, arc: 0.3, damage: 12, knock: 3, lift: 7, lunge: 0, kind: 'light', hitstop: 0.06 },
  [AttackId.FlyingKick]: { dur: 0.7, hitStart: 0.35, hitEnd: 0.7, range: 1.6, arc: 0.4, damage: 12, knock: 7, lift: 2, lunge: 9, kind: 'agent', hitstop: 0.06 },
};

const _c = new THREE.Vector3();

/**
 * Find targets inside an attack volume: a sphere of `range` around a point in
 * front of the attacker, filtered by a facing arc (cos threshold; -1 = all
 * directions).
 */
export function queryHits(origin: THREE.Vector3, facing: THREE.Vector3, range: number, arc: number, targets: Iterable<Hittable>, exclude: Set<string>): Hittable[] {
  const out: Hittable[] = [];
  for (const t of targets) {
    if (!t.alive || exclude.has(t.key)) continue;
    t.center(_c);
    const dx = _c.x - origin.x;
    const dy = _c.y - origin.y;
    const dz = _c.z - origin.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > range + t.radius) continue;
    if (Math.abs(dy) > 1.6) continue;
    if (arc > -1 && d > 0.3) {
      const h = Math.hypot(dx, dz) || 1;
      const cos = (dx * facing.x + dz * facing.z) / h;
      if (cos < arc) continue;
    }
    out.push(t);
  }
  return out;
}
