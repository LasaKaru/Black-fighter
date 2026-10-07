import * as THREE from 'three';
import type { IslandCtx } from './types';
import { groundHeight, v } from './types';
import type { Builder, MatKey } from '../Builder';
import type { Rng } from '../../core/math';
import { dripTexture, wallEyeTexture } from '../Textures';
import { PALETTE } from '../Materials';
import type { EyeType } from '../City';

/**
 * The Ink City kit (reference frames): stacked white/black cube towers with
 * window cubes, teal glass, ink drips, painted wall eyes and rooftop knobs,
 * joined by plank bridges, swinging teal platforms and zip-line cables.
 * Every island gets a district of these around its landmark, so the whole
 * world reads as one city.
 */

interface Face {
  n: THREE.Vector3;
  c: THREE.Vector3;
  w: number;
}

function faces(x0: number, x1: number, z0: number, z1: number): Face[] {
  return [
    { n: v(0, 0, 1), c: v((x0 + x1) / 2, 0, z1), w: x1 - x0 },
    { n: v(0, 0, -1), c: v((x0 + x1) / 2, 0, z0), w: x1 - x0 },
    { n: v(1, 0, 0), c: v(x1, 0, (z0 + z1) / 2), w: z1 - z0 },
    { n: v(-1, 0, 0), c: v(x0, 0, (z0 + z1) / 2), w: z1 - z0 },
  ];
}

const EYE_IRIS = ['#111114', PALETTE.voidPurple, PALETTE.routeTeal, PALETTE.eyeFire];

/** Drips from the top edge, painted eyes, window cubes with teal glass. */
export function decorateBlock(b: Builder, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, dark: boolean, rng: Rng, opts: { eyes?: number; windows?: boolean } = {}) {
  const h = y1 - y0;
  for (const f of faces(x0, x1, z0, z1)) {
    const along = (t: number) => v(-f.n.z, 0, f.n.x).multiplyScalar(t);
    // ink drips (black on white, teal goo on black)
    if (rng.chance(dark ? 0.35 : 0.75) && h > 1.5) {
      const dw = Math.min(f.w * 0.9, rng.range(1.6, 4.5));
      const dh = Math.min(h * 0.9, dw * 2);
      const seed = rng.int(0, 5);
      const pos = f.c.clone().add(along(rng.range(-f.w / 2 + dw / 2, f.w / 2 - dw / 2))).setY(y1 - dh / 2 + 0.01);
      if (dark) b.decal(`gdrip${seed}`, dripTexture(seed, '#ffffff'), PALETTE.routeTeal, dw, dh, pos, f.n);
      else b.decal(`drip${seed}`, dripTexture(seed), '#ffffff', dw, dh, pos, f.n);
    }
    // painted wall eye
    if (rng.chance(opts.eyes ?? 0.3) && h > 3) {
      const s = Math.min(f.w * 0.35, rng.range(0.8, 2.2));
      const iris = rng.pick(EYE_IRIS);
      const y = y1 - rng.range(1.5, Math.min(h - 1, 7));
      const glow = iris === PALETTE.eyeFire;
      b.decal(`eye${iris}`, wallEyeTexture(iris, glow), '#ffffff', s * 1.2, s * 1.2, f.c.clone().add(along(rng.range(-f.w / 4, f.w / 4))).setY(y), f.n, 0, glow);
    }
    // window cubes: a dark frame sticking out with a teal pane
    if (opts.windows !== false && h > 2.5) {
      const n = rng.int(0, Math.min(3, Math.floor(h / 4)));
      for (let i = 0; i < n; i++) {
        const s = rng.range(0.7, Math.min(1.6, f.w * 0.3));
        const y = rng.range(y0 + 1.2, y1 - 1);
        const c = f.c.clone().add(along(rng.range(-f.w / 2 + s, f.w / 2 - s))).setY(y);
        const out = rng.range(0.15, 0.45);
        const fx = Math.abs(f.n.x) > 0.5;
        const frame = new THREE.BoxGeometry(fx ? out : s, s, fx ? s : out);
        frame.translate(c.x + f.n.x * out / 2, c.y, c.z + f.n.z * out / 2);
        b.add(dark ? 'white' : 'black', frame);
        if (rng.chance(0.7)) {
          const pane = new THREE.BoxGeometry(fx ? 0.04 : s * 0.7, s * 0.7, fx ? s * 0.7 : 0.04);
          pane.translate(c.x + f.n.x * (out + 0.02), c.y, c.z + f.n.z * (out + 0.02));
          b.add(rng.chance(0.8) ? 'glass' : 'purple', pane);
        }
      }
    }
  }
}

