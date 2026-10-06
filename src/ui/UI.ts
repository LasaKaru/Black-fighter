import { ACTION_LABELS, Action, Input, prettyCode } from '../core/Input';
import { GraphicsPreset, Settings, SettingsData } from '../core/Settings';
import { Appearance, COLOR_SLOT_LABELS, ColorSlot, ROSTER, STYLE_OPTIONS } from '../character/Appearance';
import type { EyeType } from '../world/City';
import { EYE_COLORS, EYE_ORDER, FLOW_TIERS } from '../player/Player';
import { CONSUMABLES, Consumable, itemPrice, Profile } from '../game/Profile';
import type { MissionDef } from '../game/Missions';
import { VEHICLES, VehicleType } from '../vehicles/VehicleModels';

export type ScreenName = 'main' | 'pause' | 'characters' | 'customize' | 'inventory' | 'map' | 'missions' | 'settings' | 'controls' | 'online' | 'help' | 'none';

export interface MapIsland {
  id: string;
  name: string;
  country: string;
  blurb: string;
  x: number;
  z: number;
  r: number;
  biome: string;
}

export interface UIData {
  profile: Profile;
  islands(): MapIsland[];
  bridges(): Array<{ ax: number; az: number; bx: number; bz: number }>;
  player(): { x: number; z: number; yaw: number };
  missions(): Array<{ def: MissionDef; x: number; z: number }>;
  appearance(): Appearance;
  summonType(): VehicleType;
}

export interface UICallbacks {
  play(mode: 'story' | 'free'): void;
  connect(name: string, room: string, url: string): void;
  disconnect(): void;
  resume(): void;
  quit(): void;
  appearanceChanged(a: Appearance): void;
  settingsChanged(s: SettingsData): void;
  uiSound(back?: boolean): void;
  screenChanged(s: ScreenName): void;
  chat(text: string): void;
  fastTravel(island: string): void;
  startMission(id: string): void;
  setSummon(type: VehicleType): void;
  skipIntro(): void;
  listRooms(url: string): Promise<Array<{ name: string; players: number }>>;
}

export interface HudData {
  health: number;
  stamina: number;
  flow: number;
  flowTier: number;
  eyes: Record<EyeType, number>;
  selected: EyeType;
  buffs: { tide: number; watcher: number; storm: number };
  objective: { text: string; hint?: string; progress: string; time?: number } | null;
  fps: number;
  showFps: boolean;
  net: string;
  firstPerson: boolean;
  ko: boolean;
  pointerHint: boolean;
  ink: number;
  consumables: Record<Consumable, number>;
  prompt: string | null;
  vehicle: { speed: number; nitro: number; name: string } | null;
  compass: { angle: number; dist: number } | null;
}

const EYE_SVG = `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg"><path d="M4 30 Q50 -14 96 30 Q50 74 4 30 Z" fill="#f6f5f2" stroke="#111114" stroke-width="7"/><circle cx="50" cy="30" r="15" fill="#ff7a1a"/><circle cx="50" cy="30" r="7" fill="#111114"/><circle cx="45" cy="25" r="3" fill="#fff"/></svg>`;

const EYE_NAMES: Record<EyeType, string> = { fire: 'Fire', sky: 'Sky', void: 'Void', iron: 'Iron', tide: 'Tide', watcher: 'Watcher', storm: 'BLACKEYE' };
const BIOME_COLORS: Record<string, string> = { tropical: '#7e9a62', highland: '#5f8f4a', jungle: '#56724a', garden: '#a8c48c', desert: '#d39a83', temperate: '#a8a091', mountain: '#6d7a5e', ink: '#2c2c32' };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) el.append(c);
  return el;
}

export class UI {
  readonly root: HTMLElement;
  private screens = new Map<ScreenName, HTMLElement>();
  private rebuilders = new Map<ScreenName, () => void>();
  current: ScreenName = 'main';
  private back: ScreenName = 'main';
  private hud!: HTMLElement;
  private hudEls: Record<string, HTMLElement> = {};
  private toastBox!: HTMLElement;
  private chatBox!: HTMLElement;
  private chatInput!: HTMLInputElement;
  private onlineStatus!: HTMLElement;
  private playersBox!: HTMLElement;
  private intro!: HTMLElement;
  private attractCaption!: HTMLElement;
  private banner!: HTMLElement;
  private inkBadge!: HTMLElement;
  inGame = false;
  online = false;

  constructor(root: HTMLElement, private settings: Settings, private input: Input, private data: UIData, private cb: UICallbacks) {
    this.root = root;
    this.buildMain();
    this.buildPause();
    this.buildCharacters();
    this.buildCustomize();
    this.buildInventory();
    this.buildMap();
    this.buildMissions();
    this.buildSettings();
    this.buildControls();
    this.buildOnline();
    this.buildHelp();
    this.buildHud();
    this.buildIntro();
    data.profile.onChange(() => this.refreshInk());
    this.show('main');
  }

  // ------------------------------------------------------------ navigation

  show(name: ScreenName, back?: ScreenName) {
    if (back) this.back = back;
    for (const [n, el] of this.screens) el.classList.toggle('show', n === name);
    this.current = name;
    this.rebuilders.get(name)?.();
    this.cb.screenChanged(name);
    const first = this.screens.get(name)?.querySelector<HTMLElement>('.menu-left button, .panel button, input, select');
    first?.focus({ preventScroll: true });
  }

  private screen(name: ScreenName, ...children: Node[]): HTMLElement {
    const el = h('div', { class: 'screen', id: 'screen-' + name }, ...children);
    this.root.append(el);
    this.screens.set(name, el);
    return el;
  }

