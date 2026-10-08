/**
 * Unified input layer: keyboard, mouse (pointer lock) and gamepad all map to
 * abstract actions. Presses are buffered so a fixed-step simulation never
 * misses them (this is also our jump/attack input buffer).
 */

export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'sprint' | 'crouch'
  | 'light' | 'heavy' | 'grab' | 'dodge'
  | 'power' | 'nextPower' | 'prevPower'
  | 'power1' | 'power2' | 'power3' | 'power4' | 'power5' | 'power6' | 'power7'
  | 'throwBomb' | 'heal' | 'smoke' | 'summon' | 'map' | 'inventory'
  | 'toggleView' | 'emote' | 'pause' | 'chat' | 'scoreboard' | 'mapZoom'
  | 'weapon' | 'nextWeapon' | 'grapple' | 'photo' | 'mark' | 'creator';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  jump: 'Jump / Wall-run / Vault', sprint: 'Sprint', crouch: 'Crouch / Slide / Roll',
  light: 'Light attack', heavy: 'Heavy attack / Tackle', grab: 'Interact (vehicle, mission, talk)', dodge: 'Dodge',
  power: 'Use Eye power', nextPower: 'Next Eye power', prevPower: 'Previous Eye power',
  power1: 'Fire Eye (dash)', power2: 'Sky Eye (super-jump)', power3: 'Void Eye (blink)',
  power4: 'Iron Eye (wrecking charge)', power5: 'Tide Eye (paint path)', power6: 'Watcher Eye (reveal)', power7: 'BLACKEYE (ink storm)',
  throwBomb: 'Throw Ink Bomb', heal: 'Use Fresh Ink (heal)', smoke: 'Smudge Cloud', summon: 'Summon vehicle', map: 'World map', inventory: 'Inventory',
  toggleView: 'Toggle 1st / 3rd person', emote: 'Emote', pause: 'Pause menu', chat: 'Chat', scoreboard: 'Players', mapZoom: 'Mini-map zoom',
  weapon: 'Use weapon (fire / throw / swing)', nextWeapon: 'Switch weapon', grapple: 'Grapple hook (aim with the camera)', photo: 'Photo mode', mark: 'Ping / mark a spot', creator: 'Creator mode (build courses)',
};

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  jump: ['Space'], sprint: ['ShiftLeft'], crouch: ['KeyC', 'ControlLeft'],
  light: ['Mouse0'], heavy: ['Mouse2'], grab: ['KeyF'], dodge: ['AltLeft', 'KeyQ'],
  power: ['KeyE'], nextPower: ['WheelDown'], prevPower: ['WheelUp'],
  power1: ['Digit1'], power2: ['Digit2'], power3: ['Digit3'], power4: ['Digit4'], power5: ['Digit5'], power6: ['Digit6'], power7: ['Digit7'],
  throwBomb: ['KeyR'], heal: ['KeyH'], smoke: ['KeyX'], summon: ['KeyB'], map: ['KeyM'], inventory: ['KeyI'],
  toggleView: ['KeyV'], emote: ['KeyG'], pause: ['Escape', 'KeyP'], chat: ['Enter'], scoreboard: ['Tab'], mapZoom: ['KeyN'],
  weapon: ['KeyT', 'Mouse1'], nextWeapon: ['KeyZ'], grapple: ['KeyY', 'Mouse3'], photo: ['KeyK'], mark: ['KeyJ', 'Mouse4'], creator: ['KeyL'],
};

/** Standard gamepad mapping (Xbox layout). */
const PAD_BUTTONS: Partial<Record<Action, number[]>> = {
  jump: [0], crouch: [1], light: [2], heavy: [3], grab: [5], dodge: [4],
  power: [7], sprint: [10], toggleView: [13], emote: [12], pause: [9], scoreboard: [8],
  prevPower: [14], nextPower: [15], weapon: [6], nextWeapon: [11],
};

const BUFFER_TIME = 0.18;
const STORAGE_KEY = 'blackeye.bindings.v1';

