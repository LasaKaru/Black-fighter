import { dataBase, desktop } from '../net/Endpoints';

/**
 * Maintenance / development mode on the client. Reads GET /status at start and
 * every minute (server time, so a wrong PC clock does not break the
 * countdown). While the owner has closed the game for this platform it shows
 * a full-screen notice with a live countdown to the "back at" time and comes
 * back by itself. Testers can get in with the tester code.
 *
 * It fails open: if the server cannot be reached, the game plays normally
 * (single player must keep working offline).
 */

export interface PublicStatus {
  mode: 'live' | 'maintenance' | 'development';
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

export interface StatusHost {
  root: HTMLElement;
  serverUrl(): string;
  /** A menu is showing (not in the middle of a run). */
  inMenu(): boolean;
  /** Register / remove the screen as the top modal layer. */
  overlay(el: HTMLElement, back: (() => void) | null): void;
  toast(text: string, kind?: 'info' | 'warn'): void;
  /** Save progress now (checkpoint + profile). */
  saveNow(): void;
  /** Company logo for dark screens. */
  logo(): string;
  /** Online play is closed (Multiplayer button). */
  setOnlineClosed(text: string | null): void;
}

const TESTER_KEY = 'blackeye.tester';
const fmtLeft = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return d ? `${d}d ${two(hh)}h ${two(mm)}m` : `${two(hh)}:${two(mm)}:${two(ss)}`;
};
const clock = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });

export class StatusScreen {
  status: PublicStatus | null = null;
  /** server time − local time */
  private skew = 0;
  private el: HTMLElement | null = null;
  private tester = false;
  private warnedUpcoming = new Set<number>();
  private warnedInGame = false;
  /** Set after the launch notices, so the screen never covers them. */
  private armed = false;

  constructor(private h: StatusHost) {
    try {
      this.tester = !!localStorage.getItem(TESTER_KEY);
    } catch {
      this.tester = false;
    }
    window.setInterval(() => void this.check(), 60_000);
    window.setInterval(() => this.tick(), 1000);
  }

  private now() {
    return Date.now() + this.skew;
  }

  /** Is the whole game closed for this platform right now? */
  get blocking(): boolean {
    const s = this.status;
    if (!s || !s.active || s.mode === 'live') return false;
    if (this.tester && s.testers) return false;
    if (s.until && s.until <= this.now()) return false;
    return desktop ? s.blockDesktop : s.blockWeb;
  }

