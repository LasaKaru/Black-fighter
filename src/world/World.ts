import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Physics } from '../physics/Physics';
import { City, EyeNest, EyeType } from './City';
import { Builder } from './Builder';
import { createWorldMaterials, WorldMaterials } from './Materials';
import { Vegetation } from './Vegetation';
import { makeRng } from '../core/math';
import type { IslandCtx, IslandDef, IslandInfo, ParkingSpot } from './islands/types';
import { v } from './islands/types';
import { jitter } from './islands/base';
import { buildColombo, buildElla, buildSigiriya } from './islands/ceylon';
import { buildChichen, buildColosseum, buildGreatWall, buildMachu, buildPetra, buildRio, buildTaj } from './islands/wonders';
import { buildAgentHQ, buildSpeedway } from './islands/special';
import { buildAdamsPeak, buildAngkor, buildGalle, buildGiza } from './islands/outer';
import { CableCar, SwingPlatform, Train } from './Movers';
import { decorateBlock, inkDistrict, lootSpots, propSpots, zipline } from './islands/inkKit';
import type { Tower } from './islands/inkKit';
import { cloudSeaTexture } from './Textures';
import { CharacterRig } from '../character/CharacterRig';
import { Animator, AnimInput, AnimState, AttackId, packAttack } from '../character/Animator';
import { AGENT_APPEARANCE, DEFAULT_APPEARANCE } from '../character/Appearance';

/** World ring layout (README §13): the hub floats in the middle, wonders orbit it. */
export const RING_RADIUS = 440;
export const HUB_CENTER = new THREE.Vector3(0, 0, -15);
/** Second ring: newer wonders behind the inner islands. */
export const OUTER_RADIUS = 720;

export const ISLANDS: IslandDef[] = [
  { id: 'colombo', name: 'Colombo', country: 'Sri Lanka', angle: 0, radius: 85, biome: 'tropical', blurb: 'Lotus Tower, palm promenades and tuk-tuks.' },
  { id: 'ella', name: 'Ella', country: 'Sri Lanka', angle: 30, radius: 105, biome: 'highland', blurb: 'Tea hills, Ella Rock and the Nine Arch Bridge train.' },
  { id: 'sigiriya', name: 'Sigiriya', country: 'Sri Lanka', angle: 60, radius: 95, biome: 'jungle', blurb: 'The Lion Rock fortress, paw gate and water gardens.' },
  { id: 'taj', name: 'Taj Mahal', country: 'India', angle: 90, radius: 95, biome: 'garden', blurb: 'White marble, onion domes and a mirror-still pool.' },
  { id: 'chichen', name: 'Chichén Itzá', country: 'Mexico', angle: 120, radius: 90, biome: 'jungle', blurb: 'El Castillo pyramid, ball court and the sacred cenote.' },
  { id: 'machu', name: 'Machu Picchu', country: 'Peru', angle: 150, radius: 100, biome: 'mountain', blurb: 'Inca terraces climbing to a cloud citadel.' },
  { id: 'colosseum', name: 'Colosseum', country: 'Italy', angle: 180, radius: 90, biome: 'temperate', blurb: 'Arches, tiers and an arena for Agent waves.' },
  { id: 'petra', name: 'Petra', country: 'Jordan', angle: 210, radius: 95, biome: 'desert', blurb: 'The rose-red Siq and the Treasury facade.' },
  { id: 'greatwall', name: 'Great Wall', country: 'China', angle: 240, radius: 110, biome: 'temperate', blurb: 'A stone dragon riding the ridges.' },
  { id: 'rio', name: 'Rio', country: 'Brazil', angle: 270, radius: 100, biome: 'tropical', blurb: 'Corcovado peak, the cable car and Cristo Redentor.' },
  { id: 'speedway', name: 'Ink Docks', country: 'Ink City', angle: 300, radius: 100, biome: 'ink', blurb: 'The Speedway, pit garages and stunt ramps.' },
  { id: 'agenthq', name: 'Agent HQ', country: 'Ink City', angle: 330, radius: 95, biome: 'ink', blurb: 'The faceless fortress. The Warden waits.' },
  { id: 'galle', name: 'Galle Fort', country: 'Sri Lanka', angle: 0, radius: 85, biome: 'tropical', ring: 'outer', link: 'colombo', blurb: 'Star-fort ramparts, the lighthouse and the clock tower by the sea.' },
  { id: 'adamspeak', name: "Adam's Peak", country: 'Sri Lanka', angle: 30, radius: 95, biome: 'mountain', ring: 'outer', link: 'ella', blurb: 'A lamp-lit pilgrim stair spiralling to the summit above the clouds.' },
  { id: 'angkor', name: 'Angkor Wat', country: 'Cambodia', angle: 90, radius: 100, biome: 'jungle', ring: 'outer', link: 'taj', blurb: 'Moat, causeway and five lotus-bud towers in the jungle.' },
  { id: 'giza', name: 'Pyramids of Giza', country: 'Egypt', angle: 210, radius: 100, biome: 'desert', ring: 'outer', link: 'petra', blurb: 'Climb the stepped pyramids. The Sphinx is watching.' },
];
const INNER = ISLANDS.filter((d) => d.ring !== 'outer');
const OUTER = ISLANDS.filter((d) => d.ring === 'outer');

