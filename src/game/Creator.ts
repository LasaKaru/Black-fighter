import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/Physics';
import type { Player } from '../player/Player';

/** Piece kinds: [name, size (x, y, z), colour]. */
const KINDS: Array<{ name: string; size: [number, number, number]; color: string; solid: boolean }> = [
  { name: 'Block', size: [2, 1, 2], color: '#eceae6', solid: true },
  { name: 'Pillar', size: [1, 4, 1], color: '#111114', solid: true },
  { name: 'Ramp', size: [2, 1, 4], color: '#17a9a3', solid: true },
  { name: 'Wall', size: [4, 3, 0.5], color: '#2a2a30', solid: true },
  { name: 'Ring', size: [3, 3, 0.4], color: '#ffd27a', solid: false },
  { name: 'Pad', size: [1.6, 0.2, 1.6], color: '#6b2bff', solid: true },
];

/** [kind, x, y, z, rotation quarter-turns] */
type Piece = [number, number, number, number, number];

interface Placed {
  p: Piece;
  mesh: THREE.Object3D;
  collider: RAPIER.Collider | null;
}

export interface CreatorHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  physics: Physics;
  player: Player;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  audio(name: 'ui' | 'smash' | 'catch' | 'absorb'): void;
  /** Mission-style HUD while building / racing. */
  setHud(h: { text: string; hint: string; progress: string; time?: number } | null): void;
}

const STORE = 'blackeye.course';
const MAX = 250;

/**
 * Creator mode (L): build a parkour course anywhere in free roam from blocks,
 * pillars, ramps, walls, launch pads and checkpoint rings, then race it.
 * Courses autosave and share as a short text code.
 *
 * Keys while building: 1-6 piece · R rotate · E place · X delete · P race ·
 * C copy share code · V paste a code · L leave.
 */
export class Creator {
  active = false;
  private kind = 0;
  private rot = 0;
  private placed: Placed[] = [];
  private ghost: THREE.Mesh;
  private ghostOk = false;
  private ghostPos = new THREE.Vector3();
  private race: { next: number; t: number; rings: Placed[] } | null = null;
  private padCd = 0;

