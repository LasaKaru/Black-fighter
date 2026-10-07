import * as THREE from 'three';
import type { IslandCtx, Hill } from './types';
import { groundHeight } from './types';
import type { MatKey } from '../Builder';
import type { TreeKind } from '../Vegetation';
import type { Surface } from '../../physics/Physics';
import { signTexture } from '../Textures';

/** Deterministic vertex jitter for faceted rocks. */
export function jitter(g: THREE.BufferGeometry, amount: number, seed: number, keepBottom = true) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  // hash positions so shared vertices move together (no cracks)
  const h = (x: number, y: number, z: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
    return s - Math.floor(s) - 0.5;
  };
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (keepBottom && Math.abs(y - minY) < 1e-3) continue;
    const k = amount;
    pos.setXYZ(i, x + h(x, y, z) * k, y + h(y, z, x) * k * 0.6, z + h(z, x, y) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** The floating island itself: grassy top, faceted rock underside, edge stones. */
export function islandBase(ctx: IslandCtx, ground: MatKey, rim: MatKey = 'rock') {
  const { b, c, R, rng } = ctx;
  const top = new THREE.CylinderGeometry(R, R * 0.985, 3, 40, 1);
  top.translate(c.x, -1.5, c.z);
  b.add(ground, top);
  const under = jitter(new THREE.ConeGeometry(R * 0.985, R * 0.75, 18, 4, true), 3.5, c.x + c.z);
  under.rotateX(Math.PI);
  under.translate(c.x, -3 - R * 0.375, c.z);
  b.add(rim, under);
  ctx.physics.addStaticCylinder(new THREE.Vector3(c.x, -1.5, c.z), R, 3, 'concrete');
  // edge boulders & hanging roots for silhouette
  for (let i = 0; i < Math.round(R / 3); i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = R - rng.range(0.5, 3);
    const s = rng.range(0.6, 2.2);
    const g = jitter(new THREE.DodecahedronGeometry(s, 0), 0.3, i);
    g.translate(c.x + Math.cos(a) * r, s * 0.3, c.z + Math.sin(a) * r);
    b.add(rim, g);
  }
  for (let i = 0; i < 10; i++) {
    const a = rng.range(0, Math.PI * 2);
    const g = new THREE.ConeGeometry(rng.range(1, 3), rng.range(8, 22), 5);
    g.rotateX(Math.PI);
    g.translate(c.x + Math.cos(a) * R * 0.8, -6 - rng.range(0, 8), c.z + Math.sin(a) * R * 0.8);
    b.add(rim, g);
  }
}

/** A grassy hill cap (spherical cap above y=0) with a ball collider. */
export function hillCap(ctx: IslandCtx, x: number, z: number, r: number, h: number, mat: MatKey = 'grass'): Hill {
  const cy = h - r;
  const theta = Math.acos(THREE.MathUtils.clamp(-cy / r, -1, 1));
  const g = new THREE.SphereGeometry(r, 26, 12, 0, Math.PI * 2, 0, theta);
  g.translate(x, cy, z);
  ctx.b.add(mat, jitter(g, Math.min(1.2, r * 0.04), x * 3 + z, false));
  ctx.physics.addStaticBall(new THREE.Vector3(x, cy, z), r * 0.995, 'concrete');
  const hill = { x, z, cy, r };
  ctx.info.hills.push(hill);
  return hill;
}

/** Faceted mesa/rock with stacked cylinder colliders that follow its taper. */
export function rockMass(ctx: IslandCtx, x: number, z: number, rBot: number, rTop: number, h: number, mat: MatKey, seed: number, slices = 4) {
  const raw = new THREE.CylinderGeometry(rTop, rBot, h, 28, 12);
  // Weathering: vertical erosion grooves and recessed strata. Only ever pulls
  // the surface inwards, so the collision cylinders below stay a tight hull,
  // and fades out near the summit so whatever sits on top keeps its footing.
  const pos = raw.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const t = pos.getY(i) / h + 0.5;
    const r = Math.hypot(px, pz);
    if (r < 1e-3) continue;
    const a = Math.atan2(pz, px);
    const fade = 1 - THREE.MathUtils.smoothstep(t, 0.82, 1);
    const groove = 0.06 * (0.5 + 0.5 * Math.sin(a * 7 + seed)) + 0.04 * (0.5 + 0.5 * Math.sin(a * 17 + t * 4 + seed * 2));
    const strata = (t * 6) % 1 < 0.22 ? 0.025 : 0;
    const m = 1 - (groove + strata) * fade - 0.02;
    pos.setX(i, px * m);
    pos.setZ(i, pz * m);
  }
  const g = jitter(raw, Math.min(1.6, rBot * 0.06), seed);
  g.translate(x, h / 2, z);
  ctx.b.add(mat, g);
  // rounded top
  const cap = jitter(new THREE.SphereGeometry(rTop * 0.98, 28, 5, 0, Math.PI * 2, 0, Math.PI * 0.18), 0.6, seed + 1, false);
  cap.translate(x, h - rTop * Math.cos(Math.PI * 0.18) + 0.2, z);
  ctx.b.add(mat, cap);
  for (let i = 0; i < slices; i++) {
    const t0 = i / slices;
    const t1 = (i + 1) / slices;
    const r = THREE.MathUtils.lerp(rBot, rTop, (t0 + t1) / 2) * 0.96;
    ctx.physics.addStaticCylinder(new THREE.Vector3(x, h * (t0 + t1) / 2, z), r, h / slices, 'concrete');
  }
}