const BUILDERS: Record<string, (ctx: IslandCtx) => void> = {
  colombo: buildColombo,
  ella: buildElla,
  sigiriya: buildSigiriya,
  taj: buildTaj,
  chichen: buildChichen,
  machu: buildMachu,
  colosseum: buildColosseum,
  petra: buildPetra,
  greatwall: buildGreatWall,
  rio: buildRio,
  speedway: buildSpeedway,
  agenthq: buildAgentHQ,
  galle: buildGalle,
  adamspeak: buildAdamsPeak,
  angkor: buildAngkor,
  giza: buildGiza,
};

/** Eye nests per island (README §11.2: every power has a home). */
const NESTS: Record<string, EyeType[]> = {
  colombo: ['sky', 'tide'],
  ella: ['tide', 'fire'],
  sigiriya: ['iron', 'sky'],
  taj: ['watcher', 'void'],
  chichen: ['fire', 'iron'],
  machu: ['sky', 'watcher'],
  colosseum: ['iron', 'fire'],
  petra: ['void', 'watcher'],
  greatwall: ['tide', 'iron'],
  rio: ['sky', 'void'],
  speedway: ['fire', 'tide'],
  agenthq: ['storm', 'void'],
  galle: ['tide', 'sky'],
  adamspeak: ['sky', 'watcher'],
  angkor: ['void', 'iron'],
  giza: ['fire', 'void'],
};

export function islandCenter(def: IslandDef): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(def.angle);
  const r = def.ring === 'outer' ? OUTER_RADIUS : RING_RADIUS;
  return new THREE.Vector3(HUB_CENTER.x + Math.cos(a) * r, 0, HUB_CENTER.z + Math.sin(a) * r);
}

interface Bird {
  center: THREE.Vector3;
  r: number;
  speed: number;
  phase: number;
  y: number;
}

export class World {
  readonly mats: WorldMaterials;
  readonly city: City;
  readonly islands: IslandInfo[] = [];
  readonly checkpoints: THREE.Vector3[] = [];
  readonly agentSpawns: THREE.Vector3[] = [];
  readonly eyeNests: EyeNest[] = [];
  readonly parking: ParkingSpot[] = [];
  readonly statues: CharacterRig[] = [];
  /** Giants that breathe and turn their heads to watch you (reference backgrounds). */
  private giants: Array<{ rig: CharacterRig; anim: Animator; input: AnimInput; look: number; headQ: THREE.Quaternion }> = [];
  /** Road network (bridge centre lines) for traffic. */
  readonly roads: Array<{ a: THREE.Vector3; b: THREE.Vector3 }> = [];
  train: Train | null = null;
  cable: CableCar | null = null;
  readonly swings: SwingPlatform[] = [];
  /** Zip-line cables (a = high end) across every island. */
  readonly ziplines: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  private lastTowers: Tower[] = [];
  /** Grind rails (top line of the pipe). */
  readonly rails: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  private gates = new Map<string, { p: THREE.Vector3; inward: THREE.Vector3 }[]>();
  /** One-off finds per island (loot crates, collectibles) for completion %. */
  readonly finds = new Map<string, string[]>();
  readonly group = new THREE.Group();
  private birds: Bird[] = [];
  private birdMesh!: THREE.InstancedMesh;
  private time = 0;