/** Little white knobs along the top edge (the "bollards" on reference rooftops). */
function knobs(b: Builder, x0: number, x1: number, y: number, z0: number, z1: number, rng: Rng) {
  const n = rng.int(1, 4);
  for (let i = 0; i < n; i++) {
    const x = rng.chance(0.5) ? rng.pick([x0 + 0.4, x1 - 0.4]) : rng.range(x0 + 0.4, x1 - 0.4);
    const z = rng.chance(0.5) ? rng.pick([z0 + 0.4, z1 - 0.4]) : rng.range(z0 + 0.4, z1 - 0.4);
    const g = new THREE.CapsuleGeometry(0.22, 0.25, 3, 8);
    g.translate(x, y + 0.35, z);
    b.add('statue', g);
  }
}

export interface Tower {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: number;
  dark: boolean;
  links: number;
}

/** A tower block with a plinth, trims, details, and (optionally) stacked cubes on top. */
export function towerBlock(b: Builder, t: Tower, rng: Rng, base = 0, collide = true) {
  const mat: MatKey = t.dark ? 'black' : 'white';
  b.box(t.x0, t.x1, base, t.h, t.z0, t.z1, mat, collide ? (t.dark ? 'ink' : 'concrete') : null);
  // plinth and top trim
  if (base >= 0) b.box(t.x0 - 0.2, t.x1 + 0.2, base, base + 0.45, t.z0 - 0.2, t.z1 + 0.2, t.dark ? 'dark' : 'grey', null);
  if (rng.chance(0.65)) b.box(t.x0 - 0.15, t.x1 + 0.15, t.h - 0.3, t.h + 0.06, t.z0 - 0.15, t.z1 + 0.15, t.dark ? 'dark' : 'grey', null);
  decorateBlock(b, t.x0, t.x1, Math.max(base, t.h - 14), t.h, t.z0, t.z1, t.dark, rng);
}

/** Stack a smaller block on a corner of the roof (kept off bridge landings). */
function stack(b: Builder, t: Tower, rng: Rng, collide: boolean) {
  const w = (t.x1 - t.x0) * rng.range(0.4, 0.6);
  const d = (t.z1 - t.z0) * rng.range(0.4, 0.6);
  const sx = rng.chance(0.5) ? t.x0 : t.x1 - w;
  const sz = rng.chance(0.5) ? t.z0 : t.z1 - d;
  const h = rng.range(1.8, 5);
  const dark = !t.dark;
  b.box(sx, sx + w, t.h, t.h + h, sz, sz + d, dark ? 'black' : 'white', collide ? 'concrete' : null);
  decorateBlock(b, sx, sx + w, t.h, t.h + h, sz, sz + d, dark, rng, { eyes: 0.4, windows: false });
}

/** A teal-tinted zip-line cable with end posts. */
export function zipline(b: Builder, out: { a: THREE.Vector3; b: THREE.Vector3 }[], a: THREE.Vector3, bb: THREE.Vector3, groundA: number, groundB: number) {
  for (const [p, g] of [[a, groundA], [bb, groundB]] as const) {
    b.cyl(p.x, g, p.z, 0.12, 0.16, p.y - g, 6, 'dark', null);
    const cap = new THREE.BoxGeometry(0.6, 0.3, 0.6);
    cap.translate(p.x, p.y + 0.15, p.z);
    b.add('neonTeal', cap);
  }
  const sag = a.distanceTo(bb) * 0.025;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(a.clone().lerp(bb, t).add(v(0, -Math.sin(t * Math.PI) * sag, 0)));
  }
  b.add('dark', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.05, 4));
  out.push({ a: a.clone(), b: bb.clone() });
}

export interface DistrictOpts {
  inner: number;
  outer: number;
  /** Tower lots to try to fill. */
  count: number;
  maxH: number;
}

const NEST_TYPES: EyeType[] = ['fire', 'sky', 'void', 'iron', 'tide', 'watcher'];

/**
 * Fill the free ring of an island with an Ink City district. Lots are taken
 * only where nothing has been authored yet (landmarks, paths, roads, plazas),
 * away from bridge landings, spawn points, NPC zones and parking.
 */
