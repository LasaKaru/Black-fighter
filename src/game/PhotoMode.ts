import * as THREE from 'three';
import { AnimState } from '../character/Animator';
import type { Player } from '../player/Player';

export interface PhotoHost {
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  root: HTMLElement;
  player: Player;
  /** Render one frame right now (so the canvas can be captured). */
  renderNow(): void;
  onExit(): void;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
}

const FILTERS: Record<string, string> = {
  none: 'none',
  noir: 'grayscale(1) contrast(1.35)',
  ink: 'grayscale(1) contrast(2.2) brightness(1.05)',
  sepia: 'sepia(0.85) contrast(1.1)',
  vivid: 'saturate(1.8) contrast(1.1)',
  teal: 'hue-rotate(-20deg) saturate(1.4) contrast(1.15)',
  dream: 'blur(0.6px) saturate(1.3) brightness(1.08)',
};

const POSES: Array<[string, AnimState, number]> = [
  ['Idle', AnimState.Idle, 0],
  ['Wave', AnimState.Emote, 0],
  ['Catch', AnimState.Catch, 0.6],
  ['Glide', AnimState.Glide, 0],
  ['Hang', AnimState.Zip, 0],
  ['Sit', AnimState.Sit, 0],
  ['Down', AnimState.KO, 0],
];

/**
 * Photo mode: frozen world, free-fly camera (WASD, Q/E, mouse drag, wheel for
 * zoom), filters, poses, hide the HUD and the player, and save a PNG with a
 * BLACKEYE frame.
 */
export class PhotoMode {
  active = false;
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private fov = 60;
  private filter = 'none';
  private pose = 0;
  private panel: HTMLElement;
  private dragging = false;
  private savedFov = 70;
  private anchor = new THREE.Vector3();

  constructor(private h: PhotoHost) {
    this.panel = document.createElement('div');
    this.panel.className = 'photo-panel hidden';
    h.root.append(this.panel);
  }

  enter() {
    if (this.active) return;
    this.active = true;
    const cam = this.h.camera;
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this.savedFov = cam.fov;
    this.fov = cam.fov;
    this.anchor.copy(this.h.player.feet);
    document.body.classList.add('photo-mode');
    this.panel.classList.remove('hidden');
    this.buildPanel();
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    this.h.canvas.addEventListener('mousedown', this.onDown);
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('mousemove', this.onMove);
    this.h.canvas.addEventListener('wheel', this.onWheel, { passive: true });
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.keys.clear();
    document.body.classList.remove('photo-mode');
    this.panel.classList.add('hidden');
    this.h.canvas.style.filter = '';
    this.h.camera.fov = this.savedFov;
    this.h.camera.updateProjectionMatrix();
    this.h.player.rig.root.visible = true;
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    this.h.canvas.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('mousemove', this.onMove);
    this.h.canvas.removeEventListener('wheel', this.onWheel);
    this.h.onExit();
  }

  /** Called every rendered frame instead of the gameplay camera. */
  update(dt: number) {
    if (!this.active) return;
    const cam = this.h.camera;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const sp = (this.keys.has('ShiftLeft') ? 14 : 5) * dt;
    const mv = new THREE.Vector3();
    if (this.keys.has('KeyW')) mv.add(fwd);
    if (this.keys.has('KeyS')) mv.sub(fwd);
    if (this.keys.has('KeyD')) mv.add(right);
    if (this.keys.has('KeyA')) mv.sub(right);
    if (this.keys.has('KeyE')) mv.y += 1;
    if (this.keys.has('KeyQ')) mv.y -= 1;
    if (mv.lengthSq() > 0) cam.position.addScaledVector(mv.normalize(), sp);
    // stay within 40 m of where the shot started
    const off = cam.position.clone().sub(this.anchor);
    if (off.length() > 40) cam.position.copy(this.anchor).add(off.setLength(40));
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    cam.fov += (this.fov - cam.fov) * Math.min(1, dt * 8);
    cam.updateProjectionMatrix();
    // hold the pose
    const [, state, param] = POSES[this.pose];
    this.h.player.anim.update(dt, { state, param, speed: 0, vy: 0, grounded: true });
  }

  private onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.code === 'Escape' || e.code === 'KeyK') {
      e.preventDefault();
      this.exit();
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      this.snap();
      return;
    }
    if (e.code === 'KeyH') {
      this.panel.classList.toggle('collapsed');
      return;
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    e.stopPropagation();
    this.keys.delete(e.code);
  };

  private onDown = () => {
    this.dragging = true;
  };

  private onUp = () => {
    this.dragging = false;
  };

  private onMove = (e: MouseEvent) => {
    if (!this.dragging) return;
    this.yaw -= e.movementX * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.004, -1.45, 1.45);
  };

  private onWheel = (e: WheelEvent) => {
    this.fov = THREE.MathUtils.clamp(this.fov + Math.sign(e.deltaY) * 4, 15, 100);
  };

  private buildPanel() {
    const p = this.panel;
    p.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'photo-title';
    title.textContent = 'PHOTO MODE';
    const help = document.createElement('div');
    help.className = 'photo-help';
    help.textContent = 'WASD fly · Q/E down/up · drag to look · wheel zoom · Space snap · H hide panel · Esc exit';
    p.append(title, help);
    const group = (label: string, items: string[], current: number, pick: (i: number) => void) => {
      const row = document.createElement('div');
      row.className = 'photo-row';
      const l = document.createElement('span');
      l.textContent = label;
      row.append(l);
      items.forEach((name, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (i === current ? ' on' : '');
        b.textContent = name;
        b.addEventListener('click', () => {
          pick(i);
          this.buildPanel();
        });
        row.append(b);
      });
      p.append(row);
    };
    const fnames = Object.keys(FILTERS);
    group('Filter', fnames, fnames.indexOf(this.filter), (i) => {
      this.filter = fnames[i];
      this.h.canvas.style.filter = FILTERS[this.filter] === 'none' ? '' : FILTERS[this.filter];
    });
    group('Pose', POSES.map((x) => x[0]), this.pose, (i) => (this.pose = i));
    const vis = this.h.player.rig.root.visible;
    group('Player', ['Shown', 'Hidden'], vis ? 0 : 1, (i) => (this.h.player.rig.root.visible = i === 0));
    const actions = document.createElement('div');
    actions.className = 'photo-row';
    const snap = document.createElement('button');
    snap.type = 'button';
    snap.className = 'chip on';
    snap.textContent = '📷 Snap (Space)';
    snap.addEventListener('click', () => this.snap());
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'chip';
    done.textContent = 'Exit';
    done.addEventListener('click', () => this.exit());
    actions.append(snap, done);
    p.append(actions);
  }

  /** Save the current view as a PNG with the filter baked in and a thin ink frame. */
  snap(): string {
    this.h.renderNow();
    const src = this.h.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext('2d')!;
    g.filter = FILTERS[this.filter];
    g.drawImage(src, 0, 0);
    g.filter = 'none';
    const b = Math.round(out.width * 0.012);
    g.strokeStyle = '#111114';
    g.lineWidth = b * 2;
    g.strokeRect(0, 0, out.width, out.height);
    g.font = `700 ${Math.round(out.height * 0.03)}px sans-serif`;
    g.fillStyle = 'rgba(246,245,242,0.85)';
    g.textAlign = 'right';
    g.fillText('BLACKEYE · INK CITY', out.width - b * 2, out.height - b * 2);
    const url = out.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `blackeye-${Date.now()}.png`;
    a.click();
    this.h.toast('Photo saved', 'power');
    return url;
  }
}
