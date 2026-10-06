import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/Physics';
import type { WorldMaterials } from './Materials';
import type { MatKey } from './Builder';

export type TreeKind = 'palm' | 'broadleaf' | 'cypress' | 'pine' | 'banana' | 'tea' | 'bush' | 'boulder' | 'inkTree' | 'mushroom' | 'orb';

interface PartDef {
  geo: THREE.BufferGeometry;
  mat: MatKey;
}

interface KindDef {
  parts: PartDef[];
  /** Trunk collider radius/height at scale 1 (0 = no collider). */
  colR: number;
  colH: number;
}

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function merged(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => {
    for (const name of Object.keys(x.attributes)) if (!['position', 'normal'].includes(name)) x.deleteAttribute(name);
    return x;
  }), false)!;
  g.computeBoundingSphere();
  return g;
}

let KINDS: Record<TreeKind, KindDef> | null = null;

/** Low-poly tree kit, built once and shared by every island. */
function kinds(): Record<TreeKind, KindDef> {
  if (KINDS) return KINDS;
  // palm: curved segmented trunk + drooping fronds
  const trunk: THREE.BufferGeometry[] = [];
  let x = 0;
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.CylinderGeometry(0.2 - i * 0.012, 0.24 - i * 0.012, 1.25, 6);
    seg.rotateZ(-0.05 - i * 0.03);
    seg.translate(x, 0.6 + i * 1.18, 0);
    x += 0.07 + i * 0.03;
    trunk.push(seg);
  }
  const top = new THREE.Vector3(x, 8.5, 0);
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.ConeGeometry(0.45, 3.6, 4);
    leaf.scale(1, 1, 0.18);
    leaf.translate(0, 1.8, 0);
    leaf.rotateZ(-1.15 - (i % 2) * 0.35);
    leaf.rotateY((i / 9) * Math.PI * 2);
    leaf.translate(top.x, top.y, top.z);
    fronds.push(leaf);
  }
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.IcosahedronGeometry(0.2, 0);
    nut.translate(top.x + Math.cos(i * 2.1) * 0.25, top.y - 0.25, Math.sin(i * 2.1) * 0.25);
    trunk.push(nut);
  }
  // broadleaf
  const bl: THREE.BufferGeometry[] = [];
  for (const [cx, cy, cz, r] of [[0, 4.2, 0, 1.9], [1.1, 3.6, 0.5, 1.3], [-1.0, 3.7, -0.4, 1.4], [0.2, 5.2, -0.3, 1.2]] as const) {
    const s = new THREE.IcosahedronGeometry(r, 1);
    s.translate(cx, cy, cz);
    bl.push(s);
  }
  const blTrunk = new THREE.CylinderGeometry(0.18, 0.32, 3.4, 6);
  blTrunk.translate(0, 1.7, 0);
  // cypress
  const cyp = new THREE.ConeGeometry(0.85, 6.5, 7);
  cyp.translate(0, 4.2, 0);
  const cypTrunk = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 5);
  cypTrunk.translate(0, 0.6, 0);
  // pine
  const pine: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.ConeGeometry(2.1 - i * 0.55, 2.6, 7);
    c.translate(0, 2.4 + i * 1.5, 0);
    pine.push(c);
  }
  const pineTrunk = new THREE.CylinderGeometry(0.16, 0.24, 2, 5);
  pineTrunk.translate(0, 1, 0);
  // banana
  const ban: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const l = new THREE.BoxGeometry(0.7, 0.05, 2.4);
    l.translate(0, 0, 1.2);
    l.rotateX(-0.5 - (i % 2) * 0.3);
    l.rotateY((i / 6) * Math.PI * 2);
    l.translate(0, 2.6, 0);
    ban.push(l);
  }
  const banTrunk = new THREE.CylinderGeometry(0.16, 0.26, 2.7, 6);
  banTrunk.translate(0, 1.35, 0);
  // tea bush, shrub, boulder
  const tea = new THREE.IcosahedronGeometry(0.75, 1);
  tea.scale(1.25, 0.65, 1.25);
  tea.translate(0, 0.45, 0);
  const bush = new THREE.IcosahedronGeometry(0.9, 1);
  bush.scale(1, 0.75, 1);
  bush.translate(0, 0.55, 0);
  const boulder = new THREE.DodecahedronGeometry(1, 0);
  boulder.scale(1.2, 0.8, 1);
  boulder.translate(0, 0.45, 0);
  // ink tree: white trunk, black blob canopy with drips (hub style)
  const inkC: THREE.BufferGeometry[] = [];
  for (const [cx, cy, cz, r] of [[0, 4, 0, 1.7], [0.9, 3.4, 0.3, 1.1], [-0.8, 3.6, -0.3, 1.2]] as const) {
    const s = new THREE.IcosahedronGeometry(r, 1);
    s.translate(cx, cy, cz);
    inkC.push(s);
  }
  for (let i = 0; i < 5; i++) {
    const d = new THREE.CylinderGeometry(0.08, 0.05, 1.2, 4);
    d.translate(Math.cos(i * 1.3) * 1.2, 2.4, Math.sin(i * 1.3) * 1.2);
    inkC.push(d);
  }
  const inkTrunk = new THREE.CylinderGeometry(0.16, 0.3, 3.2, 6);
  inkTrunk.translate(0, 1.6, 0);
  // mushroom statue (the reference's white lathe "mushrooms" on the plaza)
  const mp: Array<[number, number]> = [[0, 0], [0.55, 0], [0.45, 0.4], [0.35, 1.6], [0.4, 2.1], [1.4, 2.2], [1.5, 2.5], [1.2, 2.95], [0.6, 3.2], [0, 3.3]];
  const mush = new THREE.LatheGeometry(mp.map(([r, h]) => new THREE.Vector2(r, h)), 9);
  // faceted orb on a short plinth (the big grey balls in the reference)
  const orb = new THREE.IcosahedronGeometry(1.3, 1);
  orb.translate(0, 1.75, 0);
  const plinth = new THREE.CylinderGeometry(0.55, 0.75, 0.6, 6);
  plinth.translate(0, 0.3, 0);

  KINDS = {
    palm: { parts: [{ geo: merged(trunk), mat: 'trunk' }, { geo: merged(fronds), mat: 'leafLight' }], colR: 0.25, colH: 8 },
    broadleaf: { parts: [{ geo: merged([blTrunk]), mat: 'trunk' }, { geo: merged(bl), mat: 'leafLight' }], colR: 0.3, colH: 3.4 },
    cypress: { parts: [{ geo: merged([cypTrunk]), mat: 'trunk' }, { geo: merged([cyp]), mat: 'grassDark' }], colR: 0.6, colH: 6 },
    pine: { parts: [{ geo: merged([pineTrunk]), mat: 'trunk' }, { geo: merged(pine), mat: 'grassDark' }], colR: 0.3, colH: 4 },
    banana: { parts: [{ geo: merged([banTrunk]), mat: 'leaf' }, { geo: merged(ban), mat: 'leafLight' }], colR: 0.25, colH: 2.5 },
    tea: { parts: [{ geo: merged([tea]), mat: 'tea' }], colR: 0, colH: 0 },
    bush: { parts: [{ geo: merged([bush]), mat: 'leafLight' }], colR: 0, colH: 0 },
    boulder: { parts: [{ geo: merged([boulder]), mat: 'grey' }], colR: 0.9, colH: 1.2 },
    inkTree: { parts: [{ geo: merged([inkTrunk]), mat: 'white' }, { geo: merged(inkC), mat: 'black' }], colR: 0.3, colH: 3.2 },
    mushroom: { parts: [{ geo: merged([mush]), mat: 'statue' }], colR: 0.45, colH: 3.1 },
    orb: { parts: [{ geo: merged([plinth]), mat: 'dark' }, { geo: merged([orb]), mat: 'grey' }], colR: 1.1, colH: 3 },
  };
  return KINDS;
}

