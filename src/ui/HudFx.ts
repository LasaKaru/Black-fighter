import * as THREE from 'three';

interface Float {
  el: HTMLElement;
  pos: THREE.Vector3;
  t: number;
  life: number;
  drift: number;
}

const _p = new THREE.Vector3();

/** A world point to track on screen. */
export interface ScreenMarker {
  pos: THREE.Vector3;
  kind: 'target' | 'waypoint' | 'mission' | 'boss' | 'loot' | 'quest';
  label?: string;
  dist: number;
}

const ICONS: Record<ScreenMarker['kind'], string> = { target: '◆', waypoint: '▼', mission: '!', boss: '☠', loot: '▣', quest: '?' };

/**
 * Combat feedback layered over the HUD: floating ink damage numbers that
 * pop out of the target, a hit marker, and the combo meter.
 */
export class HudFx {
  readonly el: HTMLElement;
  private floats: Float[] = [];
  private combo: HTMLElement;
  private comboN: HTMLElement;
  private comboLabel: HTMLElement;
  private comboBar: HTMLElement;
  private hit: HTMLElement;
  private markerPool: HTMLElement[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hudfx';
    this.combo = document.createElement('div');
    this.combo.className = 'combo';
    this.comboN = document.createElement('b');
    this.comboLabel = document.createElement('span');
    const bar = document.createElement('div');
    bar.className = 'combo-bar';
    this.comboBar = document.createElement('i');
    bar.append(this.comboBar);
    this.combo.append(this.comboN, this.comboLabel, bar);
    this.hit = document.createElement('div');
    this.hit.className = 'hitmarker';
    this.el.append(this.combo, this.hit);
  }

  /** A number (or word) popping out of a point in the world. */
  floatText(text: string, pos: THREE.Vector3, kind: 'normal' | 'heavy' | 'kill' | 'ink' | 'xp' = 'normal') {
    const el = document.createElement('div');
    el.className = 'ft ' + kind;
    el.textContent = text;
    this.el.append(el);
    this.floats.push({ el, pos: pos.clone(), t: 0, life: kind === 'kill' ? 1.1 : 0.85, drift: (Math.random() - 0.5) * 40 });
    while (this.floats.length > 24) this.floats.shift()!.el.remove();
  }

  hitMarker(kill: boolean) {
    this.hit.classList.remove('on', 'kill');
    void this.hit.offsetWidth;
    this.hit.classList.add('on');
    if (kill) this.hit.classList.add('kill');
  }

  /** n = 0 hides the meter; t = remaining fraction of the combo window. */
  setCombo(n: number, t: number) {
    if (n < 2) {
      this.combo.classList.remove('show');
      return;
    }
    this.combo.classList.add('show');
    this.comboN.textContent = `×${n}`;
    this.comboLabel.textContent = n >= 30 ? 'INKREDIBLE' : n >= 20 ? 'UNSTOPPABLE' : n >= 10 ? 'GREAT' : n >= 5 ? 'GOOD' : 'COMBO';
    this.comboBar.style.width = `${Math.max(0, Math.min(1, t)) * 100}%`;
    this.combo.dataset.tier = n >= 20 ? '3' : n >= 10 ? '2' : n >= 5 ? '1' : '0';
  }

  /** Screen-space objective markers; off-screen ones ride the edge with an arrow. */
  setMarkers(list: ScreenMarker[], camera: THREE.Camera, w: number, h: number) {
    while (this.markerPool.length < list.length) {
      const el = document.createElement('div');
      el.className = 'sm';
      el.innerHTML = '<i></i><b></b><span></span><em></em>';
      this.el.append(el);
      this.markerPool.push(el);
    }
    this.markerPool.forEach((el, i) => {
      const m = list[i];
      if (!m) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.dataset.kind = m.kind;
      (el.children[1] as HTMLElement).textContent = ICONS[m.kind];
      (el.children[2] as HTMLElement).textContent = m.dist < 1000 ? `${Math.round(m.dist)} m` : `${(m.dist / 1000).toFixed(1)} km`;
      (el.children[3] as HTMLElement).textContent = m.label ?? '';
      _p.copy(m.pos).project(camera);
      let x = _p.x;
      let y = _p.y;
      const behind = _p.z > 1;
      if (behind) {
        x = -x;
        y = -y;
      }
      const on = !behind && Math.abs(x) < 0.9 && Math.abs(y) < 0.86;
      el.classList.toggle('edge', !on);
      if (!on) {
        // push onto the screen edge along the direction from the centre
        const len = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.84, 1e-3);
        x /= len;
        y /= len;
        if (behind && Math.abs(y) > 0.8) y = -0.84;
        (el.children[0] as HTMLElement).style.transform = `rotate(${Math.atan2(x * w, y * h)}rad)`;
      }
      el.style.transform = `translate(${(x * 0.5 + 0.5) * w}px, ${(-y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
    });
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number) {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        f.el.remove();
        this.floats.splice(i, 1);
        continue;
      }
      _p.copy(f.pos).project(camera);
      if (_p.z > 1) {
        f.el.style.display = 'none';
        continue;
      }
      f.el.style.display = '';
      const x = (_p.x * 0.5 + 0.5) * w + f.drift * k;
      const y = (-_p.y * 0.5 + 0.5) * h - 46 * Math.sqrt(k);
      const pop = k < 0.12 ? 0.6 + (k / 0.12) * 0.6 : 1.2 - Math.min(0.2, (k - 0.12) * 0.5);
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${pop})`;
      f.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
    }
  }
}
