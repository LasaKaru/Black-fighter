import * as THREE from 'three';
import type { Player } from '../player/Player';
import type { Physics } from '../physics/Physics';
import type { ClientMsg, MarkKind } from '../../shared/protocol';
import { VOICE_LINES } from '../../shared/protocol';
import { markerTexture } from '../world/Textures';

export const EMOTES: Array<{ id: number; name: string; unlock: string | null }> = [
  { id: 0, name: 'Dance', unlock: null },
  { id: 1, name: 'Wave', unlock: 'emote:wave' },
  { id: 2, name: 'Flex', unlock: 'emote:flex' },
  { id: 3, name: 'Salute', unlock: 'emote:salute' },
  { id: 4, name: 'Sit', unlock: 'emote:sit' },
];

export interface SocialHost {
  root: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  physics: Physics;
  player: Player;
  unlocked(id: string): boolean;
  send(m: ClientMsg): void;
  online(): boolean;
  /** World position of a remote player's head (for speech bubbles). */
  remoteHead(id: number): THREE.Vector3 | null;
  remoteName(id: number): string;
  chatLine(name: string, text: string): void;
  speak(text: string, pitch: number): void;
  isAgentAt(p: THREE.Vector3): boolean;
  audio(name: 'ui' | 'spot'): void;
}

interface Mark {
  sprite: THREE.Sprite;
  ring: THREE.Mesh;
  t: number;
  kind: MarkKind;
  label: string;
}

const MARK_COLOR: Record<MarkKind, string> = { look: '#ffd27a', go: '#17a9a3', danger: '#ff2a4a' };
const MARK_ICON: Record<MarkKind, string> = { look: '◎', go: '➜', danger: '!' };

/**
 * Social layer: emote/voice wheel (G), location pings (J) that teammates see
 * in the world and on the radar, and speech bubbles for voice lines.
 */
export class Social {
  private wheel: HTMLElement;
  private wheelOpen = false;
  private wheelT = 0;
  readonly marks: Mark[] = [];
  private bubbles: Array<{ el: HTMLElement; from: number; t: number }> = [];
  /** Accessibility: also show voice lines as subtitles. */
  subtitles = true;
  onSubtitle: ((text: string) => void) | null = null;

  constructor(private h: SocialHost) {
    this.wheel = document.createElement('div');
    this.wheel.className = 'emote-wheel hidden';
    h.root.append(this.wheel);
  }

  toggleWheel() {
    if (this.wheelOpen) {
      this.closeWheel();
      return;
    }
    this.wheelOpen = true;
    this.wheelT = 4;
    this.wheel.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'ew-title';
    title.textContent = 'EMOTES · VOICE  (press a number)';
    this.wheel.append(title);
    let n = 1;
    const add = (label: string, locked: boolean, act: () => void) => {
      const key = n++ % 10;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ew-item' + (locked ? ' locked' : '');
      b.innerHTML = `<b>${key}</b>${label}`;
      b.dataset.key = String(key);
      if (!locked)
        b.addEventListener('click', () => {
          act();
          this.closeWheel();
        });
      this.wheel.append(b);
    };
    for (const e of EMOTES) {
      const locked = !!e.unlock && !this.h.unlocked(e.unlock);
      add(locked ? `${e.name} 🔒` : e.name, locked, () => this.h.player.playEmote(e.id));
    }
    VOICE_LINES.slice(0, 5).forEach((line, i) => add(`“${line}”`, false, () => this.say(i)));
    this.wheel.classList.remove('hidden');
    window.addEventListener('keydown', this.onKey, true);
  }

  private closeWheel() {
    this.wheelOpen = false;
    this.wheel.classList.add('hidden');
    window.removeEventListener('keydown', this.onKey, true);
  }

  private onKey = (e: KeyboardEvent) => {
    const m = /^Digit(\d)$/.exec(e.code);
    if (m) {
      e.stopPropagation();
      e.preventDefault();
      const b = this.wheel.querySelector<HTMLButtonElement>(`[data-key="${m[1]}"]`);
      if (b && !b.classList.contains('locked')) b.click();
      return;
    }
    if (e.code === 'Escape') {
      e.stopPropagation();
      this.closeWheel();
    }
  };

