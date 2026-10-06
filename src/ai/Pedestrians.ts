import * as THREE from 'three';
import { CharacterRig } from '../character/CharacterRig';
import { Animator, AnimState } from '../character/Animator';
import { Appearance, ROSTER, STYLE_OPTIONS } from '../character/Appearance';
import type { Physics } from '../physics/Physics';
import { makeRng } from '../core/math';
import { speechTexture } from '../world/Textures';

/** Flavour lines per island (shown in a speech bubble when you press F). */
const LINES: Record<string, string[]> = {
  hub: ['The wall eyes blinked at me. Twice.', 'Agents took my face. I drew a better one.', 'Catch a burning Eye. Trust me.'],
  colombo: ['Kottu at the night market? Best in the city.', 'The Lotus Tower glows purple when the Watchers blink.', 'Tuk-tuk? Hop in. Mind the goo.'],
  ella: ['The 9:15 never waits. Ride its roof if you dare.', 'Tea tastes better at 1,000 metres.', 'Nine arches, zero steel. Built with patience.'],
  sigiriya: ["1,200 steps to the top. Or one good super-jump.", 'The lion paws are older than the Agents.', 'Kings swam in pools up there. In the sky.'],
  taj: ['Marble remembers every footprint.', 'Walk the pool at dawn. The dome walks with you.', 'Shh. The Watchers love this place.'],
  chichen: ['Clap at the stairs. The pyramid chirps back.', 'Climb fast — the Agents hate stairs.', 'The serpent comes down at the equinox.'],
  machu: ['Thin air, thick legs.', 'The terraces are a staircase for giants.', 'Llamas? They went on strike.'],
  colosseum: ['Fifty thousand cheered here once.', 'The arena still wants a show.', 'Survive three waves and they chant your name.'],
  petra: ['Rose-red city, half as old as time.', 'The Treasury is empty. Or is it?', 'Watch the Siq — it whispers.'],
  greatwall: ['A dragon of stone. Run its spine.', 'Every tower has a view and a story.', 'Wall runners get the best sunsets.'],
  rio: ['The cable car is the lazy way up. I approve.', 'He sees the whole city from up there.', 'Samba later? After the Agents.'],
  speedway: ['Hold Space to drift. Shift for nitro.', 'Best lap wins bragging rights.', 'The Blotter is fast. Too fast.'],
  agenthq: ['You should not be here.', 'The Warden never blinks.', 'Stay. On. Model.'],
};

interface Ped {
  rig: CharacterRig;
  anim: Animator;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  wait: number;
  speed: number;
  island: string;
  bubble: THREE.Sprite | null;
  bubbleT: number;
  fleeing: number;
  zone: { c: THREE.Vector3; r: number };
}

/**
 * Wandering locals ("more characters"): spawned lazily near the player so
 * only ~a dozen exist at once. They stroll, idle, chat and run from Agents.
 */
export class Pedestrians {
  private peds: Ped[] = [];
  private rng = makeRng(4242);
  max = 14;

  constructor(private scene: THREE.Scene, private physics: Physics, private zones: Array<{ island: string; c: THREE.Vector3; r: number }>) {}

  private randomLook(): Appearance {
    const base = structuredClone(this.rng.pick(ROSTER).look);
    const r = this.rng;
    base.hat = r.pick(STYLE_OPTIONS.hat);
    base.hair = r.pick(STYLE_OPTIONS.hair);
    base.top = r.pick(STYLE_OPTIONS.top);
    base.bottom = r.pick(STYLE_OPTIONS.bottom);
    base.shoes = r.pick(STYLE_OPTIONS.shoes);
    base.face = r.pick(['sleepy', 'deadpan', 'cheeky'] as const);
    base.body = r.pick(STYLE_OPTIONS.body);
    const tint = () => '#' + new THREE.Color().setHSL(r.next(), r.range(0.2, 0.6), r.range(0.25, 0.65)).getHexString();
    base.colors.top = tint();
    base.colors.hat = tint();
    base.colors.pants = tint();
    base.colors.shirt = tint();
    base.acc = r.chance(0.4) ? [r.pick(STYLE_OPTIONS.acc)] : [];
    base.print = '';
    base.chest = '';
    base.patches = r.chance(0.3);
    return base;
  }

  private groundAt(x: number, z: number, from: number): number {
    const hit = this.physics.raycast(new THREE.Vector3(x, from + 3, z), new THREE.Vector3(0, -1, 0), 12);
    return hit ? hit.point.y : from;
  }

