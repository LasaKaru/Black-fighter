import * as THREE from 'three';
import type { World } from '../world/World';
import { HUB_CENTER } from '../world/World';
import { smoothstep } from '../core/math';

export interface Shot {
  dur: number;
  pos: (t: number) => THREE.Vector3;
  look: (t: number) => THREE.Vector3;
  fov?: number;
  caption?: string;
  /** Show the big title card during this shot. */
  title?: boolean;
  /** Island id this shot shows (for "now showing"). */
  island?: string;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ease = (t: number) => smoothstep(0, 1, t);

function dolly(from: THREE.Vector3, to: THREE.Vector3, lookFrom: THREE.Vector3, lookTo: THREE.Vector3, dur: number, extra: Partial<Shot> = {}): Shot {
  return {
    dur,
    pos: (t) => from.clone().lerp(to, ease(t)),
    look: (t) => lookFrom.clone().lerp(lookTo, ease(t)),
    ...extra,
  };
}

function orbit(center: THREE.Vector3, radius: number, height: number, a0: number, a1: number, lookY: number, dur: number, extra: Partial<Shot> = {}): Shot {
  return {
    dur,
    pos: (t) => {
      const a = a0 + (a1 - a0) * t;
      return v(center.x + Math.cos(a) * radius, center.y + height + Math.sin(t * Math.PI) * 4, center.z + Math.sin(a) * radius);
    },
    look: () => center.clone().setY(center.y + lookY),
    ...extra,
  };
}

/**
 * In-engine cinematography: the boot intro and the endless "attract mode"
 * that plays behind the main menu like a gameplay trailer (README §23).
 * Everything is live: trains, traffic, birds and locals keep moving.
 */
export class Director {
  private shots: Shot[] = [];
  private index = 0;
  private t = 0;
  mode: 'intro' | 'attract' | null = null;
  onShot: ((shot: Shot, index: number) => void) | null = null;
  onDone: (() => void) | null = null;
  private lookCur = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, private world: World) {}

  private anchor(island: string, key: string, fallbackY = 20): THREE.Vector3 {
    const isl = this.world.island(island);
    if (!isl) return HUB_CENTER.clone();
    return (isl.anchors[key]?.[0] ?? isl.center.clone().setY(fallbackY)).clone();
  }

  private center(island: string): THREE.Vector3 {
    return this.world.island(island)?.center.clone() ?? HUB_CENTER.clone();
  }

  /** Boot cinematic: cloud sea → watching eye → Ceylon → wonders → the hero → title. */
  playIntro(hero: () => THREE.Vector3) {
    const col = this.center('colombo');
    const lotus = this.anchor('colombo', 'lotusTop');
    const rio = this.anchor('rio', 'summit');
    const rioStatue = rio.clone().add(v(0, 24, -6));
    const taj = this.anchor('taj', 'dome');
    const train = this.world.train;
    this.shots = [
      dolly(v(-170, 28, 190), v(-70, 16, 90), v(0, 12, -20), v(0, 8, -25), 4.2, { caption: 'THE CITY IS WATCHING', fov: 50 }),
      dolly(v(-11, 2.3, -21.5), v(-11, 2.25, -25.6), v(-11, 2.2, -28), v(-11, 2.2, -28), 2.6, { fov: 40 }),
      dolly(col.clone().add(v(70, 30, 60)), col.clone().add(v(36, 96, 28)), lotus.clone().setY(60), lotus.clone().setY(108), 4, { caption: 'FROM THE LOTUS TOWER OF COLOMBO…', fov: 45, island: 'colombo' }),
      train
        ? { dur: 4, fov: 48, caption: '…OVER THE NINE ARCHES OF ELLA…', island: 'ella', pos: (t) => train.front.clone().add(v(26 - t * 10, 9, 22)), look: () => train.front.clone().add(v(0, 2, 0)) }
        : orbit(this.center('ella'), 90, 40, 0, 0.6, 10, 4, { island: 'ella' }),
      dolly(taj.clone().add(v(-50, -14, 80)), taj.clone().add(v(-20, -6, 58)), taj.clone().add(v(0, -14, 0)), taj.clone().add(v(0, -10, 0)), 3.4, { fov: 45, island: 'taj' }),
      dolly(rioStatue.clone().add(v(40, -6, 70)), rioStatue.clone().add(v(10, 2, 34)), rioStatue, rioStatue.clone().add(v(0, 2, 0)), 4, { caption: '…TO THE WONDERS OF THE WORLD.', fov: 42, island: 'rio' }),
      {
        dur: 4.6,
        fov: 38,
        title: true,
        pos: (t) => {
          const h = hero();
          const a = Math.PI + 0.6 - t * 1.2;
          return v(h.x + Math.sin(a) * (3.4 - t * 0.6), h.y + 1.1 + t * 0.4, h.z + Math.cos(a) * (3.4 - t * 0.6));
        },
        look: () => hero().clone().add(v(0, 1.25, 0)),
      },
    ];
    this.start('intro');
  }

