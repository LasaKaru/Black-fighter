import { dataBase } from '../net/Endpoints';
import type { BrandConfig, BrandLink, Sponsor } from '../../shared/brand';
import { BUNDLED_LOGO, FEATURES, usesBundledLogo } from '../../shared/brand';
import { DEFAULT_PAGES } from './Pages';

/**
 * The hidden owner panel. Type "kumara" while a menu is open to get the
 * sign-in; the server checks the credentials (nothing secret is in the game).
 * Tabs: Dashboard (anonymous play statistics), Live (players and rooms on
 * the server), Branding, Sponsors, Links, Pages, Features, Account.
 */

export interface OwnerPanelHost {
  root: HTMLElement;
  serverUrl(): string;
  /** A menu is open (the secret word only works there). */
  menuOpen(): boolean;
  /** Re-apply branding / pages / features after a save. */
  brandChanged(): void;
  sound(): void;
  /** Register / remove the panel as the top modal layer (gamepad + Esc). */
  overlay(el: HTMLElement, back: (() => void) | null): void;
}

const SECRET = 'kumara';
const TOKEN_KEY = 'blackeye.panel.token';

type Tab = 'dashboard' | 'status' | 'crashes' | 'live' | 'moderation' | 'events' | 'branding' | 'sponsors' | 'links' | 'pages' | 'features' | 'account';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string | null>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const k of kids) if (k !== null) e.append(k);
  return e;
}

function btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'op-btn ' + cls }, label);
  b.addEventListener('click', onClick);
  return b;
}

function field(label: string, input: HTMLElement, hint = ''): HTMLElement {
  return el('label', { class: 'op-field' }, el('span', {}, label), input, hint ? el('small', {}, hint) : null);
}

function input(value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const i = el('input', { type: 'text', ...attrs }) as HTMLInputElement;
  i.value = value;
  return i;
}

function check(value: boolean): HTMLInputElement {
  const i = el('input', { type: 'checkbox' }) as HTMLInputElement;
  i.checked = value;
  return i;
}

const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString());

export class OwnerPanel {
  private buf = '';
  private wrap: HTMLElement;
  private body!: HTMLElement;
  private tab: Tab = 'dashboard';
  private token = '';
  private email = '';
  private days = 30;
  private brand: BrandConfig | null = null;
  private files: string[] = [];
  private liveTimer = 0;

