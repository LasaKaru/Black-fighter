import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Physics, Surface } from '../physics/Physics';
import type { WorldMaterials } from './Materials';

export type MatKey = keyof WorldMaterials;

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Static-geometry builder: authors boxes, ramps, stairs, lathes and decals,
 * registers matching Rapier colliders, then merges everything per material
 * into a few meshes (one chunk = one cullable group). Every island and the
 * hub are separate chunks so off-screen ones are frustum-culled.
 */
export class Builder {
  protected geos = new Map<MatKey, THREE.BufferGeometry[]>();
  protected decalGeos = new Map<string, { tex: THREE.Texture; color: string; geos: THREE.BufferGeometry[]; emissive?: boolean }>();
  /** XZ footprints of everything authored above ground (used to find free building lots). */
  readonly footprints: THREE.Box3[] = [];
  /** Set false while authoring ground slabs that should not block lots. */
  recordFootprints = true;

  constructor(readonly physics: Physics, readonly mats: WorldMaterials) {}

  /** Add arbitrary geometry under a material (already in world space). */
  add(key: MatKey, g: THREE.BufferGeometry) {
    if (!this.geos.has(key)) this.geos.set(key, []);
    if (this.recordFootprints) {
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      if (bb.max.y > 0.03 && bb.max.x - bb.min.x < 400 && bb.max.z - bb.min.z < 400) this.footprints.push(bb.clone());
    }
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    this.geos.get(key)!.push(g);
  }

  /** Geometry placed with position / euler rotation / scale. */
  place(key: MatKey, g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    this.add(key, g);
  }

  /** Axis-aligned box from min/max corners (with an optional collider). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: MatKey, surface: Surface | null = 'concrete') {
    const size = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
    const center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const g = new THREE.BoxGeometry(size.x, size.y, size.z);
    g.translate(center.x, center.y, center.z);
    this.add(mat, g);
    if (surface) this.physics.addStaticBox(center, size, surface);
    return { center, size };
  }

  /** Box by centre/size, rotated around Y. */
  boxAt(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY: number, mat: MatKey, surface: Surface | null = 'concrete') {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateY(rotY);
    g.translate(cx, cy, cz);
    this.add(mat, g);
    if (surface) {
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      this.physics.addStaticBox(new THREE.Vector3(cx, cy, cz), new THREE.Vector3(sx, sy, sz), surface, q);
    }
  }

  /** A slab whose top surface runs from `from` to `to` (both centre points of the top edge). */
  ramp(from: THREE.Vector3, to: THREE.Vector3, width: number, thickness: number, mat: MatKey | null, surface: Surface | null) {
    const dir = to.clone().sub(from);
    const horiz = Math.hypot(dir.x, dir.z);
    const len = dir.length();
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = Math.atan2(dir.y, horiz);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
    const center = from.clone().add(to).multiplyScalar(0.5);
    center.add(new THREE.Vector3(0, -thickness / 2, 0).applyQuaternion(q));
    if (mat) {
      const g = new THREE.BoxGeometry(width, thickness, len);
      g.applyQuaternion(q);
      g.translate(center.x, center.y, center.z);
      this.add(mat, g);
    }
    if (surface) this.physics.addStaticBox(center, new THREE.Vector3(width, thickness, len), surface, q);
    return { center, quat: q, len };
  }