export function inkDistrict(ctx: IslandCtx, opts: DistrictOpts) {
  const { b, c, R, rng, info } = ctx;
  const towers: Tower[] = [];
  const blocked = (x: number, z: number, r: number) => {
    if (Math.hypot(x - c.x, z - c.z) + r > R - 3) return true;
    if (Math.hypot(x - info.spawn.x, z - info.spawn.z) < 16 + r) return true;
    for (const p of info.parking) if (Math.hypot(x - p.pos.x, z - p.pos.z) < 7 + r) return true;
    for (const w of info.wander) if (Math.hypot(x - w.c.x, z - w.c.z) < w.r + r) return true;
    for (const list of Object.values(info.anchors)) for (const p of list) if (Math.hypot(x - p.x, z - p.z) < 5 + r) return true;
    for (const g of info.gates) {
      // distance to the corridor running 34 m inwards from the bridge landing
      const rel = v(x - g.p.x, 0, z - g.p.z);
      const t = THREE.MathUtils.clamp(rel.dot(g.inward), 0, 34);
      const d = rel.clone().addScaledVector(g.inward, -t).length();
      if (d < 9 + r) return true;
    }
    return false;
  };
  const heights = [2.2, 4.4, 6, 8, 10, 13, 16, 20, 26, 32];
  for (let tries = 0; tries < opts.count * 8 && towers.length < opts.count; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(opts.inner, opts.outer);
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    const w = rng.range(3.5, 9);
    const d = rng.range(3.5, 9);
    const rad = Math.hypot(w, d) / 2;
    if (blocked(x, z, rad)) continue;
    if (groundHeight(info.hills, x, z) > 0.3) continue;
    const t: Tower = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h: Math.min(opts.maxH, rng.pick(heights) + rng.range(-0.4, 0.8)), dark: rng.chance(0.5), links: 0 };
    if (!b.lotFree(t.x0, t.x1, t.z0, t.z1, 1.8, t.h + 2)) continue;
    ctx.veg.clearRect(t.x0 - 1, t.x1 + 1, t.z0 - 1, t.z1 + 1);
    towerBlock(b, t, rng);
    towers.push(t);
  }
  const centre = (t: Tower) => v((t.x0 + t.x1) / 2, t.h, (t.z0 + t.z1) / 2);
  const gap = (A: Tower, B: Tower) => {
    const dx = Math.max(0, Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1));
    const dz = Math.max(0, Math.max(A.z0, B.z0) - Math.min(A.z1, B.z1));
    return Math.hypot(dx, dz);
  };
  // edge point of A facing B (on the roof, 0.3 m inside the parapet)
  const edgeToward = (A: Tower, B: Tower, y: number) => {
    const ca = centre(A);
    const cb = centre(B);
    const dir = cb.clone().sub(ca).setY(0).normalize();
    const hx = (A.x1 - A.x0) / 2;
    const hz = (A.z1 - A.z0) / 2;
    const s = Math.min(hx / Math.max(1e-3, Math.abs(dir.x)), hz / Math.max(1e-3, Math.abs(dir.z)));
    return ca.clone().addScaledVector(dir, s - 0.2).setY(y);
  };
  // plank rope bridges between neighbours of a similar height
  for (let i = 0; i < towers.length; i++) {
    for (let j = i + 1; j < towers.length; j++) {
      const A = towers[i];
      const B = towers[j];
      if (A.links >= 2 || B.links >= 2) continue;
      const g = gap(A, B);
      if (g < 2.5 || g > 13 || Math.abs(A.h - B.h) > 1.2 || Math.min(A.h, B.h) < 4) continue;
      const y = Math.min(A.h, B.h);
      const pa = edgeToward(A, B, y);
      const pb = edgeToward(B, A, y);
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      if (towers.some((T) => T !== A && T !== B && mid.x > T.x0 - 1 && mid.x < T.x1 + 1 && mid.z > T.z0 - 1 && mid.z < T.z1 + 1)) continue;
      b.ropeBridge(pa, pb, 2);
      A.links++;
      B.links++;
    }
  }
  // swinging teal platforms over wider gaps
  let swings = 0;
  for (let i = 0; i < towers.length && swings < 3; i++) {
    for (let j = i + 1; j < towers.length && swings < 3; j++) {
      const A = towers[i];
      const B = towers[j];
      const g = gap(A, B);
      if (g < 9 || g > 17 || Math.abs(A.h - B.h) > 2 || Math.min(A.h, B.h) < 6 || A.links >= 3 || B.links >= 3) continue;
      const y = Math.min(A.h, B.h);
      const pa = edgeToward(A, B, y);
      const pb = edgeToward(B, A, y);
      const axis = pb.clone().sub(pa).setY(0).normalize();
      const L = 12;
      const reach = Math.max(1, pa.distanceTo(pb) / 2 - 2.4);
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      info.swings.push({ pivot: mid.clone().setY(y + L - 0.2), length: L, axis, amplitude: Math.asin(Math.min(0.95, reach / L)), period: rng.range(3.6, 4.6), phase: rng.range(0, Math.PI * 2) });
      A.links++;
      B.links++;
      swings++;
    }
  }
  // zip-lines from tall roofs down to lower ones
  const tall = towers.filter((t) => t.h >= 13).sort((p, q) => q.h - p.h);
  let zips = 0;
  for (const A of tall) {
    if (zips >= 3) break;
    const ca = centre(A);
    const target = towers
      .filter((B) => B !== A && A.h - B.h > 5)
      .map((B) => ({ B, d: centre(B).setY(0).distanceTo(ca.clone().setY(0)) }))
      .filter((o) => o.d > 22 && o.d < 70)
      .sort((p, q) => p.d - q.d)[0];
    if (!target) continue;
    const B = target.B;
    const za = edgeToward(A, B, A.h + 3.2);
    const zb = edgeToward(B, A, B.h + 2.6);
    // the cable must not cut through another tower
    let clear = true;
    for (let k = 1; k < 10 && clear; k++) {
      const q = za.clone().lerp(zb, k / 10);
      clear = !towers.some((T) => T !== A && T !== B && q.x > T.x0 - 1 && q.x < T.x1 + 1 && q.z > T.z0 - 1 && q.z < T.z1 + 1 && q.y < T.h + 3);
    }
    if (!clear) continue;
    zipline(b, info.ziplines, za, zb, A.h, B.h);
    A.links++;
    zips++;
  }
  // roofs: stacked cubes, knobs, lamps, Eye nests; stairs on a few low towers
  let nests = 0;
  for (const t of towers) {
    if (t.links === 0 && t.h > 3 && rng.chance(0.55)) stack(b, t, rng, true);
    knobs(b, t.x0, t.x1, t.h, t.z0, t.z1, rng);
    if (t.h >= 8 && nests < 2 && t.links === 0 && rng.chance(0.35)) {
      const p = centre(t);
      b.box(p.x - 0.6, p.x + 0.6, t.h, t.h + 0.35, p.z - 0.6, p.z + 0.6, 'dark', 'concrete');
      info.extraNests.push({ pos: p.clone().setY(t.h + 1.6), type: NEST_TYPES[(rng.int(0, 99) + nests) % NEST_TYPES.length] });
      nests++;
    } else if (rng.chance(0.25)) {
      const p = centre(t);
      b.cyl(p.x + 0.8, t.h, p.z + 0.8, 0.07, 0.1, 3.2, 6, 'dark', null);
      const bulb = new THREE.SphereGeometry(0.2, 8, 6);
      bulb.translate(p.x + 0.8, t.h + 3.3, p.z + 0.8);
      b.add('lamp', bulb);
    }
    if (t.h >= 4 && t.h <= 13 && rng.chance(0.4)) {
      // stairs on the face that looks at the island centre
      const ct = centre(t);
      const toC = v(c.x - ct.x, 0, c.z - ct.z);
      const alongX = Math.abs(toC.x) > Math.abs(toC.z);
      const sgn = alongX ? Math.sign(toC.x) : Math.sign(toC.z);
      const run = t.h * 1.35;
      const top = alongX ? v(sgn > 0 ? t.x1 : t.x0, t.h, ct.z) : v(ct.x, t.h, sgn > 0 ? t.z1 : t.z0);
      const bottom = top.clone().add(alongX ? v(sgn * run, 0, 0) : v(0, 0, sgn * run)).setY(0);
      // stair lot: from 0.7 m off the face out to the foot of the flight
      const start = top.clone().add(alongX ? v(sgn * 0.7, 0, 0) : v(0, 0, sgn * 0.7));
      const x0 = Math.min(start.x, bottom.x) - (alongX ? 0 : 1.6);
      const x1 = Math.max(start.x, bottom.x) + (alongX ? 0 : 1.6);
      const z0 = Math.min(start.z, bottom.z) - (alongX ? 1.6 : 0);
      const z1 = Math.max(start.z, bottom.z) + (alongX ? 1.6 : 0);
      if (!blocked(bottom.x, bottom.z, 2) && b.lotFree(x0, x1, z0, z1, 0.3, t.h + 1)) {
        ctx.veg.clearRect(x0 - 0.5, x1 + 0.5, z0 - 0.5, z1 + 0.5);
        b.stairs(bottom, top, 2.4, t.dark ? 'dark' : 'white', 'dark');
      }
    }
  }
  // ground clutter: vault blocks, mushrooms, orbs, teal crystals
  for (let i = 0; i < Math.round(opts.count * 0.9); i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(opts.inner * 0.9, opts.outer);
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    if (blocked(x, z, 2) || groundHeight(info.hills, x, z) > 0.2) continue;
    const kind = rng.int(0, 5);
    if (kind <= 1) {
      const s = rng.range(1, 2.2);
      const h = rng.pick([0.9, 1.1, 1.6]);
      if (!b.lotFree(x - s / 2, x + s / 2, z - s / 2, z + s / 2, 0.8)) continue;
      const dark = rng.chance(0.5);
      b.box(x - s / 2, x + s / 2, 0, h, z - s / 2, z + s / 2, dark ? 'black' : 'white', dark ? 'ink' : 'concrete');
    } else if (kind === 2) {
      if (!b.lotFree(x - 1.6, x + 1.6, z - 1.6, z + 1.6, 0.5)) continue;
      ctx.veg.clearRect(x - 1.6, x + 1.6, z - 1.6, z + 1.6);
      ctx.veg.add('mushroom', x, 0, z, rng.range(0.7, 1.4), rng.range(0, 6));
    } else if (kind === 3) {
      if (!b.lotFree(x - 1.4, x + 1.4, z - 1.4, z + 1.4, 0.5)) continue;
      ctx.veg.clearRect(x - 1.4, x + 1.4, z - 1.4, z + 1.4);
      ctx.veg.add('orb', x, 0, z, rng.range(0.8, 1.3), rng.range(0, 6));
    } else {
      for (let k = 0; k < rng.int(2, 4); k++) {
        const h = rng.range(0.4, 1.1);
        const g = new THREE.ConeGeometry(rng.range(0.12, 0.25), h, 4);
        g.rotateZ(rng.range(-0.4, 0.4));
        g.rotateX(rng.range(-0.4, 0.4));
        g.translate(x + rng.range(-0.5, 0.5), h / 2 - 0.05, z + rng.range(-0.5, 0.5));
        b.add('teal', g);
      }
    }
  }
  // smashable cracked walls between a few towers (Fire dash / tackle / Iron)
  let walls = 0;
  for (let i = 0; i < 40 && walls < 2; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(opts.inner, opts.outer);
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    if (blocked(x, z, 4) || !b.lotFree(x - 3.5, x + 3.5, z - 0.8, z + 0.8, 1)) continue;
    ctx.veg.clearRect(x - 4, x + 4, z - 1.5, z + 1.5);
    ctx.destructibles.add(v(x, 0, z), v(6, 3.2, 1));
    b.footprints.push(new THREE.Box3(v(x - 3, 0, z - 0.5), v(x + 3, 3.2, z + 0.5)));
    walls++;
  }
  // floating faceted boulders overhead
  for (let i = 0, placed = 0; i < 30 && placed < 9; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(R * 0.5, R * 1.25);
    const s = rng.range(1, 4);
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    const y = rng.range(26, 60);
    // never hang in front of a landmark: skip anything near tall authored geometry
    const nearTall = b.footprints.some((f) => f.max.y > y - 25 && f.max.x > x - s - 18 && f.min.x < x + s + 18 && f.max.z > z - s - 18 && f.min.z < z + s + 18);
    if (nearTall) continue;
    const g = new THREE.DodecahedronGeometry(s, 0);
    g.rotateY(rng.range(0, 3));
    g.translate(x, y, z);
    b.add('floatRock', g);
    placed++;
  }
  return towers;
}