  constructor(private h: OwnerPanelHost) {
    this.wrap = el('div', { class: 'owner-panel hidden', role: 'dialog', 'aria-label': 'Owner panel' });
    h.root.append(this.wrap);
    try {
      this.token = sessionStorage.getItem(TOKEN_KEY) ?? '';
    } catch {
      this.token = '';
    }
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (this.isOpen) {
        // Esc outside a text box goes through the menu navigation (overlay back)
        if (e.code === 'Escape' && typing) this.close();
        return;
      }
      if (typing) return;
      if (!this.h.menuOpen() || e.key.length !== 1) return;
      this.buf = (this.buf + e.key.toLowerCase()).slice(-SECRET.length);
      if (this.buf === SECRET) {
        this.buf = '';
        this.open();
      }
    }, true);
  }

  get isOpen(): boolean {
    return !this.wrap.classList.contains('hidden');
  }

  open() {
    this.wrap.classList.remove('hidden');
    this.h.overlay(this.wrap, () => this.close());
    this.h.sound();
    if (this.token) void this.showPanel();
    else this.showLogin();
  }

  close() {
    this.wrap.classList.add('hidden');
    this.h.overlay(this.wrap, null);
    clearInterval(this.liveTimer);
  }

  // ------------------------------------------------------------ api

  private async api<T = Record<string, unknown>>(path: string, body?: unknown, raw?: Blob): Promise<T> {
    const r = await fetch(dataBase(this.h.serverUrl()) + '/panel/api' + path, {
      method: body !== undefined || raw ? 'POST' : 'GET',
      headers: { authorization: 'Bearer ' + this.token, ...(raw ? { 'content-type': raw.type || 'application/octet-stream' } : { 'content-type': 'application/json' }) },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const o = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (r.status === 401 && path !== '/login') {
      this.signOut('Your session ended. Sign in again.');
      throw new Error('signed out');
    }
    if (!r.ok) throw new Error(o.error ?? r.statusText);
    return o;
  }

  private signOut(msg = '') {
    this.token = '';
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    this.showLogin(msg);
  }

  // ------------------------------------------------------------ sign-in

  private showLogin(msg = '') {
    clearInterval(this.liveTimer);
    const email = input('', { type: 'email', autocomplete: 'username', placeholder: 'Email' });
    const pass = input('', { type: 'password', autocomplete: 'current-password', placeholder: 'Password' });
    const err = el('p', { class: 'op-err' }, msg);
    const go = async () => {
      err.textContent = '';
      try {
        const o = await this.api<{ token: string; email: string }>('/login', { email: email.value, password: pass.value });
        this.token = o.token;
        this.email = o.email;
        try {
          sessionStorage.setItem(TOKEN_KEY, o.token);
        } catch {
          /* ignore */
        }
        void this.showPanel();
      } catch (e) {
        err.textContent = (e as Error).message === 'Failed to fetch' ? 'The game server is not reachable. The owner panel needs the server online.' : (e as Error).message;
      }
    };
    pass.addEventListener('keydown', (e) => e.key === 'Enter' && void go());
    this.wrap.innerHTML = '';
    this.wrap.append(
      el(
        'div',
        { class: 'op-login' },
        el('div', { class: 'op-lock' }, '◉'),
        el('h2', {}, 'Owner sign-in'),
        el('p', { class: 'op-dim' }, `Server: ${dataBase(this.h.serverUrl()) || location.origin}`),
        email,
        pass,
        err,
        el('div', { class: 'op-row' }, btn('Sign in', () => void go(), 'primary'), btn('Cancel', () => this.close())),
      ),
    );
    setTimeout(() => email.focus(), 30);
  }

  // ------------------------------------------------------------ shell

  private async showPanel() {
    try {
      const me = await this.api<{ email: string }>('/me');
      this.email = me.email;
    } catch {
      return;
    }
    const tabs: Array<[Tab, string]> = [
      ['dashboard', 'Dashboard'],
      ['status', 'Game status'],
      ['crashes', 'Crashes'],
      ['live', 'Live server'],
      ['moderation', 'Moderation'],
      ['events', 'Events & rules'],
      ['branding', 'Branding'],
      ['sponsors', 'Sponsors'],
      ['links', 'Links'],
      ['pages', 'Pages'],
      ['features', 'Features'],
      ['account', 'Account'],
    ];
    const nav = el('nav', { class: 'op-nav' });
    for (const [id, label] of tabs) {
      const b = btn(label, () => {
        this.tab = id;
        void this.render();
        nav.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      });
      if (id === this.tab) b.classList.add('on');
      nav.append(b);
    }
    this.body = el('main', { class: 'op-body' });
    this.wrap.innerHTML = '';
    this.wrap.append(
      el(
        'div',
        { class: 'op-shell' },
        el('header', { class: 'op-head' }, el('b', {}, 'OWNER PANEL'), el('span', { class: 'op-dim' }, this.email), el('span', { class: 'op-grow' }), btn('Sign out', () => void this.api('/logout', {}).finally(() => this.signOut())), btn('Close', () => this.close())),
        el('div', { class: 'op-main' }, nav, this.body),
      ),
    );
    void this.render();
  }

  private async render() {
    clearInterval(this.liveTimer);
    const b = this.body;
    b.innerHTML = '';
    b.append(el('p', { class: 'op-dim' }, 'Loading…'));
    try {
      if (this.tab === 'dashboard') await this.dashboard();
      else if (this.tab === 'status') await this.statusTab();
      else if (this.tab === 'crashes') await this.crashesTab();
      else if (this.tab === 'live') await this.live();
      else if (this.tab === 'moderation') await this.moderationTab();
      else if (this.tab === 'account') this.accountTab();
      else {
        const o = await this.api<{ config: BrandConfig; files: string[] }>('/brand');
        this.brand = o.config;
        this.files = o.files;
        if (this.tab === 'branding') this.brandingTab();
        else if (this.tab === 'sponsors') this.sponsorsTab();
        else if (this.tab === 'links') this.linksTab();
        else if (this.tab === 'pages') this.pagesTab();
        else if (this.tab === 'events') this.eventsTab();
        else this.featuresTab();
      }
    } catch (e) {
      if ((e as Error).message !== 'signed out') {
        b.innerHTML = '';
        b.append(el('p', { class: 'op-err' }, `Could not load: ${(e as Error).message}`));
      }
    }
  }

  private async saveBrand(patch: Partial<BrandConfig>, note: HTMLElement) {
    note.textContent = 'Saving…';
    try {
      const o = await this.api<{ config: BrandConfig }>('/brand', patch);
      this.brand = o.config;
      note.textContent = 'Saved. Players see it the next time the game starts (and right away here).';
      this.h.brandChanged();
    } catch (e) {
      note.textContent = 'Not saved: ' + (e as Error).message;
    }
  }

  private async upload(file: File, name: string): Promise<string> {
    const o = await this.api<{ url: string }>(`/upload?name=${encodeURIComponent(name)}`, undefined, file);
    return o.url;
  }

  // ------------------------------------------------------------ dashboard

  private async dashboard() {
    const s = await this.api<DashboardData>(`/analytics?days=${this.days}`);
    const b = this.body;
    b.innerHTML = '';
    const range = el('div', { class: 'op-row' }, el('h2', {}, 'Players & play'), el('span', { class: 'op-grow' }));
    for (const d of [7, 30, 90]) {
      const c = btn(`${d} days`, () => {
        this.days = d;
        void this.render();
      }, 'chip' + (this.days === d ? ' on' : ''));
      range.append(c);
    }
    b.append(range);
    const t = s.totals;
    const tiles: Array<[string, string, string]> = [
      [fmt(t.today), 'Players today', ''],
      [fmt(t.week), 'Players this week', ''],
      [fmt(t.month), `Players, last ${s.days} days`, ''],
      [fmt(t.installs), 'Installs, all time', ''],
      [fmt(t.sessions), 'Sessions', `${s.days} days`],
      [String(t.playHours), 'Hours played', `${s.days} days`],
      [String(t.avgSessionMin), 'Minutes per session', 'average'],
      [`${t.retentionD1}%`, 'Came back after a day', 'retention'],
      [`${t.retentionD7}%`, 'Came back after a week', 'retention'],
      [`${t.retentionD30}%`, 'Came back after a month', 'retention'],
    ];
    b.append(el('div', { class: 'op-tiles' }, ...tiles.map(([v, l, sub]) => el('div', { class: 'op-tile' }, el('b', {}, v), el('span', {}, l), sub ? el('small', {}, sub) : null))));
    b.append(el('h3', {}, 'Players per day'), this.barChart(s.series));
    const grid = el('div', { class: 'op-grid' });
    grid.append(
      this.ranked('Platforms', s.platforms),
      this.ranked('Regions (from language)', s.regions),
      this.ranked('Game versions', s.versions),
      this.ranked('Game modes started', s.modes),
      this.ranked('Art style', s.art),
      this.ranked('Graphics preset', s.gfx),
      this.ranked('Islands discovered', s.islands, 10),
      this.ranked('Achievements unlocked', s.achievements, 10),
      this.ranked('Story chapters finished', s.chapters),
      this.ranked('Sponsor & link clicks', s.links),
      this.ranked('GPUs', s.gpus, 8),
      this.ranked('Secrets found', s.secrets),
    );
    b.append(grid);
    // missions: started / finished / rate
    b.append(el('h3', {}, 'Missions'));
    const mt = el('table', { class: 'op-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Mission'), el('th', {}, 'Started'), el('th', {}, 'Completed'), el('th', {}, 'Failed'), el('th', {}, 'Completion'))));
    const mb = el('tbody');
    for (const m of s.missions.slice(0, 40)) mb.append(el('tr', {}, el('td', {}, m.id), el('td', {}, fmt(m.started)), el('td', {}, fmt(m.done)), el('td', {}, fmt(m.failed)), el('td', {}, el('span', { class: 'op-meter' }, el('i', { style: `width:${m.rate}%` })), ` ${m.rate}%`)));
    if (!s.missions.length) mb.append(el('tr', {}, el('td', { colspan: '5', class: 'op-dim' }, 'No mission data yet.')));
    mt.append(mb);
    b.append(mt);
    b.append(el('h3', {}, 'Errors reported by players'));
    const et = el('table', { class: 'op-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Count'), el('th', {}, 'Message'), el('th', {}, 'Where'))));
    const eb = el('tbody');
    for (const e of s.errors) eb.append(el('tr', {}, el('td', {}, String(e.n)), el('td', {}, e.msg), el('td', {}, e.at)));
    if (!s.errors.length) eb.append(el('tr', {}, el('td', { colspan: '3', class: 'op-dim' }, 'No errors reported. 🎉')));
    et.append(eb);
    b.append(et);
    b.append(el('p', { class: 'op-dim' }, 'Statistics are anonymous: a random install id, no names, emails or IP addresses. Players can turn them off in Settings → Privacy.'));
    // privacy requests: a player sends the id shown in their Settings → Privacy
    const forgetId = input('', { placeholder: 'Install id from the player (24 letters and digits)' });
    const forgetNote = el('small', { class: 'op-dim' });
    b.append(
      el('h3', {}, 'Delete a player\'s statistics'),
      el('div', { class: 'op-row' }, forgetId, btn('Delete', async () => {
        const id = forgetId.value.trim().toLowerCase();
        if (!/^[a-f0-9]{24}$/.test(id)) {
          forgetNote.textContent = 'That does not look like an install id.';
          return;
        }
        const o = await this.api<{ ok: boolean }>('/forget', { id }).catch(() => ({ ok: false }));
        forgetNote.textContent = o.ok ? 'Deleted.' : 'No statistics found for that id.';
      }, 'warn')),
      forgetNote,
    );
  }

  /** Daily players: one series, one hue, rounded bar tops, hover tooltip, table view. */
  private barChart(series: DashboardData['series']): HTMLElement {
    const W = 720;
    const H = 180;
    const pad = { l: 34, r: 8, t: 10, b: 22 };
    const max = Math.max(4, ...series.map((d) => d.players));
    const step = Math.ceil(max / 4);
    const top = step * 4;
    const bw = (W - pad.l - pad.r) / series.length;
    const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / top);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'op-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Players per day');
    const mk = (tag: string, a: Record<string, string | number>) => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
      svg.append(n);
      return n;
    };
    for (let k = 0; k <= 4; k++) {
      const v = step * k;
      mk('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' });
      mk('text', { x: pad.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }).textContent = String(v);
    }
    const tip = el('div', { class: 'op-tip hidden' });
    series.forEach((d, i) => {
      const x = pad.l + i * bw;
      const h = Math.max(0, y(0) - y(d.players));
      const w = Math.max(2, bw - 2);
      // a rounded data-end anchored to the baseline
      const r = Math.min(4, w / 2, h);
      const path = h > 0 ? `M${x + 1},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${h - r} z` : '';
      if (path) mk('path', { d: path, class: 'bar' });
      if (i % Math.ceil(series.length / 8) === 0) mk('text', { x: x + bw / 2, y: H - 6, class: 'axis', 'text-anchor': 'middle' }).textContent = d.date.slice(5);
      // hit target: the whole column, bigger than the mark
      const hit = mk('rect', { x, y: pad.t, width: bw, height: H - pad.t - pad.b, class: 'hit' });
      hit.addEventListener('mouseenter', () => {
        tip.classList.remove('hidden');
        tip.textContent = `${d.date} · ${d.players} players · ${d.newPlayers} new · ${d.sessions} sessions · ${d.playMin} min played${d.fps ? ` · ${d.fps} fps avg` : ''}`;
      });
      hit.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    });
    const table = el('details', { class: 'op-details' }, el('summary', {}, 'Show as a table'));
    const tb = el('table', { class: 'op-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Date'), el('th', {}, 'Players'), el('th', {}, 'New'), el('th', {}, 'Sessions'), el('th', {}, 'Minutes'))));
    const body = el('tbody');
    for (const d of [...series].reverse()) body.append(el('tr', {}, el('td', {}, d.date), el('td', {}, String(d.players)), el('td', {}, String(d.newPlayers)), el('td', {}, String(d.sessions)), el('td', {}, String(d.playMin))));
    tb.append(body);
    table.append(tb);
    return el('div', { class: 'op-chartbox' }, svg as unknown as Node, tip, table);
  }

  /** A ranked list as single-hue horizontal bars with the value as text. */
  private ranked(title: string, rows: Array<[string, number]>, limit = 6): HTMLElement {
    const box = el('section', { class: 'op-card' }, el('h4', {}, title));
    if (!rows.length) {
      box.append(el('p', { class: 'op-dim' }, 'No data yet.'));
      return box;
    }
    const total = rows.reduce((n, r) => n + r[1], 0);
    const max = rows[0][1];
    for (const [k, n] of rows.slice(0, limit)) {
      box.append(el('div', { class: 'op-rank' }, el('span', { class: 'op-rk' }, k || '—'), el('span', { class: 'op-rbar' }, el('i', { style: `width:${Math.round((n / max) * 100)}%` })), el('span', { class: 'op-rv' }, `${fmt(n)} · ${Math.round((n / total) * 100)}%`)));
    }
    return box;
  }

  // ------------------------------------------------------------ moderation

  private async moderationTab() {
    const m = await this.api<ModerationData>('/moderation');
    const board: Record<string, Array<{ name: string; time: number }>> = await this.api<Record<string, Array<{ name: string; time: number }>>>('/leaderboard').catch(() => ({}));
    const b = this.body;
    b.innerHTML = '';
    const when = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const act = async (path: string, body: unknown) => {
      await this.api(path, body).catch((e) => alert((e as Error).message));
      void this.render();
    };
    b.append(el('h2', {}, 'Moderation'), el('p', { class: 'op-dim' }, 'Recent multiplayer chat (kept in memory only, not saved), blocked words, mutes, bans and leaderboard clean-up.'));
    // chat log
    const t = el('table', { class: 'op-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'Room'), el('th', {}, 'Player'), el('th', {}, 'Message'), el('th', {}, ''))));
    const tb = el('tbody');
    for (const l of m.log.slice(0, 120)) {
      const online = m.online.includes(l.ip);
      tb.append(
        el(
          'tr',
          { class: l.flag ? 'op-flag ' + l.flag : '' },
          el('td', {}, when(l.t)),
          el('td', {}, l.room),
          el('td', {}, l.name),
          el('td', {}, l.text, l.flag ? el('small', { class: 'op-dim' }, ` (${l.flag})`) : null),
          el(
            'td',
            { class: 'op-actions' },
            btn('Mute 10 min', () => void act('/moderation/mute', { ip: l.ip, name: l.name, minutes: 10 })),
            btn('Mute 1 day', () => void act('/moderation/mute', { ip: l.ip, name: l.name, minutes: 1440 })),
            btn(online ? 'Ban' : 'Ban (offline)', () => confirm(`Ban ${l.name}'s network from multiplayer?`) && void act('/moderation/ban', { ip: l.ip }), 'warn'),
          ),
        ),
      );
    }
    if (!m.log.length) tb.append(el('tr', {}, el('td', { colspan: '5', class: 'op-dim' }, 'No chat since the server started.')));
    t.append(tb);
    b.append(el('h3', {}, 'Recent chat'), t);
    // blocked words
    const words = el('textarea', { rows: '4' }) as HTMLTextAreaElement;
    words.value = m.words.join(', ');
    const wnote = el('small', { class: 'op-dim' });
    b.append(
      el('h3', {}, 'Blocked words'),
      field('Words replaced with ★ in chat and player names (comma or new line separated)', words, 'Letter swaps such as 0→o, 1→i, 3→e, @→a are caught too.'),
      el('div', { class: 'op-row' }, btn('Save words', async () => {
        const list = words.value.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
        const o = await this.api<{ words: string[] }>('/moderation/words', { words: list });
        wnote.textContent = `Saved ${o.words.length} words.`;
      }, 'primary'), wnote),
    );
    // mutes and bans
    const mutes = el('div', {});
    for (const x of m.muted) mutes.append(el('div', { class: 'op-row' }, el('span', { class: 'op-grow' }, `${x.name || 'player'} · ${x.ip} · ${x.until ? 'until ' + when(x.until) : 'permanent'}`), btn('Unmute', () => void act('/moderation/unmute', { ip: x.ip }))));
    if (!m.muted.length) mutes.append(el('p', { class: 'op-dim' }, 'Nobody is muted.'));
    const bans = el('div', {});
    for (const ip of m.bans) bans.append(el('div', { class: 'op-row' }, el('span', { class: 'op-grow' }, ip), btn('Unban', () => void act('/unban', { ip }))));
    if (!m.bans.length) bans.append(el('p', { class: 'op-dim' }, 'Nobody is banned.'));
    b.append(el('div', { class: 'op-grid' }, el('section', { class: 'op-card' }, el('h4', {}, 'Muted'), mutes), el('section', { class: 'op-card' }, el('h4', {}, 'Banned networks'), bans)));
    // leaderboards
    const missions = Object.keys(board);
    const lb = el('div', {});
    const pick = el('select', {}, ...missions.map((id) => el('option', { value: id }, id))) as HTMLSelectElement;
    const draw = () => {
      lb.innerHTML = '';
      for (const e of board[pick.value] ?? []) lb.append(el('div', { class: 'op-row' }, el('span', { class: 'op-grow' }, `${e.name} · ${e.time.toFixed(2)} s`), btn('Remove', () => void act('/leaderboard/delete', { mission: pick.value, name: e.name }), 'warn')));
    };
    pick.addEventListener('change', draw);
    b.append(el('h3', {}, 'Leaderboards'), missions.length ? field('Mission', pick) : el('p', { class: 'op-dim' }, 'No leaderboard times yet.'), lb);
    if (missions.length) draw();
  }

  // ------------------------------------------------------------ events & rules

  private eventsTab() {
    const c = this.brand!;
    const e = { ...c.event };
    const b = this.body;
    b.innerHTML = '';
    const note = el('p', { class: 'op-dim' });
    const name = input(e.name, { placeholder: 'e.g. Double Ink Weekend' });
    const mult = (label: string, key: 'ink' | 'xp') => {
      const row = el('div', { class: 'op-row' });
      const bs: HTMLButtonElement[] = [];
      for (const v of [1, 1.5, 2, 3]) {
        const x = btn(v === 1 ? 'Normal' : `${v}×`, () => {
          e[key] = v;
          bs.forEach((y) => y.classList.toggle('on', y === x));
        }, 'chip' + (e[key] === v ? ' on' : ''));
        bs.push(x);
        row.append(x);
      }
      return field(label, row);
    };
    const local = (t: number) => (t ? new Date(t - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');
    const start = el('input', { type: 'datetime-local' }) as HTMLInputElement;
    start.value = local(e.startsAt);
    const end = el('input', { type: 'datetime-local' }) as HTMLInputElement;
    end.value = local(e.until);
    const minV = input(c.minVersion, { placeholder: `e.g. ${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.5.0'}` });
    b.append(
      el('h2', {}, 'Events & rules'),
      el('p', { class: 'op-dim' }, 'Settings for every player. Games pick them up when they start and re-check every 30 seconds while running.'),
      el('h3', {}, 'Bonus event'),
      field('Event name (shown on the title screen)', name),
      mult('Ink earned', 'ink'),
      mult('XP earned', 'xp'),
      field('Starts (empty = now)', start),
      field('Ends (empty = until you stop it)', end),
      el(
        'div',
        { class: 'op-row' },
        btn('Save event', () => void this.saveBrand({ event: { ...e, name: name.value, startsAt: start.value ? new Date(start.value).getTime() : 0, until: end.value ? new Date(end.value).getTime() : 0 } }, note), 'primary'),
        btn('Stop event', () => void this.saveBrand({ event: { name: '', ink: 1, xp: 1, startsAt: 0, until: 0 } }, note).then(() => this.render())),
      ),
      el('h3', {}, 'Minimum game version'),
      field('Players on an older version are asked to update and cannot join online games', minV, 'Use it after a release that changes online play. Empty = any version.'),
      el('div', { class: 'op-row' }, btn('Save version rule', () => void this.saveBrand({ minVersion: minV.value.trim() }, note), 'primary')),
      note,
    );
  }

  // ------------------------------------------------------------ crashes

  private crashFilter: 'open' | 'all' = 'open';

  private async crashesTab() {
    const [c, a] = await Promise.all([this.api<CrashData>('/crashes'), this.api<DashboardData>('/analytics?days=7').catch(() => null)]);
    const b = this.body;
    b.innerHTML = '';
    const sessions = a?.totals.sessions ?? 0;
    const crashFree = sessions ? Math.max(0, Math.round((1 - c.sessions7 / sessions) * 1000) / 10) : null;
    const head = el('div', { class: 'op-row' }, el('h2', {}, 'Crashes'), el('span', { class: 'op-grow' }));
    for (const f of ['open', 'all'] as const) head.append(btn(f === 'open' ? 'Open' : 'All', () => ((this.crashFilter = f), void this.render()), 'chip' + (this.crashFilter === f ? ' on' : '')));
    b.append(
      head,
      el(
        'div',
        { class: 'op-tiles' },
        ...([
          [crashFree === null ? '—' : `${crashFree}%`, 'Crash-free sessions', 'last 7 days'],
          [String(c.open), 'Open problems', ''],
          [String(c.regressions), 'Came back after a fix', 'regressions'],
          [String(c.last24), 'Reports, last 24 h', ''],
          [String(c.players), 'Players affected', 'all time'],
        ] as Array<[string, string, string]>).map(([v, l, sub]) => el('div', { class: 'op-tile' }, el('b', {}, v), el('span', {}, l), sub ? el('small', {}, sub) : null)),
      ),
      el('p', { class: 'op-dim' }, 'Every error, graphics reset and long freeze in players\' games is reported here with the game version, platform, graphics card, what the player was doing and their last actions. The game recovers by itself where it can; fix the most common ones first.'),
    );
    const list = c.groups.filter((g) => this.crashFilter === 'all' || g.status === 'open');
    if (!list.length) b.append(el('p', { class: 'op-dim' }, this.crashFilter === 'open' ? 'No open problems. 🎉' : 'No crash reports yet.'));
    const when = (t: number) => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const top = (o: Record<string, number>) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, n]) => `${k} (${n})`).join(', ');
    for (const g of list) {
      const sample = g.samples[g.samples.length - 1];
      const details = el('details', { class: 'op-crash-details' }, el('summary', {}, 'Details: stack trace, what the player was doing'));
      if (sample) {
        details.append(
          el('p', { class: 'op-dim' }, `Latest: ${when(sample.t)} · ${sample.version} · ${sample.platform} ${sample.os} · ${sample.gpu || 'unknown GPU'}`),
          el('p', {}, Object.entries(sample.context).map(([k, v]) => `${k}: ${v}`).join(' · ')),
          el('h4', {}, 'Last actions before it happened'),
          el('pre', {}, sample.crumbs.join('\n') || '—'),
          el('h4', {}, 'Stack trace'),
          el('pre', {}, sample.stack || '—'),
        );
      }
      const actions = el('div', { class: 'op-row' });
      const set = (status: string) => void this.api('/crashes/status', { id: g.id, status }).then(() => this.render());
      if (g.status !== 'resolved') actions.append(btn('Mark fixed', () => set('resolved'), 'primary'));
      if (g.status !== 'ignored') actions.append(btn('Ignore', () => set('ignored')));
      if (g.status !== 'open') actions.append(btn('Reopen', () => set('open')));
      actions.append(btn('Delete', () => confirm('Delete this crash group?') && void this.api('/crashes/delete', { id: g.id }).then(() => this.render()), 'warn'));
      b.append(
        el(
          'section',
          { class: 'op-card op-crash ' + g.status },
          el('div', { class: 'op-row' }, el('span', { class: 'op-kind ' + g.kind }, g.kind), g.regressed ? el('span', { class: 'op-kind regressed' }, 'came back') : null, el('b', { class: 'op-grow op-crash-msg' }, g.msg), el('span', { class: 'op-dim' }, g.status)),
          el('p', { class: 'op-dim' }, `${g.count} reports · ${g.players} players · first ${when(g.firstSeen)} · last ${when(g.lastSeen)}`),
          el('p', { class: 'op-dim' }, `Versions: ${top(g.versions) || '—'} · Platforms: ${top(g.platforms) || '—'} · GPUs: ${top(g.gpus) || '—'}`),
          details,
          actions,
        ),
      );
    }
  }

  // ------------------------------------------------------------ game status

  private async statusTab() {
    const st = await this.api<{ mode: 'live' | 'maintenance' | 'development'; active: boolean; title: string; message: string; startsAt: number; until: number; blockWeb: boolean; blockDesktop: boolean; testers: boolean; serverTime: number }>('/status');
    const b = this.body;
    b.innerHTML = '';
    const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const now = el('div', { class: 'op-status ' + (st.active ? st.mode : st.mode !== 'live' ? 'scheduled' : 'live') });
    now.append(
      el('b', {}, st.active ? (st.mode === 'development' ? 'IN DEVELOPMENT' : 'MAINTENANCE') : st.mode !== 'live' ? 'SCHEDULED' : 'LIVE'),
      el('span', {}, st.active ? `Players see the ${st.mode} screen${st.until ? ` until ${when(st.until)} (then live again by itself)` : ' until you go live'}.` : st.mode !== 'live' ? `${st.mode === 'development' ? 'Development' : 'Maintenance'} starts ${when(st.startsAt)}${st.until ? `, back ${when(st.until)}` : ''}.` : 'The game is open for everyone.'),
    );
    b.append(el('h2', {}, 'Game status'), now);
    if (st.mode !== 'live') b.append(el('div', { class: 'op-row' }, btn('Go live now', () => void this.api('/status', { mode: 'live' }).then(() => this.render()), 'primary')));

    let mode: 'maintenance' | 'development' = st.mode === 'development' ? 'development' : 'maintenance';
    const modeRow = el('div', { class: 'op-row' });
    const modeBtns: HTMLButtonElement[] = [];
    for (const [m, label] of [['maintenance', 'Maintenance'], ['development', 'In development (coming soon)']] as const) {
      const c = btn(label, () => {
        mode = m;
        modeBtns.forEach((x) => x.classList.toggle('on', x === c));
      }, 'chip' + (mode === m ? ' on' : ''));
      modeBtns.push(c);
      modeRow.append(c);
    }
    const title = input(st.title, { placeholder: 'e.g. Ink City is closed for repairs' });
    const msg = el('textarea', { rows: '3', placeholder: 'e.g. We are adding the Season 1 update. Thanks for waiting!' }) as HTMLTextAreaElement;
    msg.value = st.message;
    // start: now or later
    let startIn = 0;
    const startCustom = el('input', { type: 'datetime-local' }) as HTMLInputElement;
    const startRow = el('div', { class: 'op-row' });
    const startBtns: HTMLButtonElement[] = [];
    for (const [mins, label] of [[0, 'Now'], [10, 'In 10 min'], [30, 'In 30 min'], [60, 'In 1 hour']] as const) {
      const c = btn(label, () => {
        startIn = mins;
        startCustom.value = '';
        startBtns.forEach((x) => x.classList.toggle('on', x === c));
      }, 'chip' + (mins === 0 ? ' on' : ''));
      startBtns.push(c);
      startRow.append(c);
    }
    startRow.append(startCustom);
    // back at
    let backIn = 60;
    const backCustom = el('input', { type: 'datetime-local' }) as HTMLInputElement;
    const backRow = el('div', { class: 'op-row' });
    const backBtns: HTMLButtonElement[] = [];
    for (const [mins, label] of [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [120, '2 hours'], [360, '6 hours'], [1440, '1 day'], [0, 'Until I turn it off']] as const) {
      const c = btn(label, () => {
        backIn = mins;
        backCustom.value = '';
        backBtns.forEach((x) => x.classList.toggle('on', x === c));
      }, 'chip' + (mins === 60 ? ' on' : ''));
      backBtns.push(c);
      backRow.append(c);
    }
    backRow.append(backCustom);
    const web = check(st.blockWeb);
    const desk = check(st.blockDesktop);
    const tester = input('', { type: 'password', placeholder: st.testers ? 'A tester code is set (type a new one to change it)' : 'Optional: a code that lets testers play' });
    const clearTester = check(false);
    const note = el('p', { class: 'op-dim' });
    b.append(
      el('h3', {}, 'Close the game'),
      field('Mode', modeRow),
      field('Headline', title),
      field('Message for players', msg),
      field('Starts', startRow, 'Players in the game get warnings 30, 10, 5 and 1 minutes before; online rooms close when it starts.'),
      field('Back at', backRow, 'Players see a countdown, and the game opens again by itself at this time.'),
      field('Close the web version (browser)', web),
      field('Close the desktop / Steam version too', desk, 'Off is recommended for maintenance: players who bought the game can keep playing single player; only online play pauses.'),
      field('Tester code', tester, 'Testers enter it on the closed screen to play anyway.'),
      ...(st.testers ? [field('Remove the tester code', clearTester)] : []),
      el(
        'div',
        { class: 'op-row' },
        btn('Close the game', async () => {
          const t0 = Date.now();
          const startsAt = startCustom.value ? new Date(startCustom.value).getTime() : startIn ? t0 + startIn * 60_000 : 0;
          const base = Math.max(t0, startsAt);
          const until = backCustom.value ? new Date(backCustom.value).getTime() : backIn ? base + backIn * 60_000 : 0;
          if (until && until <= base) {
            note.textContent = '"Back at" must be after the start.';
            return;
          }
          note.textContent = 'Saving…';
          try {
            await this.api('/status', { mode, title: title.value, message: msg.value, startsAt, until, blockWeb: web.checked, blockDesktop: desk.checked, ...(tester.value ? { tester: tester.value } : clearTester.checked ? { tester: '' } : {}) });
            this.h.brandChanged();
            void this.render();
          } catch (e) {
            note.textContent = 'Not saved: ' + (e as Error).message;
          }
        }, 'warn'),
      ),
      note,
      el('p', { class: 'op-dim' }, 'Players who cannot reach the server (offline desktop players) keep playing single player. You can always sign in here from the closed screen: type kumara on it.'),
    );
    this.liveTimer = window.setInterval(() => {
      if (!this.isOpen || this.tab !== 'status') clearInterval(this.liveTimer);
    }, 5000);
  }

  // ------------------------------------------------------------ live server

  private async live() {
    const draw = async () => {
      const s = await this.api<LiveData>('/live');
      const b = this.body;
      b.innerHTML = '';
      b.append(el('h2', {}, 'Live server'));
      b.append(
        el(
          'div',
          { class: 'op-tiles' },
          ...([
            [String(s.players), 'Online now'],
            [String(s.peakPlayers), 'Peak since restart'],
            [String(s.rooms.length), 'Rooms'],
            [String(s.totalConnections), 'Connections since restart'],
            [`${Math.round(s.uptimeMs / 3600_000)} h`, 'Uptime'],
            [s.maintenance ? 'ON' : 'off', 'Maintenance'],
            [s.region, 'Region'],
          ] as Array<[string, string]>).map(([v, l]) => el('div', { class: 'op-tile' }, el('b', {}, v), el('span', {}, l))),
        ),
      );
      const msg = input('', { placeholder: 'Message to every player (chat)' });
      const motd = input(s.motd, { placeholder: 'Message shown when someone joins' });
      b.append(
        el('div', { class: 'op-row' }, msg, btn('Announce', () => void this.api('/broadcast', { text: msg.value }).then(() => (msg.value = '')))),
        el('div', { class: 'op-row' }, motd, btn('Save join message', () => void this.api('/motd', { text: motd.value }))),
        el('div', { class: 'op-row' }, btn(s.maintenance ? 'Turn maintenance off' : 'Turn maintenance on (no new joins)', () => void this.api('/maintenance', { on: !s.maintenance }).then(draw), s.maintenance ? '' : 'warn')),
      );
      const t = el('table', { class: 'op-table' }, el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Player'), el('th', {}, 'Room'), el('th', {}, 'Online'), el('th', {}, ''))));
      const tb = el('tbody');
      for (const c of s.clients) {
        tb.append(el('tr', {}, el('td', {}, String(c.id)), el('td', {}, c.name), el('td', {}, c.room || '—'), el('td', {}, `${Math.round(c.onlineMs / 60000)} min`), el('td', {}, btn('Kick', () => void this.api('/kick', { id: c.id }).then(draw)), btn('Ban', () => confirm(`Ban ${c.name}'s network?`) && void this.api('/kick', { id: c.id, ban: true }).then(draw), 'warn'))));
      }
      if (!s.clients.length) tb.append(el('tr', {}, el('td', { colspan: '5', class: 'op-dim' }, 'Nobody is online right now.')));
      t.append(tb);
      b.append(el('h3', {}, 'Players'), t);
    };
    await draw();
    this.liveTimer = window.setInterval(() => void draw().catch(() => {}), 5000);
  }

  // ------------------------------------------------------------ branding

  private logoPicker(current: string, name: string, onSet: (url: string) => void): HTMLElement {
    const preview = el('div', { class: 'op-logo' });
    const show = (url: string) => {
      preview.innerHTML = '';
      if (url) preview.append(el('img', { src: (url.startsWith('/') ? dataBase(this.h.serverUrl()) : '') + url, alt: '' }));
      else if (name === 'company' && usesBundledLogo({ logo: '', company: this.brand?.company ?? '' })) preview.append(el('img', { src: BUNDLED_LOGO.color, alt: '', title: 'Built-in HelaO2 logo' }));
      else preview.append(el('span', { class: 'op-dim' }, 'No image'));
    };
    show(current);
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' }) as HTMLInputElement;
    const note = el('small', { class: 'op-dim' }, 'PNG, JPEG, WebP or GIF, up to 2 MB. Transparent PNGs look best.');
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      note.textContent = 'Uploading…';
      try {
        const url = await this.upload(f, name);
        onSet(url);
        show(url);
        note.textContent = 'Uploaded — press Save.';
      } catch (e) {
        note.textContent = (e as Error).message;
      }
    });
    return el('div', { class: 'op-logo-row' }, preview, el('div', {}, file, note, btn('Remove', () => (onSet(''), show('')))));
  }

  private brandingTab() {
    const c = structuredClone(this.brand!);
    const b = this.body;
    b.innerHTML = '';
    const company = input(c.company);
    const presents = input(c.presents);
    const website = input(c.website, { placeholder: 'https://…' });
    const support = input(c.supportEmail);
    const news = input(c.news, { placeholder: 'e.g. Season 1 is live — new missions in the Metropolis!' });
    const graffiti = check(c.graffiti);
    const adOn = check(c.advertise.enabled);
    const adText = input(c.advertise.text);
    // uploaded images: reuse or delete
    const gallery = el('div', { class: 'op-gallery' });
    for (const f of this.files) {
      const used = c.logo === f || c.sponsors.some((x) => x.logo === f);
      gallery.append(
        el(
          'figure',
          {},
          el('img', { src: dataBase(this.h.serverUrl()) + f, alt: '' }),
          el('figcaption', {}, f.split('/').pop() ?? f),
          used
            ? el('small', { class: 'op-dim' }, 'in use')
            : btn('Delete', () => {
                if (confirm('Delete this image?')) void this.api('/files/delete', { url: f }).then(() => this.render());
              }, 'warn'),
        ),
      );
    }
    const note = el('p', { class: 'op-dim' });
    b.append(
      el('h2', {}, 'Branding'),
      field('Company name', company, 'Loading screen ("… presents"), billboards, footer, credits.'),
      field('Word after the name on the loading screen', presents, 'Usually "presents". Leave empty to hide it.'),
      field('Company logo', this.logoPicker(c.logo, 'company', (u) => (c.logo = u)), 'Loading screen, billboards, ink graffiti on walls, footer and credits, in its real colours. With no upload and a company name starting with HelaO2, the built-in HelaO2 logo is used.'),
      field('Website', website),
      field('Support email', support),
      field('Title-screen news line', news),
      field('Logo graffiti on walls', graffiti),
      field('"Advertise with us" boards and footer link', adOn),
      field('Advertise text', adText),
      el('div', { class: 'op-row' }, btn('Save', () => void this.saveBrand({ ...c, company: company.value, presents: presents.value, website: website.value, supportEmail: support.value, news: news.value, graffiti: graffiti.checked, advertise: { enabled: adOn.checked, text: adText.value } }, note), 'primary')),
      note,
      el('h3', {}, 'Uploaded images'),
      this.files.length ? gallery : el('p', { class: 'op-dim' }, 'Nothing uploaded yet.'),
    );
  }

  private sponsorsTab() {
    const list: Sponsor[] = structuredClone(this.brand!.sponsors);
    const b = this.body;
    const note = el('p', { class: 'op-dim' });
    const draw = () => {
      b.innerHTML = '';
      b.append(el('h2', {}, 'Sponsors'), el('p', { class: 'op-dim' }, 'Logos show in their real colours on billboards at every island and in the title-screen footer. Tiers: gold = "Official sponsor".'));
      list.forEach((s, i) => {
        const name = input(s.name, { placeholder: 'Brand name' });
        const url = input(s.url, { placeholder: 'https://…' });
        const tier = el('select', {}, ...['gold', 'silver', 'partner'].map((t) => el('option', { value: t, ...(s.tier === t ? { selected: '' } : {}) }, t))) as HTMLSelectElement;
        const menu = check(s.menu);
        const world = check(s.world);
        const sync = () => Object.assign(s, { name: name.value, url: url.value, tier: tier.value as Sponsor['tier'], menu: menu.checked, world: world.checked, id: s.id || name.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || `sponsor${i}` });
        for (const x of [name, url, tier, menu, world]) x.addEventListener('change', sync);
        b.append(
          el(
            'section',
            { class: 'op-card' },
            el('div', { class: 'op-row' }, field('Name', name), field('Link', url), field('Tier', tier)),
            this.logoPicker(s.logo, s.id || 'sponsor', (u) => (s.logo = u)),
            el('div', { class: 'op-row' }, field('Title-screen footer', menu), field('Billboards in the world', world), btn('Remove sponsor', () => (list.splice(i, 1), draw()), 'warn')),
          ),
        );
      });
      b.append(
        el(
          'div',
          { class: 'op-row' },
          btn('+ Add sponsor', () => (list.push({ id: '', name: '', url: '', logo: '', tier: 'partner', menu: true, world: true }), draw())),
          btn('Save sponsors', () => void this.saveBrand({ sponsors: list }, note), 'primary'),
        ),
        note,
      );
    };
    draw();
  }

  private linksTab() {
    const links: BrandLink[] = structuredClone(this.brand!.links);
    const desk = check(this.brand!.donationsOnDesktop);
    const b = this.body;
    const note = el('p', { class: 'op-dim' });
    const draw = () => {
      b.innerHTML = '';
      b.append(el('h2', {}, 'Support & social links'), el('p', { class: 'op-dim' }, 'Buttons in the title-screen footer. Links without a URL are hidden. Donation links: Buy Me a Coffee, Ko-fi, Patreon, GitHub Sponsors…'));
      links.forEach((l, i) => {
        const label = input(l.label);
        const url = input(l.url, { placeholder: 'https://…' });
        const kind = el('select', {}, ...['donate', 'social', 'site', 'store'].map((k) => el('option', { value: k, ...(l.kind === k ? { selected: '' } : {}) }, k))) as HTMLSelectElement;
        const sync = () => Object.assign(l, { label: label.value, url: url.value, kind: kind.value as BrandLink['kind'], id: l.id || label.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || `link${i}` });
        for (const x of [label, url, kind]) x.addEventListener('change', sync);
        b.append(el('div', { class: 'op-row op-card' }, field('Label', label), field('URL', url), field('Type', kind), btn('Remove', () => (links.splice(i, 1), draw()), 'warn')));
      });
      b.append(
        field('Show donation links in the desktop (Steam) build', desk, 'Off is safer: Steam may treat payment links outside Steam as a policy problem. They always show on the web version.'),
        el('div', { class: 'op-row' }, btn('+ Add link', () => (links.push({ id: '', label: '', url: '', kind: 'donate' }), draw())), btn('Save links', () => void this.saveBrand({ links, donationsOnDesktop: desk.checked }, note), 'primary')),
        note,
      );
    };
    draw();
  }

  private pagesTab() {
    const pages = structuredClone(this.brand!.pages);
    const b = this.body;
    b.innerHTML = '';
    const ids = Object.keys(DEFAULT_PAGES);
    const pick = el('select', {}, ...ids.map((id) => el('option', { value: id }, DEFAULT_PAGES[id].title))) as HTMLSelectElement;
    const title = input('');
    const body = el('textarea', { rows: '18' }) as HTMLTextAreaElement;
    const enabled = check(true);
    const note = el('p', { class: 'op-dim' });
    const load = () => {
      const id = pick.value;
      const p = pages[id] ?? DEFAULT_PAGES[id];
      title.value = p.title;
      body.value = p.body;
      enabled.checked = p.enabled !== false;
      note.textContent = pages[id] ? 'Custom text.' : 'Built-in text (save to customise).';
    };
    pick.addEventListener('change', load);
    load();
    b.append(
      el('h2', {}, 'Pages'),
      el('p', { class: 'op-dim' }, 'Text pages in the game menus. Format: "# Heading", "- bullet", blank line = new paragraph.'),
      field('Page', pick),
      field('Title', title),
      field('Text', body),
      field('Show this page in the game', enabled),
      el(
        'div',
        { class: 'op-row' },
        btn('Save page', () => {
          pages[pick.value] = { title: title.value, body: body.value, enabled: enabled.checked };
          void this.saveBrand({ pages }, note);
        }, 'primary'),
        btn('Reset to built-in text', () => {
          delete pages[pick.value];
          void this.saveBrand({ pages }, note).then(load);
        }),
      ),
      note,
    );
  }

  private featuresTab() {
    const f = { ...this.brand!.features };
    const b = this.body;
    b.innerHTML = '';
    b.append(el('h2', {}, 'Features'), el('p', { class: 'op-dim' }, 'Switch parts of the game on or off for every player (applied the next time the game starts).'));
    const note = el('p', { class: 'op-dim' });
    const boxes: Array<[string, HTMLInputElement]> = [];
    for (const [id, def] of Object.entries(FEATURES)) {
      const c = check(f[id] ?? def.on);
      boxes.push([id, c]);
      b.append(field(def.label, c, def.hint));
    }
    b.append(
      el('div', { class: 'op-row' }, btn('Save features', () => {
        for (const [id, c] of boxes) f[id] = c.checked;
        void this.saveBrand({ features: f }, note);
      }, 'primary')),
      note,
    );
  }

  // ------------------------------------------------------------ account

  private accountTab() {
    const b = this.body;
    b.innerHTML = '';
    const email = input(this.email, { type: 'email' });
    const cur = input('', { type: 'password', autocomplete: 'current-password' });
    const next = input('', { type: 'password', autocomplete: 'new-password' });
    const note = el('p', { class: 'op-dim' });
    b.append(
      el('h2', {}, 'Account'),
      el('p', { class: 'op-dim' }, 'Change the sign-in email or password. You will be signed out on every device.'),
      field('Email', email),
      field('Current password', cur),
      field('New password', next, 'At least 8 characters. Leave empty to keep the password and only change the email.'),
      el('div', { class: 'op-row' }, btn('Save', async () => {
        note.textContent = 'Saving…';
        try {
          await this.api('/account', { email: email.value, password: cur.value, newPassword: next.value });
          this.signOut('Saved. Sign in with the new details.');
        } catch (e) {
          note.textContent = (e as Error).message;
        }
      }, 'primary')),
      note,
    );
  }
}

