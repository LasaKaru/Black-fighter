/**
 * Anonymous play statistics. Clients send batches of events (see
 * src/net/Analytics.ts); the server keeps per-day aggregates and a small
 * per-install record (first/last seen, sessions, play time). No IP address,
 * name or email is stored. Data lives in DATA_DIR/analytics/.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Counts = Record<string, number>;

interface Day {
  sessions: number;
  players: string[];
  newPlayers: number;
  playSec: number;
  modes: Counts;
  missionStart: Counts;
  missionDone: Counts;
  missionFail: Counts;
  achievements: Counts;
  islands: Counts;
  chapters: Counts;
  platforms: Counts;
  regions: Counts;
  versions: Counts;
  gpus: Counts;
  art: Counts;
  gfx: Counts;
  links: Counts;
  secrets: Counts;
  levels: Counts;
  errors: Array<{ msg: string; at: string; n: number }>;
  fpsSum: number;
  fpsN: number;
}

interface Player {
  first: number;
  last: number;
  sessions: number;
  playSec: number;
  platform: string;
  region: string;
  version: string;
}

const emptyDay = (): Day => ({
  sessions: 0, players: [], newPlayers: 0, playSec: 0, modes: {}, missionStart: {}, missionDone: {}, missionFail: {}, achievements: {}, islands: {}, chapters: {},
  platforms: {}, regions: {}, versions: {}, gpus: {}, art: {}, gfx: {}, links: {}, secrets: {}, levels: {}, errors: [], fpsSum: 0, fpsN: 0,
});

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const str = (v: unknown, max = 40) => (typeof v === 'string' ? v.replace(/[^\w .:/@#+-]/g, '').slice(0, max) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const inc = (c: Counts, k: string, n = 1) => {
  if (!k) return;
  if (Object.keys(c).length > 400 && !(k in c)) return;
  c[k] = (c[k] ?? 0) + n;
};

export class AnalyticsStore {
  private days = new Map<string, Day>();
  private players = new Map<string, Player>();
  private dirty = new Set<string>();
  private playersDirty = false;
  private timer: NodeJS.Timeout | null = null;
  private dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'analytics');
  }

  async load() {
    try {
      const raw = JSON.parse(await readFile(join(this.dir, 'players.json'), 'utf8')) as Record<string, Player>;
      for (const [k, v] of Object.entries(raw)) this.players.set(k, v);
    } catch {
      /* first run */
    }
    try {
      const files = (await readdir(join(this.dir, 'days'))).filter((f) => f.endsWith('.json')).sort().slice(-120);
      for (const f of files) this.days.set(f.slice(0, 10), { ...emptyDay(), ...(JSON.parse(await readFile(join(this.dir, 'days', f), 'utf8')) as Day) });
    } catch {
      /* no days yet */
    }
  }

  private day(t: number): Day {
    const k = dayKey(t);
    let d = this.days.get(k);
    if (!d) {
      d = emptyDay();
      this.days.set(k, d);
    }
    this.dirty.add(k);
    return d;
  }

  /** One batch from a client. Returns false when it is malformed. */
  ingest(body: unknown, now = Date.now()): boolean {
    if (!body || typeof body !== 'object') return false;
    const o = body as { anon?: unknown; session?: unknown; events?: unknown };
    const anon = typeof o.anon === 'string' && /^[a-f0-9]{24}$/.test(o.anon) ? o.anon : '';
    if (!anon || !Array.isArray(o.events) || o.events.length > 120) return false;
    let p = this.players.get(anon);
    for (const raw of o.events) {
      if (!raw || typeof raw !== 'object') continue;
      const ev = raw as { e?: unknown; t?: unknown; d?: Record<string, unknown> };
      // clamp client clocks to the last 3 days … now
      const t = Math.min(now, Math.max(now - 3 * 86400_000, Number(ev.t) || now));
      const d = this.day(t);
      const data = ev.d && typeof ev.d === 'object' ? ev.d : {};
      if (!d.players.includes(anon)) d.players.push(anon);
      switch (ev.e) {
        case 'session_start': {
          d.sessions++;
          if (!p) {
            p = { first: t, last: t, sessions: 0, playSec: 0, platform: '', region: '', version: '' };
            this.players.set(anon, p);
            d.newPlayers++;
          }
          p.sessions++;
          p.platform = str(data.platform, 12);
          p.region = str(data.region, 2).toUpperCase();
          p.version = str(data.version, 16);
          inc(d.platforms, p.platform);
          inc(d.regions, p.region || '??');
          inc(d.versions, p.version);
          inc(d.gpus, str(data.gpu, 50) || 'unknown');
          inc(d.art, str(data.art, 12));
          inc(d.gfx, str(data.gfx, 12));
          break;
        }
        case 'heartbeat':
          d.playSec += 60;
          if (p) p.playSec += 60;
          if (typeof data.fps === 'number' && data.fps > 0 && data.fps < 1000) {
            d.fpsSum += data.fps;
            d.fpsN++;
          }
          break;
        case 'mode':
          inc(d.modes, str(data.mode, 12));
          break;
        case 'mission_start':
          inc(d.missionStart, str(data.id, 32));
          break;
        case 'mission_end':
          inc(data.ok === true ? d.missionDone : d.missionFail, str(data.id, 32));
          break;
        case 'achievement':
          inc(d.achievements, str(data.id, 32));
          break;
        case 'island':
          inc(d.islands, str(data.id, 32));
          break;
        case 'chapter':
          inc(d.chapters, str(data.n, 4));
          break;
        case 'level':
          inc(d.levels, str(data.id, 4));
          break;
        case 'link':
          inc(d.links, str(data.id, 40));
          break;
        case 'secret':
          inc(d.secrets, str(data.id, 32));
          break;
        case 'error': {
          const msg = str(data.msg, 160);
          const at = str(data.at, 60);
          const hit = d.errors.find((x) => x.msg === msg && x.at === at);
          if (hit) hit.n++;
          else if (d.errors.length < 60) d.errors.push({ msg, at, n: 1 });
          break;
        }
      }
      if (p) p.last = Math.max(p.last, t);
    }
    this.playersDirty = true;
    this.scheduleSave();
    return true;
  }

  private scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save();
    }, 5000);
  }

  async save() {
    await mkdir(join(this.dir, 'days'), { recursive: true }).catch(() => {});
    for (const k of this.dirty) {
      const d = this.days.get(k);
      if (d) await writeFile(join(this.dir, 'days', k + '.json'), JSON.stringify(d)).catch(() => {});
    }
    this.dirty.clear();
    if (this.playersDirty) {
      this.playersDirty = false;
      await writeFile(join(this.dir, 'players.json'), JSON.stringify(Object.fromEntries(this.players))).catch(() => {});
    }
  }

  /** Everything the owner panel shows, for the last `days` days. */
  summary(days = 30, now = Date.now()) {
    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i--) keys.push(dayKey(now - i * 86400_000));
    const sum = (pick: (d: Day) => Counts) => {
      const out: Counts = {};
      for (const k of keys) {
        const d = this.days.get(k);
        if (d) for (const [x, n] of Object.entries(pick(d))) out[x] = (out[x] ?? 0) + n;
      }
      return Object.entries(out).sort((a, b) => b[1] - a[1]);
    };
    const uniq = (ks: string[]) => new Set(ks.flatMap((k) => this.days.get(k)?.players ?? [])).size;
    const series = keys.map((k) => {
      const d = this.days.get(k);
      return { date: k, players: d?.players.length ?? 0, newPlayers: d?.newPlayers ?? 0, sessions: d?.sessions ?? 0, playMin: Math.round((d?.playSec ?? 0) / 60), fps: d && d.fpsN ? Math.round(d.fpsSum / d.fpsN) : 0 };
    });
    const totalSessions = series.reduce((n, s) => n + s.sessions, 0);
    const totalPlay = series.reduce((n, s) => n + s.playMin, 0);
    // retention: of the installs first seen at least N days ago, how many came back N+ days later
    const ret = (n: number) => {
      const cut = now - n * 86400_000;
      let base = 0;
      let back = 0;
      for (const p of this.players.values()) {
        if (p.first > cut) continue;
        base++;
        if (p.last - p.first >= n * 86400_000 * 0.9) back++;
      }
      return base ? Math.round((back / base) * 100) : 0;
    };
    const errors = new Map<string, { msg: string; at: string; n: number }>();
    for (const k of keys) for (const e of this.days.get(k)?.errors ?? []) {
      const key = e.msg + '@' + e.at;
      const hit = errors.get(key);
      if (hit) hit.n += e.n;
      else errors.set(key, { ...e });
    }
    return {
      days,
      totals: {
        installs: this.players.size,
        today: series[series.length - 1].players,
        week: uniq(keys.slice(-7)),
        month: uniq(keys),
        sessions: totalSessions,
        playHours: Math.round((totalPlay / 60) * 10) / 10,
        avgSessionMin: totalSessions ? Math.round((totalPlay / totalSessions) * 10) / 10 : 0,
        retentionD1: ret(1),
        retentionD7: ret(7),
        retentionD30: ret(30),
      },
      series,
      modes: sum((d) => d.modes),
      missions: sum((d) => d.missionStart).map(([id, n]) => {
        const done = sum((d) => d.missionDone).find((x) => x[0] === id)?.[1] ?? 0;
        const fail = sum((d) => d.missionFail).find((x) => x[0] === id)?.[1] ?? 0;
        return { id, started: n, done, failed: fail, rate: n ? Math.round((done / n) * 100) : 0 };
      }),
      achievements: sum((d) => d.achievements),
      islands: sum((d) => d.islands),
      chapters: sum((d) => d.chapters),
      levels: sum((d) => d.levels),
      platforms: sum((d) => d.platforms),
      regions: sum((d) => d.regions),
      versions: sum((d) => d.versions),
      gpus: sum((d) => d.gpus).slice(0, 15),
      art: sum((d) => d.art),
      gfx: sum((d) => d.gfx),
      links: sum((d) => d.links),
      secrets: sum((d) => d.secrets),
      errors: [...errors.values()].sort((a, b) => b.n - a.n).slice(0, 30),
    };
  }
}
