import { ACTION_LABELS, Action, Input, prettyCode } from '../core/Input';
import { GraphicsPreset, Settings, SettingsData } from '../core/Settings';
import { Appearance, BodyType, COLOR_SLOT_LABELS, ColorSlot, FaceStyle, HatStyle, PRESETS } from '../character/Appearance';
import type { EyeType } from '../world/City';
import { FLOW_TIERS } from '../player/Player';

export type ScreenName = 'main' | 'pause' | 'customize' | 'settings' | 'controls' | 'online' | 'help' | 'none';

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
}

export interface HudData {
  health: number;
  stamina: number;
  flow: number;
  flowTier: number;
  eyes: Record<EyeType, number>;
  selected: EyeType;
  objective: { text: string; hint?: string; progress: string } | null;
  fps: number;
  showFps: boolean;
  net: string;
  firstPerson: boolean;
  ko: boolean;
  pointerHint: boolean;
}

const EYE_SVG = `<svg viewBox="0 0 100 60" xmlns="http://www.w3.org/2000/svg"><path d="M4 30 Q50 -14 96 30 Q50 74 4 30 Z" fill="#f6f5f2" stroke="#111114" stroke-width="7"/><circle cx="50" cy="30" r="15" fill="#ff7a1a"/><circle cx="50" cy="30" r="7" fill="#111114"/><circle cx="45" cy="25" r="3" fill="#fff"/></svg>`;

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
  current: ScreenName = 'main';
  private back: ScreenName = 'main';
  private hud!: HTMLElement;
  private hudEls: Record<string, HTMLElement> = {};
  private toastBox!: HTMLElement;
  private chatBox!: HTMLElement;
  private chatInput!: HTMLInputElement;
  private onlineStatus!: HTMLElement;
  private playersBox!: HTMLElement;
  inGame = false;
  online = false;

  constructor(root: HTMLElement, private settings: Settings, private input: Input, private cb: UICallbacks) {
    this.root = root;
    this.buildMain();
    this.buildPause();
    this.buildCustomize();
    this.buildSettings();
    this.buildControls();
    this.buildOnline();
    this.buildHelp();
    this.buildHud();
    this.show('main');
  }

  // ------------------------------------------------------------ navigation

  show(name: ScreenName, back?: ScreenName) {
    if (back) this.back = back;
    for (const [n, el] of this.screens) el.classList.toggle('show', n === name);
    this.current = name;
    if (name === 'controls') this.renderBindings();
    this.cb.screenChanged(name);
    const first = this.screens.get(name)?.querySelector<HTMLElement>('button, input, select');
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

  // ------------------------------------------------------------ main / pause

  private buildMain() {
    const logo = h('div', { class: 'logo', html: `BLACK${EYE_SVG}EYE` });
    this.screen(
      'main',
      h(
        'div',
        { class: 'menu-left' },
        logo,
        h('div', { class: 'tagline' }, 'INK CITY · THE CITY IS WATCHING'),
        this.button('Ink Run', 'Story route: chase, fight, catch the burning Eyes', () => this.cb.play('story'), 'primary'),
        this.button('Free Roam', 'No Agents. Just you, the parkour and the city', () => this.cb.play('free')),
        this.button('Multiplayer', 'Co-op brawl and PvP in shared rooms', () => this.show('online', 'main')),
        this.button('Customize', 'Beanie, jacket, patches, colours, face', () => this.show('customize', 'main')),
        this.button('Settings', null, () => this.show('settings', 'main')),
        this.button('Controls', null, () => this.show('controls', 'main')),
        this.button('How to play', null, () => this.show('help', 'main')),
        h('div', { class: 'foot' }, 'Prototype build · Three.js + Rapier · Click the game to lock the mouse'),
      ),
    );
  }

  private buildPause() {
    this.screen(
      'pause',
      h(
        'div',
        { class: 'menu-left' },
        h('div', { class: 'logo', html: `PAUSED` }),
        h('div', { class: 'tagline' }, 'THE CITY WAITS'),
        this.button('Resume', null, () => this.cb.resume(), 'primary'),
        this.button('Customize', null, () => this.show('customize', 'pause')),
        this.button('Settings', null, () => this.show('settings', 'pause')),
        this.button('Controls', null, () => this.show('controls', 'pause')),
        this.button('How to play', null, () => this.show('help', 'pause')),
        this.button('Quit to menu', null, () => this.cb.quit()),
      ),
    );
  }

  // ------------------------------------------------------------ customize

  private buildCustomize() {
    const panel = h('div', { class: 'panel' });
    const rebuild = () => {
      panel.innerHTML = '';
      const a = this.settings.data.appearance;
      const commit = () => {
        this.settings.set('appearance', a);
        this.cb.appearanceChanged(a);
      };
      panel.append(h('h2', {}, 'Customize'), h('p', {}, 'Every Blank draws their own look. Changes apply instantly and sync to other players.'));
      panel.append(h('h3', {}, 'PRESETS'));
      const presets = h('div', { class: 'chips' });
      for (const [name, p] of Object.entries(PRESETS)) {
        const c = h('button', { class: 'chip', type: 'button' }, name);
        c.addEventListener('click', () => {
          this.settings.set('appearance', structuredClone(p));
          this.cb.appearanceChanged(this.settings.data.appearance);
          this.cb.uiSound();
          rebuild();
        });
        presets.append(c);
      }
      const rnd = h('button', { class: 'chip', type: 'button' }, '🎲 Randomize');
      rnd.addEventListener('click', () => {
        const rand = () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
        for (const k of ['beanie', 'jacket', 'shirt', 'pants', 'shoes', 'patchA', 'patchB'] as ColorSlot[]) a.colors[k] = rand();
        a.hat = (['beanie', 'cap', 'none'] as HatStyle[])[Math.floor(Math.random() * 3)];
        a.face = (['deadpan', 'sleepy', 'cheeky'] as FaceStyle[])[Math.floor(Math.random() * 3)];
        commit();
        rebuild();
      });
      presets.append(rnd);
      panel.append(presets);

      const choice = <T extends string>(label: string, options: T[], get: () => T, set: (v: T) => void) => {
        const row = h('div', { class: 'row' }, h('label', {}, label));
        const chips = h('div', { class: 'chips' });
        for (const o of options) {
          const c = h('button', { class: 'chip' + (get() === o ? ' on' : ''), type: 'button' }, o);
          c.addEventListener('click', () => {
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
      panel.append(h('h3', {}, 'STYLE'));
      choice('Hat', ['beanie', 'cap', 'none'] as HatStyle[], () => a.hat, (v) => (a.hat = v));
      choice('Face', ['sleepy', 'deadpan', 'cheeky', 'none'] as FaceStyle[], () => a.face, (v) => (a.face = v));
      choice('Body', ['slim', 'standard', 'bulky'] as BodyType[], () => a.body, (v) => (a.body = v));
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
      toggle('Chain necklace', () => a.chain, (v) => (a.chain = v));
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
      panel.append(h('div', { class: 'actions' }, this.backButton()));
    };
    rebuild();
    this.screen('customize', panel);
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
      check('Shadows', 'shadows');
      check('Bloom', 'bloom');
      check('Ambient occlusion (GTAO)', 'ao');
      check('Show FPS', 'showFps');
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
      panel.append(h('h3', {}, 'AUDIO'));
      slider('Master volume', 'masterVolume', 0, 1, 0.05);
      slider('Music', 'musicVolume', 0, 1, 0.05);
      slider('Effects', 'sfxVolume', 0, 1, 0.05);
      panel.append(h('div', { class: 'actions' }, this.backButton()));
    };
    rebuild();
    this.screen('settings', panel);
    this.settings.onChange(() => {
      if (this.current !== 'settings') rebuild();
    });
  }

  // ------------------------------------------------------------ controls

  private bindTable!: HTMLElement;

  private buildControls() {
    this.bindTable = h('div');
    const reset = this.button('Reset to defaults', null, () => {
      this.input.resetBindings();
      this.renderBindings();
    });
    this.screen(
      'controls',
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'Controls'),
        h('p', {}, 'Click a key to rebind it, then press the new key or mouse button. Gamepads use the standard Xbox layout (A jump, X light, Y heavy, RB grab, LB dodge, RT power, B slide, d-pad ↓ view).'),
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
          // wait a tick so this click is not captured as the binding
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
        h('p', {}, 'Join a room by name. Everyone in the same room shares the city: co-op against the Agents and PvP brawling. Start the server with "npm run server" (dev) or "npm start" (production).'),
        h('div', { class: 'row' }, h('label', {}, 'Name'), name),
        h('div', { class: 'row' }, h('label', {}, 'Room'), room),
        h('div', { class: 'row' }, h('label', {}, 'Server URL'), url),
        this.onlineStatus,
        h('div', { class: 'actions' }, connect, disconnect, this.backButton()),
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
    add('WASD', 'Move (camera-relative)');
    add('Mouse', 'Look · click to lock the mouse');
    add('Shift', 'Sprint');
    add('Space', 'Jump · vault/mantle at ledges · wall-run beside walls · Space again to wall-kick');
    add('C', 'Slide while running · roll on landing · surf the purple goo');
    add('LMB', 'Light combo (jab, cross, kick) · air kick');
    add('RMB', 'Tackle when sprinting (smashes cracked walls) · uppercut · stomp in the air');
    add('Q / Alt', 'Dodge (invulnerable for a moment)');
    add('E', 'Use Eye power: Fire = dash · Sky = hold to charge super-jump · Void = blink');
    add('1 2 3', 'Select Fire / Sky / Void Eye');
    add('V', 'Toggle first / third person');
    add('G', 'Emote');
    add('Esc / P', 'Pause');
    add('Enter', 'Chat (multiplayer)');
    this.screen(
      'help',
      h(
        'div',
        { class: 'panel' },
        h('h2', {}, 'How to play'),
        h('p', {}, 'You are a Blank: you drew your own face, so the city\'s eyes can see you. Faceless Agents hunt you. Keep moving — chaining parkour and hits fills your Flow (the eye at the top). Burning Eyes hover on nests and fly to you when your Flow is hot: catch one to absorb its power.'),
        keys,
        h('div', { class: 'actions' }, this.backButton()),
      ),
    );
  }

  // ------------------------------------------------------------ HUD

  private buildHud() {
    const hud = h('div', { id: 'hud' });
    this.hud = hud;
    const E = this.hudEls;
    E.hp = h('i');
    E.hpBar = h('div', { class: 'bar hp' }, E.hp);
    E.st = h('i');
    hud.append(h('div', { class: 'hud-bl' }, h('div', { class: 'hud-label' }, 'INK'), E.hpBar, h('div', { class: 'bar stam' }, E.st)));
    const slots = h('div', { class: 'hud-br' });
    const colors: Record<EyeType, string> = { fire: '#ff7a1a', sky: '#7fd8ff', void: '#8a4dff' };
    (['fire', 'sky', 'void'] as EyeType[]).forEach((t, i) => {
      const n = h('span', { class: 'n' }, '0');
      const slot = h('div', { class: 'eye-slot', style: `--c:${colors[t]}` }, h('div', { class: 'ico' }), n, h('span', { class: 'k' }, String(i + 1)));
      E['slot_' + t] = slot;
      E['n_' + t] = n;
      slots.append(slot);
    });
    hud.append(slots);
    E.flowI = h('i');
    E.flowName = h('div', { class: 'flow-name' }, 'COLD');
    hud.append(h('div', { class: 'hud-top' }, h('div', { class: 'flow-eye' }, E.flowI), E.flowName));
    E.objP = h('div', { class: 'p' });
    E.objT = h('div', { class: 't' });
    E.objH = h('div', { class: 'h' });
    E.obj = h('div', { class: 'obj' }, E.objP, E.objT, E.objH);
    hud.append(h('div', { class: 'hud-tl' }, E.obj));
    E.tr = h('div', { class: 'hud-tr' });
    hud.append(E.tr);
    E.cross = h('div', { class: 'crosshair' });
    hud.append(E.cross);
    E.ko = h('div', { id: 'ko' }, 'REDRAWING…');
    hud.append(E.ko);
    E.click = h('div', { class: 'hint-click' }, 'Click to lock the mouse and look around');
    hud.append(E.click);
    this.toastBox = h('div', { id: 'toasts' });
    hud.append(this.toastBox);
    this.chatInput = h('input', { type: 'text', maxlength: '140', placeholder: 'Say something… (Enter to send, Esc to cancel)' }) as HTMLInputElement;
    this.chatBox = h('div', { id: 'chat' });
    hud.append(this.chatBox, this.chatInput);
    Object.assign(this.chatInput.style, { position: 'absolute', left: '20px', bottom: '90px', width: 'min(360px, 60vw)', display: 'none', pointerEvents: 'auto', padding: '6px 8px', background: 'rgba(17,17,20,0.85)', color: '#eceae6', border: '1px solid rgba(236,234,230,0.16)', borderRadius: '3px' });
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
    for (const t of ['fire', 'sky', 'void'] as EyeType[]) {
      E['n_' + t].textContent = String(d.eyes[t]);
      E['slot_' + t].classList.toggle('sel', d.selected === t);
      E['slot_' + t].classList.toggle('empty', d.eyes[t] <= 0);
    }
    if (d.objective) {
      E.obj.style.display = '';
      E.objP.textContent = 'OBJECTIVE ' + d.objective.progress;
      E.objT.textContent = d.objective.text;
      E.objH.textContent = d.objective.hint ?? '';
    } else E.obj.style.display = 'none';
    E.tr.textContent = [d.showFps ? `${d.fps.toFixed(0)} fps` : '', d.net].filter(Boolean).join(' · ');
    E.cross.style.display = d.firstPerson ? 'block' : 'none';
    E.ko.classList.toggle('show', d.ko);
    E.click.classList.toggle('show', d.pointerHint);
  }
}