export class Input {
  bindings: Record<Action, string[]>;
  private codesDown = new Set<string>();
  private pressTimes = new Map<Action, number>();
  private padPrev: boolean[] = [];
  private time = 0;
  mouseDX = 0;
  mouseDY = 0;
  padLookX = 0;
  padLookY = 0;
  padMoveX = 0;
  padMoveY = 0;
  padActive = false;
  pointerLocked = false;
  /** When false (menus open) gameplay actions are ignored. */
  enabled = false;
  /** Set while the rebinding UI is waiting for a key. */
  private captureCallback: ((code: string) => void) | null = null;
  private listeners: Array<(a: Action) => void> = [];

  constructor(private canvas: HTMLElement) {
    this.bindings = this.loadBindings();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.codesDown.clear());
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  /** Listen for discrete action presses (used by UI for pause etc.). */
  onAction(fn: (a: Action) => void) {
    this.listeners.push(fn);
  }

  requestPointerLock() {
    if (document.pointerLockElement !== this.canvas) {
      const p = this.canvas.requestPointerLock?.() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  captureNextKey(cb: (code: string) => void) {
    this.captureCallback = cb;
  }

  setBinding(action: Action, slot: number, code: string) {
    const list = [...(this.bindings[action] ?? [])];
    list[slot] = code;
    this.bindings[action] = list.filter(Boolean);
    this.saveBindings();
  }

  resetBindings() {
    this.bindings = structuredClone(DEFAULT_BINDINGS);
    this.saveBindings();
  }

  private loadBindings(): Record<Action, string[]> {
    const base = structuredClone(DEFAULT_BINDINGS);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<Action, string[]>>;
        for (const k of Object.keys(base) as Action[]) {
          if (Array.isArray(parsed[k])) base[k] = parsed[k]!.filter((c) => typeof c === 'string');
        }
      }
    } catch {
      /* storage unavailable */
    }
    return base;
  }

