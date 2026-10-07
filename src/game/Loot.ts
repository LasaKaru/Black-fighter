import * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import type { Effects } from '../vfx/Effects';
import type { AudioEngine } from '../audio/Audio';
import type { World } from '../world/World';
import type { LootSpot } from '../world/islands/types';
import { crateTexture, graffitiTexture, softDotTexture, tagSpotTexture, wallEyeTexture } from '../world/Textures';
import { PALETTE } from '../world/Materials';
import { CONSUMABLES, Consumable, itemPrice, Profile } from './Profile';
import type { Progression } from './Progression';
import type { MapMarker } from '../ui/Minimap';

export const RARITY = [
  { name: 'Common', color: '#f6f5f2' },
  { name: 'Rare', color: '#17a9a3' },
  { name: 'Legendary', color: '#ff7a1a' },
];

/** One lore line per audio log (hub + 12 islands). */
const LOGS: Record<string, string> = {
  hub: 'LOG 00 · "Every face in Ink City was drawn by someone. The Agents erase the ones that draw back."',
  colombo: 'LOG 01 · "The Lotus Tower hums at night. The Agents say it is just wind. Wind does not blink."',
  ella: 'LOG 02 · "The 9:15 never stops at the Nine Arch. It slows down. Someone is always waiting on the roof."',
  sigiriya: 'LOG 03 · "The Lion Rock kept its paws so it could remember what it was guarding."',
  taj: 'LOG 04 · "White marble does not hold ink. That is why the Warden built his watchtower in the gardens."',
  chichen: 'LOG 05 · "Clap at the foot of El Castillo and the stairs answer. Sometimes the answer is an Eye."',
  machu: 'LOG 06 · "The terraces were built for crops. Now they grow Agents. Nobody planted them."',
  colosseum: 'LOG 07 · "Fifty thousand seats and every one of them painted with an eye. The arena is always watching."',
  petra: 'LOG 08 · "The Treasury is a facade. Behind it: a door, and behind the door, the first Blank."',
  greatwall: 'LOG 09 · "The wall was not built to keep anything out. It was built so the city could see further."',
  rio: 'LOG 10 · "The statue lowered its arms once. Only once. The day the Warden arrived."',
  speedway: 'LOG 11 · "Fastest lap on record: unknown driver, no face, a hat pulled low. Sound familiar?"',
  agenthq: 'LOG 12 · "The Warden is not the boss. The Warden is the last Agent who forgot how to stop watching."',
};

interface Crate {
  id: string;
  island: string;
  rarity: number;
  group: THREE.Group;
  lid: THREE.Mesh;
  beam: THREE.Mesh | null;
  pos: THREE.Vector3;
  open: boolean;
  lidT: number;
  lidVel: THREE.Vector3;
}

interface Collectible {
  id: string;
  island: string;
  kind: 'sticker' | 'tag' | 'log';
  obj: THREE.Object3D;
  extra: THREE.Object3D | null;
  pos: THREE.Vector3;
  got: boolean;
  anim: number;
}

interface Pickup {
  mesh: THREE.Object3D;
  kind: 'ink' | 'use' | 'mask' | 'shard';
  value: number;
  consumable?: Consumable;
  vel: THREE.Vector3;
  rest: boolean;
  life: number;
}

export interface LootHost {
  scene: THREE.Scene;
  physics: Physics;
  effects: Effects;
  audio: AudioEngine;
  world: World;
  profile: Profile;
  progress: Progression;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  pop(text: string, pos: THREE.Vector3, kind: 'ink' | 'xp' | 'heavy' | 'kill' | 'normal'): void;
  subtitle(text: string, seconds: number): void;
}

const crateGeo = new THREE.BoxGeometry(1.1, 0.7, 0.8);
const lidGeo = new THREE.BoxGeometry(1.16, 0.14, 0.86);
const dropGeo = new THREE.IcosahedronGeometry(0.16, 0);
const shardGeo = new THREE.OctahedronGeometry(0.2, 0);

