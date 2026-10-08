import * as THREE from 'three';
import type { Checkpoint, Profile } from './Profile';
import type { Player } from '../player/Player';

export interface CheckpointHost {
  profile: Profile;
  player: Player;
  /** 'story' or 'free' while playing single-player; anything else = don't save. */
  mode(): string;
  /** Where you are, e.g. "Colombo · Sri Lanka" (or "Ink City"). */
  placeName(p: THREE.Vector3): string;
  /** What to do next (story step / active mission), if anything. */
  nextGoal(): string;
  /** Busy right now: in a mission, a vehicle, falling … (autosave waits). */
  busy(): boolean;
  /** The big "CHECKPOINT CLEARED" banner. */
  banner(label: string, detail: string): void;
  celebrate(at: THREE.Vector3): void;
  /** Small "saving" indicator in the corner. */
  saving(): void;
}

const AUTOSAVE_EVERY = 75;

/**
 * Checkpoints: every cleared story step, finished mission, discovered island
 * and world checkpoint (island arrivals, summits) records where you stand,
 * plus a quiet autosave every ~75 s while exploring. Continue on the title
 * screen and Restore in the pause menu put you back there.
 */
export class Checkpoints {
  private autosaveT = AUTOSAVE_EVERY;
  private bannerKeys = new Set<string>();
  private playT = 0;

  constructor(private h: CheckpointHost) {}

  get last(): Checkpoint | null {
    return this.h.profile.data.checkpoint;
  }

  /** Record a checkpoint at the player's feet. `banner` shows the big cleared banner. */
  clear(label: string, opts: { banner?: boolean; key?: string } = {}) {
    const mode = this.h.mode();
    if (mode !== 'story' && mode !== 'free') return;
    const pl = this.h.player;
    if (!pl.grounded && !pl.vehicle) {
      // mid-air: remember the last solid checkpoint position instead
      this.record(label, pl.checkpoint, pl.yaw, mode);
    } else this.record(label, pl.feet, pl.yaw, mode);
    const showBanner = opts.banner !== false && (!opts.key || !this.bannerKeys.has(opts.key));
    if (opts.key) this.bannerKeys.add(opts.key);
    if (showBanner) {
      this.h.banner(label, this.last!.detail);
      this.h.celebrate(pl.feet.clone());
    } else this.h.saving();
  }

  private record(label: string, at: THREE.Vector3, yaw: number, mode: 'story' | 'free') {
    const goal = this.h.nextGoal();
    const place = this.h.placeName(at);
    this.h.profile.data.checkpoint = {
      mode,
      pos: [round(at.x), round(at.y + 0.1), round(at.z)],
      yaw: round(yaw),
      label,
      detail: goal ? `${place} · ${goal}` : place,
      at: Date.now(),
    };
    this.h.player.checkpoint.set(at.x, at.y + 0.1, at.z);
    this.h.profile.save();
    this.autosaveT = AUTOSAVE_EVERY;
  }

  /** Call every frame while playing (not paused). */
  update(dt: number) {
    const mode = this.h.mode();
    if (mode !== 'story' && mode !== 'free') return;
    this.playT += dt;
    if (this.playT >= 10) {
      this.h.profile.data.playTime = (this.h.profile.data.playTime ?? 0) + this.playT;
      this.playT = 0;
    }
    this.autosaveT -= dt;
    if (this.autosaveT > 0) return;
    const pl = this.h.player;
    if (!pl.grounded || pl.vehicle || this.h.busy()) {
      this.autosaveT = 5;
      return;
    }
    this.clear('Autosave', { banner: false });
  }

  /** Where to put the player back (null when there is no checkpoint). */
  spot(): { pos: THREE.Vector3; yaw: number } | null {
    const c = this.last;
    if (!c) return null;
    return { pos: new THREE.Vector3(...c.pos), yaw: c.yaw };
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** "5 min ago" style label. */
export function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
