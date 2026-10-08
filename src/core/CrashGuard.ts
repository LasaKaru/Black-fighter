import { dataBase, desktop } from '../net/Endpoints';
import { cleanGpu } from './gpu';
export { cleanGpu };

/**
 * Keeps the game running when something goes wrong, and tells the owner.
 *
 * - Crash reports: every uncaught error, rejected promise, game-loop error,
 *   graphics reset and long freeze is sent to the server (POST /crash) with
 *   the game version, platform, GPU, what the player was doing and the last
 *   30 "breadcrumbs" (screens, missions, islands, vehicles). Reports are
 *   queued on the device while offline and sent later. The owner panel's
 *   Crashes tab groups them.
 * - Game-loop safety net: an exception in one frame is caught and the next
 *   frame runs. If frames keep failing, the game saves and shows a recovery
 *   screen (continue from the last checkpoint, main menu, or restart).
 * - Graphics reset (WebGL context lost, e.g. a driver update or the GPU
 *   resetting): the game pauses, waits for the context to come back and
 *   carries on; if it does not, it offers a restart from the checkpoint.
 * - Safe mode: if the game failed to reach the title screen last time, it
 *   starts with low graphics.
 */

export type CrashKind = 'error' | 'promise' | 'loop' | 'webgl' | 'hang' | 'boot' | 'stuck' | 'storage';

export interface CrashHost {
  serverUrl(): string;
  anon(): string;
  session: string;
  /** What the player is doing, for the report. */
  context(): Record<string, string | number | boolean>;
  /** Save progress (checkpoint + profile) before a recovery. */
  saveNow(): void;
  /** Recovery choices. */
  toCheckpoint(): void;
  toMenu(): void;
  /** Stop / resume simulation and rendering. */
  setHalted(on: boolean): void;
  root: HTMLElement;
  /** Register / remove a modal layer (gamepad navigation). */
  overlay(el: HTMLElement, on: boolean): void;
}

const QUEUE_KEY = 'blackeye.crashq';
const BOOT_KEY = 'blackeye.boot';
const MAX_QUEUE = 10;

const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

interface Report {
  kind: CrashKind;
  msg: string;
  stack: string;
  version: string;
  platform: string;
  os: string;
  gpu: string;
  anon: string;
  session: string;
  t: number;
  context: Record<string, string | number | boolean>;
  crumbs: string[];
}

function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return dbg ? cleanGpu(String(gl!.getParameter(dbg.UNMASKED_RENDERER_WEBGL))) : '';
  } catch {
    return '';
  }
}

/** Boot bookkeeping: did the last start reach the title screen? */
export function bootBegin(): { safeMode: boolean; fails: number } {
  let fails = 0;
  try {
    const b = JSON.parse(localStorage.getItem(BOOT_KEY) ?? '{}') as { ok?: boolean; fails?: number };
    fails = b.ok === false ? (b.fails ?? 0) + 1 : 0;
    localStorage.setItem(BOOT_KEY, JSON.stringify({ ok: false, fails, t: Date.now() }));
    // closing the game while it loads is not a crash; a hard crash (tab or
    // GPU process dying, out of memory) never gets here
    window.addEventListener('pagehide', () => {
      const now = JSON.parse(localStorage.getItem(BOOT_KEY) ?? '{}') as { ok?: boolean };
      if (now.ok === false) localStorage.setItem(BOOT_KEY, JSON.stringify({ ok: true, fails: Math.max(0, fails - 1), t: Date.now() }));
    });
  } catch {
    /* no storage */
  }
  return { safeMode: fails >= 1, fails };
}

/** The game reached the title screen: clear the failed-start counter. */
export function bootOk() {
  try {
    localStorage.setItem(BOOT_KEY, JSON.stringify({ ok: true, fails: 0, t: Date.now() }));
  } catch {
    /* ignore */
  }
}

export class CrashGuard {
  /** The player allows crash reports (Settings → Privacy). */
  enabled = true;
  private crumbs: string[] = [];
  private gpu = '';
  private sent = new Map<string, number>();
  private loopErrors: number[] = [];
  private recovering = false;
  private overlay: HTMLElement | null = null;
  private lostAt = 0;
  private host: CrashHost | null = null;

  constructor() {
    document.addEventListener('visibilitychange', () => (this.shownAt = performance.now()));
    window.addEventListener('error', (e) => this.report('error', e.error ?? e.message, { at: `${(e.filename ?? '').split('/').pop()}:${e.lineno ?? 0}` }));
    window.addEventListener('unhandledrejection', (e) => this.report('promise', e.reason));
  }

  /** Connect to the game once it exists (reports before that are queued). */
  attach(host: CrashHost) {
    this.host = host;
    this.gpu = gpuName();
    // send what earlier sessions could not
    window.setTimeout(() => this.flush(), 8000);
  }

  /** A short note about what just happened (kept: the last 30). */
  crumb(text: string) {
    const t = new Date();
    this.crumbs.push(`${t.toISOString().slice(11, 19)} ${text}`.slice(0, 120));
    if (this.crumbs.length > 30) this.crumbs.shift();
  }