interface DashboardData {
  days: number;
  totals: { installs: number; today: number; week: number; month: number; sessions: number; playHours: number; avgSessionMin: number; retentionD1: number; retentionD7: number; retentionD30: number };
  series: Array<{ date: string; players: number; newPlayers: number; sessions: number; playMin: number; fps: number }>;
  modes: Array<[string, number]>;
  missions: Array<{ id: string; started: number; done: number; failed: number; rate: number }>;
  achievements: Array<[string, number]>;
  islands: Array<[string, number]>;
  chapters: Array<[string, number]>;
  platforms: Array<[string, number]>;
  regions: Array<[string, number]>;
  versions: Array<[string, number]>;
  gpus: Array<[string, number]>;
  art: Array<[string, number]>;
  gfx: Array<[string, number]>;
  links: Array<[string, number]>;
  secrets: Array<[string, number]>;
  errors: Array<{ msg: string; at: string; n: number }>;
}

interface ModerationData {
  words: string[];
  muted: Array<{ ip: string; name: string; until: number }>;
  log: Array<{ t: number; room: string; id: number; name: string; ip: string; text: string; flag: string }>;
  bans: string[];
  online: string[];
}

interface CrashData {
  open: number;
  regressions: number;
  last24: number;
  sessions7: number;
  players: number;
  groups: Array<{
    id: string;
    kind: string;
    msg: string;
    count: number;
    players: number;
    firstSeen: number;
    lastSeen: number;
    versions: Record<string, number>;
    platforms: Record<string, number>;
    gpus: Record<string, number>;
    status: 'open' | 'resolved' | 'ignored';
    regressed: boolean;
    samples: Array<{ t: number; stack: string; version: string; platform: string; os: string; gpu: string; context: Record<string, string | number | boolean>; crumbs: string[] }>;
  }>;
}

interface LiveData {
  region: string;
  maintenance: boolean;
  motd: string;
  uptimeMs: number;
  players: number;
  peakPlayers: number;
  totalConnections: number;
  rooms: Array<{ name: string; players: number }>;
  clients: Array<{ id: number; name: string; room: string; onlineMs: number }>;
}
