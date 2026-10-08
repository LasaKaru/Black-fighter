/**
 * Crash reports from players' games (POST /crash), grouped by cause so the
 * owner panel shows "this error, 37 times, 12 players, versions 0.5.3-0.5.4"
 * rather than 37 separate entries. Each group keeps the last 5 full reports
 * (stack trace, what the player was doing, the last actions before it).
 *
 * A group marked resolved reopens by itself if the same crash comes back
 * (flagged as a regression). Stored in DATA_DIR/crashes.json, at most 500
 * groups; no IP address or name is stored.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readJson, writeJson } from './fsutil';

export interface CrashSample {
  t: number;
  stack: string;
  version: string;
  platform: string;
  os: string;
  gpu: string;
  context: Record<string, string | number | boolean>;
  crumbs: string[];
}

export interface CrashGroup {
  id: string;
  kind: string;
  msg: string;
  count: number;
  players: string[];
  sessions: string[];
  firstSeen: number;
  lastSeen: number;
  versions: Record<string, number>;
  platforms: Record<string, number>;
  gpus: Record<string, number>;
  status: 'open' | 'resolved' | 'ignored';
  resolvedAt: number;
  regressed: boolean;
  samples: CrashSample[];
}

const KINDS = new Set(['error', 'promise', 'loop', 'webgl', 'hang', 'boot', 'stuck', 'storage']);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, max) : '');
const inc = (o: Record<string, number>, k: string) => {
  if (!k) return;
  if (Object.keys(o).length >= 40 && !(k in o)) k = 'other';
  o[k] = (o[k] ?? 0) + 1;
};

/** Same crash = same kind + message (numbers blanked) + first stack frame. */
function signature(kind: string, msg: string, stack: string): string {
  const norm = msg.replace(/\d+(\.\d+)?/g, 'N').replace(/'[^']*'|"[^"]*"/g, 'S');
  const frame = (stack.split('\n').find((l) => /\bat\b|@/.test(l)) ?? '').replace(/:\d+:\d+/g, '').replace(/\?[^)\s]*/g, '').trim();
  return createHash('sha1').update(`${kind}|${norm}|${frame}`).digest('hex').slice(0, 12);
}

export class CrashStore {
  groups = new Map<string, CrashGroup>();
  private file: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'crashes.json');
  }

  async load() {
    try {
      for (const g of await readJson<CrashGroup[]>(this.file)) this.groups.set(g.id, g);
    } catch {
      /* none yet */
    }
  }

  private dirty() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, 4000);
  }

  async save() {
    await writeJson(this.file, [...this.groups.values()]).catch((e) => console.error('[crashes] save failed', e));
  }

  /** A batch from one game. Returns how many reports were accepted. */
  ingest(body: unknown, now = Date.now()): number {
    const reports = (body as { reports?: unknown })?.reports;
    if (!Array.isArray(reports)) return 0;
    let n = 0;
    for (const raw of reports.slice(0, 10)) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const kind = KINDS.has(r.kind as string) ? (r.kind as string) : 'error';
      const msg = str(r.msg, 300) || 'unknown';
      const stack = str(r.stack, 3000);
      const id = signature(kind, msg, stack);
      let g = this.groups.get(id);
      if (!g) {
        if (this.groups.size >= 500) this.evict();
        g = { id, kind, msg, count: 0, players: [], sessions: [], firstSeen: now, lastSeen: now, versions: {}, platforms: {}, gpus: {}, status: 'open', resolvedAt: 0, regressed: false, samples: [] };
        this.groups.set(id, g);
      }
      if (g.status === 'resolved') {
        g.status = 'open';
        g.regressed = true;
      }
      g.count++;
      g.lastSeen = now;
      const anon = /^[a-f0-9]{24}$/.test(String(r.anon)) ? String(r.anon) : '';
      if (anon && !g.players.includes(anon) && g.players.length < 500) g.players.push(anon);
      const session = str(r.session, 32);
      if (session && !g.sessions.includes(session) && g.sessions.length < 1000) g.sessions.push(session);
      const version = str(r.version, 20);
      const platform = str(r.platform, 12);
      const gpu = str(r.gpu, 60);
      inc(g.versions, version);
      inc(g.platforms, platform);
      inc(g.gpus, gpu);
      const ctx: Record<string, string | number | boolean> = {};
      if (r.context && typeof r.context === 'object') {
        for (const [k, v] of Object.entries(r.context as Record<string, unknown>).slice(0, 24)) {
          if (typeof v === 'number' || typeof v === 'boolean') ctx[str(k, 24)] = v;
          else if (typeof v === 'string') ctx[str(k, 24)] = str(v, 80);
        }
      }
      const crumbs = Array.isArray(r.crumbs) ? r.crumbs.slice(-30).map((c) => str(c, 120)) : [];
      g.samples.push({ t: now, stack, version, platform, os: str(r.os, 20), gpu, context: ctx, crumbs });
      if (g.samples.length > 5) g.samples.shift();
      n++;
    }
    if (n) this.dirty();
    return n;
  }

  /** Drop the oldest resolved / ignored group, else the oldest. */
  private evict() {
    const all = [...this.groups.values()].sort((a, b) => a.lastSeen - b.lastSeen);
    const victim = all.find((g) => g.status !== 'open') ?? all[0];
    if (victim) this.groups.delete(victim.id);
  }

  setStatus(id: string, status: CrashGroup['status']): boolean {
    const g = this.groups.get(id);
    if (!g || !['open', 'resolved', 'ignored'].includes(status)) return false;
    g.status = status;
    g.resolvedAt = status === 'resolved' ? Date.now() : 0;
    if (status !== 'open') g.regressed = false;
    this.dirty();
    return true;
  }

  delete(id: string): boolean {
    const ok = this.groups.delete(id);
    if (ok) this.dirty();
    return ok;
  }

  /** The panel list: groups (without full player lists) + totals. */
  summary(now = Date.now()) {
    const day = 86400_000;
    const groups = [...this.groups.values()].sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.lastSeen - a.lastSeen);
    const sessions7 = new Set<string>();
    let last24 = 0;
    for (const g of groups) {
      if (g.kind === 'hang' || g.status === 'ignored') continue;
      for (const s of g.samples) if (now - s.t < day) last24++;
      if (now - g.lastSeen < 7 * day) for (const s of g.sessions) sessions7.add(s);
    }
    return {
      open: groups.filter((g) => g.status === 'open').length,
      regressions: groups.filter((g) => g.regressed).length,
      last24,
      sessions7: sessions7.size,
      players: new Set(groups.flatMap((g) => g.players)).size,
      groups: groups.map(({ players, sessions, ...g }) => ({ ...g, players: players.length, sessions: sessions.length })),
    };
  }
}
