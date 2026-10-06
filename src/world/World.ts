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
import { CableCar, Train } from './Movers';
import { cloudSeaTexture } from './Textures';
import { CharacterRig } from '../character/CharacterRig';
import { Animator, AnimState, AttackId, packAttack } from '../character/Animator';
import { AGENT_APPEARANCE, DEFAULT_APPEARANCE } from '../character/Appearance';

/** World ring layout (README §13): the hub floats in the middle, wonders orbit it. */
export const RING_RADIUS = 440;
export const HUB_CENTER = new THREE.Vector3(0, 0, -15);

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
];

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
};

export function islandCenter(def: IslandDef): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(def.angle);
  return new THREE.Vector3(HUB_CENTER.x + Math.cos(a) * RING_RADIUS, 0, HUB_CENTER.z + Math.sin(a) * RING_RADIUS);
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
  /** Road network (bridge centre lines) for traffic. */
  readonly roads: Array<{ a: THREE.Vector3; b: THREE.Vector3 }> = [];
  train: Train | null = null;
  cable: CableCar | null = null;
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
    for (const def of ISLANDS) this.buildIsland(def);
    this.buildBridges();
    this.buildStatues();
    this.buildAtmosphere();
  }

  private buildIsland(def: IslandDef) {
    const c = islandCenter(def);
    const group = new THREE.Group();
    group.name = 'island:' + def.id;
    const info: IslandInfo = { def, center: c, spawn: c.clone(), anchors: {}, hills: [], movers: [], parking: [], wander: [], group };
    const b = new Builder(this.physics, this.mats);
    const veg = new Vegetation(this.physics, this.mats);
    const ctx: IslandCtx = { b, veg, rng: makeRng(def.angle * 97 + 13), physics: this.physics, mats: this.mats, c, R: def.radius, group, info };
    BUILDERS[def.id](ctx);
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
    // ring road between neighbouring islands
    for (let i = 0; i < this.islands.length; i++) {
      const A = this.islands[i];
      const B = this.islands[(i + 1) % this.islands.length];
      const d = B.center.clone().sub(A.center).normalize();
      this.bridge(b, A.center.clone().addScaledVector(d, A.def.radius - 4), B.center.clone().addScaledVector(d, -(B.def.radius - 4)), false);
    }
    const g = new THREE.Group();
    g.name = 'bridges';
    b.finalize(g, { shadows: true });
    this.group.add(g);
  }

  // ------------------------------------------------------------ giant statues (reference: huge figures on the skyline)

  private statue(look: typeof DEFAULT_APPEARANCE, agent: boolean, pos: THREE.Vector3, yaw: number, scale: number, pose: (a: Animator) => void) {
    const rig = new CharacterRig(look, { agent, statue: agent ? '#3a3a40' : '#d9d7d2' });
    const anim = new Animator(rig);
    for (let i = 0; i < 40; i++) pose(anim);
    rig.root.position.copy(pos);
    rig.root.rotation.y = yaw;
    rig.root.scale.setScalar(scale);
    this.scene.add(rig.root);
    this.statues.push(rig);
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
    // reaching for a falling Eye
    this.statue(blank, false, spots[0], face(spots[0]), 24, (a) => a.update(0.1, { state: AnimState.Catch, param: 0, speed: 0, vy: 0, grounded: true }));
    // faceless Agent standing guard
    this.statue(AGENT_APPEARANCE, true, spots[1], face(spots[1]), 26, (a) => a.update(0.1, { state: AnimState.Idle, param: 0, speed: 0, vy: 0, grounded: true }));
    // pressing the Eye into the chest
    this.statue({ ...blank, hat: 'hood', top: 'hoodie' }, false, spots[2], face(spots[2]), 24, (a) => a.update(0.1, { state: AnimState.Absorb, param: 0.9, speed: 0, vy: 0, grounded: true }));
    // Agent mid-kick
    this.statue(AGENT_APPEARANCE, true, spots[3], face(spots[3]), 22, (a) => a.update(0.1, { state: AnimState.Attack, param: packAttack(AttackId.Kick, 0.5), speed: 0, vy: 0, grounded: true }));
    // The Warden at Agent HQ
    const hq = this.islands.find((i) => i.def.id === 'agenthq');
    const sp = hq?.anchors.statue?.[0];
    if (sp) {
      this.pillar(b, sp.x, sp.z, 10, 0);
      this.statue(AGENT_APPEARANCE, true, sp.clone().setY(0), face(sp) + Math.PI * 0, 16, (a) => a.update(0.1, { state: AnimState.Attack, param: packAttack(AttackId.Jab, 0.5), speed: 0, vy: 0, grounded: true }));
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
      mg.push(g.toNonIndexed());
    }
    const mountains = new THREE.Mesh(mergeGeometries(mg)!, new THREE.MeshBasicMaterial({ color: '#9b9ba6', fog: false }));
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
        cg.push(g.toNonIndexed());
      }
    }
    const clouds = new THREE.Mesh(mergeGeometries(cg)!, this.mats.cloud);
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
    void this.time;
  }
}
