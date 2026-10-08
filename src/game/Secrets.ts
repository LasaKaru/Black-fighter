import * as THREE from 'three';
import type { World } from '../world/World';
import type { Profile } from './Profile';
import type { Effects } from '../vfx/Effects';
import type { AudioEngine } from '../audio/Audio';
import { softDotTexture } from '../world/Textures';

export interface SecretsHost {
  scene: THREE.Scene;
  world: World;
  profile: Profile;
  effects: Effects;
  audio: AudioEngine;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  /** Progress counter (achievements, quests). */
  count(counter: 'pens' | 'secrets'): void;
}

/** Twelve Golden Pens hidden on the highest and strangest spots in the world. */
const PENS: Array<{ island: string; anchor: string; idx?: number; off?: [number, number, number] }> = [
  { island: 'metro', anchor: 'spireTop', off: [-14, 0.8, 4] },
  { island: 'metro', anchor: 'fallsCave', off: [-4, 0.5, -3] },
  { island: 'metro', anchor: 'underpass', off: [0, 0.6, 0] },
  { island: 'metro', anchor: 'rooftops', idx: -1, off: [0, 0.8, 0] },
  { island: 'colombo', anchor: 'lotusTop', off: [0, 0.8, 0] },
  { island: 'sigiriya', anchor: 'summit', off: [2, 0.8, 0] },
  { island: 'adamspeak', anchor: 'summit', off: [0, 0.8, 2] },
  { island: 'galle', anchor: 'lighthouseTop', off: [0, 0.8, 0] },
  { island: 'giza', anchor: 'khufuTop', off: [0, 0.8, 0] },
  { island: 'angkor', anchor: 'templeTop', off: [0, 0.8, 0] },
  { island: 'rio', anchor: 'hands', idx: -1, off: [0, 0.8, 0] },
  { island: 'machu', anchor: 'terraces', idx: -1, off: [0, 0.8, 0] },
];

/** Secret places: walking in counts as a find. */
const PLACES: Array<{ id: string; name: string; island: string; anchor: string; r: number }> = [
  { id: 'falls', name: 'Behind the Falls', island: 'metro', anchor: 'fallsCave', r: 6 },
  { id: 'underpass', name: 'Under the Overpass', island: 'metro', anchor: 'underpass', r: 7 },
  { id: 'spire', name: 'Top of the World', island: 'metro', anchor: 'spireTop', r: 10 },
];

interface Pen {
  id: string;
  pos: THREE.Vector3;
  obj: THREE.Group;
  got: boolean;
}

export class Secrets {
  private pens: Pen[] = [];
  private places: Array<{ id: string; name: string; pos: THREE.Vector3; r: number; got: boolean }> = [];
  private time = 0;

  constructor(private h: SecretsHost) {
    const gold = new THREE.MeshStandardMaterial({ color: '#ffcf5a', emissive: '#ff9a1a', emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.25 });
    const ink = new THREE.MeshStandardMaterial({ color: '#141418', metalness: 0.4, roughness: 0.3 });
    const glow = new THREE.SpriteMaterial({ map: softDotTexture(), color: '#ffcf5a', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
    PENS.forEach((p, n) => {
      const isl = h.world.island(p.island);
      const list = isl?.anchors[p.anchor];
      if (!list?.length) return;
      const base = list[p.idx === -1 ? list.length - 1 : (p.idx ?? 0)];
      const pos = base.clone().add(new THREE.Vector3(...(p.off ?? [0, 0.8, 0])));
      const id = `pen:${n}`;
      const got = h.profile.data.found.includes(id);
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 10), gold);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 10), ink);
      cap.position.y = 0.3;
      const nib = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 10), gold);
      nib.rotation.x = Math.PI;
      nib.position.y = -0.41;
      const halo = new THREE.Sprite(glow);
      halo.scale.setScalar(1.6);
      g.add(body, cap, nib, halo);
      g.rotation.z = 0.5;
      g.position.copy(pos);
      g.visible = !got;
      h.scene.add(g);
      this.pens.push({ id, pos, obj: g, got });
    });
    for (const s of PLACES) {
      const p = h.world.island(s.island)?.anchors[s.anchor]?.[0];
      if (!p) continue;
      this.places.push({ id: s.id, name: s.name, pos: p.clone(), r: s.r, got: h.profile.data.found.includes('secret:' + s.id) });
    }
  }

  get penCount(): [number, number] {
    return [this.pens.filter((p) => p.got).length, this.pens.length];
  }

  get secretCount(): [number, number] {
    return [this.places.filter((p) => p.got).length, this.places.length];
  }

  update(dt: number, feet: THREE.Vector3) {
    this.time += dt;
    const chest = feet.clone().add(new THREE.Vector3(0, 1, 0));
    for (const p of this.pens) {
      if (p.got) continue;
      const d = p.pos.distanceTo(chest);
      // pens only show up close by: they are secrets
      p.obj.visible = d < 70;
      if (!p.obj.visible) continue;
      p.obj.rotation.y += dt * 1.6;
      p.obj.position.y = p.pos.y + Math.sin(this.time * 2 + p.pos.x) * 0.12;
      if (d < 1.9) this.takePen(p);
    }
    for (const s of this.places) {
      if (s.got || s.pos.distanceTo(feet) > s.r) continue;
      s.got = true;
      this.h.profile.data.found.push('secret:' + s.id);
      this.h.profile.addInk(200);
      this.h.count('secrets');
      this.h.audio.stinger('secret');
      this.h.toast(`SECRET FOUND · ${s.name} · +200 Ink`, 'power');
    }
  }

  private takePen(p: Pen) {
    p.got = true;
    p.obj.visible = false;
    const prof = this.h.profile;
    prof.data.found.push(p.id);
    prof.addInk(250);
    this.h.count('pens');
    this.h.effects.inkBurst(p.pos.clone(), new THREE.Vector3(0, 1, 0), '#ffcf5a', 30);
    this.h.audio.stinger('secret');
    const [got, all] = this.penCount;
    this.h.toast(`GOLDEN PEN ${got}/${all} · +250 Ink`, 'power');
    if (got === all && !prof.data.unlocks.includes('paint:gold')) {
      prof.data.unlocks.push('paint:gold', 'trail:gold');
      this.h.toast('All Golden Pens found! Gold paint and a gold trail are unlocked.', 'power');
    }
    prof.save();
  }

  /** Map dots (only for pens you're close to, and found places). */
  markers(feet: THREE.Vector3): Array<{ x: number; z: number }> {
    return this.pens.filter((p) => !p.got && p.pos.distanceTo(feet) < 40).map((p) => ({ x: p.pos.x, z: p.pos.z }));
  }
}