  /** Fetch the status (4 s timeout). Resolves once applied. */
  async check(): Promise<void> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(dataBase(this.h.serverUrl()) + '/status', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return;
      const s = (await r.json()) as PublicStatus;
      if (typeof s.mode !== 'string') return;
      this.skew = s.serverTime - Date.now();
      this.status = s;
      // a saved tester code is re-checked against the current one
      if (this.tester && s.testers) {
        const code = localStorage.getItem(TESTER_KEY) ?? '';
        this.tester = await this.verifyTester(code);
        if (!this.tester) localStorage.removeItem(TESTER_KEY);
      }
    } catch {
      return; // offline: play on
    }
    this.apply();
  }

  private async verifyTester(code: string): Promise<boolean> {
    try {
      const r = await fetch(dataBase(this.h.serverUrl()) + '/status/tester', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ code }) });
      return r.ok;
    } catch {
      return true; // offline: keep the saved code
    }
  }

  /** Start showing the screen (after the loading screen and health warning). */
  arm() {
    this.armed = true;
    this.apply();
  }

  private apply() {
    if (!this.armed) return;
    const s = this.status;
    const online = s && s.active && s.mode !== 'live' ? (s.mode === 'development' ? 'Online play opens at launch' : 'Online play is paused for maintenance') + (s.until ? ` · back ${clock(s.until)}` : '') : null;
    this.h.setOnlineClosed(online);
    if (this.blocking) {
      if (this.h.inMenu()) this.show();
      else if (!this.warnedInGame) {
        // mid-run: save, warn, and close at the next menu
        this.warnedInGame = true;
        this.h.saveNow();
        this.h.toast(`${s!.mode === 'development' ? 'The game is closing for development' : 'Maintenance has started'}: your progress is saved. Finish up!`, 'warn');
      }
    } else this.hide(true);
  }

  /** Every second: countdown text, upcoming warnings, auto-return. */
  private tick() {
    const s = this.status;
    if (!s) return;
    const now = this.now();
    // a scheduled closure that has started
    if (s.mode !== 'live' && !s.active && s.startsAt && s.startsAt <= now && (!s.until || s.until > now)) {
      s.active = true;
      this.apply();
    }
    if (s.mode !== 'live' && !s.active && s.startsAt > now) {
      const mins = Math.ceil((s.startsAt - now) / 60_000);
      for (const m of [30, 10, 5, 1]) {
        if (mins <= m && !this.warnedUpcoming.has(m)) {
          for (const k of [30, 10, 5, 1]) if (k >= m) this.warnedUpcoming.add(k);
          this.h.toast(`${s.mode === 'development' ? 'The game closes' : 'Maintenance starts'} in ${mins} minute${mins === 1 ? '' : 's'}${s.until ? ` · back ${clock(s.until)}` : ''}`, 'warn');
          break;
        }
      }
    }
    if (this.armed && this.blocking && !this.el && this.h.inMenu()) this.show();
    if (this.el) {
      const left = this.el.querySelector('.st-left');
      if (s.until) {
        if (left) left.textContent = fmtLeft(s.until - now);
        if (s.until <= now) void this.check();
      }
    }
  }

  private show() {
    const s = this.status;
    if (!s || this.el) return;
    const dev = s.mode === 'development';
    const back = s.until ? `Back ${clock(s.until)}` : dev ? 'Coming soon' : 'Back soon';
    const box = document.createElement('div');
    box.className = 'status-screen ' + s.mode;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const logo = this.h.logo();
    box.innerHTML = `
      <div class="st-card">
        ${logo ? '<img class="st-logo" alt="" />' : ''}
        <div class="st-badge">${dev ? 'IN DEVELOPMENT' : 'MAINTENANCE'}</div>
        <h1></h1>
        <p class="st-msg"></p>
        ${s.until ? '<div class="st-count"><span class="st-left"></span><small></small></div>' : '<div class="st-count soon"><small></small></div>'}
        <div class="st-actions"></div>
        <p class="st-note">Your progress is saved. This screen closes by itself when the game is back.</p>
      </div>`;
    if (logo) (box.querySelector('.st-logo') as HTMLImageElement).src = logo;
    box.querySelector('h1')!.textContent = s.title || (dev ? 'BLACKEYE is still being drawn' : 'Ink City is closed for repairs');
    box.querySelector('.st-msg')!.textContent = s.message || (dev ? 'We are building the game right now. Check back soon!' : 'We are updating the game. It will be back shortly.');
    box.querySelector('.st-count small')!.textContent = back;
    const actions = box.querySelector('.st-actions')!;
    const btn = (label: string, fn: () => void, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', fn);
      actions.append(b);
      return b;
    };
    const again = btn('Check again', () => {
      again.textContent = 'Checking…';
      void this.check().then(() => (again.textContent = 'Check again'));
    }, 'primary');
    if (s.testers) {
      const t = btn('Tester code', () => {
        // inline field (window.prompt does not exist in the desktop build)
        const row = document.createElement('div');
        row.className = 'st-tester';
        const input = document.createElement('input');
        input.type = 'password';
        input.placeholder = 'Tester code';
        input.autocomplete = 'off';
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn primary';
        ok.textContent = 'Enter';
        const go = () => {
          const code = input.value.trim();
          if (!code) return;
          ok.textContent = '…';
          void this.verifyTester(code).then((valid) => {
            ok.textContent = 'Enter';
            if (!valid) return this.h.toast('That tester code is not valid.', 'warn');
            try {
              localStorage.setItem(TESTER_KEY, code);
            } catch {
              /* this session only */
            }
            this.tester = true;
            this.hide(false);
            this.h.toast('Tester access granted. Thanks for testing!', 'info');
          });
        };
        ok.addEventListener('click', go);
        input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
        row.append(input, ok);
        t.replaceWith(row);
        input.focus();
      });
    }
    if (desktop) btn('Quit', () => desktop?.quit(), 'ghost');
    this.h.root.append(box);
    this.el = box;
    this.h.overlay(box, () => {});
    setTimeout(() => again.focus({ preventScroll: true }), 50);
    this.tick();
  }

  private hide(back: boolean) {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    this.warnedInGame = false;
    this.h.overlay(el, null);
    el.classList.add('out');
    setTimeout(() => el.remove(), 500);
    if (back) this.h.toast('We are back! Have fun in Ink City.', 'info');
  }
}