  /** Voice line: bubble over your head + chat for everyone in the room. */
  say(id: number) {
    const text = VOICE_LINES[id];
    if (!text) return;
    this.bubble(-1, text);
    this.h.chatLine('You', text);
    this.h.speak(text, 1.15);
    if (this.subtitles) this.onSubtitle?.(`You: ${text}`);
    if (this.h.online()) this.h.send({ t: 'voice', id });
  }

  heard(from: number, id: number) {
    const text = VOICE_LINES[id];
    if (!text) return;
    this.bubble(from, text);
    this.h.chatLine(this.h.remoteName(from), text);
    this.h.speak(text, 0.85 + (from % 5) * 0.08);
    if (this.subtitles) this.onSubtitle?.(`${this.h.remoteName(from)}: ${text}`);
    this.h.audio('spot');
  }

  private bubble(from: number, text: string) {
    const el = document.createElement('div');
    el.className = 'speech';
    el.textContent = text;
    this.h.root.append(el);
    this.bubbles.push({ el, from, t: 3 });
  }

  /** Ping whatever the crosshair is on (J). Danger if it's an Agent. */
  ping() {
    const cam = this.h.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const hit = this.h.physics.raycast(cam.position, dir, 150, true);
    const p = hit ? hit.point : cam.position.clone().addScaledVector(dir, 40);
    const kind: MarkKind = this.h.isAgentAt(p) ? 'danger' : hit && hit.normal.y > 0.7 ? 'go' : 'look';
    this.addMark(p, kind, 'You');
    if (this.h.online()) this.h.send({ t: 'mark', p: [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100], kind });
  }

  addMark(p: THREE.Vector3, kind: MarkKind, label: string) {
    while (this.marks.length >= 6) this.removeMark(0);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(MARK_COLOR[kind], MARK_ICON[kind]), depthTest: false }));
    sprite.scale.set(1.4, 1.4, 1);
    sprite.position.copy(p).add(new THREE.Vector3(0, 1.6, 0));
    sprite.renderOrder = 12;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 24), new THREE.MeshBasicMaterial({ color: MARK_COLOR[kind], transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(p).add(new THREE.Vector3(0, 0.05, 0));
    sprite.userData.noMap = true;
    ring.userData.noMap = true;
    this.h.scene.add(sprite, ring);
    this.marks.push({ sprite, ring, t: 8, kind, label });
    this.h.audio('ui');
  }

  private removeMark(i: number) {
    const m = this.marks[i];
    m.sprite.removeFromParent();
    m.ring.removeFromParent();
    this.marks.splice(i, 1);
  }

  update(dt: number, width: number, height: number) {
    if (this.wheelOpen) {
      this.wheelT -= dt;
      if (this.wheelT <= 0) this.closeWheel();
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.t -= dt;
      const s = 1 + Math.sin(m.t * 6) * 0.08;
      m.sprite.scale.set(1.4 * s, 1.4 * s, 1);
      m.ring.scale.setScalar(1 + (8 - m.t) * 0.05);
      if (m.t <= 0) this.removeMark(i);
    }
    // speech bubbles follow the speaker's head
    const v = new THREE.Vector3();
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.t -= dt;
      const head = b.from < 0 ? this.h.player.feet.clone().add(new THREE.Vector3(0, 2.4, 0)) : this.h.remoteHead(b.from);
      if (b.t <= 0 || !head) {
        b.el.remove();
        this.bubbles.splice(i, 1);
        continue;
      }
      v.copy(head).project(this.h.camera);
      const on = v.z < 1;
      b.el.style.display = on ? 'block' : 'none';
      b.el.style.left = `${((v.x + 1) / 2) * width}px`;
      b.el.style.top = `${((1 - v.y) / 2) * height}px`;
      b.el.style.opacity = String(Math.min(1, b.t * 2));
    }
  }
}
