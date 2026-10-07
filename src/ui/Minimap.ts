import type { MapImage } from '../render/MapBake';

export type MarkerKind = 'mission' | 'missionDone' | 'target' | 'waypoint' | 'nest' | 'agent' | 'agentAlert' | 'boss' | 'vehicle' | 'player' | 'loot' | 'collectible' | 'quest' | 'race';

/** Something to show on the mini-map / world map / screen markers. */
export interface MapMarker {
  kind: MarkerKind;
  x: number;
  z: number;
  y?: number;
  color?: string;
  /** Heading (character convention: atan2(x, z)) for arrows. */
  yaw?: number;
  label?: string;
}

/** Markers that stick to the rim when they are out of range. */
const PINNED: Partial<Record<MarkerKind, true>> = { target: true, waypoint: true, boss: true, quest: true };

/** Radar view radius per zoom step (metres). */
export const MINIMAP_ZOOMS = [55, 110, 230];

/**
 * Round radar in the HUD: pans and rotates over the baked top-down map and
 * draws live markers. Heading-up (camera forward is up) or north-up.
 */
export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: MapImage | null = null;
  private label: HTMLElement;
  zoom = 0;
  rotate = true;
  private last = 0;
  private time = 0;

  constructor(private sizeCss = 184) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.canvas = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = this.canvas.height = Math.round(sizeCss * dpr);
    this.canvas.style.width = this.canvas.style.height = sizeCss + 'px';
    this.ctx = this.canvas.getContext('2d')!;
    this.label = document.createElement('span');
    this.label.className = 'mm-zoom';
    this.el.append(this.canvas, this.label);
  }

  setImage(img: MapImage) {
    this.img = img;
  }

  cycleZoom() {
    this.zoom = (this.zoom + 1) % MINIMAP_ZOOMS.length;
  }

  /** Draw (throttled to ~30 Hz). camYaw uses the camera rig convention. */
  draw(now: number, view: { x: number; z: number; yaw: number; camYaw: number }, markers: MapMarker[]) {
    this.time = now;
    if (now - this.last < 1 / 30) return;
    this.last = now;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const R = W / 2;
    const viewR = MINIMAP_ZOOMS[this.zoom];
    const s = (R - 4) / viewR; // canvas px per metre
    const cy = this.rotate ? view.camYaw : Math.PI;
    // world delta -> screen: heading-up uses the camera basis, north-up is identity
    const cos = Math.cos(cy);
    const sin = Math.sin(cy);
    const toScreen = (dx: number, dz: number): [number, number] => (this.rotate ? [s * (-cos * dx + sin * dz), -s * (sin * dx + cos * dz)] : [s * dx, s * dz]);
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#8c8c95';
    ctx.fillRect(0, 0, W, W);
    if (this.img) {
      const k = s / this.img.ppm;
      ctx.save();
      ctx.translate(R, R);
      if (this.rotate) ctx.transform(-cos * k, -sin * k, sin * k, -cos * k, 0, 0);
      else ctx.scale(k, k);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.img.canvas, -(view.x - this.img.minX) * this.img.ppm, -(view.z - this.img.minZ) * this.img.ppm);
      ctx.restore();
    }
    // range ring
    ctx.strokeStyle = 'rgba(17,17,20,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(R, R, R * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const dpr = W / this.sizeCss;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    for (const m of markers) {
      let [x, y] = toScreen(m.x - view.x, m.z - view.z);
      const d = Math.hypot(x, y);
      const edge = R - 9 * dpr;
      let clamped = false;
      if (d > edge) {
        if (!PINNED[m.kind]) continue;
        x *= edge / d;
        y *= edge / d;
        clamped = true;
      }
      this.marker(m, R + x, R + y, dpr, clamped, pulse, cy, Math.atan2(x, -y));
    }
    // the player: arrow at the centre
    const ang = this.rotate ? view.camYaw - view.yaw : Math.PI - view.yaw;
    this.arrow(R, R, ang, 9 * dpr, '#ff7a1a', '#111114', dpr);
    // rim + north tick
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = '#111114';
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.stroke();
    const [nx, ny] = toScreen(0, -1);
    const nl = Math.hypot(nx, ny) || 1;
    const px = R + (nx / nl) * (R - 11 * dpr);
    const py = R + (ny / nl) * (R - 11 * dpr);
    ctx.fillStyle = '#111114';
    ctx.beginPath();
    ctx.arc(px, py, 8 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6f5f2';
    ctx.font = `bold ${10 * dpr}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', px, py + 0.5 * dpr);
    this.label.textContent = `${MINIMAP_ZOOMS[this.zoom]} m`;
  }

  private arrow(x: number, y: number, ang: number, size: number, fill: string, stroke: string, dpr: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.7, size * 0.75);
    ctx.lineTo(0, size * 0.35);
    ctx.lineTo(-size * 0.7, size * 0.75);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.6 * dpr;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    ctx.restore();
  }

  private marker(m: MapMarker, x: number, y: number, dpr: number, clamped: boolean, pulse: number, camYaw: number, rimAngle: number) {
    const ctx = this.ctx;
    const r = 4 * dpr;
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = '#111114';
    switch (m.kind) {
      case 'mission':
      case 'missionDone':
      case 'race':
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = m.kind === 'missionDone' ? '#ffd27a' : m.color ?? '#17a9a3';
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.strokeRect(-r, -r, r * 2, r * 2);
        ctx.restore();
        break;
      case 'target':
      case 'waypoint':
      case 'quest':
      case 'boss': {
        const c = m.kind === 'waypoint' ? '#ff7a1a' : m.kind === 'boss' ? '#6b2bff' : m.kind === 'quest' ? '#ffd24a' : '#ffd27a';
        if (clamped) {
          this.arrow(x, y, rimAngle, 6 * dpr, c, '#111114', dpr);
        } else {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(x, y - 5 * dpr, 5 * dpr, Math.PI, 0);
          ctx.lineTo(x, y + 3 * dpr);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        break;
      }
      case 'nest':
        ctx.fillStyle = m.color ?? '#ff7a1a';
        ctx.beginPath();
        ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      case 'agent':
      case 'agentAlert': {
        const al = m.kind === 'agentAlert';
        ctx.fillStyle = al ? `rgba(255,59,59,${0.7 + pulse * 0.3})` : '#3b3b42';
        ctx.beginPath();
        ctx.arc(x, y, (al ? 4 : 3) * dpr, 0, Math.PI * 2);
        ctx.fill();
        if (al) ctx.stroke();
        break;
      }
      case 'vehicle':
        ctx.fillStyle = '#f6f5f2';
        ctx.fillRect(x - 3 * dpr, y - 3 * dpr, 6 * dpr, 6 * dpr);
        ctx.strokeRect(x - 3 * dpr, y - 3 * dpr, 6 * dpr, 6 * dpr);
        break;
      case 'player':
        this.arrow(x, y, (this.rotate ? camYaw : Math.PI) - (m.yaw ?? 0), 6 * dpr, m.color ?? '#17a9a3', '#111114', dpr);
        break;
      case 'loot':
        ctx.fillStyle = m.color ?? '#ffd27a';
        ctx.fillRect(x - 3.5 * dpr, y - 3.5 * dpr, 7 * dpr, 7 * dpr);
        ctx.strokeRect(x - 3.5 * dpr, y - 3.5 * dpr, 7 * dpr, 7 * dpr);
        break;
      case 'collectible':
        ctx.fillStyle = m.color ?? '#17a9a3';
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
          const rr = (i % 2 ? 2.2 : 5) * dpr;
          ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
    }
  }
}
