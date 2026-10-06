import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Physics } from '../physics/Physics';
import type { WorldMaterials } from './Materials';
import { dripTexture } from './Textures';
import { makeRng } from '../core/math';

interface Chunk {
  center: THREE.Vector3;
  half: THREE.Vector3;
  rot: THREE.Quaternion;
}

interface Wall {
  id: number;
  base: THREE.Vector3;
  size: THREE.Vector3;
  intact: THREE.Group;
  collider: RAPIER.Collider | null;
  chunks: Chunk[];
  broken: boolean;
  rebuildTimer: number;
}

interface Debris {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  life: number;
}

const REBUILD_TIME = 45;
const DEBRIS_LIFE = 4.5;

/**
 * Cracked walls that burst into low-poly chunks when tackled, dashed through
 * or hit by the Iron charge (reference 2.0 s). The fact of the break is the
 * only thing that needs to be synced over the network; chunk physics is local.
 */
export class Destructibles {
  private walls: Wall[] = [];
  private debris: Debris[] = [];
  private chunkGeo = new THREE.BoxGeometry(1, 1, 1);
  private crackMat: THREE.MeshStandardMaterial;
  onBreak: ((id: number, point: THREE.Vector3, dir: THREE.Vector3) => void) | null = null;

  constructor(private scene: THREE.Scene, private physics: Physics, private mats: WorldMaterials) {
    this.crackMat = new THREE.MeshStandardMaterial({ color: '#111114', transparent: true, map: dripTexture(9), alphaTest: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  }

  /** `base` is the bottom-centre of the wall. */
  add(base: THREE.Vector3, size: THREE.Vector3): number {
    const id = this.walls.length;
    const rng = makeRng(1000 + id);
    const chunks: Chunk[] = [];
    // fracture into a jittered brick grid
    const cols = Math.max(2, Math.round(size.x / 0.9));
    const rows = Math.max(2, Math.round(size.y / 0.8));
    const layers = size.z > 1.5 ? 2 : 1;
    for (let r = 0; r < rows; r++) {
      const offset = r % 2 ? 0.5 : 0;
      for (let c = 0; c < cols + (offset ? 1 : 0); c++) {
        for (let l = 0; l < layers; l++) {
          let x0 = -size.x / 2 + ((c - offset) / cols) * size.x;
          let x1 = -size.x / 2 + ((c + 1 - offset) / cols) * size.x;
          x0 = Math.max(x0, -size.x / 2);
          x1 = Math.min(x1, size.x / 2);
          if (x1 - x0 < 0.05) continue;
          const y0 = (r / rows) * size.y;
          const y1 = ((r + 1) / rows) * size.y;
          const z0 = -size.z / 2 + (l / layers) * size.z;
          const z1 = -size.z / 2 + ((l + 1) / layers) * size.z;
          const half = new THREE.Vector3((x1 - x0) / 2 - 0.01, (y1 - y0) / 2 - 0.01, (z1 - z0) / 2 - 0.01);
          const center = new THREE.Vector3(base.x + (x0 + x1) / 2, base.y + (y0 + y1) / 2, base.z + (z0 + z1) / 2);
          const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.04, 0.04), rng.range(-0.04, 0.04), rng.range(-0.04, 0.04)));
          chunks.push({ center, half, rot });
        }
      }
    }
    const intact = new THREE.Group();
    this.scene.add(intact);
    const wall: Wall = { id, base: base.clone(), size: size.clone(), intact, collider: null, chunks, broken: false, rebuildTimer: 0 };
    this.walls.push(wall);
    this.buildIntact(wall);
    return id;
  }

  private buildIntact(w: Wall) {
    w.intact.clear();
    const mesh = new THREE.InstancedMesh(this.chunkGeo, this.mats.white, w.chunks.length);
    const m = new THREE.Matrix4();
    w.chunks.forEach((c, i) => {
      m.compose(c.center, c.rot, c.half.clone().multiplyScalar(2));
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    w.intact.add(mesh);
    // painted cracks: a dark drip decal on both faces, so players read "breakable"
    for (const s of [1, -1]) {
      const crack = new THREE.Mesh(new THREE.PlaneGeometry(w.size.x * 0.7, w.size.y * 0.8), this.crackMat);
      crack.position.set(w.base.x, w.base.y + w.size.y * 0.55, w.base.z + (w.size.z / 2 + 0.03) * s);
      crack.rotation.y = s > 0 ? 0 : Math.PI;
      crack.rotation.z = Math.PI;
      w.intact.add(crack);
    }
    const center = w.base.clone().add(new THREE.Vector3(0, w.size.y / 2, 0));
    w.collider = this.physics.addStaticBox(center, w.size, 'concrete');
    this.physics.tags.set(w.collider.handle, { destructible: w.id });
  }

  /** Destructible id for a collider, if any. */
  idOf(collider: RAPIER.Collider): number | undefined {
    return this.physics.tags.get(collider.handle)?.destructible;
  }

  isIntact(id: number): boolean {
    return !!this.walls[id] && !this.walls[id].broken;
  }

  /** Nearest intact wall within `range` of a point (used by tackles/dashes). */
  findNear(p: THREE.Vector3, range: number): number | null {
    let best: number | null = null;
    let bestD = range;
    for (const w of this.walls) {
      if (w.broken) continue;
      const cx = THREE.MathUtils.clamp(p.x, w.base.x - w.size.x / 2, w.base.x + w.size.x / 2);
      const cy = THREE.MathUtils.clamp(p.y, w.base.y, w.base.y + w.size.y);
      const cz = THREE.MathUtils.clamp(p.z, w.base.z - w.size.z / 2, w.base.z + w.size.z / 2);
      const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz);
      if (d < bestD) {
        bestD = d;
        best = w.id;
      }
    }
    return best;
  }

  smash(id: number, point: THREE.Vector3, dir: THREE.Vector3, notify = true) {
    const w = this.walls[id];
    if (!w || w.broken) return;
    w.broken = true;
    w.rebuildTimer = REBUILD_TIME;
    w.intact.clear();
    if (w.collider) {
      this.physics.removeCollider(w.collider);
      w.collider = null;
    }
    const rng = makeRng(Math.floor(performance.now()));
    for (const c of w.chunks) {
      const { body } = this.physics.addDebris(c.center, c.half, c.rot);
      const away = c.center.clone().sub(point);
      const dist = Math.max(0.5, away.length());
      const push = dir.clone().multiplyScalar(9 / dist).add(away.normalize().multiplyScalar(3)).add(new THREE.Vector3(rng.range(-1, 1), rng.range(1, 3), rng.range(-1, 1)));
      const mass = body.mass();
      body.applyImpulse({ x: push.x * mass, y: push.y * mass, z: push.z * mass }, true);
      body.applyTorqueImpulse({ x: rng.range(-1, 1) * mass, y: rng.range(-1, 1) * mass, z: rng.range(-1, 1) * mass }, true);
      const mesh = new THREE.Mesh(this.chunkGeo, this.mats.white);
      mesh.scale.copy(c.half).multiplyScalar(2);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.debris.push({ body, mesh, life: DEBRIS_LIFE + rng.range(0, 1.5) });
    }
    // cap debris count
    while (this.debris.length > 220) this.removeDebris(0);
    if (notify) this.onBreak?.(id, point, dir);
  }

  private removeDebris(i: number) {
    const d = this.debris[i];
    this.physics.removeBody(d.body);
    d.mesh.removeFromParent();
    this.debris.splice(i, 1);
  }

  update(dt: number) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      const t = d.body.translation();
      const r = d.body.rotation();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (d.life < 0.6) d.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 4));
      if (d.life <= 0 || t.y < -40) this.removeDebris(i);
    }
    for (const w of this.walls) {
      if (!w.broken) continue;
      w.rebuildTimer -= dt;
      if (w.rebuildTimer <= 0) {
        w.broken = false;
        this.buildIntact(w);
      }
    }
  }
}