  report(kind: CrashKind, err: unknown, extra: Record<string, string | number | boolean> = {}) {
    try {
      const e = err instanceof Error ? err : null;
      const msg = (e ? `${e.name}: ${e.message}` : String(err ?? 'unknown')).slice(0, 300);
      // the same problem is sent at most 3 times per session
      const sig = kind + msg;
      const n = (this.sent.get(sig) ?? 0) + 1;
      this.sent.set(sig, n);
      if (n > 3) return;
      this.crumb(`! ${kind}: ${msg.slice(0, 80)}`);
      if (!this.enabled) return;
      const h = this.host;
      let ctx: Record<string, string | number | boolean> = {};
      try {
        ctx = h?.context() ?? {};
      } catch {
        /* the context itself may be broken */
      }
      const r: Report = {
        kind,
        msg,
        stack: (e?.stack ?? '').slice(0, 3000),
        version,
        platform: desktop ? 'desktop' : /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) ? 'mobile' : 'web',
        os: desktop?.platform ?? navigator.platform ?? '',
        gpu: this.gpu,
        anon: h?.anon() ?? '',
        session: h?.session ?? '',
        t: Date.now(),
        context: { ...ctx, ...extra },
        crumbs: [...this.crumbs],
      };
      const q = this.queue();
      q.push(r);
      this.store(q.slice(-MAX_QUEUE));
      if (h) this.flush();
    } catch {
      /* never let the reporter itself crash the game */
    }
  }

  private queue(): Report[] {
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as Report[];
      return Array.isArray(q) ? q : [];
    } catch {
      return [];
    }
  }

  private store(q: Report[]) {
    try {
      if (q.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
      else localStorage.removeItem(QUEUE_KEY);
    } catch {
      /* full: drop */
    }
  }

  private flushing = false;
  flush() {
    if (this.host) this.flushTo(this.host.serverUrl());
  }

  /** Send queued reports to a server (also used before the game exists). */
  flushTo(serverUrl: string) {
    const q = this.queue();
    if (!q.length || this.flushing) return;
    this.flushing = true;
    fetch(dataBase(serverUrl) + '/crash', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ reports: q }), keepalive: true })
      .then((r) => {
        if (r.ok) {
          // keep anything reported while sending
          this.store(this.queue().slice(q.length));
        }
      })
      .catch(() => {})
      .finally(() => (this.flushing = false));
  }

  // ------------------------------------------------------------ game loop

  /**
   * An exception escaped one frame. Report it; if frames keep failing (more
   * than 20 in 3 s), save and show the recovery screen.
   */
  loopError(e: unknown) {
    const now = performance.now();
    this.loopErrors = this.loopErrors.filter((t) => now - t < 3000);
    this.loopErrors.push(now);
    this.report('loop', e);
    if (this.loopErrors.length > 20 && !this.recovering) this.recover('The game hit a problem it could not get past.');
  }

  private frames = 0;
  private shownAt = 0;

  /** Frame took this long (ms): report freezes over 5 s (not the first frames, nor a tab coming back). */
  frameTime(ms: number) {
    if (++this.frames < 5 || document.hidden || ms < 5000) return;
    if (performance.now() - this.shownAt < ms + 1000) return;
    this.report('hang', `Frame took ${Math.round(ms / 1000)} s`, { ms: Math.round(ms) });
  }

  /** Show the recovery screen (progress is saved first). */
  recover(why: string) {
    const h = this.host;
    if (!h || this.recovering) return;
    this.recovering = true;
    try {
      h.saveNow();
    } catch {
      /* best effort */
    }
    h.setHalted(true);
    this.showOverlay('Something went wrong', `${why} Your progress was saved. The problem has been reported to the developers.`, [
      ['Continue from checkpoint', () => this.resolve(() => h.toCheckpoint())],
      ['Main menu', () => this.resolve(() => h.toMenu())],
      ['Restart the game', () => location.reload()],
    ]);
  }

  private resolve(fn: () => void) {
    this.hideOverlay();
    this.loopErrors = [];
    this.recovering = false;
    this.host?.setHalted(false);
    try {
      fn();
    } catch (e) {
      this.report('loop', e, { during: 'recovery' });
    }
  }

  // ------------------------------------------------------------ WebGL context

  /** Watch the canvas for a lost / restored WebGL context. */
  watchContext(canvas: HTMLCanvasElement) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // allow the browser to restore it
      this.lostAt = performance.now();
      this.report('webgl', 'WebGL context lost');
      try {
        this.host?.saveNow();
      } catch {
        /* best effort */
      }
      this.host?.setHalted(true);
      this.showOverlay('Restoring graphics…', 'The graphics driver was reset. Hold on a moment.', []);
      window.setTimeout(() => {
        if (this.lostAt && this.overlay) {
          this.showOverlay('Graphics stopped responding', 'Your progress was saved. Restart the game to continue from your last checkpoint. If this keeps happening, lower the graphics preset or update your graphics driver.', [['Restart the game', () => location.reload()]]);
        }
      }, 8000);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lostAt = 0;
      this.hideOverlay();
      this.host?.setHalted(false);
      this.crumb('webgl context restored');
    });
  }

  // ------------------------------------------------------------ overlay

  private showOverlay(title: string, text: string, actions: Array<[string, () => void]>) {
    this.hideOverlay();
    const root = this.host?.root ?? document.body;
    const el = document.createElement('div');
    el.className = 'crash-screen';
    el.setAttribute('role', 'alertdialog');
    const card = document.createElement('div');
    card.className = 'crash-card';
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = text;
    card.append(h, p);
    if (!actions.length) card.append(Object.assign(document.createElement('div'), { className: 'crash-spinner' }));
    const row = document.createElement('div');
    row.className = 'actions';
    actions.forEach(([label, fn], i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (i === 0 ? ' primary' : '');
      b.textContent = label;
      b.addEventListener('click', fn);
      row.append(b);
    });
    card.append(row);
    el.append(card);
    root.append(el);
    this.overlay = el;
    this.host?.overlay(el, true);
    (row.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private hideOverlay() {
    if (this.overlay) this.host?.overlay(this.overlay, false);
    this.overlay?.remove();
    this.overlay = null;
  }
}

/** One guard for the whole app, created before anything else so boot errors are caught too. */
export const crashGuard = new CrashGuard();
