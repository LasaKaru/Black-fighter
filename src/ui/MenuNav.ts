/**
 * Controller and keyboard navigation for every menu (Steam Deck friendly).
 *
 * - D-pad / left stick / arrow keys move focus to the nearest control in that
 *   direction (spatial navigation over whatever is visible on the screen).
 * - A / Enter activates, B / Esc goes back, LB / RB (or Q / E) switch tabs.
 * - Left / right on a slider changes its value; on a checkbox toggles it.
 * - A bottom hint bar shows the pad buttons while a pad is in use.
 */

export interface MenuNavHost {
  /** The element of the menu that is open now, or null during gameplay. */
  activeRoot(): HTMLElement | null;
  back(): void;
  tab(dir: number): void;
  sound(): void;
}

type Dir = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

export class MenuNav {
  private prev: boolean[] = [];
  private holdDir: Dir | null = null;
  private holdT = 0;
  private wasOpen = false;
  private hint: HTMLElement;
  padUsed = false;

  constructor(private host: MenuNavHost, root: HTMLElement) {
    this.hint = document.createElement('div');
    this.hint.className = 'pad-hint hidden';
    this.hint.innerHTML = '<span><b>A</b> Select</span><span><b>B</b> Back</span><span><b>LB</b>/<b>RB</b> Tabs</span><span><b>✥</b> Move</span>';
    root.append(this.hint);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('mousemove', () => this.setPad(false), { passive: true });
  }

  private setPad(on: boolean) {
    if (this.padUsed === on) return;
    this.padUsed = on;
    document.body.classList.toggle('pad-nav', on);
  }

  private onKey = (e: KeyboardEvent) => {
    const root = this.host.activeRoot();
    if (!root) return;
    const t = e.target as HTMLElement | null;
    const typing = t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'color'].includes((t as HTMLInputElement).type)));
    const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const d = map[e.code];
    if (d && !typing) {
      // sliders use left/right natively; arrows everywhere else move focus
      const isRange = t instanceof HTMLInputElement && t.type === 'range';
      if (isRange && (d === 'left' || d === 'right')) return;
      e.preventDefault();
      this.move(root, d);
      return;
    }
    if (e.code === 'Escape' && !typing) {
      e.preventDefault();
      e.stopPropagation();
      this.host.back();
      return;
    }
    if ((e.code === 'KeyQ' || e.code === 'KeyE') && !typing && !e.repeat) this.host.tab(e.code === 'KeyQ' ? -1 : 1);
  };

  /** Call every frame. */
  update(dt: number) {
    const root = this.host.activeRoot();
    this.hint.classList.toggle('hidden', !root || !this.padUsed);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p && p.connected) ?? null;
    if (!pad) return;
    const pressed = pad.buttons.map((b) => b.pressed);
    if (!root) {
      this.prev = pressed;
      this.wasOpen = false;
      return;
    }
    // the press that opened the menu must not also click inside it
    if (!this.wasOpen) {
      this.wasOpen = true;
      this.prev = pressed;
      this.ensureFocus(root);
      return;
    }
    const edge = (i: number) => pressed[i] && !this.prev[i];
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    let dir: Dir | null = null;
    if (pressed[12] || ay < -0.55) dir = 'up';
    else if (pressed[13] || ay > 0.55) dir = 'down';
    else if (pressed[14] || ax < -0.55) dir = 'left';
    else if (pressed[15] || ax > 0.55) dir = 'right';
    if (dir || pressed.some(Boolean)) this.setPad(true);
    if (dir) {
      if (dir !== this.holdDir) {
        this.holdDir = dir;
        this.holdT = 0.38;
        this.step(root, dir);
      } else {
        this.holdT -= dt;
        if (this.holdT <= 0) {
          this.holdT = 0.11;
          this.step(root, dir);
        }
      }
    } else this.holdDir = null;
    if (edge(0)) this.activate(root);
    if (edge(1)) this.host.back();
    if (edge(4)) this.host.tab(-1);
    if (edge(5)) this.host.tab(1);
    this.prev = pressed;
  }

  private visible(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  ensureFocus(root: HTMLElement) {
    const a = document.activeElement as HTMLElement | null;
    if (a && root.contains(a) && a !== document.body) return;
    // an active tab is the natural home after a rebuild
    const first = root.querySelector<HTMLElement>('.tab.on') ?? this.visible(root)[0];
    first?.focus({ preventScroll: true });
  }

  /** Slider / checkbox handle left and right themselves; everything else moves. */
  private step(root: HTMLElement, dir: Dir) {
    const a = document.activeElement;
    if (a instanceof HTMLInputElement && root.contains(a) && (dir === 'left' || dir === 'right')) {
      if (a.type === 'range') {
        const step = Number(a.step) || 1;
        const v = Math.min(Number(a.max), Math.max(Number(a.min), Number(a.value) + (dir === 'right' ? step : -step)));
        a.value = String(v);
        a.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }
    this.move(root, dir);
  }

  private move(root: HTMLElement, dir: Dir) {
    const els = this.visible(root);
    if (!els.length) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !root.contains(cur) || cur === document.body) {
      this.ensureFocus(root);
      return;
    }
    const c = cur.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    // edge-to-edge distances: the gap along the direction, plus how far the
    // element sits outside our row/column (0 when they overlap)
    const overlap = (a0: number, a1: number, b0: number, b1: number) => (a1 < b0 ? b0 - a1 : b1 < a0 ? a0 - b1 : 0);
    for (const el of els) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      let gap: number;
      let side: number;
      if (dir === 'down') [gap, side] = [r.top - c.bottom, overlap(c.left, c.right, r.left, r.right)];
      else if (dir === 'up') [gap, side] = [c.top - r.bottom, overlap(c.left, c.right, r.left, r.right)];
      else if (dir === 'right') [gap, side] = [r.left - c.right, overlap(c.top, c.bottom, r.top, r.bottom)];
      else [gap, side] = [c.left - r.right, overlap(c.top, c.bottom, r.top, r.bottom)];
      if (gap < -2) continue;
      // vertical moves: the next row wins even if it is off to the side;
      // horizontal moves: stay on the same row whenever possible
      const score = dir === 'up' || dir === 'down' ? gap + side * 0.12 : gap * 0.5 + side * 3;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (!best) return;
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.host.sound();
  }

  private activate(root: HTMLElement) {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !root.contains(a)) {
      this.ensureFocus(root);
      return;
    }
    if (a instanceof HTMLInputElement) {
      if (a.type === 'checkbox') {
        a.click();
        return;
      }
      if (a.type === 'range') return;
      a.focus();
      return;
    }
    a.click();
  }
}