  private spawn(zone: { island: string; c: THREE.Vector3; r: number }) {
    const a = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(0, zone.r);
    const pos = zone.c.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    pos.y = this.groundAt(pos.x, pos.z, zone.c.y);
    const rig = new CharacterRig(this.randomLook());
    rig.root.position.copy(pos);
    this.scene.add(rig.root);
    this.peds.push({ rig, anim: new Animator(rig), pos, target: pos.clone(), yaw: a, wait: this.rng.range(0, 3), speed: this.rng.range(1.2, 1.8), island: zone.island, bubble: null, bubbleT: 0, fleeing: 0, zone });
  }

  /** Nearest pedestrian within range (for the talk interaction). */
  nearest(p: THREE.Vector3, range: number): Ped | null {
    let best: Ped | null = null;
    let bd = range;
    for (const ped of this.peds) {
      const d = ped.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = ped;
      }
    }
    return best;
  }

  talk(ped: Ped, toward: THREE.Vector3): string {
    const lines = LINES[ped.island] ?? LINES.hub;
    const text = lines[Math.floor(Math.random() * lines.length)];
    ped.yaw = Math.atan2(toward.x - ped.pos.x, toward.z - ped.pos.z);
    ped.wait = 4;
    ped.target.copy(ped.pos);
    ped.bubble?.removeFromParent();
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: speechTexture(text), depthTest: false, transparent: true }));
    s.scale.set(3.6, 1.2, 1);
    s.renderOrder = 12;
    this.scene.add(s);
    ped.bubble = s;
    ped.bubbleT = 4.5;
    ped.rig.setExpression('smirk', 1.5);
    return text;
  }

  update(dt: number, focus: THREE.Vector3, threats: THREE.Vector3[]) {
    // despawn far ones
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (p.pos.distanceTo(focus) > 190) {
        p.rig.dispose();
        p.bubble?.removeFromParent();
        this.peds.splice(i, 1);
      }
    }
    // spawn in nearby zones
    if (this.peds.length < this.max) {
      const near = this.zones.filter((z) => z.c.distanceTo(focus) < 150);
      if (near.length) this.spawn(near[Math.floor(this.rng.next() * near.length)]);
    }
    for (const p of this.peds) {
      const dist = p.pos.distanceTo(focus);
      p.rig.setDetail(dist < 30);
      // flee from nearby threats (alerted Agents)
      for (const t of threats) {
        if (t.distanceTo(p.pos) < 9) {
          const away = p.pos.clone().sub(t).setY(0).normalize().multiplyScalar(10);
          p.target.copy(p.pos).add(away);
          p.fleeing = 3;
          p.wait = 0;
          p.rig.setExpression('wide', 1);
        }
      }
      p.fleeing = Math.max(0, p.fleeing - dt);
      let speed = 0;
      if (p.wait > 0) {
        p.wait -= dt;
      } else {
        const to = p.target.clone().sub(p.pos).setY(0);
        const d = to.length();
        if (d < 0.4) {
          p.wait = this.rng.range(1.5, 6);
          const a = this.rng.range(0, Math.PI * 2);
          const r = this.rng.range(0, p.zone.r);
          p.target.set(p.zone.c.x + Math.cos(a) * r, 0, p.zone.c.z + Math.sin(a) * r);
        } else {
          speed = p.fleeing > 0 ? 5.5 : p.speed;
          to.normalize();
          const step = Math.min(d, speed * dt);
          const nx = p.pos.x + to.x * step;
          const nz = p.pos.z + to.z * step;
          // don't walk off cliffs / into walls: check ground stays near
          const gy = dist < 80 ? this.groundAt(nx, nz, p.pos.y) : p.pos.y;
          if (Math.abs(gy - p.pos.y) < 0.8) {
            p.pos.set(nx, gy, nz);
            p.yaw = Math.atan2(to.x, to.z);
          } else {
            p.target.copy(p.pos);
          }
        }
      }
      if (dist < 120) {
        p.anim.update(dt, { state: speed > 0.3 ? AnimState.Move : p.wait > 3.5 && !p.bubble ? AnimState.Emote : AnimState.Idle, param: 0, speed, vy: 0, grounded: true });
      }
      p.rig.root.position.copy(p.pos);
      p.rig.root.rotation.y = p.yaw;
      if (p.bubble) {
        p.bubbleT -= dt;
        p.bubble.position.copy(p.pos).add(new THREE.Vector3(0, 2.7, 0));
        if (p.bubbleT <= 0) {
          p.bubble.removeFromParent();
          p.bubble = null;
        }
      }
    }
  }

  get count() {
    return this.peds.length;
  }
}