  constructor(private scene: THREE.Scene, private physics: Physics) {
    this.mats = createWorldMaterials();
    this.city = new City(scene, physics, this.mats);
    this.checkpoints.push(...this.city.checkpoints);
    this.agentSpawns.push(...this.city.agentSpawns);
    this.eyeNests.push(...this.city.eyeNests);
    scene.add(this.group);
    this.computeGates();
    // hub zip-lines: from the high tower and the west block down to the plaza
    const hub = new Builder(physics, this.mats);
    zipline(hub, this.ziplines, v(22, 19.2, -64), v(-20, 2.6, 20), 16, 0);
    zipline(hub, this.ziplines, v(-48, 16.2, 17), v(-10, 2.6, 34), 13, 0);
    const hg = new THREE.Group();
    hub.finalize(hg);
    this.group.add(hg);
    for (const def of ISLANDS) this.buildIsland(def);
    this.buildCourses();
    this.buildBridges();
    this.buildSkyline();
    this.buildStatues();
    this.buildAtmosphere();
  }

  /** Mission courses that span islands or use generated content. */
  private buildCourses() {
    // Sky Line: glide from the top of the Lotus Tower to Ella
    const col = this.island('colombo')!;
    const ella = this.island('ella')!;
    const top = col.anchors.lotusTop?.[0];
    if (top) {
      const end = ella.spawn.clone();
      const pts: THREE.Vector3[] = [];
      const n = 8;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const p = top.clone().lerp(end, t);
        const side = new THREE.Vector3(-(end.z - top.z), 0, end.x - top.x).normalize().multiplyScalar(Math.sin(t * Math.PI * 2) * 22);
        p.add(side);
        p.y = i === n ? end.y : top.y - 10 - t * (top.y - 40) * (t < 0.85 ? 0.9 : 1.05);
        pts.push(p);
      }
      col.anchors.skyLine = pts;
    }
    // Cable Rush: a ring under the middle of every zip-line on the island
    for (const isl of this.islands) {
      const rings = isl.ziplines.map((z) => {
        const mid = z.a.clone().lerp(z.b, 0.5);
        mid.y -= z.a.distanceTo(z.b) * 0.025 + 2.35;
        return mid;
      });
      if (rings.length) isl.anchors.zipRings = rings;
    }
  }

  /** Where the bridges will land on each island (same maths as buildBridges). */
  private computeGates() {
    const add = (id: string, p: THREE.Vector3, inward: THREE.Vector3) => {
      if (!this.gates.has(id)) this.gates.set(id, []);
      this.gates.get(id)!.push({ p, inward: inward.normalize() });
    };
    const def = (id: string) => ISLANDS.find((d) => d.id === id)!;
    const col = islandCenter(def('colombo'));
    add('colombo', v(col.x - def('colombo').radius + 4, 0, 10), v(1, 0, 0));
    const taj = islandCenter(def('taj'));
    add('taj', v(0, 0, taj.z - def('taj').radius + 4), v(0, 0, 1));
    const ro = islandCenter(def('colosseum'));
    add('colosseum', v(ro.x + def('colosseum').radius - 4, 0, 0), v(-1, 0, 0));
    for (const [A, B] of this.links()) {
      const ca = islandCenter(A);
      const cb = islandCenter(B);
      const d = cb.clone().sub(ca).normalize();
      add(A.id, ca.clone().addScaledVector(d, A.radius - 4), d.clone().negate());
      add(B.id, cb.clone().addScaledVector(d, -(B.radius - 4)), d.clone());
    }
  }

  /** Island pairs joined by bridges: the inner ring road plus one radial per outer island. */
  private links(): Array<[IslandDef, IslandDef]> {
    const out: Array<[IslandDef, IslandDef]> = INNER.map((d, i) => [d, INNER[(i + 1) % INNER.length]]);
    for (const o of OUTER) out.push([ISLANDS.find((d) => d.id === o.link)!, o]);
    return out;
  }

  private buildIsland(def: IslandDef) {
    const c = islandCenter(def);
    const group = new THREE.Group();
    group.name = 'island:' + def.id;
    const info: IslandInfo = { def, center: c, spawn: c.clone(), anchors: {}, hills: [], movers: [], parking: [], wander: [], group, gates: this.gates.get(def.id) ?? [], ziplines: [], swings: [], extraNests: [], loot: [], props: [], towers: [] };
    const b = new Builder(this.physics, this.mats);
    const veg = new Vegetation(this.physics, this.mats);
    const ctx: IslandCtx = { b, veg, rng: makeRng(def.angle * 97 + 13), physics: this.physics, mats: this.mats, c, R: def.radius, group, info, destructibles: this.city.destructibles };
    BUILDERS[def.id](ctx);
    // every island also gets an Ink City district around its landmark
    this.lastTowers = [];
    if (def.id !== 'speedway') this.lastTowers = inkDistrict(ctx, { inner: def.radius * (def.id === 'agenthq' ? 0.72 : 0.45), outer: def.radius * 0.96, count: Math.round(def.radius * 0.42), maxH: 34 });
    else lootSpots(ctx, []);
    propSpots(ctx, this.lastTowers);
    info.towers = this.lastTowers;
    for (const p of info.props) if (p.kind === 'rail' && p.to) this.rails.push({ a: p.pos.clone().setY(p.pos.y + 0.9), b: p.to.clone().setY(p.to.y + 0.9) });
    this.eyeNests.push(...info.extraNests);
    this.ziplines.push(...info.ziplines);
    for (const sd of info.swings) {
      const sw = new SwingPlatform(this.physics, this.mats, sd);
      this.swings.push(sw);
      this.group.add(sw.group, ...sw.extra);
    }
    // eye nests near the arrival plaza
    NESTS[def.id].forEach((type, i) => {
      const a = def.angle * (Math.PI / 180) + Math.PI + (i ? 0.5 : -0.5);
      const p = info.spawn.clone().add(v(Math.cos(a) * 9, 0, Math.sin(a) * 9));
      p.y = 0;
      b.box(p.x - 0.6, p.x + 0.6, 0, 0.35, p.z - 0.6, p.z + 0.6, 'dark', 'concrete');
      this.eyeNests.push({ pos: p.clone().setY(1.6), type });
    });
    b.finalize(group);
    veg.build(group);
    this.group.add(group);
    this.islands.push(info);
    this.checkpoints.push(info.spawn.clone());
    for (const k of ['summit', 'pyramidTop', 'lotusTop', 'station', 'gate', 'peak']) for (const p of info.anchors[k] ?? []) this.checkpoints.push(p.clone());
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this.agentSpawns.push(info.spawn.clone().add(v(Math.cos(a) * 22, 0.2, Math.sin(a) * 22)));
    }
    this.parking.push(...info.parking);
    for (const m of info.movers) {
      if (m.kind === 'train') {
        this.train = new Train(this.physics, this.mats, m.points);
        this.group.add(this.train.group);
      } else {
        this.cable = new CableCar(this.physics, this.mats, m.points[0], m.points[1]);
        this.group.add(this.cable.group);
      }
    }
  }

  // ------------------------------------------------------------ bridges

  private bridge(b: Builder, a: THREE.Vector3, bb: THREE.Vector3, suspension: boolean) {
    const W = 10;
    const dir = bb.clone().sub(a);
    const len = dir.length();
    const yaw = Math.atan2(dir.x, dir.z);
    const mid = a.clone().add(bb).multiplyScalar(0.5);
    const top = 0.08;
    this.roads.push({ a: a.clone().setY(top), b: bb.clone().setY(top) });
    b.boxAt(mid.x, top - 0.45, mid.z, W, 0.9, len, yaw, 'asphalt', 'concrete');
    b.boxAt(mid.x, top - 1.2, mid.z, W - 1, 0.8, len, yaw, 'dark', null);
    const side = (s: number, d: number) => v(Math.cos(yaw) * s * d, 0, -Math.sin(yaw) * s * d);
    for (const s of [-1, 1]) {
      // sidewalks + railings
      const o = side(s, W / 2 + 0.75);
      b.boxAt(mid.x + o.x, top + 0.1, mid.z + o.z, 1.5, 0.4, len, yaw, 'white', 'concrete');
      const r = side(s, W / 2 + 1.4);
      b.boxAt(mid.x + r.x, top + 1.1, mid.z + r.z, 0.12, 0.12, len, yaw, 'metal', null);
      b.boxAt(mid.x + r.x, top + 0.75, mid.z + r.z, 0.2, 1.1, len, yaw, 'white', 'concrete');
    }
    const n = Math.floor(len / 6);
    for (let i = 0; i < n; i++) {
      const p = a.clone().addScaledVector(dir, (i + 0.5) / n);
      if (i % 2 === 0) b.boxAt(p.x, top + 0.01, p.z, 0.25, 0.02, 3, yaw, 'line', null);
      if (i % 5 === 0) {
        for (const s of [-1, 1]) {
          const o = side(s, W / 2 + 1.1);
          b.cyl(p.x + o.x, top + 0.3, p.z + o.z, 0.07, 0.1, 5, 6, 'dark', null);
          const head = new THREE.SphereGeometry(0.22, 8, 6);
          head.translate(p.x + o.x - o.x * 0.12, top + 5.4, p.z + o.z - o.z * 0.12);
          b.add('lamp', head);
        }
      }
      if (i % 7 === 3) b.cyl(p.x, -60, p.z, 1.2, 2.2, 60 + top - 1.6, 8, 'dark', null);
    }
    if (suspension) {
      // cable-stayed pylons at the middle of the long radial bridges
      for (const s of [-1, 1]) {
        const o = side(s, W / 2 + 2.4);
        b.boxAt(mid.x + o.x, 18, mid.z + o.z, 1.6, 36, 1.6, yaw, 'black', 'concrete');
        b.boxAt(mid.x + o.x, 34, mid.z + o.z, 2.2, 0.8, 2.2, yaw, 'neonTeal', null);
      }
      b.boxAt(mid.x, 33, mid.z, W + 6, 1.4, 1.4, yaw, 'black', null);
      const pts: THREE.Vector3[] = [];
      for (const s of [-1, 1]) {
        const o = side(s, W / 2 + 2.4);
        for (let k = 1; k <= 8; k++) {
          for (const d of [-1, 1]) {
            const anchor = mid.clone().addScaledVector(dir, (d * k * 0.055)).add(side(s, W / 2 + 1.4));
            pts.push(v(mid.x + o.x, 32, mid.z + o.z), anchor.setY(top + 0.5));
          }
        }
      }
      this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#202026' })));
    }
  }

  private buildBridges() {
    const b = new Builder(this.physics, this.mats);
    const byId = (id: string) => this.islands.find((i) => i.def.id === id)!;
    // three radials leaving the hub plaza (east, south, west gaps in its walls)
    const col = byId('colombo');
    this.bridge(b, v(44, 0, 10), v(col.center.x - col.def.radius + 4, 0, 10), true);
    const taj = byId('taj');
    this.bridge(b, v(0, 0, 44), v(0, 0, taj.center.z - taj.def.radius + 4), true);
    const ro = byId('colosseum');
    this.bridge(b, v(-44, 0, 0), v(ro.center.x + ro.def.radius - 4, 0, 0), true);
    // ring road between neighbouring islands, and radial spans to the outer ring
    for (const [da, db] of this.links()) {
      const A = byId(da.id);
      const B = byId(db.id);
      const d = B.center.clone().sub(A.center).normalize();
      this.bridge(b, A.center.clone().addScaledVector(d, A.def.radius - 4), B.center.clone().addScaledVector(d, -(B.def.radius - 4)), B.def.ring === 'outer');
    }
    const g = new THREE.Group();
    g.name = 'bridges';
    b.finalize(g, { shadows: true });
    this.group.add(g);
  }

  // ------------------------------------------------------------ skyline between islands

  /**
   * Ink City towers rising out of the cloud sea in every gap between the
   * islands (the reference frames are dense with them in all directions).
   * Solid, so a glide that comes up short can still land on a roof.
   */
  private buildSkyline() {
    const rng = makeRng(4242);
    const sectors = Array.from({ length: 12 }, () => new Builder(this.physics, this.mats));
    const nearRoad = (x: number, z: number, m: number) =>
      this.roads.some(({ a, b }) => {
        const ab = b.clone().sub(a).setY(0);
        const t = THREE.MathUtils.clamp(v(x - a.x, 0, z - a.z).dot(ab) / ab.lengthSq(), 0, 1);
        return Math.hypot(x - (a.x + ab.x * t), z - (a.z + ab.z * t)) < m;
      });
    const cables: THREE.Vector3[] = [];
    let placed = 0;
    const tops: THREE.Vector3[] = [];
    for (let tries = 0; tries < 3600 && placed < 540; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.range(200 * 200, 840 * 840));
      const x = HUB_CENTER.x + Math.cos(a) * r;
      const z = HUB_CENTER.z + Math.sin(a) * r;
      const w = rng.range(6, 16);
      const d = rng.range(6, 16);
      const rad = Math.hypot(w, d) / 2;
      if (this.islands.some((i) => Math.hypot(x - i.center.x, z - i.center.z) < i.def.radius + 12 + rad)) continue;
      if (nearRoad(x, z, 16 + rad)) continue;
      const h = rng.chance(0.25) ? rng.range(-24, -4) : rng.range(-4, r > 520 ? 75 : 45);
      const dark = rng.chance(0.55);
      const sec = Math.floor(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 6)) % 12;
      const b = sectors[sec];
      b.box(x - w / 2, x + w / 2, -60, h, z - d / 2, z + d / 2, dark ? 'black' : 'white', 'concrete');
      if (rng.chance(0.6)) b.box(x - w / 2 - 0.2, x + w / 2 + 0.2, h - 0.3, h + 0.06, z - d / 2 - 0.2, z + d / 2 + 0.2, dark ? 'dark' : 'grey', null);
      decorateBlock(b, x - w / 2, x + w / 2, h - 14, h, z - d / 2, z + d / 2, dark, rng);
      if (rng.chance(0.35)) {
        // stacked cube on the roof
        const sw = w * rng.range(0.35, 0.6);
        const sd = d * rng.range(0.35, 0.6);
        const sh = rng.range(2, 7);
        const sx = x + rng.range(-w / 2 + sw / 2, w / 2 - sw / 2);
        const sz = z + rng.range(-d / 2 + sd / 2, d / 2 - sd / 2);
        b.box(sx - sw / 2, sx + sw / 2, h, h + sh, sz - sd / 2, sz + sd / 2, dark ? 'white' : 'black', 'concrete');
      }
      if (rng.chance(0.15)) {
        // hanging teal sign / platform off the side
        const s = rng.range(2, 4);
        b.box(x + w / 2, x + w / 2 + s, h - 3, h - 2.6, z - s / 2, z + s / 2, 'teal', 'concrete');
      }
      tops.push(v(x, h, z));
      placed++;
    }
    // sagging cables between neighbouring tall roofs
    for (let i = 0; i < tops.length; i++) {
      const A = tops[i];
      if (A.y < 10 || !rng.chance(0.35)) continue;
      const B = tops.find((T) => T !== A && T.y > 5 && T.distanceTo(A) > 20 && T.distanceTo(A) < 60);
      if (!B) continue;
      const sag = A.distanceTo(B) * 0.07;
      let prev = A.clone().setY(A.y + 2);
      for (let k = 1; k <= 8; k++) {
        const t = k / 8;
        const p = A.clone().setY(A.y + 2).lerp(B.clone().setY(B.y + 2), t);
        p.y -= Math.sin(t * Math.PI) * sag;
        cables.push(prev, p);
        prev = p;
      }
    }
    sectors.forEach((b, i) => {
      const g = new THREE.Group();
      g.name = 'skyline:' + i;
      b.finalize(g, { shadows: false });
      this.group.add(g);
    });
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cables), new THREE.LineBasicMaterial({ color: '#1b1b20' })));
  }

  // ------------------------------------------------------------ giant statues (reference: huge figures on the skyline)

  private statue(look: typeof DEFAULT_APPEARANCE, agent: boolean, pos: THREE.Vector3, yaw: number, scale: number, input: AnimInput) {
    const rig = new CharacterRig(look, { agent, statue: agent ? '#34343a' : '#d9d7d2' });
    const anim = new Animator(rig);
    for (let i = 0; i < 40; i++) anim.update(0.1, input);
    rig.root.position.copy(pos);
    rig.root.rotation.y = yaw;
    rig.root.scale.setScalar(scale);
    this.scene.add(rig.root);
    this.statues.push(rig);
    this.giants.push({ rig, anim, input, look: 0, headQ: rig.joints.head.quaternion.clone() });
  }

  private pillar(b: Builder, x: number, z: number, r: number, topY: number) {
    const g = jitter(new THREE.ConeGeometry(r, topY + 90, 10, 4, true), 1.5, x + z);
    g.rotateX(Math.PI);
    g.translate(x, topY - (topY + 90) / 2, z);
    b.add('rock', g);
    const cap = new THREE.CylinderGeometry(r, r, 2, 10);
    cap.translate(x, topY - 1, z);
    b.add('stone', cap);
  }

  private buildStatues() {
    const b = new Builder(this.physics, this.mats);
    const face = (p: THREE.Vector3) => Math.atan2(HUB_CENTER.x - p.x, HUB_CENTER.z - p.z);
    const spots = [45, 135, 225, 315].map((deg) => {
      const a = THREE.MathUtils.degToRad(deg);
      return v(HUB_CENTER.x + Math.cos(a) * 250, -4, HUB_CENTER.z + Math.sin(a) * 250);
    });
    for (const p of spots) this.pillar(b, p.x, p.z, 16, p.y);
    const blank = structuredClone(DEFAULT_APPEARANCE);
    const pose = (state: AnimState, param = 0): AnimInput => ({ state, param, speed: 0, vy: 0, grounded: true });
    // reaching for a falling Eye
    this.statue(blank, false, spots[0], face(spots[0]), 24, pose(AnimState.Catch));
    // faceless Agent standing guard
    this.statue(AGENT_APPEARANCE, true, spots[1], face(spots[1]), 26, pose(AnimState.Idle));
    // pressing the Eye into the chest
    this.statue({ ...blank, hat: 'hood', top: 'hoodie' }, false, spots[2], face(spots[2]), 24, pose(AnimState.Absorb, 0.9));
    // Agent mid-kick
    this.statue(AGENT_APPEARANCE, true, spots[3], face(spots[3]), 22, pose(AnimState.Attack, packAttack(AttackId.Kick, 0.5)));
    // The Warden at Agent HQ
    const hq = this.islands.find((i) => i.def.id === 'agenthq');
    const sp = hq?.anchors.statue?.[0];
    if (sp) {
      this.pillar(b, sp.x, sp.z, 10, 0);
      this.statue(AGENT_APPEARANCE, true, sp.clone().setY(0), face(sp), 16, pose(AnimState.Attack, packAttack(AttackId.Jab, 0.5)));
    }
    // giants standing among the far stacks, in the gaps between the islands
    const far: Array<{ deg: number; r: number; agent: boolean; scale: number; input: AnimInput }> = [
      { deg: 15, r: 640, agent: true, scale: 30, input: pose(AnimState.Idle) },
      { deg: 75, r: 650, agent: false, scale: 26, input: pose(AnimState.Emote, 0.3) },
      { deg: 105, r: 290, agent: true, scale: 18, input: pose(AnimState.Idle) },
      { deg: 135, r: 660, agent: true, scale: 32, input: pose(AnimState.Attack, packAttack(AttackId.Cross, 0.55)) },
      { deg: 195, r: 640, agent: false, scale: 28, input: pose(AnimState.Charge, 0.6) },
      { deg: 255, r: 650, agent: true, scale: 30, input: pose(AnimState.Idle) },
      { deg: 285, r: 290, agent: false, scale: 17, input: pose(AnimState.Idle) },
      { deg: 345, r: 660, agent: true, scale: 34, input: pose(AnimState.Idle) },
    ];
    for (const f of far) {
      const a = THREE.MathUtils.degToRad(f.deg);
      const p = v(HUB_CENTER.x + Math.cos(a) * f.r, -10, HUB_CENTER.z + Math.sin(a) * f.r);
      this.pillar(b, p.x, p.z, f.scale * 0.55, p.y);
      this.statue(f.agent ? AGENT_APPEARANCE : { ...blank, hat: f.deg === 75 ? 'cap' : 'beanie' }, f.agent, p, face(p), f.scale, f.input);
    }
    const g = new THREE.Group();
    b.finalize(g);
    this.group.add(g);
  }

  // ------------------------------------------------------------ atmosphere

  private buildAtmosphere() {
    // cloud sea
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshStandardMaterial({ map: cloudSeaTexture(), roughness: 1, color: '#c9c9d0' }));
    (sea.material as THREE.MeshStandardMaterial).map!.repeat.set(40, 40);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -34;
    sea.userData.noMap = true;
    this.group.add(sea);
    // distant mountain silhouettes (no fog, flat colour = aerial perspective)
    const rng = makeRng(77);
    const mg: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + rng.range(-0.03, 0.03);
      const r = rng.range(1300, 1600);
      const h = rng.range(80, 300);
      const g = jitter(new THREE.ConeGeometry(rng.range(90, 200), h, 6, 3), 12, i);
      g.translate(Math.cos(a) * r, h / 2 - 40, Math.sin(a) * r);
      mg.push(g.index ? g.toNonIndexed() : g);
    }
    const mountains = new THREE.Mesh(mergeGeometries(mg)!, new THREE.MeshBasicMaterial({ color: '#9b9ba6', fog: false }));
    mountains.userData.noMap = true;
    this.group.add(mountains);
    // far floating clouds, merged
    const cg: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 90; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(120, 800);
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const cy = rng.range(45, 140);
      const s = rng.range(3, 10);
      for (let k = 0; k < rng.int(3, 6); k++) {
        const g = new THREE.IcosahedronGeometry(rng.range(0.7, 1.2) * s, 1);
        g.translate(cx + rng.range(-1.6, 1.6) * s, cy + rng.range(-0.2, 0.5) * s, cz + rng.range(-0.7, 0.7) * s);
        cg.push(g.index ? g.toNonIndexed() : g);
      }
    }
    const clouds = new THREE.Mesh(mergeGeometries(cg)!, this.mats.cloud);
    clouds.userData.noMap = true;
    this.group.add(clouds);
    // birds
    const bird = new THREE.BufferGeometry();
    bird.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0.3, -0.9, 0.25, -0.2, 0, 0, -0.2, 0, 0, 0.3, 0.9, 0.25, -0.2, 0, 0, -0.2]), 3));
    bird.computeVertexNormals();
    const flocks = 6;
    const per = 9;
    this.birdMesh = new THREE.InstancedMesh(bird, new THREE.MeshBasicMaterial({ color: '#2a2a30', side: THREE.DoubleSide }), flocks * per);
    this.birdMesh.frustumCulled = false;
    for (let f = 0; f < flocks; f++) {
      const isl = this.islands[(f * 2) % this.islands.length];
      for (let k = 0; k < per; k++) this.birds.push({ center: isl.center, r: 50 + k * 1.5, speed: 0.12 + f * 0.01, phase: k * 0.06 + f, y: 45 + f * 6 + (k % 3) });
    }
    this.birdMesh.userData.noMap = true;
    this.group.add(this.birdMesh);
  }

  /** Which island (if any) contains a point. */
  islandAt(p: THREE.Vector3): IslandInfo | null {
    for (const i of this.islands) if (Math.hypot(p.x - i.center.x, p.z - i.center.z) < i.def.radius + 4) return i;
    return null;
  }

  nearestIsland(p: THREE.Vector3): IslandInfo {
    let best = this.islands[0];
    let bd = Infinity;
    for (const i of this.islands) {
      const d = Math.hypot(p.x - i.center.x, p.z - i.center.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  island(id: string): IslandInfo | undefined {
    return this.islands.find((i) => i.def.id === id);
  }

  /** Simulation step for moving platforms (fixed timestep). */
  fixedUpdate(dt: number) {
    for (const sw of this.swings) sw.update(dt);
    this.train?.update(dt);
    this.cable?.update(dt);
  }

  update(dt: number, time: number, focus: THREE.Vector3) {
    this.time = time;
    this.city.update(dt, time, focus);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    this.birds.forEach((b, i) => {
      const a = time * b.speed + b.phase;
      const p = v(b.center.x + Math.cos(a) * b.r, b.y + Math.sin(time * 0.7 + i) * 1.5, b.center.z + Math.sin(a) * b.r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      const flap = 0.5 + Math.abs(Math.sin(time * 9 + i)) * 0.9;
      s.set(1.6, flap * 1.6, 1.6);
      m.compose(p, q, s);
      this.birdMesh.setMatrixAt(i, m);
    });
    this.birdMesh.instanceMatrix.needsUpdate = true;
    // giants breathe and slowly turn their heads to watch the player
    const yawQ = new THREE.Quaternion();
    for (const g of this.giants) {
      const head = g.rig.joints.head;
      // animate from the pure pose (the look offset must not feed back into the slerp)
      head.quaternion.copy(g.headQ);
      g.anim.update(dt, g.input);
      g.headQ.copy(head.quaternion);
      const wp = head.getWorldPosition(new THREE.Vector3());
      const yawTo = Math.atan2(focus.x - wp.x, focus.z - wp.z) - g.rig.root.rotation.y;
      const rel = Math.atan2(Math.sin(yawTo), Math.cos(yawTo));
      g.look += (THREE.MathUtils.clamp(rel, -0.7, 0.7) - g.look) * Math.min(1, dt * 0.6);
      head.quaternion.multiply(yawQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.look));
    }
    void this.time;
  }
}