  private button(label: string, sub: string | null, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = h('button', { class: 'btn ' + cls, type: 'button' }, label);
    if (sub) b.append(h('small', {}, sub));
    b.addEventListener('click', () => {
      this.cb.uiSound(cls.includes('back'));
      onClick();
    });
    return b;
  }

  private backButton() {
    return this.button('Back', null, () => this.show(this.back), 'ghost back');
  }

  private refreshInk() {
    const v = `◉ ${this.data.profile.data.ink} INK`;
    if (this.inkBadge) this.inkBadge.textContent = v;
  }

  // ------------------------------------------------------------ main / pause

  private buildMain() {
    const logo = h('div', { class: 'logo', html: `BLACK${EYE_SVG}EYE` });
    this.inkBadge = h('div', { class: 'ink-badge' }, '');
    this.attractCaption = h('div', { class: 'attract' }, h('i'), h('span', {}, 'NOW SHOWING'));
    const nav = h(
      'div',
      { class: 'menu-left' },
      logo,
      h('div', { class: 'tagline' }, 'INK CITY · THE WORLD IS WATCHING'),
      h('div', { class: 'nav-label' }, 'PLAY'),
      this.button('Ink Run', 'Story: chase, fight, catch the burning Eyes', () => this.cb.play('story'), 'primary'),
      this.button('Free Roam', 'Twelve islands, vehicles, missions — your pace', () => this.cb.play('free')),
      this.button('Missions', 'Races, climbs, arenas and the Warden', () => this.show('missions', 'main')),
      this.button('Multiplayer', 'Co-op and PvP rooms with friends', () => this.show('online', 'main')),
      h('div', { class: 'nav-label' }, 'CHARACTER'),
      h(
        'div',
        { class: 'row-btns' },
        this.button('Roster', null, () => this.show('characters', 'main'), 'small'),
        this.button('Wardrobe', null, () => this.show('customize', 'main'), 'small'),
        this.button('Inventory', null, () => this.show('inventory', 'main'), 'small'),
      ),
      h('div', { class: 'nav-label' }, 'MORE'),
      h(
        'div',
        { class: 'row-btns' },
        this.button('World map', null, () => this.show('map', 'main'), 'small'),
        this.button('Settings', null, () => this.show('settings', 'main'), 'small'),
        this.button('Controls', null, () => this.show('controls', 'main'), 'small'),
        this.button('How to play', null, () => this.show('help', 'main'), 'small'),
      ),
    );
    this.screen('main', h('div', { class: 'menu-vignette' }), nav, this.inkBadge, this.attractCaption);
    this.refreshInk();
  }

  setAttractCaption(text: string) {
    const span = this.attractCaption.querySelector('span');
    if (span) span.textContent = text;
    this.attractCaption.classList.remove('flash');
    void this.attractCaption.offsetWidth;
    this.attractCaption.classList.add('flash');
  }

  private buildPause() {
    this.screen(
      'pause',
      h(
        'div',
        { class: 'menu-left' },
        h('div', { class: 'logo', html: 'PAUSED' }),
        h('div', { class: 'tagline' }, 'THE CITY WAITS'),
        this.button('Resume', null, () => this.cb.resume(), 'primary'),
        this.button('World map', 'Fast travel to any island', () => this.show('map', 'pause')),
        this.button('Missions', null, () => this.show('missions', 'pause')),
        h('div', { class: 'row-btns' }, this.button('Inventory', null, () => this.show('inventory', 'pause'), 'small'), this.button('Wardrobe', null, () => this.show('customize', 'pause'), 'small'), this.button('Roster', null, () => this.show('characters', 'pause'), 'small')),
        h('div', { class: 'row-btns' }, this.button('Settings', null, () => this.show('settings', 'pause'), 'small'), this.button('Controls', null, () => this.show('controls', 'pause'), 'small'), this.button('Help', null, () => this.show('help', 'pause'), 'small')),
        this.button('Quit to menu', null, () => this.cb.quit()),
      ),
    );
  }

  // ------------------------------------------------------------ roster

  private buildCharacters() {
    const panel = h('div', { class: 'panel wide' });
    const rebuild = () => {
      panel.innerHTML = '';
      panel.append(h('h2', {}, 'Roster'), h('p', {}, 'Pick a Blank. Every character is a full starting look you can keep customizing in the Wardrobe.'));
      const grid = h('div', { class: 'cards' });
      const prof = this.data.profile;
      for (const r of ROSTER) {
        const owned = prof.owns('char:' + r.id);
        const sw = h('div', { class: 'swatch' });
        for (const k of ['skin', 'hat', 'top', 'shirt', 'pants', 'shoes'] as ColorSlot[]) sw.append(h('i', { style: `background:${r.look.colors[k]}` }));
        const card = h('button', { class: 'card' + (owned ? '' : ' locked'), type: 'button' }, sw, h('b', {}, r.name), h('span', {}, r.bio), h('em', {}, owned ? 'Select' : `Unlock · ${r.price} Ink`));
        card.addEventListener('click', () => {
          if (!owned) {
            if (!prof.buy('char:' + r.id)) {
              this.toast(`Need ${r.price} Ink (you have ${prof.data.ink})`, 'warn');
              this.cb.uiSound(true);
              return;
            }
            this.toast(`${r.name} unlocked!`, 'power');
          }
          const look = structuredClone(r.look);
          this.settings.set('appearance', look);
          this.cb.appearanceChanged(look);
          this.cb.uiSound();
          rebuild();
        });
        grid.append(card);
      }
      panel.append(grid, h('div', { class: 'actions' }, this.button('Wardrobe', null, () => this.show('customize', 'characters')), this.backButton()));
    };
    this.rebuilders.set('characters', rebuild);
    this.screen('characters', panel);
  }