/** Collects tree instances for one chunk and builds instanced meshes. */
export class Vegetation {
  private items = new Map<TreeKind, Array<{ m: THREE.Matrix4; tint: number; x: number; z: number; col: RAPIER.Collider | null }>>();
  count = 0;

  constructor(private physics: Physics, private mats: WorldMaterials) {}

  add(kind: TreeKind, x: number, y: number, z: number, scale = 1, rotY = Math.random() * Math.PI * 2, collide = true) {
    const def = kinds()[kind];
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    _p.set(x, y, z);
    _s.setScalar(scale);
    if (!this.items.has(kind)) this.items.set(kind, []);
    const col = collide && def.colR > 0 ? this.physics.addStaticCylinder(new THREE.Vector3(x, y + (def.colH * scale) / 2, z), def.colR * scale, def.colH * scale, 'wood') : null;
    this.items.get(kind)!.push({ m: new THREE.Matrix4().compose(_p, _q, _s), tint: 0.85 + Math.random() * 0.3, x, z, col });
    this.count++;
  }

  /** Remove every plant inside an XZ rectangle (used to clear building lots). */
  clearRect(x0: number, x1: number, z0: number, z1: number) {
    for (const list of this.items.values()) {
      for (let i = list.length - 1; i >= 0; i--) {
        const it = list[i];
        if (it.x > x0 && it.x < x1 && it.z > z0 && it.z < z1) {
          if (it.col) this.physics.removeCollider(it.col);
          list.splice(i, 1);
          this.count--;
        }
      }
    }
  }

  build(group: THREE.Group) {
    const c = new THREE.Color();
    for (const [kind, list] of this.items) {
      if (!list.length) continue;
      for (const part of kinds()[kind].parts) {
        const mesh = new THREE.InstancedMesh(part.geo, this.mats[part.mat], list.length);
        list.forEach((it, i) => {
          mesh.setMatrixAt(i, it.m);
          mesh.setColorAt(i, c.setScalar(it.tint));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = kind !== 'tea';
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    this.items.clear();
  }
}

