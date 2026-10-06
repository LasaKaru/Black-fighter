import * as THREE from 'three';
import type { Builder } from '../Builder';
import type { Vegetation } from '../Vegetation';
import type { Rng } from '../../core/math';
import type { Physics } from '../../physics/Physics';
import type { WorldMaterials } from '../Materials';

export type Biome = 'tropical' | 'highland' | 'desert' | 'temperate' | 'mountain' | 'ink' | 'jungle' | 'garden';

export interface IslandDef {
  id: string;
  name: string;
  country: string;
  /** Angle on the world ring (degrees). */
  angle: number;
  radius: number;
  biome: Biome;
  blurb: string;
}

/** A circular "hill" cap used for ground height queries (and to place trees/paths on slopes). */
export interface Hill {
  x: number;
  z: number;
  /** sphere centre y (usually below ground) */
  cy: number;
  r: number;
}

export interface MoverPath {
  kind: 'train' | 'cable';
  points: THREE.Vector3[];
  closed: boolean;
}

export interface ParkingSpot {
  pos: THREE.Vector3;
  yaw: number;
  type: string;
}

/** What an island builder hands back to the world. */
export interface IslandInfo {
  def: IslandDef;
  center: THREE.Vector3;
  /** Where players arrive by fast travel. */
  spawn: THREE.Vector3;
  /** Named points used by missions (summit, gate, ring positions…). */
  anchors: Record<string, THREE.Vector3[]>;
  hills: Hill[];
  movers: MoverPath[];
  parking: ParkingSpot[];
  /** Where NPCs stroll (world-space centre + radius). */
  wander: { c: THREE.Vector3; r: number }[];
  group: THREE.Group;
}

export interface IslandCtx {
  b: Builder;
  veg: Vegetation;
  rng: Rng;
  physics: Physics;
  mats: WorldMaterials;
  /** island centre (world) */
  c: THREE.Vector3;
  R: number;
  /** For non-merged/animated objects. */
  group: THREE.Group;
  info: IslandInfo;
}

/** Ground height at (x,z) given hill caps (world coordinates). */
export function groundHeight(hills: Hill[], x: number, z: number): number {
  let y = 0;
  for (const h of hills) {
    const d2 = (x - h.x) ** 2 + (z - h.z) ** 2;
    if (d2 < h.r * h.r) y = Math.max(y, h.cy + Math.sqrt(h.r * h.r - d2));
  }
  return y;
}

export function v(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z);
}