  // ------------------------------------------------------------ wardrobe

  private buildCustomize() {
    const panel = h('div', { class: 'panel' });
    const rebuild = () => {
      panel.innerHTML = '';
      const a = this.settings.data.appearance;
      const prof = this.data.profile;
      const commit = () => {
        this.settings.set('appearance', a);
        this.cb.appearanceChanged(a);
      };
      panel.append(h('h2', {}, 'Wardrobe'), h('p', {}, 'Locked items cost Ink — earn it from missions, Agents and ink drops. Changes sync to other players instantly.'));
      const itemRow = <T extends string>(label: string, slot: string, options: T[], get: () => T, set: (v: T) => void) => {
        const row = h('div', { class: 'row' }, h('label', {}, label));
        const chips = h('div', { class: 'chips' });
        for (const o of options) {
          const id = `${slot}:${o}`;
          const price = slot === 'face' || slot === 'body' ? 0 : itemPrice(id);
          const owned = price === 0 || prof.owns(id);
          const c = h('button', { class: 'chip' + (get() === o ? ' on' : '') + (owned ? '' : ' lock'), type: 'button' }, owned ? o : `🔒 ${o} · ${price}`);
          c.addEventListener('click', () => {
            if (!owned && !prof.buy(id)) {
              this.toast(`Need ${price} Ink`, 'warn');
              this.cb.uiSound(true);
              return;
            }
            set(o);
            commit();
            this.cb.uiSound();
            rebuild();
          });
          chips.append(c);
        }
        row.append(chips);
        panel.append(row);
      };
      panel.append(h('h3', {}, 'OUTFIT'));
      itemRow('Hat', 'hat', STYLE_OPTIONS.hat, () => a.hat, (v) => (a.hat = v));
      itemRow('Hair', 'hair', STYLE_OPTIONS.hair, () => a.hair, (v) => (a.hair = v));
      itemRow('Top', 'top', STYLE_OPTIONS.top, () => a.top, (v) => (a.top = v));
      itemRow('Bottoms', 'bottom', STYLE_OPTIONS.bottom, () => a.bottom, (v) => (a.bottom = v));
      itemRow('Shoes', 'shoes', STYLE_OPTIONS.shoes, () => a.shoes, (v) => (a.shoes = v));
      itemRow('Hands', 'gloves', STYLE_OPTIONS.gloves, () => a.gloves, (v) => (a.gloves = v));
      itemRow('Face', 'face', STYLE_OPTIONS.face, () => a.face, (v) => (a.face = v));
      itemRow('Body', 'body', STYLE_OPTIONS.body, () => a.body, (v) => (a.body = v));
      // accessories toggle
      const accRow = h('div', { class: 'row' }, h('label', {}, 'Accessories'));
      const chips = h('div', { class: 'chips' });
      for (const o of STYLE_OPTIONS.acc) {
        const id = 'acc:' + o;
        const price = itemPrice(id);
        const owned = prof.owns(id);
        const on = a.acc.includes(o);
        const c = h('button', { class: 'chip' + (on ? ' on' : '') + (owned ? '' : ' lock'), type: 'button' }, owned ? o : `🔒 ${o} · ${price}`);
        c.addEventListener('click', () => {
          if (!owned && !prof.buy(id)) {
            this.toast(`Need ${price} Ink`, 'warn');
            return;
          }
          a.acc = on ? a.acc.filter((x) => x !== o) : [...a.acc, o];
          commit();
          this.cb.uiSound();
          rebuild();
        });
        chips.append(c);
      }
      accRow.append(chips);
      panel.append(accRow);
      const toggle = (label: string, get: () => boolean, set: (v: boolean) => void) => {
        const i = h('input', { type: 'checkbox' }) as HTMLInputElement;
        i.checked = get();
        i.addEventListener('change', () => {
          set(i.checked);
          commit();
        });
        panel.append(h('div', { class: 'row' }, h('label', {}, label), i));
      };
      toggle('Eye patches', () => a.patches, (v) => (a.patches = v));
      const text = (label: string, get: () => string, set: (v: string) => void) => {
        const i = h('input', { type: 'text', maxlength: '12' }) as HTMLInputElement;
        i.value = get();
        i.addEventListener('change', () => {
          set(i.value.slice(0, 12));
          commit();
        });
        panel.append(h('div', { class: 'row' }, h('label', {}, label), i));
      };
      text('Back print text', () => a.print, (v) => (a.print = v));
      text('Chest patch text', () => a.chest, (v) => (a.chest = v));
      panel.append(h('h3', {}, 'COLOURS'));
      for (const slot of Object.keys(COLOR_SLOT_LABELS) as ColorSlot[]) {
        const i = h('input', { type: 'color' }) as HTMLInputElement;
        i.value = a.colors[slot];
        i.addEventListener('change', () => {
          a.colors[slot] = i.value;
          commit();
        });
        panel.append(h('div', { class: 'row' }, h('label', {}, COLOR_SLOT_LABELS[slot]), i));
      }
      const rnd = this.button('Randomize colours', null, () => {
        const rand = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
        for (const k of ['hat', 'top', 'shirt', 'pants', 'shoes', 'patchA', 'patchB', 'accent'] as ColorSlot[]) a.colors[k] = rand();
        commit();
        rebuild();
      });
      panel.append(h('div', { class: 'actions' }, rnd, this.backButton()));
    };
    this.rebuilders.set('customize', rebuild);
    this.screen('customize', panel);
  }

  // ------------------------------------------------------------ inventory & shop

