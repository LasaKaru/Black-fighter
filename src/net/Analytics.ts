import { dataBase, desktop } from './Endpoints';
import { crashGuard } from '../core/CrashGuard';

/**
 * Anonymous play statistics for the owner panel.
 *
 * - A random install id (no name, email or IP) and a per-launch session id.
 * - Events are queued in localStorage and sent in batches every 30 s and when
 *   the window hides, so offline play loses nothing and never blocks.
 * - Settings → Privacy turns it off; the queue is then deleted.
 */

export type AnalyticsEvent =
  | 'session_start'
  | 'heartbeat'
  | 'mode'
  | 'mission_start'
  | 'mission_end'
  | 'chapter'
  | 'achievement'
  | 'island'
  | 'level'
  | 'purchase'
  | 'error'
  | 'perf'
  | 'checkpoint'
  | 'secret'
  | 'link';

interface Queued {
  e: AnalyticsEvent;
  t: number;
  d?: Record<string, string | number | boolean>;
}

const ANON_KEY = 'blackeye.anon';
const QUEUE_KEY = 'blackeye.analytics.queue';
const MAX_QUEUE = 400;

function uid(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Analytics {
  enabled = true;
  readonly session = uid();
  private anon: string;
  /** The random install id (shown in Settings → Privacy for deletion requests). */
  get installId(): string {
    return this.anon;
  }
  private queue: Queued[] = [];
  private timer = 0;
  private sending = false;
  private beat = 0;
  private fpsSum = 0;
  private fpsN = 0;

  constructor(private serverUrl: () => string) {
    let a = '';
    try {
      a = localStorage.getItem(ANON_KEY) ?? '';
      if (!a) {
        a = uid();
        localStorage.setItem(ANON_KEY, a);
      }
      this.queue = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as Queued[];
      if (!Array.isArray(this.queue)) this.queue = [];
    } catch {
      a = a || uid();
      this.queue = [];
    }
    this.anon = a;
    window.addEventListener('error', (e) => this.track('error', { msg: String(e.message ?? '').slice(0, 160), at: `${(e.filename ?? '').split('/').pop()}:${e.lineno ?? 0}` }));
    window.addEventListener('unhandledrejection', (e) => this.track('error', { msg: String((e.reason as Error)?.message ?? e.reason ?? '').slice(0, 160), at: 'promise' }));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush(true);
    });
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.queue = [];
      this.persist();
    }
  }

  /** Session start: platform, OS, version, language region, screen, GPU class. */
  start(extra: Record<string, string | number | boolean> = {}) {
    const lang = navigator.language || 'en';
    let gpu = '';
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      gpu = dbg ? String(gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).replace(/\(.*?\)/g, '').slice(0, 60) : '';
    } catch {
      /* no WebGL info */
    }
    this.track('session_start', {
      platform: desktop ? 'desktop' : /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) ? 'mobile' : 'web',
      os: desktop?.platform ?? (navigator.userAgent.includes('Windows') ? 'win32' : navigator.userAgent.includes('Mac') ? 'darwin' : navigator.userAgent.includes('Linux') ? 'linux' : 'other'),
      version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
      lang,
      region: (lang.split('-')[1] ?? '').toUpperCase().slice(0, 2),
      screen: `${screen.width}x${screen.height}`,
      gpu,
      ...extra,
    });
  }

  track(e: AnalyticsEvent, d?: Record<string, string | number | boolean>) {
    // the same events are breadcrumbs for crash reports (even with statistics off)
    if (e !== 'heartbeat' && e !== 'error') crashGuard.crumb(`${e}${d ? ' ' + JSON.stringify(d).slice(0, 80) : ''}`);
    if (!this.enabled) return;
    this.queue.push({ e, t: Date.now(), d });
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.persist();
  }

  /** Per frame: heartbeat every minute (play time + average fps), batched sends. */
  update(dt: number, fps: number, state: { playing: boolean; mode: string; island: string }) {
    if (!this.enabled) return;
    if (state.playing) {
      this.fpsSum += fps;
      this.fpsN++;
    }
    this.beat += dt;
    if (this.beat >= 60) {
      this.beat = 0;
      if (state.playing) this.track('heartbeat', { mode: state.mode, island: state.island, fps: this.fpsN ? Math.round(this.fpsSum / this.fpsN) : 0 });
      this.fpsSum = this.fpsN = 0;
    }
    this.timer += dt;
    if (this.timer >= 30) {
      this.timer = 0;
      this.flush();
    }
  }

  private persist() {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
    } catch {
      /* storage full: keep in memory */
    }
  }

  /** Send the queue. `beacon` uses sendBeacon (page closing). */
  flush(beacon = false) {
    if (!this.enabled || !this.queue.length || this.sending) return;
    const batch = this.queue.slice(0, 100);
    const body = JSON.stringify({ anon: this.anon, session: this.session, events: batch });
    const url = dataBase(this.serverUrl()) + '/analytics';
    if (beacon && navigator.sendBeacon) {
      if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) {
        this.queue.splice(0, batch.length);
        this.persist();
      }
      return;
    }
    this.sending = true;
    fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body, keepalive: true })
      .then((r) => {
        if (r.ok) {
          this.queue.splice(0, batch.length);
          this.persist();
        }
      })
      .catch(() => {
        /* offline: try again later */
      })
      .finally(() => (this.sending = false));
  }
}
