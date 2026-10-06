import * as THREE from 'three';
import { CharacterRig } from '../character/CharacterRig';
import { Animator, AnimState } from '../character/Animator';
import { Appearance } from '../character/Appearance';
import type { NetCharState } from '../../shared/protocol';
import type { HitInfo, Hittable } from '../player/Combat';
import { SnapshotBuffer, lerpAngle } from './Interpolation';
import { nameTagTexture } from '../world/Textures';

/** Another player in the room, rendered from interpolated snapshots. */
export class RemotePlayer implements Hittable {
  readonly key: string;
  readonly radius = 0.4;
  alive = true;
  rig: CharacterRig;
  anim: Animator;
  readonly feet = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  hp = 100;
  private buf = new SnapshotBuffer<NetCharState>();
  private tag: THREE.Sprite;
  private lastA = AnimState.Idle;
  /** Sends a hit to this player via the network. */
  onHit: ((p: RemotePlayer, h: HitInfo) => void) | null = null;

  constructor(readonly id: number, public name: string, look: Appearance, private scene: THREE.Scene) {
    this.key = 'remote:' + id;
    this.rig = new CharacterRig(look);
    this.anim = new Animator(this.rig);
    scene.add(this.rig.root);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTagTexture(name), depthTest: false, transparent: true }));
    this.tag.scale.set(1.6, 0.4, 1);
    this.tag.renderOrder = 10;
    scene.add(this.tag);
  }

  setLook(look: Appearance) {
    this.rig.dispose();
    this.rig = new CharacterRig(look);
    this.anim = new Animator(this.rig);
    this.scene.add(this.rig.root);
  }

  push(serverTime: number, s: NetCharState) {
    this.buf.push(serverTime, s);
  }

  center(out: THREE.Vector3) {
    return out.copy(this.feet).add(new THREE.Vector3(0, 1, 0));
  }

  receiveHit(h: HitInfo): boolean {
    if (this.hp <= 0) return false;
    this.onHit?.(this, h);
    this.anim.land(0.5);
    this.rig.setExpression('wince', 0.4);
    return true;
  }

  update(dt: number, renderTime: number) {
    const smp = this.buf.sample(renderTime);
    if (smp) {
      const { a, b, k } = smp;
      const prev = this.feet.clone();
      this.feet.set(a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k);
      this.yaw = lerpAngle(a.yaw, b.yaw, Math.min(1, k));
      this.vel.set(b.v[0], b.v[1], b.v[2]);
      this.hp = b.hp;
      this.alive = b.a !== AnimState.KO;
      const src = k > 0.5 ? b : a;
      this.lastA = src.a as AnimState;
      // teleport (respawn/blink) snaps instead of sliding across the map
      if (prev.distanceTo(this.feet) > 6) this.anim.land(0.3);
      this.anim.update(dt, { state: this.lastA, param: src.ap, speed: Math.hypot(b.v[0], b.v[2]), vy: b.v[1], grounded: b.a !== AnimState.Air });
    }
    this.rig.root.position.copy(this.feet);
    this.rig.root.rotation.y = this.yaw;
    this.tag.position.copy(this.feet).add(new THREE.Vector3(0, 2.35, 0));
  }

  dispose() {
    this.rig.dispose();
    this.tag.removeFromParent();
    (this.tag.material as THREE.SpriteMaterial).map?.dispose();
    this.tag.material.dispose();
  }
}
