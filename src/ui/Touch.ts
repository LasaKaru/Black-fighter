import type { Action, Input } from '../core/Input';

/**
 * On-screen touch controls for phones and tablets: a floating stick on the
 * left half, drag-to-look on the right half, and a thumb cluster of action
 * buttons. Everything feeds the normal Input actions, so gameplay code does
 * not know (or care) that it's a touch screen.
 */
export class TouchControls {
  readonly el: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private last = { x: 0, y: 0 };

  static wanted(): boolean {
    return 'ontouchstart' in window || (window.matchMedia?.('(pointer: coarse)').matches ?? false);
  }

  constructor(root: HTMLElement, private input: Input) {
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.stick = document.createElement('div');
    this.stick.className = 'touch-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.stick.append(this.knob);
    const zone = document.createElement('div');
    zone.className = 'touch-zone';
    this.el.append(zone, this.stick);
    const buttons: Array<[Action, string, string]> = [
      ['jump', '⤒', 'big'],
      ['light', '✊', ''],
      ['heavy', '🦶', ''],
      ['dodge', '↺', ''],
      ['power', '◉', ''],
      ['weapon', '✦', ''],
      ['grab', 'F', ''],
      ['grapple', '⚓', ''],
      ['sprint', '»', ''],
    ];
    const cluster = document.createElement('div');
    cluster.className = 'touch-buttons';
    for (const [a, label, cls] of buttons) {
      const b = document.createElement('button');
      b.className = 'touch-btn ' + cls;
      b.textContent = label;
      b.dataset.action = a;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('down');
        this.input.virtual(a, true);
      });
      const up = (e: Event) => {
        e.preventDefault();
        b.classList.remove('down');
        this.input.virtual(a, false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      cluster.append(b);
    }
    const top = document.createElement('div');
    top.className = 'touch-top';
    for (const [a, label] of [['map', '🗺'], ['inventory', '🎒'], ['pause', '❚❚']] as Array<[Action, string]>) {
      const b = document.createElement('button');
      b.className = 'touch-btn small';
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.input.virtual(a, true);
        setTimeout(() => this.input.virtual(a, false), 80);
      });
      top.append(b);
    }
    this.el.append(cluster, top);
    root.append(this.el);
    zone.addEventListener('pointerdown', this.onDown);
    zone.addEventListener('pointermove', this.onMove);
    zone.addEventListener('pointerup', this.onUp);
    zone.addEventListener('pointercancel', this.onUp);
  }

  set visible(v: boolean) {
    this.el.style.display = v ? '' : 'none';
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (e.clientX < window.innerWidth * 0.45 && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add('on');
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.last = { x: e.clientX, y: e.clientY };
    }
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerId === this.stickId) {
      const R = 55;
      let dx = e.clientX - this.stickOrigin.x;
      let dy = e.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.input.touchMoveX = dx / R;
      this.input.touchMoveY = dy / R;
    } else if (e.pointerId === this.lookId) {
      this.input.touchLook((e.clientX - this.last.x) * 1.6, (e.clientY - this.last.y) * 1.6);
      this.last = { x: e.clientX, y: e.clientY };
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.input.touchMoveX = this.input.touchMoveY = 0;
      this.knob.style.transform = '';
      this.stick.classList.remove('on');
    }
    if (e.pointerId === this.lookId) this.lookId = null;
  };
}

/** Steam Deck (and other handhelds): bigger UI and gamepad glyphs in prompts. */
export function isHandheld(): boolean {
  return /SteamDeck|Steam Deck/i.test(navigator.userAgent) || (screen.width === 1280 && screen.height === 800 && /Linux/.test(navigator.userAgent));
}

const PAD_GLYPHS: Array<[RegExp, string]> = [
  [/^F · /, 'RB · '],
  [/^LMB · /, 'X · '],
  [/^RMB · /, 'Y · '],
  [/^Space · /, 'A · '],
  [/^Hold Space /, 'Hold A '],
  [/^T · /, 'LT · '],
];

/** Swap keyboard keys in an on-screen prompt for gamepad buttons (Xbox layout). */
export function padPrompt(text: string): string {
  for (const [re, rep] of PAD_GLYPHS) if (re.test(text)) return text.replace(re, rep);
  return text;
}