  constructor(private h: CreatorHost) {
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#17a9a3', transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghost.visible = false;
    h.scene.add(this.ghost);
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) for (const p of JSON.parse(raw) as Piece[]) this.add(p, false);
    } catch {
      /* no saved course */
    }
  }

  toggle() {
    this.active = !this.active;
    this.ghost.visible = this.active;
    if (this.active) {
      window.addEventListener('keydown', this.onKey, true);
      this.h.toast('CREATOR · 1-6 piece · R rotate · E place · X delete · P race · C share · V paste · L leave', 'power');
    } else {
      window.removeEventListener('keydown', this.onKey, true);
      this.h.setHud(null);
    }
  }

  private onKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      KeyR: () => (this.rot = (this.rot + 1) % 4),
      KeyE: () => this.place(),
      KeyX: () => this.remove(),
      KeyP: () => this.startRace(),
      KeyC: () => this.share(),
      KeyV: () => this.paste(),
      KeyL: () => this.toggle(),
    };
    const d = /^Digit([1-6])$/.exec(e.code);
    if (d) {
      this.kind = Number(d[1]) - 1;
      this.h.audio('ui');
    } else if (keys[e.code]) keys[e.code]();
    else return;
    e.stopPropagation();
    e.preventDefault();
  };

  private save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.placed.map((x) => x.p)));
    } catch {
      /* full */
    }
  }

  private meshFor(p: Piece): THREE.Object3D {
    const k = KINDS[p[0]];
    const [sx, sy, sz] = k.size;
    let m: THREE.Object3D;
    if (k.name === 'Ring') {
      m = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.18, 8, 28), new THREE.MeshStandardMaterial({ color: k.color, emissive: k.color, emissiveIntensity: 0.6 }));
      m.position.y = 1.6;
    } else if (k.name === 'Ramp') {
      const g = new THREE.BoxGeometry(sx, 0.3, Math.hypot(sz, sy * 2));
      g.rotateX(-Math.atan2(sy * 2, sz));
      g.translate(0, sy, 0);
      m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: k.color, roughness: 0.5 }));
    } else {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.translate(0, sy / 2, 0);
      m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: k.color, roughness: 0.7, emissive: k.name === 'Pad' ? k.color : '#000000', emissiveIntensity: k.name === 'Pad' ? 0.8 : 0 }));
    }
    const grp = new THREE.Group();
    grp.add(m);
    grp.position.set(p[1], p[2], p[3]);
    grp.rotation.y = (p[4] * Math.PI) / 2;
    grp.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    return grp;
  }

  private add(p: Piece, announce = true) {
    if (this.placed.length >= MAX) {
      this.h.toast(`Course limit: ${MAX} pieces`, 'warn');
      return;
    }
    const k = KINDS[p[0]];
    if (!k) return;
    const mesh = this.meshFor(p);
    this.h.scene.add(mesh);
    let collider: RAPIER.Collider | null = null;
    if (k.solid) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (p[4] * Math.PI) / 2);
      if (k.name === 'Ramp') {
        const [sx, sy, sz] = k.size;
        const len = Math.hypot(sz, sy * 2);
        const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.atan2(sy * 2, sz));
        collider = this.h.physics.addStaticBox(new THREE.Vector3(p[1], p[2] + sy, p[3]), new THREE.Vector3(sx, 0.3, len), 'concrete', q.multiply(tilt));
      } else {
        collider = this.h.physics.addStaticBox(new THREE.Vector3(p[1], p[2] + k.size[1] / 2, p[3]), new THREE.Vector3(...k.size), 'concrete', q);
      }
    }
    this.placed.push({ p, mesh, collider });
    if (announce) {
      this.h.audio('ui');
      this.save();
    }
  }

  private place() {
    if (!this.ghostOk) return;
    this.add([this.kind, this.ghostPos.x, this.ghostPos.y, this.ghostPos.z, this.rot]);
  }

  private removeAt(i: number) {
    const x = this.placed[i];
    x.mesh.removeFromParent();
    if (x.collider) this.h.physics.removeCollider(x.collider);
    this.placed.splice(i, 1);
  }

  private remove() {
    let best = -1;
    let bd = 3;
    this.placed.forEach((x, i) => {
      const d = Math.hypot(x.p[1] - this.ghostPos.x, x.p[2] - this.ghostPos.y, x.p[3] - this.ghostPos.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) {
      this.removeAt(best);
      this.h.audio('smash');
      this.save();
    }
  }

  clear() {
    while (this.placed.length) this.removeAt(0);
    this.save();
  }

  /** Share code: compact JSON → base64. */
  code(): string {
    const pieces = this.placed.map((x) => [x.p[0], Math.round(x.p[1]), Math.round(x.p[2] * 2) / 2, Math.round(x.p[3]), x.p[4]]);
    return 'BE1:' + btoa(JSON.stringify(pieces));
  }

  load(code: string): boolean {
    try {
      if (!code.startsWith('BE1:')) return false;
      const pieces = JSON.parse(atob(code.slice(4))) as Piece[];
      if (!Array.isArray(pieces)) return false;
      this.clear();
      for (const p of pieces.slice(0, MAX)) if (Array.isArray(p) && p.length === 5 && p.every((n) => typeof n === 'number' && Number.isFinite(n))) this.add(p as Piece, false);
      this.save();
      return true;
    } catch {
      return false;
    }
  }

  private share() {
    const c = this.code();
    void navigator.clipboard?.writeText(c).then(
      () => this.h.toast(`Course code copied (${this.placed.length} pieces)`, 'power'),
      () => this.h.toast(c.slice(0, 60) + '…', 'info'),
    );
  }

  private paste() {
    const c = window.prompt('Paste a course code (BE1:…)');
    if (c && this.load(c.trim())) this.h.toast(`Course loaded: ${this.placed.length} pieces`, 'power');
    else if (c) this.h.toast('That code did not work', 'warn');
  }

  private startRace() {
    const rings = this.placed.filter((x) => KINDS[x.p[0]].name === 'Ring');
    if (!rings.length) {
      this.h.toast('Place some checkpoint Rings (key 5) first', 'warn');
      return;
    }
    this.race = { next: 0, t: 0, rings };
    this.h.player.respawn(new THREE.Vector3(rings[0].p[1], rings[0].p[2] + 0.3, rings[0].p[3]).add(new THREE.Vector3(0, 0, -3).applyAxisAngle(new THREE.Vector3(0, 1, 0), (rings[0].p[4] * Math.PI) / 2)));
    this.h.toast(`RACE · ${rings.length} rings · GO!`, 'power');
    this.h.audio('catch');
  }

  update(dt: number) {
    this.padCd = Math.max(0, this.padCd - dt);
    const pl = this.h.player;
    // launch pads work while you build and race
    if (this.padCd <= 0) {
      for (const x of this.placed) {
        if (KINDS[x.p[0]].name !== 'Pad') continue;
        if (Math.abs(pl.feet.x - x.p[1]) < 0.9 && Math.abs(pl.feet.z - x.p[3]) < 0.9 && Math.abs(pl.feet.y - (x.p[2] + 0.2)) < 0.5) {
          pl.launch(17);
          this.padCd = 0.6;
          this.h.audio('absorb');
        }
      }
    }
    if (this.race) {
      const r = this.race;
      r.t += dt;
      const ring = r.rings[r.next];
      const c = new THREE.Vector3(ring.p[1], ring.p[2] + 1.6, ring.p[3]);
      if (pl.feet.clone().add(new THREE.Vector3(0, 1, 0)).distanceTo(c) < 2) {
        r.next++;
        this.h.audio('ui');
        if (r.next >= r.rings.length) {
          const best = Number(localStorage.getItem(STORE + '.best') ?? Infinity);
          if (r.t < best) localStorage.setItem(STORE + '.best', String(r.t));
          this.h.toast(`FINISH · ${r.t.toFixed(2)} s${r.t < best ? ' · NEW BEST' : ` · best ${best.toFixed(2)} s`}`, 'power');
          this.h.audio('absorb');
          this.race = null;
          this.h.setHud(null);
          return;
        }
      }
      r.rings.forEach((x, i) => (x.mesh.visible = i >= r.next));
      this.h.setHud({ text: 'CUSTOM COURSE', hint: 'Through the rings in order', progress: `${r.next}/${r.rings.length}`, time: r.t });
    } else this.placed.forEach((x) => (x.mesh.visible = true));
    if (!this.active) return;
    // ghost preview where the crosshair hits, snapped to the 1 m grid
    const cam = this.h.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const hit = this.h.physics.raycast(cam.position, dir, 40);
    this.ghostOk = !!hit && hit.distance > 2;
    if (hit) {
      const k = KINDS[this.kind];
      this.ghostPos.set(Math.round(hit.point.x), Math.round(hit.point.y * 2) / 2, Math.round(hit.point.z));
      this.ghost.scale.set(...k.size);
      this.ghost.position.copy(this.ghostPos).setY(this.ghostPos.y + k.size[1] / 2);
      this.ghost.rotation.y = (this.rot * Math.PI) / 2;
      (this.ghost.material as THREE.MeshBasicMaterial).color.set(this.ghostOk ? '#17a9a3' : '#ff2a4a');
    }
    if (!this.race) this.h.setHud({ text: `CREATOR · ${KINDS[this.kind].name}`, hint: '1-6 piece · R rotate · E place · X delete · P race · C/V share · L exit', progress: `${this.placed.length}/${MAX} pieces` });
  }
}