  /** Endless trailer behind the main menu. */
  playAttract() {
    const shots: Shot[] = [];
    const add = (s: Shot) => shots.push(s);
    add(orbit(v(0, 0, 0), 26, 7, 0.4, 1.4, 3, 9, { caption: 'NOW SHOWING · INK CITY PLAZA', fov: 50 }));
    add(orbit(this.anchor('colombo', 'lotusTop').setY(0), 70, 45, 0, 0.9, 70, 9, { caption: 'NOW SHOWING · LOTUS TOWER · COLOMBO', island: 'colombo' }));
    const train = this.world.train;
    if (train) add({ dur: 9, fov: 50, caption: 'NOW SHOWING · NINE ARCH BRIDGE · ELLA', island: 'ella', pos: (t) => train.front.clone().add(v(-20 + t * 6, 12, 28)), look: () => train.front.clone().add(v(0, 1, 0)) });
    add(orbit(this.center('sigiriya').add(v(0, 0, -10)), 80, 30, 1.2, 2.0, 30, 9, { caption: "NOW SHOWING · SIGIRIYA · THE LION'S ROCK", island: 'sigiriya' }));
    add(orbit(this.anchor('taj', 'dome').setY(0), 75, 20, 1.3, 1.9, 22, 9, { caption: 'NOW SHOWING · TAJ MAHAL · AGRA', island: 'taj' }));
    add(orbit(this.center('chichen'), 55, 18, 0.2, 1.0, 14, 9, { caption: 'NOW SHOWING · CHICHÉN ITZÁ · YUCATÁN', island: 'chichen' }));
    add(orbit(this.center('machu'), 95, 34, 1.5, 2.2, 20, 9, { caption: 'NOW SHOWING · MACHU PICCHU · ANDES', island: 'machu' }));
    add(orbit(this.center('colosseum'), 70, 26, 0, 0.8, 10, 9, { caption: 'NOW SHOWING · COLOSSEUM · ROME', island: 'colosseum' }));
    add(orbit(this.center('petra'), 30, 14, 1.4, 1.75, 16, 9, { caption: 'NOW SHOWING · PETRA · ROSE CITY', island: 'petra' }));
    add(orbit(this.center('greatwall'), 110, 40, 1.6, 2.4, 14, 9, { caption: 'NOW SHOWING · GREAT WALL · CHINA', island: 'greatwall' }));
    add(orbit(this.anchor('rio', 'summit').setY(0), 90, 80, 1.2, 1.9, 82, 9, { caption: 'NOW SHOWING · CRISTO REDENTOR · RIO', island: 'rio' }));
    add(orbit(this.center('speedway'), 110, 30, 0, 0.7, 2, 9, { caption: 'NOW SHOWING · INK DOCKS SPEEDWAY', island: 'speedway' }));
    add(orbit(this.center('agenthq').add(v(0, 0, -40)), 100, 40, 1.3, 2.0, 40, 9, { caption: 'NOW SHOWING · AGENT HQ', island: 'agenthq' }));
    this.shots = shots;
    this.index = Math.floor(Math.random() * shots.length);
    this.start('attract');
  }

  private start(mode: 'intro' | 'attract') {
    this.mode = mode;
    if (mode === 'intro') this.index = 0;
    this.t = 0;
    this.lookCur.copy(this.shots[this.index].look(0));
    this.onShot?.(this.shots[this.index], this.index);
  }

  stop() {
    this.mode = null;
  }

  get current(): Shot | null {
    return this.mode ? this.shots[this.index] : null;
  }

  update(dt: number) {
    if (!this.mode) return;
    const shot = this.shots[this.index];
    this.t += dt / shot.dur;
    if (this.t >= 1) {
      this.index++;
      if (this.index >= this.shots.length) {
        if (this.mode === 'intro') {
          this.mode = null;
          this.onDone?.();
          return;
        }
        this.index = 0;
      }
      this.t = 0;
      this.lookCur.copy(this.shots[this.index].look(0));
      this.onShot?.(this.shots[this.index], this.index);
    }
    const s = this.shots[this.index];
    const t = Math.min(1, this.t);
    this.camera.position.copy(s.pos(t));
    this.lookCur.lerp(s.look(t), Math.min(1, dt * 6));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookCur);
    const want = s.fov ?? 55;
    this.camera.fov += (want - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();
  }

  /** Where the action is (for streaming NPCs near the camera). */
  focus(): THREE.Vector3 {
    return this.lookCur.clone();
  }
}