  /** Visual stairs with a smooth ramp collider, along any horizontal direction. */
  stairs(start: THREE.Vector3, end: THREE.Vector3, width: number, mat: MatKey = 'white', rails: MatKey | null = 'dark') {
    const rise = end.y - start.y;
    const run = new THREE.Vector3(end.x - start.x, 0, end.z - start.z);
    const runLen = run.length();
    const steps = Math.max(2, Math.round(Math.abs(rise) / 0.25));
    const dirN = run.clone().normalize();
    const yaw = Math.atan2(dirN.x, dirN.z);
    const baseY = Math.min(start.y, end.y);
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const top = rise > 0 ? start.y + rise * t1 : start.y + rise * t0;
      const mid = start.clone().addScaledVector(run, (t0 + t1) / 2);
      const h = Math.max(0.05, top - baseY + 0.01);
      const g = new THREE.BoxGeometry(width, h, runLen / steps + 0.01);
      g.rotateY(yaw);
      g.translate(mid.x, baseY - 0.01 + h / 2, mid.z);
      this.add(mat, g);
    }
    if (rails) {
      for (const s of [-1, 1]) {
        const side = new THREE.Vector3(-dirN.z, 0, dirN.x).multiplyScalar((width / 2 + 0.25) * s);
        const a = start.clone().add(side);
        a.y += 0.6;
        const b = end.clone().add(side);
        b.y += 0.6;
        this.ramp(a, b, 0.5, 0.62, rails, 'concrete');
      }
    }
    this.ramp(start, end, width, 0.4, null, 'concrete');
  }

  /** Plank rope bridge with sagging rails and a flat walkable collider. */
  ropeBridge(from: THREE.Vector3, to: THREE.Vector3, width: number) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const n = dir.clone().normalize();
    const side = new THREE.Vector3(-n.z, 0, n.x);
    const planks = Math.floor(len / 0.6);
    for (let i = 0; i < planks; i++) {
      const t = (i + 0.5) / planks;
      const sag = Math.sin(t * Math.PI) * 0.25;
      const c = from.clone().add(dir.clone().multiplyScalar(t));
      c.y -= sag + 0.08;
      const g = new THREE.BoxGeometry(width, 0.08, 0.5);
      g.lookAt(n);
      g.translate(c.x, c.y, c.z);
      this.add('wood', g);
    }
    // ropes
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const p = from.clone().add(dir.clone().multiplyScalar(t)).add(side.clone().multiplyScalar((width / 2) * s));
        p.y += 0.9 - Math.sin(t * Math.PI) * 0.35;
        pts.push(p);
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      this.add('dark', new THREE.TubeGeometry(curve, 24, 0.035, 4));
    }
    // flat collider slightly below planks (character snaps to it)
    const center = from.clone().add(to).multiplyScalar(0.5);
    center.y -= 0.2;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    this.physics.addStaticBox(center, new THREE.Vector3(width, 0.2, len), 'wood', q);
  }

  /** Cylinder / truncated cone, optionally with a collider (cylinder uses the larger radius). */
  cyl(x: number, y0: number, z: number, rTop: number, rBot: number, h: number, seg: number, mat: MatKey, surface: Surface | null = 'concrete', flatTop = true) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !flatTop);
    g.translate(x, y0 + h / 2, z);
    this.add(mat, g);
    if (surface) this.physics.addStaticCylinder(new THREE.Vector3(x, y0 + h / 2, z), Math.max(rTop, rBot) * 0.95, h, surface);
  }

  /** Lathe (domes, minarets, vases) from a radius/height profile. */
  lathe(x: number, y: number, z: number, profile: Array<[number, number]>, seg: number, mat: MatKey, scale = 1) {
    const g = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r * scale, h * scale)), seg);
    g.translate(x, y, z);
    this.add(mat, g);
  }

  decal(texKey: string, tex: THREE.Texture, color: string, w: number, h: number, pos: THREE.Vector3, normal: THREE.Vector3, rot = 0, emissive = false) {
    const g = new THREE.PlaneGeometry(w, h);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    g.rotateZ(rot);
    g.applyQuaternion(q);
    const p = pos.clone().add(normal.clone().multiplyScalar(0.02));
    g.translate(p.x, p.y, p.z);
    const key = `${texKey}|${color}|${emissive}`;
    if (!this.decalGeos.has(key)) this.decalGeos.set(key, { tex, color, geos: [], emissive });
    this.decalGeos.get(key)!.geos.push(g);
  }

  /** True if the XZ rectangle (grown by `margin`) is clear of authored geometry. */
  lotFree(x0: number, x1: number, z0: number, z1: number, margin = 1.5, maxY = Infinity): boolean {
    for (const f of this.footprints) {
      if (f.min.y > maxY) continue;
      if (f.max.x > x0 - margin && f.min.x < x1 + margin && f.max.z > z0 - margin && f.min.z < z1 + margin) return false;
    }
    return true;
  }

  /** Merge everything authored so far into `group` and reset. */
  finalize(group: THREE.Group, opts: { shadows?: boolean } = {}) {
    const shadows = opts.shadows ?? true;
    for (const [key, list] of this.geos) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.mats[key]);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    this.geos.clear();
    for (const [, d] of this.decalGeos) {
      const merged = mergeGeometries(d.geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
      if (!merged) continue;
      const mat = new THREE.MeshStandardMaterial({
        map: d.tex,
        color: d.color,
        transparent: true,
        alphaTest: 0.1,
        depthWrite: false,
        roughness: 0.6,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        emissive: d.emissive ? '#ff7a1a' : '#000000',
        emissiveMap: d.emissive ? d.tex : null,
        emissiveIntensity: d.emissive ? 0.6 : 0,
      });
      // the realistic art style fades ink decals into faint stains (eyes stay)
      mat.userData.decal = d.emissive ? 'glow' : 'ink';
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true;
      mesh.renderOrder = 1;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    this.decalGeos.clear();
  }
}
