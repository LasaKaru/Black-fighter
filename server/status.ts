/**
 * Game status: live, maintenance or development ("coming soon"), set from the
 * owner panel, optionally scheduled (starts at / back at). Every game client
 * reads GET /status at start and every minute and shows a full-screen notice
 * with a countdown while the game is closed; when the "back at" time passes
 * the server switches itself back to live.
 *
 * While maintenance or development is active the server also refuses new
 * multiplayer joins, warns players in rooms 10, 5 and 1 minutes before a
 * scheduled start, and closes the rooms when it starts.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { readJson, writeJson } from './fsutil';

export type GameMode = 'live' | 'maintenance' | 'development';

export interface GameStatus {
  mode: GameMode;
  title: string;
  message: string;
  /** When the mode takes effect (0 = now). */
  startsAt: number;
  /** When the game comes back by itself (0 = when the owner turns it off). */
  until: number;
  /** Close the web version (browser) too, not only online play. */
  blockWeb: boolean;
  /** Close the desktop / Steam version too. Off by default: buyers expect single player to keep working. */
  blockDesktop: boolean;
  /** sha256(salt + code) of the tester code that lets testers in ('' = none). */
  testerHash: string;
  testerSalt: string;
  updatedAt: number;
}

export interface PublicStatus {
  mode: GameMode;
  /** The mode is in force right now. */
  active: boolean;
  title: string;
  message: string;
  startsAt: number;
  until: number;
  blockWeb: boolean;
  blockDesktop: boolean;
  testers: boolean;
  serverTime: number;
}

const DEFAULT: GameStatus = { mode: 'live', title: '', message: '', startsAt: 0, until: 0, blockWeb: true, blockDesktop: false, testerHash: '', testerSalt: '', updatedAt: 0 };

const text = (v: unknown, max: number, lines = false) => (typeof v === 'string' ? v.replace(lines ? /[\u0000-\u0009\u000b-\u001f]/g : /[\u0000-\u001f]/g, ' ').slice(0, max) : '');
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const hash = (salt: string, code: string) => createHash('sha256').update(salt + code.trim().toLowerCase()).digest();

export class StatusStore {
  status: GameStatus = { ...DEFAULT };
  private file: string;
  /** Called when the mode switches on (rooms close) or off. */
  onChange: (active: boolean, s: PublicStatus) => void = () => {};
  private wasActive = false;
  private warned = new Set<number>();

  constructor(dataDir: string) {
    this.file = join(dataDir, 'status.json');
  }

  async load() {
    try {
      this.status = { ...DEFAULT, ...(await readJson<GameStatus>(this.file)) };
    } catch {
      /* live */
    }
    this.wasActive = this.public().active;
  }

  private save() {
    void writeJson(this.file, this.status).catch((e) => console.error('[status] save failed', e));
  }

  /** The status everyone sees (tester code never leaves the server). */
  public(now = Date.now()): PublicStatus {
    const s = this.status;
    const active = s.mode !== 'live' && (!s.startsAt || s.startsAt <= now) && (!s.until || s.until > now);
    return { mode: s.mode, active, title: s.title, message: s.message, startsAt: s.startsAt, until: s.until, blockWeb: s.blockWeb, blockDesktop: s.blockDesktop, testers: !!s.testerHash, serverTime: now };
  }

  /** Multiplayer joins are refused while maintenance or development is in force. */
  blocksOnline(now = Date.now()): boolean {
    return this.public(now).active;
  }

  /** Owner panel update. `tester` = new tester code ('' clears it, undefined keeps it). */
  set(patch: Partial<GameStatus> & { tester?: string }): PublicStatus {
    const s = this.status;
    const mode: GameMode = patch.mode === 'maintenance' || patch.mode === 'development' || patch.mode === 'live' ? patch.mode : s.mode;
    this.status = {
      ...s,
      mode,
      title: patch.title !== undefined ? text(patch.title, 80) : s.title,
      message: patch.message !== undefined ? text(patch.message, 600, true) : s.message,
      startsAt: patch.startsAt !== undefined ? time(patch.startsAt) : s.startsAt,
      until: patch.until !== undefined ? time(patch.until) : s.until,
      blockWeb: patch.blockWeb !== undefined ? patch.blockWeb === true : s.blockWeb,
      blockDesktop: patch.blockDesktop !== undefined ? patch.blockDesktop === true : s.blockDesktop,
      updatedAt: Date.now(),
    };
    if (mode === 'live') Object.assign(this.status, { startsAt: 0, until: 0 });
    if (patch.tester !== undefined) {
      const code = text(patch.tester, 64).trim();
      const salt = randomBytes(8).toString('hex');
      Object.assign(this.status, code ? { testerSalt: salt, testerHash: hash(salt, code).toString('hex') } : { testerSalt: '', testerHash: '' });
    }
    this.warned.clear();
    this.save();
    this.tick();
    console.log(`[status] ${mode}${this.status.until ? ' until ' + new Date(this.status.until).toISOString() : ''}`);
    return this.public();
  }

  checkTester(code: string): boolean {
    const s = this.status;
    if (!s.testerHash || !code) return false;
    return timingSafeEqual(hash(s.testerSalt, code), Buffer.from(s.testerHash, 'hex'));
  }

  /** Call every few seconds: scheduled warnings, start and automatic return to live. */
  tick(warn?: (minutes: number, s: PublicStatus) => void, now = Date.now()) {
    const p = this.public(now);
    const s = this.status;
    if (s.mode !== 'live' && s.until && s.until <= now) {
      // back at the promised time
      this.status = { ...s, mode: 'live', startsAt: 0, until: 0, updatedAt: now };
      this.save();
      console.log('[status] back to live (scheduled)');
    }
    if (warn && s.mode !== 'live' && s.startsAt > now) {
      const mins = (s.startsAt - now) / 60_000;
      for (const m of [10, 5, 1]) {
        if (mins <= m && mins > m - 1 && !this.warned.has(m)) {
          this.warned.add(m);
          warn(m, p);
        }
      }
    }
    const active = this.public(now).active;
    if (active !== this.wasActive) {
      this.wasActive = active;
      this.onChange(active, this.public(now));
    }
  }
}