/**
 * Crates, collectibles and Agent drops. Everything one-off is keyed
 * ("ella:crate:2") and saved in the profile, and registered in
 * world.finds so it counts towards island completion.
 */
export class Loot {
  private crates: Crate[] = [];
  private items: Collectible[] = [];
  private pickups: Pickup[] = [];
  private time = 0;
  private crateMats = [0, 1, 2].map((r) => new THREE.MeshStandardMaterial({ map: crateTexture(r), roughness: 0.7 }));
  private lidMat = new THREE.MeshStandardMaterial({ color: '#141418', roughness: 0.5 });
  private inkMat = new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.08, metalness: 0.5, emissive: PALETTE.voidPurple, emissiveIntensity: 0.5 });
  private maskMat = new THREE.MeshStandardMaterial({ color: '#f6f5f2', roughness: 0.3, emissive: '#ffffff', emissiveIntensity: 0.3, flatShading: true });
  private shardMat = new THREE.MeshStandardMaterial({ color: PALETTE.eyeFire, emissive: PALETTE.eyeFire, emissiveIntensity: 1.6, flatShading: true });
  private useMat = new THREE.MeshStandardMaterial({ color: '#17a9a3', emissive: '#17a9a3', emissiveIntensity: 0.8 });

  constructor(private host: LootHost, hubSpots: LootSpot[]) {
    const all: Array<{ island: string; spots: LootSpot[] }> = [{ island: 'hub', spots: hubSpots }, ...host.world.islands.map((i) => ({ island: i.def.id, spots: i.loot }))];
    let tagSeed = 0;
    for (const { island, spots } of all) {
      const n: Record<string, number> = {};
      const ids: string[] = [];
      for (const s of spots) {
        n[s.kind] = (n[s.kind] ?? 0) + 1;
        const id = `${island}:${s.kind}:${n[s.kind]}`;
        ids.push(id);
        const got = host.profile.data.found.includes(id);
        if (s.kind === 'crate') this.makeCrate(id, island, s, got);
        else this.makeCollectible(id, island, s, got, tagSeed++);
      }
      host.world.finds.set(island, [...(host.world.finds.get(island) ?? []), ...ids]);
    }
  }

  // ------------------------------------------------------------ building

  private makeCrate(id: string, island: string, s: LootSpot, open: boolean) {
    const r = s.rarity ?? 0;
    const g = new THREE.Group();
    const body = new THREE.Mesh(crateGeo, this.crateMats[r]);
    body.position.y = 0.35;
    const lid = new THREE.Mesh(lidGeo, this.lidMat);
    lid.position.y = 0.77;
    g.add(body, lid);
    let beam: THREE.Mesh | null = null;
    if (r > 0) {
      beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 14, 10, 1, true), new THREE.MeshBasicMaterial({ color: RARITY[r].color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      beam.position.y = 7.6;
      g.add(beam);
    }
    g.traverse((o) => ((o as THREE.Mesh).isMesh && o !== beam ? (o.castShadow = true) : 0));
    g.position.copy(s.pos);
    g.rotation.y = (id.length * 1.7) % Math.PI;
    this.host.scene.add(g);
    this.host.physics.addStaticBox(s.pos.clone().add(new THREE.Vector3(0, 0.35, 0)), new THREE.Vector3(1.1, 0.7, 0.8), 'wood', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y));
    const c: Crate = { id, island, rarity: r, group: g, lid, beam, pos: s.pos.clone(), open: false, lidT: -1, lidVel: new THREE.Vector3() };
    if (open) this.setOpen(c);
    this.crates.push(c);
  }

  private setOpen(c: Crate) {
    c.open = true;
    c.lid.position.set(0.15, 0.4, -0.75);
    c.lid.rotation.set(-1.2, 0.3, 0.1);
    if (c.beam) c.beam.visible = false;
  }

  private makeCollectible(id: string, island: string, s: LootSpot, got: boolean, seed: number) {
    const n = s.normal ?? new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    let obj: THREE.Object3D;
    let extra: THREE.Object3D | null = null;
    if (s.kind === 'sticker') {
      const tex = wallEyeTexture(PALETTE.eyeFire, true);
      obj = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.7, transparent: true, alphaTest: 0.2 }));
      obj.quaternion.copy(q);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: PALETTE.eyeFire, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
      glow.scale.setScalar(1.6);
      obj.add(glow);
    } else if (s.kind === 'tag') {
      obj = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshBasicMaterial({ map: tagSpotTexture(), transparent: true, depthWrite: false }));
      obj.quaternion.copy(q);
      extra = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshStandardMaterial({ map: graffitiTexture(seed), transparent: true, alphaTest: 0.1, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
      extra.quaternion.copy(q);
      extra.position.copy(s.pos).addScaledVector(n, 0.01);
      extra.visible = got;
      this.host.scene.add(extra);
    } else {
      // audio log: a little radio with a teal grille and antenna
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.22), new THREE.MeshStandardMaterial({ color: '#1b1b20', roughness: 0.4 }));
      const grille = new THREE.Mesh(new THREE.CircleGeometry(0.12, 16), new THREE.MeshStandardMaterial({ color: '#17a9a3', emissive: '#17a9a3', emissiveIntensity: 1.2 }));
      grille.position.set(-0.1, 0, 0.115);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), new THREE.MeshStandardMaterial({ color: '#c8cad0', metalness: 0.8, roughness: 0.3 }));
      ant.position.set(0.18, 0.4, 0);
      ant.rotation.z = -0.3;
      g.add(box, grille, ant);
      g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : 0));
      obj = g;
    }
    obj.position.copy(s.pos);
    if (s.kind === 'log') obj.position.y += 0.9;
    obj.visible = !got || s.kind === 'tag' ? !got : false;
    this.host.scene.add(obj);
    this.items.push({ id, island, kind: s.kind as Collectible['kind'], obj, extra, pos: obj.position.clone(), got, anim: Math.random() * 10 });
  }

  // ------------------------------------------------------------ interaction

  /** What F would do here (for the HUD prompt), or null. */
  prompt(feet: THREE.Vector3): string | null {
    const c = this.nearCrate(feet);
    if (c) return `F · Open ${RARITY[c.rarity].name} crate`;
    if (this.nearTag(feet)) return 'F · Spray graffiti tag';
    return null;
  }

  /** Handle the interact key; true if something was used. */
  interact(feet: THREE.Vector3): boolean {
    const c = this.nearCrate(feet);
    if (c) {
      this.openCrate(c);
      return true;
    }
    const t = this.nearTag(feet);
    if (t) {
      this.sprayTag(t);
      return true;
    }
    return false;
  }

  private nearCrate(feet: THREE.Vector3): Crate | null {
    for (const c of this.crates) if (!c.open && Math.abs(c.pos.y - feet.y) < 1.6 && Math.hypot(c.pos.x - feet.x, c.pos.z - feet.z) < 2.2) return c;
    return null;
  }

  private nearTag(feet: THREE.Vector3): Collectible | null {
    for (const t of this.items) if (t.kind === 'tag' && !t.got && Math.abs(t.pos.y - 1.7 - feet.y) < 1.6 && Math.hypot(t.pos.x - feet.x, t.pos.z - feet.z) < 2.6) return t;
    return null;
  }

  private openCrate(c: Crate) {
    const h = this.host;
    c.open = true;
    c.lidT = 0;
    c.lidVel.set((Math.random() - 0.5) * 2, 6, -2);
    if (c.beam) c.beam.visible = false;
    const top = c.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const col = RARITY[c.rarity].color;
    h.effects.sparks3(top, col, 30 + c.rarity * 20, 7, 0.3, 6);
    h.effects.shockwave(c.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), col, 2 + c.rarity);
    h.audio.play(c.rarity === 2 ? 'catch' : 'smash', { pitch: 1.2 + c.rarity * 0.15, vol: 0.7 });
    h.profile.markFound(c.id);
    // rewards
    const lines: string[] = [];
    const ink = [20 + Math.floor(Math.random() * 21), 60 + Math.floor(Math.random() * 41), 150 + Math.floor(Math.random() * 101)][c.rarity];
    h.profile.addInk(ink);
    lines.push(`+${ink} Ink`);
    h.pop(`+${ink} INK`, top, 'ink');
    const uses = c.rarity === 2 ? 2 : c.rarity === 1 ? 1 : Math.random() < 0.3 ? 1 : 0;
    for (let i = 0; i < uses; i++) {
      const k = (Object.keys(CONSUMABLES) as Consumable[])[Math.floor(Math.random() * 3)];
      h.profile.data.consumables[k]++;
      lines.push(CONSUMABLES[k].name);
    }
    const shards = [0, 1, 3][c.rarity];
    if (shards) {
      h.profile.data.shards += shards;
      lines.push(`${shards} Eye shard${shards > 1 ? 's' : ''}`);
    }
    if (c.rarity === 2 || (c.rarity === 1 && Math.random() < 0.25)) {
      const item = this.randomItem();
      if (item) lines.push(`NEW: ${item}`);
    }
    h.profile.save();
    h.progress.event('crates');
    if (c.rarity === 1) h.progress.event('crateRare');
    if (c.rarity === 2) h.progress.event('crateLegendary');
    h.toast(`${RARITY[c.rarity].name} crate: ${lines.join(' · ')}`, c.rarity ? 'power' : 'info');
  }

  /** Unlock a random premium wardrobe item you don't own yet; returns its id. */
  private randomItem(): string | null {
    const p = this.host.profile;
    const ids = Object.values(Profile.catalog()).flat().filter((id) => itemPrice(id) > 0 && !p.owns(id));
    if (!ids.length) {
      p.addInk(150);
      return null;
    }
    const id = ids[Math.floor(Math.random() * ids.length)];
    p.data.owned.push(id);
    return id.replace(':', ' · ');
  }

  private sprayTag(t: Collectible) {
    const h = this.host;
    t.got = true;
    t.obj.visible = false;
    if (t.extra) {
      t.extra.visible = true;
      t.extra.scale.setScalar(0.01);
    }
    t.anim = 0;
    h.effects.dust(t.pos, 26, Math.random() < 0.5 ? PALETTE.routeTeal : PALETTE.voidPurple, 0.45, 2.5);
    h.audio.play('whoosh', { pitch: 1.8, vol: 0.6 });
    this.found(t, 'tags', 'Graffiti tag sprayed', 25);
  }

  private found(t: Collectible, counter: string, label: string, ink: number) {
    const h = this.host;
    h.profile.markFound(t.id);
    h.profile.addInk(ink);
    h.progress.event(counter);
    const isl = t.island;
    const all = this.items.filter((i) => i.island === isl && i.kind === t.kind);
    const got = all.filter((i) => i.got).length;
    h.toast(`${label} (${got}/${all.length} on this island)  +${ink} Ink`, 'power');
    h.pop(`+${ink} INK`, t.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 'ink');
  }

  // ------------------------------------------------------------ Agent drops

  /** Ink blobs and the odd consumable, mask fragment or Eye shard. */
  spawnDrops(pos: THREE.Vector3, boss: boolean) {
    const n = boss ? 12 : 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.addPickup('ink', pos, 2 + Math.floor(Math.random() * 3));
    if (Math.random() < (boss ? 1 : 0.1)) this.addPickup('use', pos, 1);
    if (Math.random() < (boss ? 1 : 0.04)) this.addPickup('mask', pos, 1);
    if (Math.random() < (boss ? 1 : 0.03)) this.addPickup('shard', pos, boss ? 3 : 1);
  }

  private addPickup(kind: Pickup['kind'], pos: THREE.Vector3, value: number) {
    const mesh = new THREE.Mesh(kind === 'ink' ? dropGeo : kind === 'use' ? new THREE.BoxGeometry(0.34, 0.34, 0.34) : shardGeo, kind === 'ink' ? this.inkMat : kind === 'use' ? this.useMat : kind === 'mask' ? this.maskMat : this.shardMat);
    mesh.position.copy(pos).add(new THREE.Vector3(0, 0.8, 0));
    this.host.scene.add(mesh);
    const a = Math.random() * Math.PI * 2;
    const p: Pickup = { mesh, kind, value, vel: new THREE.Vector3(Math.cos(a) * (1.5 + Math.random() * 2), 4 + Math.random() * 3, Math.sin(a) * (1.5 + Math.random() * 2)), rest: false, life: 40 };
    if (kind === 'use') p.consumable = (Object.keys(CONSUMABLES) as Consumable[])[Math.floor(Math.random() * 3)];
    this.pickups.push(p);
  }

  private collectPickup(p: Pickup) {
    const h = this.host;
    const at = p.mesh.position.clone();
    if (p.kind === 'ink') {
      h.profile.addInk(p.value);
      h.pop(`+${p.value}`, at, 'ink');
      h.audio.play('ui', { pitch: 1.8 + Math.random() * 0.3, vol: 0.35 });
    } else if (p.kind === 'use' && p.consumable) {
      h.profile.data.consumables[p.consumable]++;
      h.profile.save();
      h.toast(`Picked up ${CONSUMABLES[p.consumable].name}`, 'info');
      h.audio.play('ui', { pitch: 1.2 });
    } else if (p.kind === 'shard') {
      h.profile.data.shards += p.value;
      h.profile.save();
      h.toast(`+${p.value} Eye shard${p.value > 1 ? 's' : ''} (${h.profile.data.shards}) — spend them on power upgrades`, 'power');
      h.audio.play('catch', { vol: 0.5, pitch: 1.3 });
    } else if (p.kind === 'mask') {
      const d = h.profile.data;
      d.masks++;
      if (d.masks >= 5) {
        d.masks -= 5;
        const item = this.randomItem();
        h.toast(item ? `Agent mask rebuilt! Unlocked ${item}` : 'Agent mask rebuilt! +150 Ink', 'power');
      } else h.toast(`Agent mask fragment ${d.masks}/5`, 'info');
      h.profile.save();
      h.audio.play('catch', { vol: 0.4, pitch: 1.6 });
    }
    p.mesh.removeFromParent();
  }

  // ------------------------------------------------------------ per frame

  update(dt: number, feet: THREE.Vector3, revealed: boolean) {
    this.time += dt;
    const h = this.host;
    const chest = feet.clone().add(new THREE.Vector3(0, 1, 0));
    for (const c of this.crates) {
      const d = Math.abs(c.pos.x - feet.x) + Math.abs(c.pos.z - feet.z);
      c.group.visible = d < 170;
      if (!c.group.visible) continue;
      if (c.beam) (c.beam.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(this.time * 3 + c.pos.x) * 0.06;
      if (c.lidT >= 0) {
        c.lidT += dt;
        c.lidVel.y -= 18 * dt;
        c.lid.position.addScaledVector(c.lidVel, dt);
        c.lid.rotation.x -= dt * 6;
        if (c.lid.position.y < 0.1 || c.lidT > 1.2) {
          c.lidT = -1;
          this.setOpen(c);
        }
      }
    }
    for (const t of this.items) {
      const d = Math.abs(t.pos.x - feet.x) + Math.abs(t.pos.z - feet.z);
      const near = d < 140;
      if (t.kind === 'tag') {
        t.obj.visible = near && !t.got;
        if (t.extra) {
          t.extra.visible = near && t.got;
          if (t.got && t.anim < 1) {
            t.anim = Math.min(1, t.anim + dt * 3);
            t.extra.scale.setScalar(0.2 + t.anim * 0.8);
          }
        }
        continue;
      }
      if (t.got) continue;
      t.obj.visible = near;
      if (!near) continue;
      t.anim += dt;
      if (t.kind === 'sticker') t.obj.scale.setScalar(1 + Math.sin(t.anim * 4) * 0.08 + (revealed ? 0.4 : 0));
      else {
        t.obj.position.y = t.pos.y + Math.sin(t.anim * 2) * 0.12;
        t.obj.rotation.y += dt;
      }
      if (t.obj.position.distanceTo(chest) < (t.kind === 'sticker' ? 1.7 : 1.5)) {
        t.got = true;
        t.obj.visible = false;
        h.effects.sparks3(t.pos, t.kind === 'sticker' ? PALETTE.eyeFire : PALETTE.routeTeal, 24, 5, 0.3, 4);
        h.audio.play('catch', { vol: 0.5, pitch: t.kind === 'sticker' ? 1.5 : 0.9 });
        if (t.kind === 'sticker') this.found(t, 'collectibles', 'Watching-Eye sticker found', 15);
        else {
          this.found(t, 'logs', 'Audio log found', 40);
          h.subtitle(LOGS[t.island] ?? 'LOG · static…', 9);
        }
      }
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.life -= dt;
      const m = p.mesh;
      const toPlayer = chest.clone().sub(m.position);
      const dist = toPlayer.length();
      if (dist < 6 && p.life < 39.4) {
        // magnet
        m.position.addScaledVector(toPlayer.normalize(), Math.min(dist, (14 - dist) * dt));
        p.rest = false;
      } else if (!p.rest) {
        p.vel.y -= 18 * dt;
        const step = p.vel.clone().multiplyScalar(dt);
        const hit = p.vel.y < 0 ? h.physics.raycast(m.position, new THREE.Vector3(0, -1, 0), -step.y + 0.2) : null;
        if (hit) {
          m.position.copy(hit.point).add(new THREE.Vector3(0, 0.25, 0));
          p.rest = true;
        } else m.position.add(step);
      }
      m.rotation.y += dt * 3;
      if (dist < 1.1) {
        this.collectPickup(p);
        this.pickups.splice(i, 1);
      } else if (p.life <= 0 || m.position.y < -60) {
        m.removeFromParent();
        this.pickups.splice(i, 1);
      }
    }
  }

  /** For the maps: unopened crates nearby; collectibles only while revealed (Watcher Eye). */
  mapMarkers(feet: THREE.Vector3, revealed: boolean): MapMarker[] {
    const out: MapMarker[] = [];
    for (const c of this.crates) if (!c.open && c.pos.distanceTo(feet) < 90) out.push({ kind: 'loot', x: c.pos.x, z: c.pos.z, y: c.pos.y, color: RARITY[c.rarity].color });
    if (revealed) for (const t of this.items) if (!t.got && t.pos.distanceTo(feet) < 120) out.push({ kind: 'collectible', x: t.pos.x, z: t.pos.z, y: t.pos.y, color: t.kind === 'sticker' ? PALETTE.eyeFire : PALETTE.routeTeal });
    return out;
  }

  /** Counts for the progress screen. */
  summary(island?: string) {
    const f = (k: string) => this.items.filter((i) => i.kind === k && (!island || i.island === island));
    const crates = this.crates.filter((c) => !island || c.island === island);
    return {
      crates: [crates.filter((c) => c.open).length, crates.length],
      stickers: [f('sticker').filter((i) => i.got).length, f('sticker').length],
      tags: [f('tag').filter((i) => i.got).length, f('tag').length],
      logs: [f('log').filter((i) => i.got).length, f('log').length],
    };
  }
}