  private buildInventory() {
    const panel = h('div', { class: 'panel' });
    const rebuild = () => {
      panel.innerHTML = '';
      const prof = this.data.profile;
      panel.append(h('h2', {}, 'Inventory'), h('p', {}, `You carry ${prof.data.ink} Ink. Missions done: ${prof.data.done.length}. Agents inked: ${prof.data.stats.defeats}.`));
      panel.append(h('h3', {}, 'CONSUMABLES'));
      for (const c of Object.keys(CONSUMABLES) as Consumable[]) {
        const info = CONSUMABLES[c];
        const buy = h('button', { class: 'chip', type: 'button' }, `Buy · ${info.price}`);
        buy.addEventListener('click', () => {
          if (!prof.buy('use:' + c)) this.toast(`Need ${info.price} Ink`, 'warn');
          else this.cb.uiSound();
          rebuild();
        });
        panel.append(h('div', { class: 'row' }, h('label', {}, `${info.name} ×${prof.data.consumables[c]}`, h('small', {}, ' — ' + info.desc)), buy));
      }
      panel.append(h('h3', {}, 'VEHICLES (B to summon)'));
      for (const t of ['tuktuk', 'inkbox', 'buggy', 'blotter'] as VehicleType[]) {
        const id = 'veh:' + t;
        const owned = prof.owns(id);
        const sel = this.data.summonType() === t;
        const b = h('button', { class: 'chip' + (sel ? ' on' : '') + (owned ? '' : ' lock'), type: 'button' }, owned ? (sel ? 'Selected' : 'Select') : `🔒 ${itemPrice(id)}`);
        b.addEventListener('click', () => {
          if (!owned && !prof.buy(id)) {
            this.toast(`Need ${itemPrice(id)} Ink`, 'warn');
            return;
          }
          this.cb.setSummon(t);
          this.cb.uiSound();
          rebuild();
        });
        const spec = VEHICLES[t];
        panel.append(h('div', { class: 'row' }, h('label', {}, spec.name, h('small', {}, ` — top speed ${Math.round(spec.topSpeed * 3.6)} km/h`)), b));
      }
      panel.append(h('h3', {}, 'EYE POWERS'));
      const eyes = h('div', { class: 'keys' });
      const desc: Record<EyeType, string> = {
        fire: 'Dash burst through enemies and walls',
        sky: 'Hold to charge a shockwave super-jump',
        void: 'Blink through thin walls',
        iron: 'Unstoppable wrecking charge + ground slam',
        tide: 'Paint path: you speed up, Agents slow down',
        watcher: 'Reveal Agents through walls, bullet-time',
        storm: 'BLACKEYE ink storm: double damage, max Flow',
      };
      EYE_ORDER.forEach((t, i) => eyes.append(h('b', { style: `background:${EYE_COLORS[t]};color:#111` }, `${i + 1} ${EYE_NAMES[t]}`), h('span', {}, desc[t])));
      panel.append(eyes, h('div', { class: 'actions' }, this.backButton()));
    };
    this.rebuilders.set('inventory', rebuild);
    this.screen('inventory', panel);
  }

  // ------------------------------------------------------------ world map