  private saveBindings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings));
    } catch {
      /* ignore */
    }
  }

  private codeToActions(code: string): Action[] {
    const out: Action[] = [];
    for (const [a, codes] of Object.entries(this.bindings) as [Action, string[]][]) {
      if (codes.includes(code)) out.push(a);
    }
    return out;
  }

  private press(code: string) {
    if (this.toggleSprint && this.enabled && this.bindings.sprint.includes(code) && !this.codesDown.has(code)) this.sprintLatched = !this.sprintLatched;
    if (this.captureCallback) {
      const cb = this.captureCallback;
      this.captureCallback = null;
      cb(code);
      return;
    }
    if (this.codesDown.has(code)) return;
    this.codesDown.add(code);
    for (const a of this.codeToActions(code)) {
      this.pressTimes.set(a, this.time);
      for (const l of this.listeners) l(a);
    }
  }

  private release(code: string) {
    this.codesDown.delete(code);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !this.captureCallback) return;
    if (this.enabled && ['Space', 'Tab', 'AltLeft', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.press(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => this.release(e.code);
  private onMouseDown = (e: MouseEvent) => {
    if (this.enabled && !this.pointerLocked) this.requestPointerLock();
    this.press('Mouse' + e.button);
  };
  private onMouseUp = (e: MouseEvent) => this.release('Mouse' + e.button);
  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  private onWheel = (e: WheelEvent) => {
    const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
    this.press(code);
    this.release(code);
  };

  /** Called once per rendered frame before simulation. */
  update(dt: number) {
    this.time += dt;
    this.pollGamepad();
  }

  private pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected);
    if (!pad) {
      // touch controls stand in for the sticks
      this.padMoveX = this.touchMoveX;
      this.padMoveY = this.touchMoveY;
      this.padLookX = this.padLookY = 0;
      return;
    }
    const z = this.deadzone;
    const dz = (v: number) => (Math.abs(v) < z ? 0 : (v - Math.sign(v) * z) / (1 - z));
    this.padMoveX = dz(pad.axes[0] ?? 0);
    this.padMoveY = dz(pad.axes[1] ?? 0);
    this.padLookX = dz(pad.axes[2] ?? 0);
    this.padLookY = dz(pad.axes[3] ?? 0);
    pad.buttons.forEach((b, i) => {
      const was = this.padPrev[i] ?? false;
      if (b.pressed && !was) {
        this.padActive = true;
        this.press('Pad' + i);
        for (const [a, list] of Object.entries(PAD_BUTTONS) as [Action, number[]][]) {
          if (list.includes(i)) {
            this.pressTimes.set(a, this.time);
            for (const l of this.listeners) l(a);
          }
        }
      } else if (!b.pressed && was) {
        this.release('Pad' + i);
      }
      this.padPrev[i] = b.pressed;
    });
    if (Math.abs(this.padMoveX) + Math.abs(this.padMoveY) > 0) this.padActive = true;
  }

  private padDown(a: Action): boolean {
    const list = PAD_BUTTONS[a];
    if (!list) return false;
    return list.some((i) => this.padPrev[i]);
  }

  /** Stick dead zone (settings). */
  deadzone = 0.15;
  /** Rumble strength 0..1 (settings). */
  vibration = 0.7;
  private rumbleUntil = 0;

  /** Controller rumble (dual-motor) when a pad is in use. */
  rumble(strength: number, ms = 160) {
    if (this.vibration <= 0 || !this.padActive) return;
    const now = performance.now();
    if (now < this.rumbleUntil - ms * 0.5) return;
    this.rumbleUntil = now + ms;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected) as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | undefined;
    const s = Math.min(1, strength) * this.vibration;
    void pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: s, weakMagnitude: Math.min(1, s * 1.3) })?.catch?.(() => {});
  }

  /** Touch controls: virtual stick and buttons. */
  touchMoveX = 0;
  touchMoveY = 0;
  private virtualDown = new Set<Action>();

  /** A touch button went down / up. */
  virtual(a: Action, down: boolean) {
    if (down) {
      if (this.virtualDown.has(a)) return;
      this.virtualDown.add(a);
      this.pressTimes.set(a, this.time);
      for (const l of this.listeners) l(a);
    } else this.virtualDown.delete(a);
  }

  /** Touch look: feeds the same path as mouse movement. */
  touchLook(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Accessibility: sprint latches on/off per tap. */
  toggleSprint = false;
  private sprintLatched = false;

  down(a: Action): boolean {
    if (!this.enabled) return false;
    if (a === 'sprint' && this.toggleSprint) return this.sprintLatched || this.virtualDown.has(a);
    return this.bindings[a].some((c) => this.codesDown.has(c)) || this.padDown(a) || this.virtualDown.has(a);
  }

  /** True once per press (buffered for BUFFER_TIME seconds). */
  consume(a: Action, window = BUFFER_TIME): boolean {
    if (!this.enabled) return false;
    const t = this.pressTimes.get(a);
    if (t === undefined) return false;
    if (this.time - t > window) {
      this.pressTimes.delete(a);
      return false;
    }
    this.pressTimes.delete(a);
    return true;
  }

  /** Peek without consuming. */
  buffered(a: Action, window = BUFFER_TIME): boolean {
    const t = this.pressTimes.get(a);
    return this.enabled && t !== undefined && this.time - t <= window;
  }

  clearBuffers() {
    this.pressTimes.clear();
  }

  /** Movement vector in input space: x = right, y = forward, length ≤ 1. */
  moveVector(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    if (this.down('forward')) y += 1;
    if (this.down('back')) y -= 1;
    if (this.down('right')) x += 1;
    if (this.down('left')) x -= 1;
    x += this.padMoveX;
    y -= this.padMoveY;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { x, y };
  }

  takeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = this.mouseDY = 0;
    return d;
  }
}

export function prettyCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓',
    ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt', AltRight: 'R-Alt', Space: 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓',
    ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter', Tab: 'Tab',
  };
  return map[code] ?? code;
}