/** Scatter trees on the island, avoiding a predicate. */
export function scatter(ctx: IslandCtx, kind: TreeKind, n: number, rMin: number, rMax: number, avoid: (x: number, z: number) => boolean = () => false, scale: [number, number] = [0.8, 1.3], collide = true) {
  const { c, rng } = ctx;
  let placed = 0;
  for (let tries = 0; tries < n * 6 && placed < n; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.range(rMin * rMin, rMax * rMax));
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    if (avoid(x, z)) continue;
    const y = groundHeight(ctx.info.hills, x, z);
    ctx.veg.add(kind, x, y, z, rng.range(scale[0], scale[1]), rng.range(0, Math.PI * 2), collide);
    placed++;
  }
}

/** Island name sign on two posts. */
export function signBoard(ctx: IslandCtx, x: number, z: number, yaw: number, title: string, sub: string) {
  const { b } = ctx;
  for (const s of [-1, 1]) {
    const px = x + Math.cos(yaw) * s * 3.2;
    const pz = z - Math.sin(yaw) * s * 3.2;
    b.cyl(px, 0, pz, 0.15, 0.15, 4.2, 6, 'dark', 'concrete');
  }
  const mat = new THREE.MeshStandardMaterial({ map: signTexture(title, sub), roughness: 0.6, emissive: '#ffffff', emissiveMap: signTexture(title, sub), emissiveIntensity: 0.25 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.2), mat);
  m.position.set(x, 3.4, z);
  m.rotation.y = yaw;
  const back = new THREE.Mesh(new THREE.BoxGeometry(7.3, 2.5, 0.2), ctx.mats.dark);
  back.position.set(x - Math.sin(yaw) * 0.12, 3.4, z - Math.cos(yaw) * 0.12);
  back.rotation.y = yaw;
  ctx.group.add(m, back);
}

/** Small house: walls, gable roof, door and windows. */
export function house(ctx: IslandCtx, x: number, z: number, w: number, d: number, h: number, yaw: number, wall: MatKey, roof: MatKey, surface: Surface | null = 'concrete') {
  const { b } = ctx;
  b.boxAt(x, h / 2, z, w, h, d, yaw, wall, surface);
  // gable roof as a triangular prism
  const r = new THREE.CylinderGeometry(1, 1, d + 0.6, 3, 1);
  r.rotateX(Math.PI / 2);
  r.rotateZ(Math.PI / 2);
  r.scale((w / 2 + 0.4) / Math.cos(Math.PI / 6), h * 0.35, 1);
  r.rotateY(yaw);
  r.translate(x, h + h * 0.17, z);
  b.add(roof, r);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  b.boxAt(x + fx * (d / 2 + 0.02), 1.0, z + fz * (d / 2 + 0.02), 1.0, 2.0, 0.08, yaw, 'dark', null);
  for (const s of [-1, 1]) {
    const rx = Math.cos(yaw) * s * w * 0.3;
    const rz = -Math.sin(yaw) * s * w * 0.3;
    b.boxAt(x + fx * (d / 2 + 0.03) + rx, h * 0.6, z + fz * (d / 2 + 0.03) + rz, 0.9, 0.8, 0.08, yaw, 'glass', null);
  }
}

/** Street lamp (emissive head, no real light: cheap). */
export function lampPost(ctx: IslandCtx, x: number, y: number, z: number, h = 4.5) {
  ctx.b.cyl(x, y, z, 0.08, 0.12, h, 6, 'dark', null);
  ctx.info.poles.push({ x, y, z, h });
  const head = new THREE.SphereGeometry(0.22, 8, 6);
  head.translate(x, y + h + 0.1, z);
  ctx.b.add('lamp', head);
}

/** Paved plaza disc + low ring wall. */
export function plaza(ctx: IslandCtx, x: number, z: number, r: number, mat: MatKey = 'stone') {
  const g = new THREE.CylinderGeometry(r, r, 0.12, 32);
  g.translate(x, 0.06, z);
  ctx.b.add(mat, g);
}

/** Flat path ribbon on the ground following points (visual only). */
export function path(ctx: IslandCtx, pts: THREE.Vector3[], width: number, mat: MatKey = 'sand') {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const bb = pts[i + 1];
    const len = a.distanceTo(bb);
    const g = new THREE.BoxGeometry(width, 0.08, len + width * 0.5);
    g.rotateY(Math.atan2(bb.x - a.x, bb.z - a.z));
    g.translate((a.x + bb.x) / 2, Math.max(a.y, bb.y) + 0.04, (a.z + bb.z) / 2);
    ctx.b.add(mat, g);
  }
}
