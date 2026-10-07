import * as THREE from 'three';
import { CharacterRig } from '../character/CharacterRig';
import { Animator, AnimState } from '../character/Animator';
import { DEFAULT_APPEARANCE } from '../character/Appearance';
import type { MissionDef } from './Missions';
import type { Player } from '../player/Player';

/** Missions you can time-trial (and race your ghost on). */
export function timed(def: MissionDef): boolean {
  return def.type === 'race' || def.type === 'climb' || def.type === 'collect' || def.type === 'delivery';
}

export type Medal = 'gold' | 'silver' | 'bronze' | null;
export const MEDAL_ICON: Record<'gold' | 'silver' | 'bronze', string> = { gold: '🥇', silver: '🥈', bronze: '🥉' };

/** Medal for a finishing time: fractions of the mission's time limit. */
export function medalFor(def: MissionDef, time: number | undefined): Medal {
  if (time === undefined || !timed(def)) return null;
  const f = time / def.time;
  return f <= 0.45 ? 'gold' : f <= 0.6 ? 'silver' : f <= 0.8 ? 'bronze' : null;
}

/** Medal target times, for the mission cards. */
export function medalTimes(def: MissionDef): [number, number, number] {
  return [def.time * 0.45, def.time * 0.6, def.time * 0.8];
}

const RATE = 0.1;
const KEY = 'blackeye.ghost.';
const MAX = 3000;

interface GhostData {
  t: number;
  /** x, y, z, yaw, anim state, anim param per sample */
  s: number[];
}

/**
 * Ghost replays for time trials: records your run at 10 Hz; when you beat
 * your best, the run is saved (localStorage) and replayed as a translucent
 * ink ghost the next time you start that mission.
 */
export class Ghosts {
  private rec: number[] = [];
  private recT = 0;
  private recording: MissionDef | null = null;
  private ghost: { data: GhostData; rig: CharacterRig; anim: Animator; t: number; label: THREE.Sprite } | null = null;

  constructor(private scene: THREE.Scene, private player: Player) {}

  load(id: string): GhostData | null {
    try {
      const raw = localStorage.getItem(KEY + id);
      return raw ? (JSON.parse(raw) as GhostData) : null;
    } catch {
      return null;
    }
  }

  begin(def: MissionDef) {
    this.stopGhost();
    this.recording = timed(def) ? def : null;
    this.rec = [];
    this.recT = 0;
    if (!this.recording) return;
    const data = this.load(def.id);
    if (data && data.s.length >= 12) this.spawnGhost(data);
  }

  /** Mission over: keep the run if it's a new best. Returns true when saved. */
  finish(def: MissionDef, success: boolean, time: number, prevBest: number | undefined): boolean {
    const was = this.recording;
    this.recording = null;
    this.stopGhost();
    if (!success || !was || was.id !== def.id || this.rec.length < 12) return false;
    if (prevBest !== undefined && time >= prevBest) return false;
    try {
      localStorage.setItem(KEY + def.id, JSON.stringify({ t: time, s: this.rec.map((n) => Math.round(n * 100) / 100) }));
      return true;
    } catch {
      return false;
    }
  }

  update(dt: number) {
    if (this.recording) {
      this.recT -= dt;
      if (this.recT <= 0 && this.rec.length < MAX * 6) {
        this.recT = RATE;
        const p = this.player;
        const s = p.animState();
        this.rec.push(p.feet.x, p.feet.y, p.feet.z, p.yaw, s.a, s.ap);
      }
    }
    const g = this.ghost;
    if (!g) return;
    g.t += dt;
    const n = g.data.s.length / 6;
    const f = g.t / RATE;
    const i = Math.min(n - 2, Math.floor(f));
    if (f >= n - 1) {
      // finished: linger at the end
      g.rig.root.visible = Math.sin(g.t * 10) > 0;
      return;
    }
    const k = f - i;
    const a = i * 6;
    const b = a + 6;
    const s = g.data.s;
    g.rig.root.position.set(s[a] + (s[b] - s[a]) * k, s[a + 1] + (s[b + 1] - s[a + 1]) * k, s[a + 2] + (s[b + 2] - s[a + 2]) * k);
    let dy = s[b + 3] - s[a + 3];
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rig.root.rotation.y = s[a + 3] + dy * k;
    const speed = Math.hypot(s[b] - s[a], s[b + 2] - s[a + 2]) / RATE;
    g.anim.update(dt, { state: s[a + 4] as AnimState, param: s[a + 5], speed, vy: (s[b + 1] - s[a + 1]) / RATE, grounded: true });
    g.label.position.copy(g.rig.root.position).add(new THREE.Vector3(0, 2.5, 0));
  }

  private spawnGhost(data: GhostData) {
    const look = structuredClone(DEFAULT_APPEARANCE);
    const rig = new CharacterRig(look);
    rig.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      const mat = new THREE.MeshBasicMaterial({ color: '#17a9a3', transparent: true, opacity: 0.32, depthWrite: false });
      m.material = mat;
    });
    rig.root.userData.noMap = true;
    this.scene.add(rig.root);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.font = '700 30px sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#17a9a3';
    g.fillText(`GHOST · ${data.t.toFixed(1)} s`, 128, 42);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    label.scale.set(2.4, 0.6, 1);
    label.renderOrder = 12;
    this.scene.add(label);
    this.ghost = { data, rig, anim: new Animator(rig), t: 0, label };
  }

  private stopGhost() {
    if (!this.ghost) return;
    this.ghost.rig.root.removeFromParent();
    this.ghost.rig.dispose();
    this.ghost.label.removeFromParent();
    this.ghost = null;
  }
}