  private buildMap() {
    const panel = h('div', { class: 'panel map-panel' });
    const rebuild = () => {
      panel.innerHTML = '';
      panel.append(h('h2', {}, 'World map'), h('p', {}, 'Click an island to fast travel. Glowing diamonds are missions.'));
      const S = 640;
      const scale = S / 1300;
      const tx = (x: number) => S / 2 + x * scale;
      const tz = (z: number) => S / 2 + (z + 15) * scale;
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
      svg.setAttribute('class', 'worldmap');
      const el = (tag: string, attrs: Record<string, string | number>) => {
        const e = document.createElementNS(svgNS, tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
        svg.append(e);
        return e;
      };
      el('rect', { x: 0, y: 0, width: S, height: S, fill: '#9d9da6' });
      for (const b of this.data.bridges()) el('line', { x1: tx(b.ax), y1: tz(b.az), x2: tx(b.bx), y2: tz(b.bz), stroke: '#2a2a31', 'stroke-width': 5 });
      // hub
      el('rect', { x: tx(-45), y: tz(-40), width: 90 * scale, height: 85 * scale, fill: '#eceae6', stroke: '#111114', 'stroke-width': 3 });
      const hub = el('text', { x: tx(0), y: tz(2), 'text-anchor': 'middle', class: 'map-label' });
      hub.textContent = 'INK CITY';
      hub.addEventListener('click', () => this.cb.fastTravel('hub'));
      for (const i of this.data.islands()) {
        const c = el('circle', { cx: tx(i.x), cy: tz(i.z), r: i.r * scale, fill: BIOME_COLORS[i.biome] ?? '#888', stroke: '#111114', 'stroke-width': 3, class: 'map-island' });
        c.addEventListener('click', () => this.cb.fastTravel(i.id));
        const t = el('text', { x: tx(i.x), y: tz(i.z) + 4, 'text-anchor': 'middle', class: 'map-label' });
        t.textContent = i.name.toUpperCase();
        t.addEventListener('click', () => this.cb.fastTravel(i.id));
        const s = el('text', { x: tx(i.x), y: tz(i.z) + 18, 'text-anchor': 'middle', class: 'map-sub' });
        s.textContent = i.country;
        const tip = document.createElementNS(svgNS, 'title');
        tip.textContent = `${i.name} — ${i.blurb}`;
        c.append(tip);
      }
      for (const m of this.data.missions()) {
        const done = this.data.profile.data.done.includes(m.def.id);
        const d = el('rect', { x: tx(m.x) - 5, y: tz(m.z) - 5, width: 10, height: 10, transform: `rotate(45 ${tx(m.x)} ${tz(m.z)})`, fill: done ? '#ffd27a' : '#17a9a3', stroke: '#111', 'stroke-width': 2 });
        const tip = document.createElementNS(svgNS, 'title');
        tip.textContent = `${m.def.name}${done ? ' ✓' : ''} — ${m.def.desc}`;
        d.append(tip);
      }
      const p = this.data.player();
      el('polygon', { points: '0,-11 7,8 0,4 -7,8', transform: `translate(${tx(p.x)} ${tz(p.z)}) rotate(${180 - (p.yaw * 180) / Math.PI})`, fill: '#ff7a1a', stroke: '#111', 'stroke-width': 2 });
      panel.append(svg, h('div', { class: 'actions' }, this.backButton()));
    };
    this.rebuilders.set('map', rebuild);
    this.screen('map', panel);
  }

  // ------------------------------------------------------------ missions

  private buildMissions() {
    const panel = h('div', { class: 'panel wide' });
    const rebuild = () => {
      panel.innerHTML = '';
      panel.append(h('h2', {}, 'Missions'), h('p', {}, 'Each mission starts at a light beacon on its island. Play travels you there and starts it.'));
      const grid = h('div', { class: 'cards' });
      const prof = this.data.profile;
      const isl = new Map(this.data.islands().map((i) => [i.id, i]));
      for (const m of this.data.missions()) {
        const d = m.def;
        const done = prof.data.done.includes(d.id);
        const best = prof.data.best[d.id];
        const card = h(
          'button',
          { class: 'card' + (done ? ' done' : ''), type: 'button' },
          h('b', {}, `${done ? '✓ ' : ''}${d.name}`),
          h('span', {}, `${isl.get(d.island)?.name ?? d.island} · ${d.type.toUpperCase()}${d.needVehicle ? ' · VEHICLE' : ''}`),
          h('span', {}, d.desc),
          h('em', {}, `+${d.reward} Ink · ${d.time}s${best !== undefined ? ` · best ${best.toFixed(1)}s` : ''}`),
        );
        card.addEventListener('click', () => {
          this.cb.uiSound();
          this.cb.startMission(d.id);
        });
        grid.append(card);
      }
      panel.append(grid, h('div', { class: 'actions' }, this.backButton()));
    };
    this.rebuilders.set('missions', rebuild);
    this.screen('missions', panel);
  }

  // ------------------------------------------------------------ settings

  private buildSettings() {
    const panel = h('div', { class: 'panel' });
    const rebuild = () => {
      panel.innerHTML = '';
      const s = this.settings.data;
      const apply = () => {
        this.settings.save();
        this.cb.settingsChanged(this.settings.data);
      };
      panel.append(h('h2', {}, 'Settings'));
      panel.append(h('h3', {}, 'GRAPHICS'));
      const presetRow = h('div', { class: 'row' }, h('label', {}, 'Preset'));
      const chips = h('div', { class: 'chips' });
      for (const p of ['low', 'medium', 'high', 'ultra'] as GraphicsPreset[]) {
        const c = h('button', { class: 'chip' + (s.graphics === p ? ' on' : ''), type: 'button' }, p);
        c.addEventListener('click', () => {
          this.settings.applyPreset(p);
          this.cb.settingsChanged(this.settings.data);
          this.cb.uiSound();
          rebuild();
        });
        chips.append(c);
      }
      presetRow.append(chips);
      panel.append(presetRow);
      const slider = (label: string, key: keyof SettingsData, min: number, max: number, step: number, fmt = (v: number) => v.toFixed(2)) => {
        const i = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
        i.value = String(s[key]);
        const val = h('span', { class: 'val' }, fmt(Number(s[key])));
        i.addEventListener('input', () => {
          (s as unknown as Record<string, unknown>)[key] = Number(i.value);
          val.textContent = fmt(Number(i.value));
          apply();
        });
        panel.append(h('div', { class: 'row' }, h('label', {}, label), i, val));
      };
      const check = (label: string, key: keyof SettingsData) => {
        const i = h('input', { type: 'checkbox' }) as HTMLInputElement;
        i.checked = Boolean(s[key]);
        i.addEventListener('change', () => {
          (s as unknown as Record<string, unknown>)[key] = i.checked;
          apply();
        });
        panel.append(h('div', { class: 'row' }, h('label', {}, label), i));
      };
      slider('Resolution scale', 'resolutionScale', 0.5, 2, 0.05);
      slider('View distance', 'viewDistance', 0.5, 1.5, 0.05);
      check('Shadows', 'shadows');
      check('Bloom', 'bloom');
      check('Ambient occlusion (GTAO)', 'ao');
      check('Motion / speed blur', 'motionBlur');
      check('Show FPS', 'showFps');
      check('Play intro cinematic on start', 'playIntro');
      panel.append(h('h3', {}, 'CAMERA'));
      slider('Field of view (3rd person)', 'fov', 55, 100, 1, (v) => v.toFixed(0));
      slider('Field of view (1st person)', 'fpFov', 70, 110, 1, (v) => v.toFixed(0));
      slider('Mouse / stick sensitivity', 'sensitivity', 0.2, 3, 0.05);
      check('Invert Y', 'invertY');
      check('First person view', 'firstPerson');
      slider('Camera shake', 'cameraShake', 0, 1, 0.05);
      slider('First-person head bob', 'headBob', 0, 1, 0.05);
      check('Cinematic slow-mo moments', 'cinematicEvents');
      check('Reduce flashes', 'reduceFlashes');
      panel.append(h('h3', {}, 'GAMEPLAY'));
      const diffRow = h('div', { class: 'row' }, h('label', {}, 'Difficulty'));
      const dchips = h('div', { class: 'chips' });
      for (const d of ['chill', 'normal', 'hard'] as const) {
        const c = h('button', { class: 'chip' + (s.difficulty === d ? ' on' : ''), type: 'button' }, d);
        c.addEventListener('click', () => {
          s.difficulty = d;
          apply();
          this.cb.uiSound();
          rebuild();
        });
        dchips.append(c);
      }
      diffRow.append(dchips);
      panel.append(diffRow);
      check('Simple parkour (auto-vault)', 'simpleParkour');
      check('Agents roam in Free Roam', 'freeRoamAgents');
      panel.append(h('h3', {}, 'AUDIO'));
      slider('Master volume', 'masterVolume', 0, 1, 0.05);
      slider('Music', 'musicVolume', 0, 1, 0.05);
      slider('Effects', 'sfxVolume', 0, 1, 0.05);
      panel.append(h('div', { class: 'actions' }, this.backButton()));
    };
    this.rebuilders.set('settings', rebuild);
    this.screen('settings', panel);
  }

  // ------------------------------------------------------------ controls

  private bindTable!: HTMLElement;

  private buildControls() {
    this.bindTable = h('div');
    const reset = this.button('Reset to defaults', null, () => {
      this.input.resetBindings();
      this.renderBindings();
    });
    this.rebuilders.set('controls', () => this.renderBindings());
    this.screen(
      'controls',
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Controls'),
        h('p', {}, 'Click a key to rebind it, then press the new key or mouse button. Driving: W/S throttle & brake, A/D steer, Space handbrake drift, Shift nitro, F exit. Gamepads use the standard Xbox layout.'),
        this.bindTable,
        h('div', { class: 'actions' }, reset, this.backButton()),
      ),
    );
  }

