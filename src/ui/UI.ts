import { ACTION_LABELS, Action, Input, prettyCode } from '../core/Input';
import { GraphicsPreset, Settings, SettingsData } from '../core/Settings';
import { Appearance, COLOR_SLOT_LABELS, ColorSlot, ROSTER, STYLE_OPTIONS } from '../character/Appearance';
import type { EyeType } from '../world/City';
import { EYE_COLORS, EYE_ORDER, FLOW_TIERS } from '../player/Player';
import { activeSlot, CONSUMABLES, Consumable, copySlot, deleteSlot, itemPrice, Profile, SLOTS, slotSummary, UPGRADES, UPGRADE_COST, useSlot, WEAPONS, WEAPON_ORDER } from '../game/Profile';
import type { MissionDef } from '../game/Missions';
import { VEHICLES, VehicleType } from '../vehicles/VehicleModels';
import { DECALS, GLOWS, GOLD_PAINT, HORNS, NITROS, PAINTS, RIMS, SPOILERS } from '../game/Garage';
import { padPrompt } from './Touch';
import { MEDAL_ICON, medalFor, medalTimes, timed } from '../game/Ghosts';
import { apiBase, dataBase, desktop, measurePing, regions, webBase } from '../net/Endpoints';
import { ago } from '../game/Checkpoints';
import { CHAPTERS } from '../game/Story';

export type ScreenName = 'main' | 'pause' | 'characters' | 'customize' | 'inventory' | 'map' | 'missions' | 'settings' | 'controls' | 'online' | 'help' | 'progress' | 'page' | 'campaign' | 'none';

export interface MapIsland {
  outer?: boolean;
  id: string;
  name: string;
  country: string;
  blurb: string;
  x: number;
  z: number;
  r: number;
  biome: string;
}

import { Minimap } from './Minimap';
import { MenuNav } from './MenuNav';
import { HudFx } from './HudFx';
import type { MapImage } from '../render/MapBake';
import { LEVEL_UNLOCKS, MAX_LEVEL, Progression, TRAILS, xpToNext } from '../game/Progression';

export interface UIData {
  profile: Profile;
  islands(): MapIsland[];
  bridges(): Array<{ ax: number; az: number; bx: number; bz: number }>;
  player(): { x: number; z: number; yaw: number };
  missions(): Array<{ def: MissionDef; x: number; z: number }>;
  appearance(): Appearance;
  summonType(): VehicleType;
  mapImage(): MapImage;
  waypoint(): { x: number; z: number } | null;
  discovered(id: string): boolean;
  /** 0..1 completion of an island (missions, loot, collectibles). */
  completion(id: string): number;
  progression(): Progression;
  collection(): Array<{ name: string; crates: number[]; stickers: number[]; tags: number[]; logs: number[] }>;
}

export interface UICallbacks {
  play(mode: 'story' | 'free'): void;
  connect(name: string, room: string, url: string): void;
  disconnect(): void;
  resume(): void;
  /** Open photo mode (from the pause menu). */
  photo(): void;
  /** Fast travel up to Blank's Loft. */
  hideout(): void;
  /** Online host: start / stop a refereed match. */
  startMatch(mode: 'rva' | 'turf'): void;
  stopMatch(): void;
  isHost(): boolean;
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
  setWaypoint(p: { x: number; z: number } | null): void;
  setTrail(id: string): void;
  listRooms(url: string): Promise<Array<{ name: string; players: number }>>;
  /** Open an info page (privacy, terms, credits, …). */
  openPage(id: string): void;
  /** Title screen: back to the last checkpoint. */
  continueGame(): void;
  /** Pause: back to the last checkpoint. */
  restoreCheckpoint(): void;
  /** Campaign map: play the story from where it stands. */
  playCampaign(): void;
  /** Campaign map: start the story over (keeps items and levels). */
  restartCampaign(): void;
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
  weapon: { key: string; name: string; ammo: string; empty: boolean };
  /** Nearest island boss in the fight. */
  boss: { name: string; frac: number } | null;
  /** Wanted stars 0..5. */
  wanted: number;
  /** The crosshair is on something the grapple can hook. */
  grappleAim: boolean;
  /** Last input was a gamepad: show pad glyphs in prompts. */
  pad: boolean;
  prompt: string | null;
  vehicle: { speed: number; nitro: number; name: string } | null;
  compass: { angle: number; dist: number } | null;
  level: number;
  /** 0..1 progress to the next level. */
  xpFrac: number;
}

const EYE_SVG = `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg"><path d="M4 30 Q50 -14 96 30 Q50 74 4 30 Z" fill="#f6f5f2" stroke="#111114" stroke-width="7"/><circle cx="50" cy="30" r="15" fill="#ff7a1a"/><circle cx="50" cy="30" r="7" fill="#111114"/><circle cx="45" cy="25" r="3" fill="#fff"/></svg>`;

const EYE_NAMES: Record<EyeType, string> = { fire: 'Fire', sky: 'Sky', void: 'Void', iron: 'Iron', tide: 'Tide', watcher: 'Watcher', storm: 'BLACKEYE' };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string | null>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null) el.append(c);
  return el;
}

export class UI {
  readonly root: HTMLElement;
  private screens = new Map<ScreenName, HTMLElement>();
  private rebuilders = new Map<ScreenName, () => void>();
  current: ScreenName = 'main';
  /** Screens to return to with Back (nested menus, e.g. Settings → Key bindings). */
  private stack: ScreenName[] = [];
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
  private matchRow: HTMLElement | null = null;
  private boards: Record<string, Array<{ name: string; time: number }>> | null = null;