  private renderBindings() {
    const t = this.bindTable;
    t.innerHTML = '';
    for (const a of Object.keys(ACTION_LABELS) as Action[]) {
      const row = h('div', { class: 'row' }, h('label', {}, ACTION_LABELS[a]));
      for (let slot = 0; slot < 2; slot++) {
        const code = this.input.bindings[a][slot];
        const b = h('button', { class: 'bind', type: 'button' }, code ? prettyCode(code) : '—');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          b.classList.add('wait');
          b.textContent = 'press…';
          setTimeout(() => {
            this.input.captureNextKey((c) => {
              if (c !== 'Escape') this.input.setBinding(a, slot, c);
              this.renderBindings();
            });
          }, 50);
        });
        row.append(b);
      }
      t.append(row);
    }
  }

  // ------------------------------------------------------------ online

  private buildOnline() {
    const s = this.settings.data;
    const name = h('input', { type: 'text', maxlength: '16', placeholder: 'Your name' }) as HTMLInputElement;
    name.value = s.name;
    const room = h('input', { type: 'text', maxlength: '24', placeholder: 'plaza' }) as HTMLInputElement;
    room.value = s.room;
    const url = h('input', { type: 'text', placeholder: 'auto (same host)/ws' }) as HTMLInputElement;
    url.value = s.serverUrl;
    this.onlineStatus = h('div', { class: 'status' });
    const rooms = h('div', { class: 'chips' });
    const refresh = () => {
      rooms.textContent = 'Looking for rooms…';
      this.cb
        .listRooms(url.value)
        .then((list) => {
          rooms.innerHTML = '';
          if (!list.length) rooms.textContent = 'No open rooms — create one by connecting.';
          for (const r of list) {
            const c = h('button', { class: 'chip', type: 'button' }, `${r.name} · ${r.players}`);
            c.addEventListener('click', () => {
              room.value = r.name;
              this.cb.uiSound();
            });
            rooms.append(c);
          }
        })
        .catch(() => (rooms.textContent = 'Server not reachable (npm run server).'));
    };
    this.rebuilders.set('online', refresh);
    const connect = this.button('Connect', null, () => {
      this.settings.set('name', name.value);
      this.settings.set('room', room.value);
      this.settings.set('serverUrl', url.value);
      this.cb.connect(name.value, room.value, url.value);
    }, 'primary');
    const disconnect = this.button('Disconnect', null, () => this.cb.disconnect());
    this.screen(
      'online',
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Multiplayer'),
        h('p', {}, 'Join a room by name. Everyone in a room shares the whole world: co-op against the Agents, PvP brawls, and racing each other in cars. Start the server with "npm run server" (dev) or "npm start" (production).'),
        h('div', { class: 'row' }, h('label', {}, 'Name'), name),
        h('div', { class: 'row' }, h('label', {}, 'Room'), room),
        h('div', { class: 'row' }, h('label', {}, 'Server URL'), url),
        h('h3', {}, 'OPEN ROOMS'),
        rooms,
        this.onlineStatus,
        h('div', { class: 'actions' }, connect, disconnect, this.button('Refresh', null, refresh), this.backButton()),
      ),
    );
  }

  setOnlineStatus(text: string) {
    this.onlineStatus.textContent = text;
  }

  // ------------------------------------------------------------ help

  private buildHelp() {
    const keys = h('div', { class: 'keys' });
    const add = (k: string, d: string) => keys.append(h('b', {}, k), h('span', {}, d));
    add('WASD / Mouse', 'Move and look · click to lock the mouse');
    add('Shift', 'Sprint · nitro while driving');
    add('Space', 'Jump · vault · wall-run · wall-kick · handbrake while driving');
    add('C', 'Slide · roll on landing · surf the goo');
    add('LMB / RMB', 'Light combo · tackle / uppercut / stomp');
    add('Q', 'Dodge');
    add('E · 1–7', 'Use / pick Eye power (Fire, Sky, Void, Iron, Tide, Watcher, BLACKEYE)');
    add('F', 'Interact: drive / exit vehicles, start missions, talk to locals');
    add('B', 'Summon your vehicle');
    add('R · H · X', 'Ink bomb · heal · smudge cloud');
    add('M · I', 'World map · inventory');
    add('V · G', 'First/third person · emote (horn in vehicles)');
    add('Esc / P · Enter · Tab', 'Pause · chat · players');
    this.screen(
      'help',
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'How to play'),
        h('p', {}, 'You are a Blank: you drew your own face, so the city\'s eyes can see you. Twelve floating islands — from Colombo, Ella and Sigiriya to the wonders of the world — orbit Ink City. Catch burning Eyes for powers, earn Ink from missions and Agents, drive the bridges, and keep moving: chaining parkour and hits fills your Flow.'),
        keys,
        h('div', { class: 'actions' }, this.backButton()),
      ),
    );
  }

  // ------------------------------------------------------------ intro overlay

  private buildIntro() {
    this.intro = h(
      'div',
      { id: 'intro' },
      h('div', { class: 'bar top' }),
      h('div', { class: 'bar bottom' }),
      h('div', { class: 'caption' }),
      h('div', { class: 'title-card', html: `<div class="logo big">BLACK${EYE_SVG}EYE</div><div class="sub">INK CITY</div>` }),
      h('div', { class: 'skip' }, 'Press any key to skip'),
    );
    this.intro.addEventListener('click', () => this.cb.skipIntro());
    this.root.append(this.intro);
  }

  showIntro(on: boolean) {
    this.intro.classList.toggle('show', on);
    this.intro.classList.remove('titled');
  }

  introCaption(text: string | undefined, title: boolean) {
    const c = this.intro.querySelector('.caption') as HTMLElement;
    c.textContent = text ?? '';
    c.classList.remove('in');
    void c.offsetWidth;
    if (text) c.classList.add('in');
    this.intro.classList.toggle('titled', title);
  }

  // ------------------------------------------------------------ HUD

  private buildHud() {
    const hud = h('div', { id: 'hud' });
    this.hud = hud;
    const E = this.hudEls;
    E.hp = h('i');
    E.hpBar = h('div', { class: 'bar hp' }, E.hp);
    E.st = h('i');
    E.cons = h('div', { class: 'cons' });
    hud.append(h('div', { class: 'hud-bl' }, h('div', { class: 'hud-label' }, 'INK'), E.hpBar, h('div', { class: 'bar stam' }, E.st), E.cons));
    const slots = h('div', { class: 'hud-br' });
    EYE_ORDER.forEach((t, i) => {
      const n = h('span', { class: 'n' }, '0');
      const slot = h('div', { class: 'eye-slot', style: `--c:${EYE_COLORS[t]}`, title: EYE_NAMES[t] }, h('div', { class: 'ico' }), n, h('span', { class: 'k' }, String(i + 1)));
      E['slot_' + t] = slot;
      E['n_' + t] = n;
      slots.append(slot);
    });
    E.buffs = h('div', { class: 'buffs' });
    hud.append(h('div', { class: 'hud-br-wrap' }, E.buffs, slots));
    E.flowI = h('i');
    E.flowName = h('div', { class: 'flow-name' }, 'COLD');
    E.compass = h('div', { class: 'compass' }, h('i'), h('span'));
    hud.append(h('div', { class: 'hud-top' }, h('div', { class: 'flow-eye' }, E.flowI), E.flowName, E.compass));
    E.objP = h('div', { class: 'p' });
    E.objT = h('div', { class: 't' });
    E.objH = h('div', { class: 'h' });
    E.objTime = h('div', { class: 'timer' });
    E.obj = h('div', { class: 'obj' }, E.objP, E.objT, E.objH, E.objTime);
    hud.append(h('div', { class: 'hud-tl' }, E.obj));
    E.tr = h('div', { class: 'hud-tr' });
    E.ink = h('div', { class: 'ink-count' });
    hud.append(h('div', { class: 'hud-tr-wrap' }, E.ink, E.tr));
    E.cross = h('div', { class: 'crosshair' });
    hud.append(E.cross);
    E.prompt = h('div', { class: 'prompt' });
    hud.append(E.prompt);
    E.veh = h('div', { class: 'veh' }, h('b'), h('span'), h('div', { class: 'bar nitro' }, h('i')));
    hud.append(E.veh);
    E.ko = h('div', { id: 'ko' }, 'REDRAWING…');
    hud.append(E.ko);
    E.click = h('div', { class: 'hint-click' }, 'Click to lock the mouse and look around');
    hud.append(E.click);
    this.banner = h('div', { class: 'banner' }, h('b'), h('span'));
    hud.append(this.banner);
    this.toastBox = h('div', { id: 'toasts' });
    hud.append(this.toastBox);
    this.chatInput = h('input', { type: 'text', maxlength: '140', placeholder: 'Say something… (Enter to send, Esc to cancel)' }) as HTMLInputElement;
    this.chatBox = h('div', { id: 'chat' });
    hud.append(this.chatBox, this.chatInput);
    Object.assign(this.chatInput.style, { position: 'absolute', left: '20px', bottom: '130px', width: 'min(360px, 60vw)', display: 'none', pointerEvents: 'auto', padding: '6px 8px', background: 'rgba(17,17,20,0.85)', color: '#eceae6', border: '1px solid rgba(236,234,230,0.16)', borderRadius: '3px' });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) this.cb.chat(t);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
    this.playersBox = h('div', { id: 'players' });
    hud.append(this.playersBox);
    this.root.append(hud);
  }

  showHud(v: boolean) {
    this.hud.classList.toggle('show', v);
  }

  /** Big "ELLA · SRI LANKA" banner when entering an island. */
  islandBanner(name: string, sub: string) {
    (this.banner.querySelector('b') as HTMLElement).textContent = name.toUpperCase();
    (this.banner.querySelector('span') as HTMLElement).textContent = sub.toUpperCase();
    this.banner.classList.remove('in');
    void this.banner.offsetWidth;
    this.banner.classList.add('in');
  }

  get chatOpen() {
    return this.chatInput.style.display === 'block';
  }

  openChat() {
    if (!this.online) return;
    this.chatInput.style.display = 'block';
    this.chatInput.value = '';
    this.input.enabled = false;
    setTimeout(() => this.chatInput.focus(), 0);
  }

  closeChat() {
    this.chatInput.style.display = 'none';
    this.chatInput.blur();
    if (this.inGame && this.current === 'none') this.input.enabled = true;
  }

  chatLine(name: string, text: string) {
    const line = h('div', { class: 'line' });
    line.append(h('b', {}, name + ': '), text);
    this.chatBox.append(line);
    while (this.chatBox.children.length > 6) this.chatBox.firstChild?.remove();
    setTimeout(() => line.remove(), 15000);
  }

  setPlayers(list: Array<{ name: string; ping?: number; host?: boolean }> | null) {
    if (!list) {
      this.playersBox.classList.remove('show');
      return;
    }
    this.playersBox.innerHTML = '<b>PLAYERS</b>';
    for (const p of list) this.playersBox.append(h('div', {}, `${p.name}${p.host ? ' (host)' : ''}${p.ping !== undefined ? ` · ${Math.round(p.ping)} ms` : ''}`));
    this.playersBox.classList.add('show');
  }

  toast(text: string, kind: 'info' | 'power' | 'warn' = 'info') {
    const t = h('div', { class: 'toast ' + kind }, text);
    this.toastBox.append(t);
    while (this.toastBox.children.length > 3) this.toastBox.firstChild?.remove();
    setTimeout(() => t.remove(), 2700);
  }

  updateHud(d: HudData) {
    const E = this.hudEls;
    E.hp.style.width = `${d.health}%`;
    E.hpBar.classList.toggle('low', d.health < 35);
    E.st.style.width = `${d.stamina}%`;
    E.flowI.style.setProperty('--open', String(0.12 + (d.flow / 100) * 0.88));
    E.flowName.textContent = FLOW_TIERS[d.flowTier].toUpperCase();
    for (const t of EYE_ORDER) {
      E['n_' + t].textContent = String(d.eyes[t]);
      E['slot_' + t].classList.toggle('sel', d.selected === t);
      E['slot_' + t].classList.toggle('empty', d.eyes[t] <= 0);
    }
    const buffs: string[] = [];
    if (d.buffs.tide > 0) buffs.push(`<span style="--c:${EYE_COLORS.tide}">TIDE ${d.buffs.tide.toFixed(0)}</span>`);
    if (d.buffs.watcher > 0) buffs.push(`<span style="--c:${EYE_COLORS.watcher}">WATCHER ${d.buffs.watcher.toFixed(0)}</span>`);
    if (d.buffs.storm > 0) buffs.push(`<span style="--c:${EYE_COLORS.storm}">STORM ${d.buffs.storm.toFixed(0)}</span>`);
    E.buffs.innerHTML = buffs.join('');
    E.cons.innerHTML = (Object.keys(CONSUMABLES) as Consumable[]).map((c) => `<span class="${d.consumables[c] ? '' : 'empty'}"><b>${CONSUMABLES[c].key}</b>${CONSUMABLES[c].name} ×${d.consumables[c]}</span>`).join('');
    if (d.objective) {
      E.obj.style.display = '';
      E.objP.textContent = d.objective.progress;
      E.objT.textContent = d.objective.text;
      E.objH.textContent = d.objective.hint ?? '';
      E.objTime.textContent = d.objective.time !== undefined ? `${Math.max(0, d.objective.time).toFixed(1)} s` : '';
      E.objTime.classList.toggle('urgent', d.objective.time !== undefined && d.objective.time < 10);
    } else E.obj.style.display = 'none';
    E.ink.textContent = `◉ ${d.ink}`;
    E.tr.textContent = [d.showFps ? `${d.fps.toFixed(0)} fps` : '', d.net].filter(Boolean).join(' · ');
    E.cross.style.display = d.firstPerson && !d.vehicle ? 'block' : 'none';
    E.ko.classList.toggle('show', d.ko);
    E.click.classList.toggle('show', d.pointerHint);
    E.prompt.textContent = d.prompt ?? '';
    E.prompt.style.display = d.prompt ? 'block' : 'none';
    if (d.vehicle) {
      E.veh.style.display = 'block';
      (E.veh.querySelector('b') as HTMLElement).textContent = `${Math.round(Math.abs(d.vehicle.speed) * 3.6)}`;
      (E.veh.querySelector('span') as HTMLElement).textContent = `KM/H · ${d.vehicle.name.toUpperCase()}`;
      (E.veh.querySelector('.nitro i') as HTMLElement).style.width = `${d.vehicle.nitro * 100}%`;
    } else E.veh.style.display = 'none';
    if (d.compass) {
      E.compass.style.display = 'flex';
      (E.compass.querySelector('i') as HTMLElement).style.transform = `rotate(${d.compass.angle}rad)`;
      (E.compass.querySelector('span') as HTMLElement).textContent = `${Math.round(d.compass.dist)} m`;
    } else E.compass.style.display = 'none';
  }
}