  /** Pause menu: host-only match controls while online. */
  private refreshMatchRow() {
    const row = this.matchRow;
    if (!row) return;
    row.innerHTML = '';
    if (!this.online) return;
    if (!this.cb.isHost()) {
      row.append(h('small', {}, 'The room host can start Runners vs Agents or Ink Turf.'));
      return;
    }
    row.append(
      this.button('Runners vs Agents', null, () => (this.cb.startMatch('rva'), this.cb.resume()), 'small'),
      this.button('Ink Turf', null, () => (this.cb.startMatch('turf'), this.cb.resume()), 'small'),
      this.button('Stop match', null, () => this.cb.stopMatch(), 'small'),
    );
  }
  readonly minimap = new Minimap();
  nav!: MenuNav;
  readonly fx = new HudFx();

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
    this.buildProgress();
    this.buildPage();
    this.buildCampaign();
    this.buildHud();
    this.buildIntro();
    data.profile.onChange(() => this.refreshInk());
    this.nav = new MenuNav(
      {
        activeRoot: () => (this.current === 'none' ? null : (this.screens.get(this.current) ?? null)),
        back: () => this.backAction(),
        tab: (d) => {
          if (this.current === 'settings') this.settingsTabStep(d);
        },
        sound: () => this.cb.uiSound(),
      },
      root,
    );
    this.show('main');
  }

  // ------------------------------------------------------------ navigation

  show(name: ScreenName, back?: ScreenName) {
    if (back) {
      if (this.stack[this.stack.length - 1] !== back) this.stack.push(back);
    } else if (name === 'main' || name === 'pause' || name === 'none') this.stack = [];
    for (const [n, el] of this.screens) el.classList.toggle('show', n === name);
    this.current = name;
    // menus sit on top of a hidden HUD (no radar/eye slots bleeding through)
    this.hud?.classList.toggle('under-menu', name !== 'none');
    if (name === 'missions') this.boards = null;
    this.rebuilders.get(name)?.();
    if (name === 'pause') this.refreshMatchRow();
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
    return this.button('Back', null, () => this.goBack(), 'ghost back');
  }

  /** B / Esc: resume from the pause menu, otherwise back one level (nothing on the title screen). */
  backAction() {
    if (this.current === 'pause') this.cb.resume();
    else if (this.current !== 'main' && this.current !== 'none') this.goBack();
  }

  /** Back one menu level (B / Esc / Back button). */
  goBack() {
    const prev = this.stack.pop() ?? (this.inGame ? 'pause' : 'main');
    this.show(prev);
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
      (this.continueBtn = this.button('Continue', '', () => this.cb.continueGame(), 'primary continue')),
      (this.campaignBtn = this.button('Campaign', 'Mission 1 → the Final: the story of the Blank', () => this.show('campaign', 'main'))),
      this.button('Free Roam', 'Seventeen islands, the Metropolis included — your pace', () => this.cb.play('free')),
      this.button('Missions', 'Races, climbs, arenas and the Warden', () => this.show('missions', 'main')),
      this.button('Multiplayer', 'Co-op and PvP rooms with friends', () => this.show('online', 'main')),
      h('div', { class: 'nav-label' }, 'CHARACTER'),
      h(
        'div',
        { class: 'row-btns' },
        this.button('Roster', null, () => this.show('characters', 'main'), 'small'),
        this.button('Wardrobe', null, () => this.show('customize', 'main'), 'small'),
        this.button('Inventory', null, () => this.show('inventory', 'main'), 'small'),
        this.button('Progress', null, () => this.show('progress', 'main'), 'small'),
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
      desktop ? this.button('Quit game', null, () => desktop?.quit(), 'small') : null,
    );
    this.screen('main', h('div', { class: 'menu-vignette' }), nav, this.inkBadge, this.attractCaption);
    this.refreshInk();
    this.rebuilders.set('main', () => {
      this.refreshContinue();
      const nodes = campaignNodes(this.data.profile.data.story);
      const cur = nodes.find((n) => n.state === 'current');
      const sub = this.campaignBtn.querySelector('small');
      if (sub) sub.textContent = cur ? `${cur.label} · ${cur.title}` : 'Complete · replay any mission';
    });
    this.refreshContinue();
  }

  private continueBtn!: HTMLButtonElement;

  /** Continue shows where you left off (hidden on a fresh save). */
  private refreshContinue() {
    const c = this.data.profile.data.checkpoint;
    const b = this.continueBtn;
    if (!b) return;
    b.style.display = c ? '' : 'none';
    if (!c) return;
    b.innerHTML = '';
    b.append('Continue', h('small', {}, `${c.mode === 'story' ? 'Story' : 'Free Roam'} · ${c.detail} · ${ago(c.at)}`));
  }

  private campaignBtn!: HTMLButtonElement;

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
        this.button('Restore last checkpoint', 'Back to where you last saved', () => this.cb.restoreCheckpoint()),
        this.button('World map', 'Fast travel to any island', () => this.show('map', 'pause')),
        h('div', { class: 'row-btns' }, this.button('Photo mode', 'Freeze the moment (K)', () => this.cb.photo(), 'small'), this.button("Blank's Loft", 'Your hideout', () => this.cb.hideout(), 'small')),
        (this.matchRow = h('div', { class: 'row-btns' })),
        this.button('Missions', null, () => this.show('missions', 'pause')),
        h('div', { class: 'row-btns' }, this.button('Inventory', null, () => this.show('inventory', 'pause'), 'small'), this.button('Wardrobe', null, () => this.show('customize', 'pause'), 'small'), this.button('Roster', null, () => this.show('characters', 'pause'), 'small'), this.button('Progress', null, () => this.show('progress', 'pause'), 'small')),
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
      // world leaderboard (top 3 per mission), fetched once per visit
      if (!this.boards) {
        this.boards = {};
        fetch(dataBase(this.settings.data.serverUrl) + '/leaderboard')
          .then((r) => (r.ok ? r.json() : {}))
          .then((b: Record<string, Array<{ name: string; time: number }>>) => {
            this.boards = b;
            rebuild();
          })
          .catch(() => {});
      }
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
      panel.append(h('h3', {}, 'GEAR'));
      {
        const owned = prof.owns('gear:wings');
        const buy = h('button', { class: 'chip' + (owned ? ' on' : ''), type: 'button' }, owned ? 'Owned' : `Buy · ${itemPrice('gear:wings')}`);
        if (!owned)
          buy.addEventListener('click', () => {
            if (!prof.buy('gear:wings')) this.toast(`Need ${itemPrice('gear:wings')} Ink`, 'warn');
            else {
              this.cb.uiSound();
              this.toast('Ink Wings: your glides go further and faster', 'power');
            }
            rebuild();
          });
        panel.append(h('div', { class: 'row' }, h('label', {}, 'Ink Wings', h('small', {}, ' — glide sinks 45% slower, flies 18% faster and costs less stamina')), buy));
      }
      panel.append(h('h3', {}, `EYE UPGRADES · ${prof.data.shards} shard${prof.data.shards === 1 ? '' : 's'}`), h('p', {}, 'Eye shards drop from rare crates, bosses and the odd Agent. Each power has three tiers, bought in order.'));
      for (const [type, up] of Object.entries(UPGRADES)) {
        const lv = prof.upgradeLevel(type);
        const pips = up.tiers.map((t, i) => h('span', { class: 'up-tier' + (i < lv ? ' owned' : i === lv ? ' next' : '') }, `${'I'.repeat(i + 1)} · ${t}`));
        const btn = h('button', { class: 'chip', type: 'button' }, lv >= 3 ? 'Maxed' : `Upgrade · ${UPGRADE_COST[lv]} shards`);
        if (lv < 3)
          btn.addEventListener('click', () => {
            if (!prof.buyUpgrade(type)) this.toast(`Need ${UPGRADE_COST[lv]} Eye shards`, 'warn');
            else {
              this.cb.uiSound();
              this.toast(`${up.name}: ${up.tiers[lv]}`, 'power');
            }
            rebuild();
          });
        panel.append(h('div', { class: 'row upgrade-row' }, h('label', {}, up.name, h('div', { class: 'up-tiers' }, ...pips)), btn));
      }
      panel.append(h('h3', {}, 'WEAPONS (T use · Z switch)'));
      for (const w of WEAPON_ORDER) {
        const info = WEAPONS[w];
        const eq = prof.data.weapon === w;
        const equip = h('button', { class: 'chip' + (eq ? ' on' : ''), type: 'button' }, eq ? 'Equipped' : 'Equip');
        equip.addEventListener('click', () => {
          prof.data.weapon = w;
          prof.save();
          this.cb.uiSound();
          rebuild();
        });
        const btns: HTMLElement[] = [equip];
        if (info.price) {
          const buy = h('button', { class: 'chip', type: 'button' }, `+${info.pack} · ${info.price}`);
          buy.addEventListener('click', () => {
            if (!prof.buy('ammo:' + w)) this.toast(`Need ${info.price} Ink`, 'warn');
            else this.cb.uiSound();
            rebuild();
          });
          btns.push(buy);
        }
        const count = w === 'boomerang' ? '∞' : `${prof.data.ammo[w]} ${info.unit}`;
        panel.append(h('div', { class: 'row' }, h('label', {}, `${info.name} · ${count}`, h('small', {}, ' — ' + info.desc)), h('span', {}, ...btns)));
      }
      panel.append(h('h3', {}, 'VEHICLES (B to summon)'));
      for (const t of ['tuktuk', 'inkbox', 'buggy', 'blotter', 'moto', 'board', 'skiff', 'glider'] as VehicleType[]) {
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
        panel.append(h('div', { class: 'row' }, h('label', {}, spec.name, h('small', {}, ` — top speed ${Math.round(spec.topSpeed * 3.6)} km/h${spec.blurb ? ' · ' + spec.blurb : ''}`)), b));
      }
      {
        // garage: style the selected summon vehicle
        const t = this.data.summonType();
        const g = (prof.data.garage[t] ??= {});
        panel.append(h('h3', {}, `GARAGE · ${VEHICLES[t].name}`), h('p', {}, 'Applies the next time you summon it (B). Driving: R drops an ink oil slick, ram Agents at speed.'));
        const row = (label: string, options: Array<[string, string]>, key: 'paint' | 'rims' | 'nitro' | 'glow', def: string) => {
          const chips = options.map(([val, color]) => {
            const on = (g[key] ?? def) === val;
            const c = h('button', { class: 'swatch' + (on ? ' on' : ''), type: 'button', title: val, style: `background:${color}` });
            c.addEventListener('click', () => {
              g[key] = val;
              prof.save();
              this.cb.uiSound();
              rebuild();
            });
            return c;
          });
          panel.append(h('div', { class: 'row' }, h('label', {}, label), h('span', { class: 'swatches' }, ...chips)));
        };
        const paints = [...PAINTS, ...(prof.data.unlocks.includes('paint:gold') ? [GOLD_PAINT] : [])];
        row('Paint', paints.map((p) => [p, p] as [string, string]), 'paint', VEHICLES[t].paint[0]);
        row('Rims', Object.entries(RIMS), 'rims', 'chrome');
        row('Nitro flame', Object.entries(NITROS), 'nitro', 'fire');
        row('Underglow', Object.entries(GLOWS).map(([k, c]) => [k, k === 'off' ? 'repeating-linear-gradient(45deg,#333 0 4px,#1d1d23 4px 8px)' : c] as [string, string]), 'glow', 'off');
        const textRow = (label: string, options: readonly string[], key: 'spoiler' | 'decal' | 'horn', def: string) => {
          const chips = h('div', { class: 'chips' });
          for (const o of options) {
            const c = h('button', { class: 'chip' + ((g[key] ?? def) === o ? ' on' : ''), type: 'button' }, o);
            c.addEventListener('click', () => {
              g[key] = o;
              prof.save();
              this.cb.uiSound();
              rebuild();
            });
            chips.append(c);
          }
          panel.append(h('div', { class: 'row' }, h('label', {}, label), chips));
        };
        textRow('Spoiler', SPOILERS, 'spoiler', 'none');
        textRow('Decal', DECALS, 'decal', 'none');
        textRow('Horn (G while driving)', HORNS, 'horn', 'default');
      }
      panel.append(h('h3', {}, 'DASH TRAIL'));
      const trails = h('div', { class: 'chips' });
      for (const [id, t] of Object.entries(TRAILS)) {
        const have = id === 'fire' || prof.data.unlocks.includes('trail:' + id);
        const lvl = Object.entries(LEVEL_UNLOCKS).find(([, u]) => u.id === 'trail:' + id)?.[0];
        const c = h('button', { class: 'chip' + (prof.data.trail === id ? ' on' : '') + (have ? '' : ' lock'), type: 'button', style: `--c:${t.color === 'rainbow' ? '#ff7a1a' : t.color}` }, have ? t.name : `🔒 ${t.name} · LV ${lvl}`);
        c.addEventListener('click', () => {
          if (!have) return;
          this.cb.setTrail(id);
          this.cb.uiSound();
          rebuild();
        });
        trails.append(c);
      }
      panel.append(trails);
      panel.append(h('p', {}, `Eye shards: ${prof.data.shards} (power upgrades) · Agent mask fragments: ${prof.data.masks}/5`));
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

  // ------------------------------------------------------------ progress

  private buildProgress() {
    const panel = h('div', { class: 'panel progress-panel' });
    const rebuild = () => {
      panel.innerHTML = '';
      const pr = this.data.progression();
      const d = pr.d;
      const next = d.level >= MAX_LEVEL ? null : xpToNext(d.level);
      const nextUnlock = Object.entries(LEVEL_UNLOCKS).find(([l]) => Number(l) > d.level);
      panel.append(
        h('h2', {}, 'Progress'),
        h('div', { class: 'lvl-head' }, h('b', {}, `LEVEL ${d.level}`), h('div', { class: 'bar comp' }, h('i', { style: `width:${next ? (d.xp / next) * 100 : 100}%` })), h('small', {}, next ? `${Math.floor(d.xp)} / ${next} XP${nextUnlock ? ` · next unlock at LV ${nextUnlock[0]}: ${nextUnlock[1].name}` : ''}` : 'Max level')),
      );
      panel.append(h('h3', {}, 'CHALLENGES'));
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const hrs = Math.ceil((midnight.getTime() - now.getTime()) / 3600000);
      for (const c of pr.challenges()) {
        panel.append(h('div', { class: 'ch-row' + (c.done ? ' done' : '') }, h('span', { class: 'tag' }, c.weekly ? 'WEEKLY' : 'DAILY'), h('label', {}, c.text), h('div', { class: 'bar comp' }, h('i', { style: `width:${(c.progress / c.goal) * 100}%` })), h('small', {}, c.done ? 'DONE ✓' : `${c.progress >= 100 ? Math.round(c.progress) : +c.progress.toFixed(0)} / ${c.goal}`)));
      }
      panel.append(h('p', {}, `Daily challenges refresh in ${hrs} h. Rewards: 100 Ink + 150 XP (daily), 400 Ink + 600 XP (weekly).`));
      panel.append(h('h3', {}, 'COLLECTION'));
      const tbl = h('div', { class: 'coll' });
      tbl.append(h('b', {}, 'Island'), h('b', {}, 'Crates'), h('b', {}, 'Stickers'), h('b', {}, 'Tags'), h('b', {}, 'Logs'));
      for (const r of this.data.collection()) tbl.append(h('span', {}, r.name), ...[r.crates, r.stickers, r.tags, r.logs].map((v) => h('span', { class: v[0] === v[1] && v[1] > 0 ? 'full' : '' }, `${v[0]}/${v[1]}`)));
      panel.append(tbl);
      const list = pr.achievementView();
      panel.append(h('h3', {}, `ACHIEVEMENTS · ${list.filter((a) => a.unlocked).length}/${list.length}`));
      const grid = h('div', { class: 'ach-grid' });
      for (const a of list) grid.append(h('div', { class: 'ach' + (a.unlocked ? ' on' : '') }, h('b', {}, (a.unlocked ? '🏆 ' : '') + a.name), h('small', {}, a.desc), h('div', { class: 'bar comp' }, h('i', { style: `width:${(a.progress / a.goal) * 100}%` }))));
      panel.append(grid);
      // save slots
      panel.append(h('h3', {}, 'SAVE SLOTS'));
      const cur = activeSlot();
      for (let n = 1; n <= SLOTS; n++) {
        const sm = slotSummary(n);
        const info = sm ? `Level ${sm.level} · ${sm.ink} Ink · ${sm.done} missions · ${sm.islands} islands${sm.saved ? ' · ' + new Date(sm.saved).toLocaleDateString() : ''}` : 'Empty';
        const btns: HTMLElement[] = [];
        if (n === cur) btns.push(h('span', { class: 'chip on' }, 'Playing'));
        else {
          const load = h('button', { class: 'chip', type: 'button' }, sm ? 'Load' : 'New game');
          load.addEventListener('click', () => useSlot(n));
          const copy = h('button', { class: 'chip', type: 'button' }, 'Copy here');
          copy.addEventListener('click', () => {
            if (sm && !confirm(`Overwrite slot ${n} with this save?`)) return;
            this.data.profile.save();
            copySlot(cur, n);
            rebuild();
          });
          btns.push(load, copy);
          if (sm) {
            const del = h('button', { class: 'chip', type: 'button' }, 'Delete');
            del.addEventListener('click', () => {
              if (!confirm(`Delete slot ${n}?`)) return;
              deleteSlot(n);
              rebuild();
            });
            btns.push(del);
          }
        }
        panel.append(h('div', { class: 'row' }, h('label', {}, `Slot ${n}`, h('small', {}, ' — ' + info)), h('span', {}, ...btns)));
      }
      // cloud save
      panel.append(h('h3', {}, 'CLOUD SAVE'), h('p', {}, 'Upload this slot to the game server and get a code; enter the code on any device to pull it down.'));
      const codeIn = h('input', { type: 'text', placeholder: 'CODE', maxlength: '8', style: 'width:110px;text-transform:uppercase' }) as HTMLInputElement;
      const cloudKey = (): { code: string; key: string } | null => {
        try {
          return JSON.parse(localStorage.getItem('blackeye.cloud') ?? 'null');
        } catch {
          return null;
        }
      };
      const ck = cloudKey();
      if (ck) codeIn.value = ck.code;
      const up = h('button', { class: 'chip', type: 'button' }, ck ? 'Update cloud save' : 'Upload');
      up.addEventListener('click', () => {
        this.data.profile.save();
        fetch(dataBase(this.settings.data.serverUrl) + '/cloud', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: this.data.profile.exportData(), code: ck?.code, key: ck?.key }) })
          .then((r) => r.json())
          .then((o: { code?: string; key?: string; error?: string }) => {
            if (!o.code) throw new Error(o.error ?? 'failed');
            localStorage.setItem('blackeye.cloud', JSON.stringify({ code: o.code, key: o.key }));
            this.toast(`Cloud save code: ${o.code}`, 'power');
            rebuild();
          })
          .catch((e) => this.toast(`Cloud save failed: ${e.message ?? e}`, 'warn'));
      });
      const down = h('button', { class: 'chip', type: 'button' }, 'Download');
      down.addEventListener('click', () => {
        const code = codeIn.value.trim().toUpperCase();
        fetch(dataBase(this.settings.data.serverUrl) + '/cloud?code=' + encodeURIComponent(code))
          .then((r) => r.json())
          .then((o: { data?: string; error?: string }) => {
            if (!o.data) throw new Error(o.error ?? 'not found');
            if (!confirm('Replace the current slot with the cloud save?')) return;
            if (this.data.profile.importData(o.data)) location.reload();
            else throw new Error('bad save');
          })
          .catch((e) => this.toast(`Cloud download failed: ${e.message ?? e}`, 'warn'));
      });
      panel.append(h('div', { class: 'row' }, h('label', {}, ck ? `Your code: ${ck.code}` : 'Code'), h('span', {}, codeIn, up, down)));
      panel.append(h('div', { class: 'actions' }, this.backButton()));
    };
    this.rebuilders.set('progress', rebuild);
    this.screen('progress', panel);
  }

  // ------------------------------------------------------------ world map

  private mapUrl = '';

  private buildMap() {
    const panel = h('div', { class: 'panel map-panel' });
    let selected: string | null = null;
    const rebuild = () => {
      panel.innerHTML = '';
      const img = this.data.mapImage();
      if (!this.mapUrl) {
        // downscale once: the full bake is 2048², the map panel needs far less
        const c = document.createElement('canvas');
        c.width = c.height = 1024;
        c.getContext('2d')!.drawImage(img.canvas, 0, 0, 1024, 1024);
        this.mapUrl = c.toDataURL('image/jpeg', 0.86);
      }
      panel.append(h('h2', {}, 'World map'), h('p', {}, 'Click an island for details and fast travel. Click open sea to drop a waypoint.'));
      const S = 640;
      const scale = S / img.size;
      const tx = (x: number) => (x - img.minX) * scale;
      const tz = (z: number) => (z - img.minZ) * scale;
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
      svg.setAttribute('class', 'worldmap');
      const el = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
        const e = document.createElementNS(svgNS, tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
        parent.append(e);
        return e;
      };
      const bg = el('image', { href: this.mapUrl, x: 0, y: 0, width: S, height: S, preserveAspectRatio: 'none' });
      bg.addEventListener('click', (ev) => {
        const r = svg.getBoundingClientRect();
        const sx = (((ev as MouseEvent).clientX - r.left) / r.width) * S;
        const sy = (((ev as MouseEvent).clientY - r.top) / r.height) * S;
        this.cb.setWaypoint({ x: img.minX + sx / scale, z: img.minZ + sy / scale });
        this.cb.uiSound();
        rebuild();
      });
      const hub = el('text', { x: tx(0), y: tz(-15) - 30, 'text-anchor': 'middle', class: 'map-label' });
      hub.textContent = 'INK CITY';
      hub.addEventListener('click', () => {
        selected = 'hub';
        rebuild();
      });
      for (const i of this.data.islands()) {
        const known = this.data.discovered(i.id);
        const pct = Math.round(this.data.completion(i.id) * 100);
        if (!known) {
          el('circle', { cx: tx(i.x), cy: tz(i.z), r: i.r * scale + 2, fill: '#2a2a30', 'fill-opacity': 0.93, stroke: '#111114', 'stroke-width': 2 });
          const q = el('text', { x: tx(i.x), y: tz(i.z) + 8, 'text-anchor': 'middle', class: 'map-fog' });
          q.textContent = '?';
        }
        const c = el('circle', { cx: tx(i.x), cy: tz(i.z), r: i.r * scale + 2, fill: 'transparent', stroke: selected === i.id ? '#ff7a1a' : '#111114', 'stroke-width': selected === i.id ? 4 : 2, class: 'map-island' });
        c.addEventListener('click', () => {
          selected = i.id;
          this.cb.uiSound();
          rebuild();
        });
        if (!known) continue;
        // outer-ring labels go under the circle so they never collide with the inner ring's
        const t = el('text', { x: tx(i.x), y: i.outer ? tz(i.z) + i.r * scale + 18 : tz(i.z) - i.r * scale - 8, 'text-anchor': 'middle', class: 'map-label' });
        t.textContent = `${i.name.toUpperCase()} · ${pct}%`;
        t.addEventListener('click', () => {
          selected = i.id;
          rebuild();
        });
      }
      for (const m of this.data.missions()) {
        const isl = this.data.islands().find((i) => i.id === m.def.island);
        if (isl && !this.data.discovered(isl.id)) continue;
        const done = this.data.profile.data.done.includes(m.def.id);
        const d = el('rect', { x: tx(m.x) - 5, y: tz(m.z) - 5, width: 10, height: 10, transform: `rotate(45 ${tx(m.x)} ${tz(m.z)})`, fill: done ? '#ffd27a' : '#17a9a3', stroke: '#111', 'stroke-width': 2 });
        const tip = document.createElementNS(svgNS, 'title');
        tip.textContent = `${m.def.name}${done ? ' ✓' : ''} — ${m.def.desc}`;
        d.append(tip);
      }
      const wp = this.data.waypoint();
      if (wp) {
        const g = el('g', { transform: `translate(${tx(wp.x)} ${tz(wp.z)})`, class: 'map-wp' });
        el('path', { d: 'M0 0 L-7 -12 A8 8 0 1 1 7 -12 Z', fill: '#ff7a1a', stroke: '#111', 'stroke-width': 2 }, g);
        el('circle', { cx: 0, cy: -15, r: 3, fill: '#111' }, g);
        g.addEventListener('click', () => {
          this.cb.setWaypoint(null);
          rebuild();
        });
      }
      const p = this.data.player();
      el('polygon', { points: '0,-11 7,8 0,4 -7,8', transform: `translate(${tx(p.x)} ${tz(p.z)}) rotate(${180 - (p.yaw * 180) / Math.PI})`, fill: '#ff7a1a', stroke: '#111', 'stroke-width': 2 });
      panel.append(svg);
      // island card
      const card = h('div', { class: 'map-card' });
      if (selected) {
        const isl = this.data.islands().find((i) => i.id === selected);
        const known = selected === 'hub' || this.data.discovered(selected);
        const name = isl ? isl.name : 'Ink City';
        const sub = isl ? `${isl.country} · ${isl.blurb}` : 'The plaza · the city is watching';
        card.append(h('b', {}, known ? name : 'Undiscovered island'), h('span', {}, known ? sub : 'Cross a bridge and set foot on it to reveal it.'));
        if (isl && known) {
          const pct = Math.round(this.data.completion(isl.id) * 100);
          card.append(h('div', { class: 'bar comp' }, h('i', { style: `width:${pct}%` })), h('small', {}, `${pct}% complete`));
        }
        const row = h('div', { class: 'row-btns' });
        if (known) row.append(this.button('Fast travel', null, () => this.cb.fastTravel(selected!), 'small primary'));
        if (isl) row.append(this.button('Set waypoint', null, () => {
          this.cb.setWaypoint({ x: isl.x, z: isl.z });
          rebuild();
        }, 'small'));
        card.append(row);
      } else card.append(h('span', {}, 'Select an island.'));
      if (wp) card.append(this.button('Clear waypoint', null, () => {
        this.cb.setWaypoint(null);
        rebuild();
      }, 'small ghost'));
      panel.append(card, h('div', { class: 'actions' }, this.backButton()));
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
          ...((this.boards?.[d.id] ?? []).length ? [h('small', { class: 'lb' }, '🌐 ' + this.boards![d.id].slice(0, 3).map((e, i) => `${i + 1}. ${e.name} ${e.time.toFixed(1)}s`).join('  '))] : []),
          h('em', {}, `+${d.reward} Ink · ${d.time}s${best !== undefined ? ` · best ${best.toFixed(1)}s` : ''}${(() => {
            const m = medalFor(d, best);
            if (m) return ` · ${MEDAL_ICON[m]}`;
            if (!timed(d)) return '';
            const [g] = medalTimes(d);
            return ` · 🥇 under ${g.toFixed(0)}s`;
          })()}`),
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

  private settingsTab = 'graphics';

  private buildSettings() {
    const panel = h('div', { class: 'panel wide settings' });
    const TABS: Array<[string, string]> = [
      ['graphics', 'Graphics'],
      ['picture', 'Picture'],
      ['controls', 'Camera & controls'],
      ['gameplay', 'Gameplay'],
      ['audio', 'Audio'],
      ['access', 'Accessibility'],
      ['privacy', 'Privacy'],
    ];
    const rebuild = () => {
      panel.innerHTML = '';
      const s = this.settings.data;
      const apply = () => {
        this.settings.save();
        this.cb.settingsChanged(this.settings.data);
      };
      panel.append(h('h2', {}, 'Settings'));
      const tabs = h('div', { class: 'tabs', role: 'tablist' });
      for (const [id, label] of TABS) {
        const t = h('button', { class: 'tab' + (this.settingsTab === id ? ' on' : ''), type: 'button', 'data-tab': id }, label);
        t.addEventListener('click', () => {
          this.settingsTab = id;
          this.cb.uiSound();
          rebuild();
          panel.querySelector<HTMLElement>('.tab.on')?.focus({ preventScroll: true });
        });
        tabs.append(t);
      }
      panel.append(tabs, h('div', { class: 'tab-hint' }, 'LB / RB or Q / E to switch tabs'));
      const body = h('div', { class: 'tab-body' });
      panel.append(body);
      const row = (label: string, ...ctl: Array<Node | null>) => body.append(h('div', { class: 'row' }, h('label', {}, label), ...ctl));
      const slider = (label: string, key: keyof SettingsData, min: number, max: number, step: number, fmt = (v: number) => v.toFixed(2)) => {
        const i = h('input', { type: 'range', min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
        i.value = String(s[key]);
        const val = h('span', { class: 'val' }, fmt(Number(s[key])));
        i.addEventListener('input', () => {
          (s as unknown as Record<string, unknown>)[key] = Number(i.value);
          val.textContent = fmt(Number(i.value));
          apply();
        });
        row(label, i, val);
      };
      const check = (label: string, key: keyof SettingsData) => {
        const i = h('input', { type: 'checkbox' }) as HTMLInputElement;
        i.checked = Boolean(s[key]);
        i.addEventListener('change', () => {
          (s as unknown as Record<string, unknown>)[key] = i.checked;
          apply();
        });
        row(label, i);
      };
      const pick = <K extends keyof SettingsData>(label: string, key: K, opts: Array<SettingsData[K]>, names?: string[]) => {
        const cs = h('div', { class: 'chips' });
        opts.forEach((o, n) => {
          const c = h('button', { class: 'chip' + (s[key] === o ? ' on' : ''), type: 'button' }, names?.[n] ?? String(o));
          c.addEventListener('click', () => {
            s[key] = o;
            apply();
            this.cb.uiSound();
            rebuild();
          });
          cs.append(c);
        });
        row(label, cs);
      };
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      const head = (t: string) => body.append(h('h3', {}, t));
      switch (this.settingsTab) {
        case 'graphics': {
          const cs = h('div', { class: 'chips' });
          for (const p of ['low', 'medium', 'high', 'ultra'] as GraphicsPreset[]) {
            const c = h('button', { class: 'chip' + (s.graphics === p ? ' on' : ''), type: 'button' }, p);
            c.addEventListener('click', () => {
              this.settings.applyPreset(p);
              this.cb.settingsChanged(this.settings.data);
              this.cb.uiSound();
              rebuild();
            });
            cs.append(c);
          }
          row('Quality preset', cs);
          pick('Art style', 'artStyle', ['ink', 'realistic'], ['Ink (stylised)', 'Realistic']);
          body.append(h('p', { class: 'hint' }, 'Realistic swaps the black-and-white ink look for natural colours, blue skies, golden sunsets and softer light. Gameplay colours stay the same.'));
          head('RENDERING');
          slider('Resolution scale', 'resolutionScale', 0.5, 2, 0.05, pct);
          check('Dynamic resolution (keeps the frame rate up)', 'dynamicResolution');
          pick('Frame-rate limit', 'fpsCap', [0, 30, 60, 120, 144], ['Unlimited', '30', '60', '120', '144']);
          pick('Anti-aliasing', 'antiAliasing', ['off', 'fxaa', 'smaa'], ['Off', 'FXAA (fast)', 'SMAA (sharp)']);
          slider('View distance', 'viewDistance', 0.5, 1.5, 0.05, pct);
          head('LIGHTING & EFFECTS');
          check('Shadows', 'shadows');
          pick('Shadow quality', 'shadowQuality', ['low', 'medium', 'high', 'ultra']);
          check('Soft shadows', 'softShadows');
          check('Ambient occlusion (GTAO)', 'ao');
          check('Bloom (glowing lights)', 'bloom');
          check('Motion / speed blur', 'motionBlur');
          check('Show FPS', 'showFps');
          check('Play intro cinematic on start', 'playIntro');
          break;
        }
        case 'picture':
          slider('Brightness', 'brightness', -0.25, 0.25, 0.01, (v) => (v >= 0 ? '+' : '') + Math.round(v * 100));
          slider('Contrast', 'contrast', 0.7, 1.4, 0.01, pct);
          slider('Colour saturation', 'saturation', 0, 1.6, 0.01, pct);
          slider('Gamma', 'gamma', 0.7, 1.5, 0.01);
          slider('Film grain', 'filmGrain', 0, 2, 0.05, pct);
          slider('Vignette', 'vignette', 0, 2, 0.05, pct);
          pick('Time of day', 'timeOfDay', ['cycle', 'morning', 'noon', 'dusk', 'night']);
          pick('Weather', 'weather', ['dynamic', 'clear', 'rain', 'fog']);
          body.append(
            this.button('Reset picture', null, () => {
              Object.assign(s, { brightness: 0, contrast: 1, saturation: 1, gamma: 1, filmGrain: 1, vignette: 1 });
              apply();
              rebuild();
            }, 'small'),
          );
          break;
        case 'controls':
          head('CAMERA');
          slider('Field of view (3rd person)', 'fov', 55, 100, 1, (v) => v.toFixed(0));
          slider('Field of view (1st person)', 'fpFov', 70, 110, 1, (v) => v.toFixed(0));
          slider('Camera distance', 'cameraDistance', 0.7, 1.6, 0.05, pct);
          slider('Camera smoothing', 'cameraSmoothing', 0, 0.9, 0.05, (v) => (v < 0.01 ? 'off' : pct(v)));
          check('Camera follows behind you', 'autoCamera');
          check('First person view', 'firstPerson');
          slider('Camera shake', 'cameraShake', 0, 1, 0.05, pct);
          slider('First-person head bob', 'headBob', 0, 1, 0.05, pct);
          check('Cinematic slow-mo moments', 'cinematicEvents');
          head('MOUSE');
          slider('Mouse sensitivity', 'sensitivity', 0.2, 3, 0.05);
          check('Invert Y (look up/down)', 'invertY');
          check('Invert X (look left/right)', 'invertX');
          head('CONTROLLER');
          slider('Stick sensitivity', 'padSensitivity', 0.2, 3, 0.05);
          slider('Stick dead zone', 'deadzone', 0.04, 0.4, 0.01, pct);
          slider('Vibration', 'vibration', 0, 1, 0.05, (v) => (v < 0.01 ? 'off' : pct(v)));
          slider('Aim assist (weapons)', 'aimAssist', 0, 1, 0.05, (v) => (v < 0.01 ? 'off' : pct(v)));
          check('Toggle sprint (tap instead of hold)', 'sprintToggle');
          body.append(this.button('Key bindings…', null, () => this.show('controls', 'settings'), 'small'));
          break;
        case 'gameplay': {
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
          row('Difficulty', dchips);
          check('Simple parkour (auto-vault)', 'simpleParkour');
          check('Agents roam in Free Roam', 'freeRoamAgents');
          check('Show mini-map', 'minimap');
          check('Mini-map rotates with the camera', 'minimapRotate');
          check('On-screen objective markers', 'objectiveMarkers');
          break;
        }
        case 'audio':
          slider('Master volume', 'masterVolume', 0, 1, 0.05, pct);
          slider('Music', 'musicVolume', 0, 1, 0.05, pct);
          slider('Effects', 'sfxVolume', 0, 1, 0.05, pct);
          slider('Ambience (birds, wind, water, city)', 'ambienceVolume', 0, 1, 0.05, pct);
          slider('Voices', 'voiceVolume', 0, 1, 0.05, pct);
          check('Spoken voice lines', 'voice');
          check('Recorded soundtrack (when installed)', 'recordedMusic');
          break;
        case 'access':
          pick('Colour-blind filter', 'colorblind', ['off', 'protanopia', 'deuteranopia', 'tritanopia']);
          slider('Interface scale', 'uiScale', 0.75, 1.5, 0.05, pct);
          check('Subtitles for voice lines and logs', 'subtitles');
          check('High-contrast HUD', 'highContrast');
          check('Reduce flashes', 'reduceFlashes');
          check('Toggle sprint (tap instead of hold)', 'sprintToggle');
          break;
        case 'privacy':
          check('Share anonymous play statistics', 'analytics');
          body.append(
            h('p', { class: 'hint' }, 'Helps us balance the game: session length, missions played, crashes. No name, email or IP address is stored. Turning this off stops all statistics immediately.'),
            this.button('Read the privacy policy', null, () => this.cb.openPage('privacy'), 'small'),
          );
          break;
      }
      panel.append(h('div', { class: 'actions' }, this.backButton()));
    };
    this.settingsTabStep = (dir: number) => {
      const i = TABS.findIndex((t) => t[0] === this.settingsTab);
      this.settingsTab = TABS[(i + dir + TABS.length) % TABS.length][0];
      this.cb.uiSound();
      rebuild();
      panel.querySelector<HTMLElement>('.tab.on')?.focus({ preventScroll: true });
    };
    this.rebuilders.set('settings', rebuild);
    this.screen('settings', panel);
  }

  /** Step the settings tabs (LB/RB, Q/E). */
  settingsTabStep: (dir: number) => void = () => {};

  // ------------------------------------------------------------ checkpoint banner

  private cpEl: HTMLElement | null = null;
  private cpTimer = 0;

  /** "CHECKPOINT CLEARED": an ink splash slams in, the label writes on, then it drips away. */
  checkpointBanner(label: string, detail: string) {
    if (!this.cpEl) {
      this.cpEl = h('div', { class: 'cp-banner' });
      this.root.append(this.cpEl);
    }
    const el = this.cpEl;
    el.innerHTML = `<svg class="cp-splash" viewBox="0 0 600 160" aria-hidden="true"><path d="M30 80 C20 30 120 18 180 34 C230 6 330 10 380 30 C440 8 560 22 572 70 C596 110 540 142 470 134 C420 156 330 150 280 138 C220 158 120 152 80 132 C20 128 -2 104 30 80 Z" fill="#111114"/><circle cx="560" cy="30" r="9" fill="#111114"/><circle cx="28" cy="132" r="6" fill="#111114"/><circle cx="590" cy="120" r="5" fill="#111114"/><path d="M180 140 q4 18 -2 26" stroke="#111114" stroke-width="7" fill="none" stroke-linecap="round"/><path d="M420 140 q-3 12 2 20" stroke="#111114" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`;
    const text = h('div', { class: 'cp-text' }, h('div', { class: 'cp-title' }, 'CHECKPOINT CLEARED'), h('div', { class: 'cp-label' }, label), h('div', { class: 'cp-detail' }, detail));
    el.append(text);
    el.classList.remove('show', 'out');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.cpTimer);
    this.cpTimer = window.setTimeout(() => el.classList.add('out'), 2900);
  }

  private saveEl: HTMLElement | null = null;

  /** Small spinning-eye "saving" indicator (autosave). */
  savingBlip() {
    if (!this.saveEl) {
      this.saveEl = h('div', { class: 'save-blip', html: `${EYE_SVG}<span>Saved</span>` });
      this.root.append(this.saveEl);
    }
    const el = this.saveEl;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ------------------------------------------------------------ campaign map

  private buildCampaign() {
    const panel = h('div', { class: 'panel wide campaign' });
    const rebuild = () => {
      panel.innerHTML = '';
      const story = this.data.profile.data.story;
      const nodes = campaignNodes(story);
      const done = nodes.filter((n) => n.state === 'done').length;
      const finished = done === nodes.length;
      panel.append(
        h('h2', {}, 'Campaign'),
        h('p', {}, finished ? 'The Eyes are closed. Replay any mission, or roam the free city.' : `Mission ${done + 1} of ${nodes.length}. Missions unlock one after another; the last is the Final.`),
        h('div', { class: 'cmp-bar' }, h('i', { style: `width:${Math.round((done / nodes.length) * 100)}%` })),
      );
      const path = h('div', { class: 'cmp-path' });
      let chapter = -1;
      for (const n of nodes) {
        if (n.chapter !== chapter) {
          chapter = n.chapter;
          path.append(h('div', { class: 'cmp-chapter' }, CHAPTERS[chapter].title));
        }
        const node = h('button', { class: `cmp-node ${n.state}${n.final ? ' final' : ''}`, type: 'button' }, h('span', { class: 'cmp-dot' }, n.state === 'done' ? '✓' : n.final ? '★' : String(n.n)), h('span', { class: 'cmp-txt' }, h('b', {}, n.label), h('small', {}, n.title)));
        if (n.state === 'locked') node.setAttribute('aria-disabled', 'true');
        node.addEventListener('click', () => {
          if (n.state === 'locked') {
            this.toast('Clear the missions before it first.', 'info');
            return;
          }
          if (n.state === 'current') this.cb.playCampaign();
          else if (n.missionId) this.cb.startMission(n.missionId);
          else this.toast('Story step — replay it by restarting the campaign.', 'info');
        });
        path.append(node);
      }
      panel.append(path);
      requestAnimationFrame(() => {
        const cur = path.querySelector<HTMLElement>('.cmp-node.current');
        if (!cur) return;
        path.scrollTop = cur.offsetTop - path.clientHeight / 2;
        cur.focus({ preventScroll: true });
      });
      panel.append(
        h(
          'div',
          { class: 'actions' },
          this.button(finished ? 'Free run' : done ? 'Play next mission' : 'Start Mission 1', null, () => (finished ? this.cb.play('free') : this.cb.playCampaign()), 'primary'),
          finished ? this.button('Watch the credits', null, () => this.rollCredits()) : null,
          this.button('Restart campaign', null, () => {
            if (confirm('Start the story over from Mission 1? Your items, levels and Ink stay.')) {
              this.cb.restartCampaign();
              rebuild();
            }
          }),
          this.backButton(),
        ),
      );
    };
    this.rebuilders.set('campaign', rebuild);
    this.screen('campaign', panel);
  }

  // ------------------------------------------------------------ credits

  private creditsEl: HTMLElement | null = null;

  /** Scrolling end credits (text from the Credits page; B / Esc / click skips). */
  rollCredits(onDone?: () => void) {
    const page = this.pages.credits ?? { title: 'Credits', body: 'BLACKEYE: Ink City' };
    this.creditsEl?.remove();
    const roll = h('div', { class: 'credits-roll' });
    roll.append(h('div', { class: 'logo', html: `BLACK${EYE_SVG}EYE` }), h('div', { class: 'credits-sub' }, 'INK CITY'));
    for (const raw of page.body.split('\n')) {
      const line = raw.trim();
      if (!line) roll.append(h('div', { class: 'gap' }));
      else if (line.startsWith('# ')) roll.append(h('h3', {}, line.slice(2)));
      else roll.append(h('p', {}, line.replace(/^- /, '')));
    }
    roll.append(h('div', { class: 'gap' }), h('h3', {}, 'Thank you for playing'));
    const el = h('div', { class: 'credits' }, roll, h('div', { class: 'credits-skip' }, 'B / Esc / click to skip'));
    this.root.append(el);
    this.creditsEl = el;
    const end = () => {
      if (!el.isConnected) return;
      el.classList.add('out');
      window.removeEventListener('keydown', key, true);
      setTimeout(() => el.remove(), 600);
      onDone?.();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        end();
      }
    };
    window.addEventListener('keydown', key, true);
    el.addEventListener('click', end);
    const dur = Math.max(30, roll.childElementCount * 1.3);
    roll.style.animationDuration = `${dur}s`;
    roll.addEventListener('animationend', end);
    const pad = setInterval(() => {
      if (!el.isConnected) return clearInterval(pad);
      const gp = navigator.getGamepads?.() ?? [];
      if (Array.from(gp).some((p) => p?.buttons[1]?.pressed)) end();
    }, 120);
  }

  // ------------------------------------------------------------ info pages

  /** Info pages (privacy, terms, credits, …). The owner panel can override the text. */
  pages: Record<string, { title: string; body: string }> = {};
  private pageBox!: HTMLElement;

  private buildPage() {
    this.pageBox = h('div', { class: 'page-body' });
    this.screen('page', h('div', { class: 'panel wide' }, this.pageBox, h('div', { class: 'actions' }, this.backButton())));
  }

  /** Show an info page. Text is "markdown-lite": # heading, - bullet, blank line = paragraph. */
  openPage(id: string) {
    const page = this.pages[id] ?? { title: 'Not available', body: 'This page has not been written yet.' };
    const box = this.pageBox;
    box.innerHTML = '';
    box.append(h('h2', {}, page.title));
    let list: HTMLElement | null = null;
    for (const raw of page.body.split('\n')) {
      const line = raw.trim();
      if (!line) {
        list = null;
        continue;
      }
      if (line.startsWith('# ')) {
        list = null;
        box.append(h('h3', {}, line.slice(2)));
      } else if (line.startsWith('- ')) {
        if (!list) box.append((list = h('ul')));
        list.append(h('li', {}, line.slice(2)));
      } else {
        list = null;
        box.append(h('p', {}, line));
      }
    }
    this.show('page', this.current === 'page' ? undefined : this.current);
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
    const url = h('input', { type: 'text', placeholder: apiBase() || 'auto (this server)' }) as HTMLInputElement;
    url.value = s.serverUrl;
    const pass = h('input', { type: 'password', placeholder: 'optional — set it to make a private room' }) as HTMLInputElement;
    pass.value = s.roomPass ?? '';
    // invite links prefill the room (and password)
    const qp = new URLSearchParams(location.search);
    if (qp.get('room')) room.value = qp.get('room')!;
    if (qp.get('pass')) pass.value = qp.get('pass')!;
    const invite = this.button('Copy invite link', null, () => {
      const link = `${webBase(url.value)}/?room=${encodeURIComponent(room.value)}${pass.value ? `&pass=${encodeURIComponent(pass.value)}` : ''}`;
      void navigator.clipboard?.writeText(link).then(
        () => this.toast('Invite link copied', 'info'),
        () => this.toast(link, 'info'),
      );
    }, 'small');
    this.onlineStatus = h('div', { class: 'status' });
    // region picker (when the build lists several servers): pings each, best first
    const regionRow = h('div', { class: 'chips' });
    const regionList = regions();
    const pingRegions = () => {
      regionRow.innerHTML = '';
      for (const r of regionList) {
        const c = h('button', { class: 'chip' + (url.value === r.url ? ' on' : ''), type: 'button' }, `${r.name} · …`);
        c.addEventListener('click', () => {
          url.value = r.url;
          this.settings.set('serverUrl', r.url);
          this.cb.uiSound();
          pingRegions();
          refresh();
        });
        regionRow.append(c);
        void measurePing(r.url).then((ms) => (c.textContent = `${r.name} · ${ms === null ? 'offline' : ms + ' ms'}`));
      }
    };
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
    this.rebuilders.set('online', () => {
      if (regionList.length) pingRegions();
      refresh();
    });
    const connect = this.button('Connect', null, () => {
      this.settings.set('name', name.value);
      this.settings.set('room', room.value);
      this.settings.set('serverUrl', url.value);
      this.settings.set('roomPass', pass.value);
      this.cb.connect(name.value, room.value, url.value);
    }, 'primary');
    const disconnect = this.button('Disconnect', null, () => this.cb.disconnect());
    this.screen(
      'online',
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Multiplayer'),
        h('p', {}, 'Join a room by name. Everyone in a room shares the whole world: co-op against the Agents, PvP brawls, and racing each other in cars. Pick the region closest to you for the lowest ping.'),
        h('div', { class: 'row' }, h('label', {}, 'Name'), name),
        h('div', { class: 'row' }, h('label', {}, 'Room'), room),
        h('div', { class: 'row' }, h('label', {}, 'Password'), pass),
        regionList.length ? h('div', { class: 'row' }, h('label', {}, 'Region'), regionRow) : null,
        h('div', { class: 'row' }, h('label', {}, 'Server URL'), url),
        h('div', { class: 'row' }, h('label', {}, 'Party'), invite),
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
        h('p', {}, 'You are a Blank: you drew your own face, so the city\'s eyes can see you. Seventeen floating islands — from Colombo, Galle and Sigiriya to the wonders of the world, and the huge Ink Metropolis downtown — orbit Ink City. Catch burning Eyes for powers, earn Ink from missions and Agents, drive the bridges, and keep moving: chaining parkour and hits fills your Flow.'),
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
    E.weapon = h('div', { class: 'weapon-chip' });
    E.bossFill = h('div', { class: 'boss-fill' });
    E.bossName = h('div', { class: 'boss-name' });
    E.boss = h('div', { class: 'boss-bar hidden' }, E.bossName, h('div', { class: 'boss-track' }, E.bossFill));
    hud.append(E.boss);
    hud.append(h('div', { class: 'hud-bl' }, h('div', { class: 'hud-label' }, 'INK'), E.hpBar, h('div', { class: 'bar stam' }, E.st), E.weapon, E.cons));
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
    E.lvl = h('b');
    E.xp = h('i');
    E.level = h('div', { class: 'level-badge' }, E.lvl, h('div', { class: 'xpbar' }, E.xp));
    E.wanted = h('div', { class: 'wanted' });
    hud.append(h('div', { class: 'hud-tr-wrap' }, h('div', { class: 'tr-row' }, E.level, E.ink), E.wanted, E.tr, this.minimap.el));
    E.sub = h('div', { class: 'subtitle' });
    hud.append(E.sub);
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
    hud.append(this.playersBox, this.fx.el);
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

  private subTimer = 0;

  /** Bottom-centre subtitle line (audio logs, story, voice lines). */
  subtitle(text: string, seconds = 5) {
    const el = this.hudEls.sub;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.subTimer);
    this.subTimer = window.setTimeout(() => el.classList.remove('show'), seconds * 1000);
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
    E.boss.classList.toggle('hidden', !d.boss);
    if (d.boss) {
      E.bossName.textContent = d.boss.name.toUpperCase();
      E.bossFill.style.width = `${Math.max(0, d.boss.frac) * 100}%`;
    }
    const wkey = `${d.weapon.name}|${d.weapon.ammo}`;
    if (E.weapon.dataset.k !== wkey) {
      E.weapon.dataset.k = wkey;
      E.weapon.className = 'weapon-chip' + (d.weapon.empty ? ' empty' : '');
      E.weapon.innerHTML = `<b>${d.weapon.key}</b>${d.weapon.name}<span>${d.weapon.ammo}</span><i>Z switch</i>`;
    }
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
    E.lvl.textContent = `LV ${d.level}`;
    E.xp.style.width = `${d.xpFrac * 100}%`;
    if (E.wanted.dataset.n !== String(d.wanted)) {
      E.wanted.dataset.n = String(d.wanted);
      E.wanted.innerHTML = d.wanted ? Array.from({ length: 5 }, (_, i) => `<span class="${i < d.wanted ? 'on' : ''}">★</span>`).join('') : '';
    }
    E.tr.textContent = [d.showFps ? `${d.fps.toFixed(0)} fps` : '', d.net].filter(Boolean).join(' · ');
    E.cross.style.display = (d.firstPerson || d.grappleAim) && !d.vehicle ? 'block' : 'none';
    E.cross.classList.toggle('grapple', d.grappleAim);
    E.ko.classList.toggle('show', d.ko);
    E.click.classList.toggle('show', d.pointerHint);
    E.prompt.textContent = d.prompt ? (d.pad ? padPrompt(d.prompt) : d.prompt) : '';
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

/** The story as a numbered campaign: the prologue is Mission 1, then one mission per story step, ending in the Final. */
export interface CampaignNode {
  n: number;
  chapter: number;
  /** Story steps covered (prologue = all of chapter 1). */
  steps: [number, number];
  label: string;
  title: string;
  missionId?: string;
  final: boolean;
  state: 'done' | 'current' | 'locked';
}

export function campaignNodes(story: { chapter: number; step: number }): CampaignNode[] {
  const out: CampaignNode[] = [];
  let n = 1;
  CHAPTERS.forEach((ch, ci) => {
    if (ci === 0) {
      out.push({ n: n++, chapter: 0, steps: [0, ch.steps.length - 1], label: 'Mission 1', title: 'Prologue · ' + ch.title.replace(/^Chapter \d+ · /, ''), final: false, state: 'locked' });
      return;
    }
    ch.steps.forEach((st, si) => {
      out.push({ n: n++, chapter: ci, steps: [si, si], label: '', title: st.text, missionId: st.step.kind === 'mission' ? st.step.id : undefined, final: false, state: 'locked' });
    });
  });
  const last = out[out.length - 1];
  last.final = true;
  for (const node of out) {
    node.label = node.final ? 'FINAL' : `Mission ${node.n}`;
    const before = story.chapter > node.chapter || (story.chapter === node.chapter && story.step > node.steps[1]);
    const at = story.chapter === node.chapter && story.step >= node.steps[0] && story.step <= node.steps[1];
    node.state = before ? 'done' : at ? 'current' : 'locked';
  }
  return out;
}
