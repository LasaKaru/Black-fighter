import * as THREE from 'three';
import type { IslandCtx } from './types';
import { v } from './types';
import { house, islandBase, jitter, lampPost, plaza, scatter, signBoard } from './base';
import type { MatKey } from '../Builder';

/**
 * The outer ring: four more wonders, each reached by a long bridge from the
 * inner island it sits behind. Every layout is authored in a local frame
 * whose +u axis points away from the hub, so the arrival side (−u) always
 * faces the bridge.
 */

interface Frame {
  /** World point at (u outward, w sideways, y). */
  at(u: number, w: number, y?: number): THREE.Vector3;
  /** boxAt yaw that lines a box's local z up with +u. */
  yaw: number;
  /** World yaw facing the hub (for signs, statues). */
  face: number;
  box(u: number, w: number, y0: number, y1: number, su: number, sw: number, mat: MatKey, surface?: 'concrete' | 'wood' | null): void;
}

function frame(ctx: IslandCtx): Frame {
  const a = THREE.MathUtils.degToRad(ctx.info.def.angle);
  const o = v(Math.cos(a), 0, Math.sin(a));
  const p = v(-Math.sin(a), 0, Math.cos(a));
  const c = ctx.c;
  const yaw = Math.PI / 2 - a;
  const at = (u: number, w: number, y = 0) => v(c.x + o.x * u + p.x * w, y, c.z + o.z * u + p.z * w);
  return {
    at,
    yaw,
    face: Math.atan2(-o.x, -o.z),
    box(u, w, y0, y1, su, sw, mat, surface = 'concrete') {
      const q = at(u, w);
      ctx.b.boxAt(q.x, (y0 + y1) / 2, q.z, sw, y1 - y0, su, yaw, mat, surface);
    },
  };
}

/** A straight wall run between two local points, walkable on top. */
function wallRun(ctx: IslandCtx, f: Frame, a: [number, number], b: [number, number], h: number, t: number, mat: MatKey) {
  const A = f.at(a[0], a[1]);
  const B = f.at(b[0], b[1]);
  const len = A.distanceTo(B);
  const yaw = Math.atan2(B.x - A.x, B.z - A.z);
  ctx.b.boxAt((A.x + B.x) / 2, h / 2, (A.z + B.z) / 2, t, h, len + t, yaw, mat, 'concrete');
  // crenellations on the outer lip
  const n = Math.floor(len / 3);
  const side = v(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(t / 2 - 0.3);
  for (let i = 0; i < n; i += 2) {
    const q = A.clone().lerp(B, (i + 0.5) / n);
    ctx.b.boxAt(q.x + side.x, h + 0.5, q.z + side.z, 0.6, 1, 1.4, yaw, mat, null);
  }
}

// ---------------------------------------------------------------- Galle Fort

export function buildGalle(ctx: IslandCtx) {
  const { b, c, R, info } = ctx;
  const f = frame(ctx);
  islandBase(ctx, 'grass');
  const beach = new THREE.RingGeometry(R - 16, R - 0.5, 48);
  beach.rotateX(-Math.PI / 2);
  beach.translate(c.x, 0.05, c.z);
  b.recordFootprints = false;
  b.add('sand', beach);
  b.recordFootprints = true;
  plaza(ctx, f.at(-6, 0).x, f.at(-6, 0).z, 14, 'stone');
  // star-fort ramparts: an octagon with bastions, gates on the bridge axis
  const RW = 44;
  const H = 7;
  const corners: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    corners.push([Math.cos(a) * RW, Math.sin(a) * RW]);
  }
  const ramparts: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    const A = corners[i];
    const B = corners[(i + 1) % 8];
    const mid: [number, number] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    // gate gap where the wall crosses the u axis (arrival side and the sea gate)
    if (Math.abs(mid[1]) < 1e-3) {
      const gap = 5;
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const t = (len / 2 - gap) / len;
      wallRun(ctx, f, A, [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t], H, 6, 'stone');
      wallRun(ctx, f, [B[0] + (A[0] - B[0]) * t, B[1] + (A[1] - B[1]) * t], B, H, 6, 'stone');
      // arch over the gate
      f.box(mid[0], 0, H - 2, H, 6, 2 * gap + 2, 'stone');
    } else wallRun(ctx, f, A, B, H, 6, 'stone');
    // bastion at each corner
    const bp = f.at(A[0] * 1.08, A[1] * 1.08);
    b.cyl(bp.x, 0, bp.z, 6.5, 7, H + 0.4, 10, 'stone', 'concrete');
    b.cyl(bp.x, H + 0.4, bp.z, 1.2, 1.2, 1.4, 8, 'white', null);
    // checkpoint on the wall junction, clear of the lighthouse on bastion 0
    ramparts.push(f.at(A[0] * 0.97, A[1] * 0.97, H + 0.6));
  }
  // ramps up onto the walls from inside
  // (against the straight arrival wall, whose inner face sits at u = -RW·cos(π/8) + 3)
  const face = -RW * Math.cos(Math.PI / 8) + 3;
  for (const s of [-1, 1]) {
    const w = s * 12.5;
    b.stairs(f.at(face + 12, w), f.at(face, w, H), 4, 'stone', null);
  }
  // Point Utrecht lighthouse on the seaward bastion
  const lh = f.at(corners[0][0] * 1.08, corners[0][1] * 1.08);
  b.cyl(lh.x, H + 0.4, lh.z, 2.2, 3, 24, 14, 'white', 'concrete');
  b.cyl(lh.x, H + 10, lh.z, 3.05, 3.05, 1.6, 14, 'black', null);
  b.cyl(lh.x, H + 24.4, lh.z, 3.2, 3.2, 0.5, 14, 'dark', 'concrete');
  b.cyl(lh.x, H + 24.9, lh.z, 1.6, 1.6, 2.4, 10, 'lamp', null);
  b.lathe(lh.x, H + 27.3, lh.z, [[0, 0], [2, 0], [1.4, 1], [0, 1.8]], 10, 'black');
  info.anchors.lighthouseTop = [v(lh.x + 2.4, H + 25.3, lh.z)];
  // clock tower by the main gate
  const ct = f.at(-20, 8);
  b.box(ct.x - 2.2, ct.x + 2.2, 0, 15, ct.z - 2.2, ct.z + 2.2, 'white');
  b.lathe(ct.x, 15, ct.z, [[0, 0], [3.1, 0], [2.4, 2], [0.4, 4.2], [0, 4.6]], 4, 'roof');
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    b.decal('clock', clockFace(), '#ffffff', 2.4, 2.4, v(ct.x + Math.sin(a) * 2.21, 12.4, ct.z + Math.cos(a) * 2.21), v(Math.sin(a), 0, Math.cos(a)));
  }
  // Dutch church, old houses on a grid of lanes
  const ch = f.at(4, -16);
  house(ctx, ch.x, ch.z, 10, 16, 8, f.face, 'white', 'roof');
  b.lathe(ch.x, 11, ch.z, [[0, 0], [1.4, 0], [1.2, 2], [0, 5]], 6, 'dark');
  for (let u = -18; u <= 22; u += 10) {
    for (const w of [-28, -6, 6, 28]) {
      if (Math.abs(w) < 8 && u < -8) continue; // keep the main street open
      if (Math.hypot(u, w) > 34 || (u > 0 && u < 12 && w < -10)) continue;
      const q = f.at(u, w);
      house(ctx, q.x, q.z, 7, 6.5, 4.5 + ((u + w) & 3), f.face + (w > 0 ? Math.PI / 2 : -Math.PI / 2), 'white', 'roof');
    }
  }
  for (let u = -30; u <= 26; u += 8) {
    const q = f.at(u, 3.6);
    lampPost(ctx, q.x, 0, q.z);
  }
  scatter(ctx, 'palm', 30, RW + 10, R - 6, () => false, [0.9, 1.3]);
  scatter(ctx, 'banana', 8, 10, 30, (x, z) => Math.abs((x - c.x) * Math.sin(-f.yaw + Math.PI / 2) - (z - c.z) * Math.cos(-f.yaw + Math.PI / 2)) < 8);
  const sg = f.at(-RW - 10, 9);
  signBoard(ctx, sg.x, sg.z, f.face, 'Galle Fort', 'Galle · Sri Lanka');
  info.anchors.ramparts = [...ramparts.slice(4), ...ramparts.slice(0, 4)];
  info.spawn.copy(f.at(-RW + 6, -4, 0.2));
  info.wander.push({ c: f.at(-6, 0), r: 14 });
  const pk = f.at(-RW - 12, -14, 0.6);
  info.parking.push({ pos: pk, yaw: f.face, type: 'tuktuk' });
}

let _clock: THREE.Texture | null = null;
function clockFace(): THREE.Texture {
  if (_clock) return _clock;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f2f0ea';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#111';
  g.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.fillRect(64 + Math.cos(a) * 48 - 3, 64 + Math.sin(a) * 48 - 3, 6, 6);
  }
  g.lineCap = 'round';
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(64, 64);
  g.lineTo(64, 26);
  g.moveTo(64, 64);
  g.lineTo(92, 74);
  g.stroke();
  _clock = new THREE.CanvasTexture(cv);
  _clock.colorSpace = THREE.SRGBColorSpace;
  return _clock;
}

// ---------------------------------------------------------------- Adam's Peak

export function buildAdamsPeak(ctx: IslandCtx) {
  const { b, R, info } = ctx;
  const f = frame(ctx);
  islandBase(ctx, 'grassDark');
  // terraced sacred mountain: six rings, a pilgrim stair spiralling up
  const pc = f.at(10, 0);
  const radii = [46, 39, 32, 25, 18, 11];
  const rise = 5;
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i];
    const top = (i + 1) * rise;
    const g = jitter(new THREE.CylinderGeometry(r, r + 1.2, rise + (i ? 0.4 : 0), 26, 2), 0.7, i * 13 + 5);
    g.translate(pc.x, top - rise / 2 - (i ? 0.2 : 0), pc.z);
    b.add(i < 2 ? 'grassDark' : i < 4 ? 'rock' : 'stone', g);
    ctx.physics.addStaticCylinder(v(pc.x, top - rise / 2, pc.z), r * 0.985, rise, 'concrete');
  }
  const pilgrim: THREE.Vector3[] = [];
  const dirAt = (k: number) => f.face + Math.PI + k * 1.25;
  for (let i = 0; i < radii.length; i++) {
    const a = dirAt(i);
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const rIn = radii[i];
    const outer = rIn + 6.6;
    const y0 = i * rise;
    const s = v(pc.x + dx * outer, y0, pc.z + dz * outer);
    // end exactly on the collider's rim so the last step is flush with the tier top
    const e = v(pc.x + dx * rIn * 0.985, y0 + rise, pc.z + dz * rIn * 0.985);
    b.stairs(s, e, 4, 'stone', 'dark');
    // lamps on both sides of every flight (the night pilgrimage glows)
    for (const sd of [-1, 1]) {
      const lx = Math.cos(a) * sd * 3;
      const lz = -Math.sin(a) * sd * 3;
      lampPost(ctx, s.x + lx, y0, s.z + lz, 2.8);
    }
    pilgrim.push(e.clone().setY(e.y + 0.3));
  }
  // summit shrine (the footprint relic) with a bell arch
  const topY = radii.length * rise;
  b.box(pc.x - 4, pc.x + 4, topY, topY + 4, pc.z - 4, pc.z + 4, 'white');
  const roof = new THREE.ConeGeometry(6.4, 2.8, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(pc.x, topY + 5.4, pc.z);
  b.add('roof', roof);
  b.cyl(pc.x, topY + 6.8, pc.z, 0.1, 0.5, 2, 8, 'gold', null);
  const bell = f.at(10 + 7, 3);
  for (const s of [-1.3, 1.3]) b.cyl(bell.x + s, topY, bell.z, 0.18, 0.18, 3.6, 6, 'wood', null);
  b.box(bell.x - 1.6, bell.x + 1.6, topY + 3.6, topY + 3.9, bell.z - 0.2, bell.z + 0.2, 'wood', null);
  b.lathe(bell.x, topY + 2.4, bell.z, [[0, 1.2], [0.4, 1.1], [0.6, 0.5], [0.8, 0]], 10, 'gold');
  info.anchors.summit = [v(pc.x, topY + 4.2, pc.z)];
  info.anchors.pilgrim = pilgrim;
  // cloud skirt around the middle (sunrise above the clouds)
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const r = 30 + (k % 3) * 4;
    const g = jitter(new THREE.IcosahedronGeometry(3 + (k % 4), 1), 0.6, k);
    g.scale(1.6, 0.6, 1.6);
    g.translate(pc.x + Math.cos(a) * r, 17 + (k % 3) * 3, pc.z + Math.sin(a) * r);
    b.add('cloud', g);
  }
  // tea estate on the approach + pilgrim rest halls
  const avoid = (x: number, z: number) => Math.hypot(x - pc.x, z - pc.z) < 54;
  scatter(ctx, 'tea', 70, 20, R - 6, avoid, [0.8, 1.2], false);
  scatter(ctx, 'pine', 16, 50, R - 6, avoid, [0.9, 1.3]);
  for (const w of [-14, 14]) {
    const q = f.at(-48, w);
    house(ctx, q.x, q.z, 8, 6, 4, f.face, 'white', 'roof');
  }
  const sp = f.at(-R + 14, 0);
  plaza(ctx, sp.x, sp.z, 10, 'stone');
  const sg = f.at(-R + 20, 10);
  signBoard(ctx, sg.x, sg.z, f.face, "Adam's Peak", 'Sri Pada · Sri Lanka');
  info.spawn.copy(f.at(-R + 16, -3, 0.2));
  info.wander.push({ c: f.at(-60, 0), r: 12 });
  info.parking.push({ pos: f.at(-R + 16, -16, 0.6), yaw: f.face, type: 'tuktuk' });
}

// ---------------------------------------------------------------- Angkor Wat

/** Lotus-bud prang profile (radius, height). */
const PRANG: Array<[number, number]> = [[0, 0], [3.4, 0], [3.4, 4], [3.0, 5], [3.2, 7], [2.6, 9], [2.8, 11], [2.1, 13.5], [2.2, 15.5], [1.4, 18.5], [1.3, 20], [0.6, 22.5], [0, 24.5]];

export function buildAngkor(ctx: IslandCtx) {
  const { b, info } = ctx;
  const f = frame(ctx);
  islandBase(ctx, 'grassDark');
  // moat square with a causeway on the arrival axis
  const M0 = 40;
  const M1 = 48;
  // the arrival side is split for the causeway
  for (const [u0, u1, w0, w1] of [[-M1, -M0, -M1, -4], [-M1, -M0, 4, M1], [M0, M1, -M1, M1], [-M0, M0, -M1, -M0], [-M0, M0, M0, M1]] as const) {
    f.box((u0 + u1) / 2, (w0 + w1) / 2, -0.02, 0.06, u1 - u0, w1 - w0, 'water', null);
  }
  // causeway with naga balustrades
  f.box(-(M1 + M0) / 2, 0, 0, 0.5, M1 - M0 + 6, 8, 'sandstone');
  for (const s of [-1, 1]) {
    f.box(-(M1 + M0) / 2, s * 4.3, 0.5, 1.3, M1 - M0 + 6, 0.6, 'stone', 'concrete');
    const head = f.at(-M1 - 3, s * 4.3);
    b.lathe(head.x, 0.5, head.z, [[0, 0], [1.4, 0], [1.6, 1.6], [1.0, 3.2], [0, 3.8]], 7, 'stone');
  }
  // outer gallery (walkable roof) with gate towers on the axis
  const G = 33;
  for (const [a, bb] of [[[-G, -G], [-G, -5]], [[-G, 5], [-G, G]], [[G, -G], [G, -5]], [[G, 5], [G, G]], [[-G, -G], [G, -G]], [[-G, G], [G, G]]] as Array<[[number, number], [number, number]]>) wallRun(ctx, f, a, bb, 5, 4, 'sandstone');
  for (const u of [-G, G]) {
    const q = f.at(u, 0);
    b.boxAt(q.x, 6.5, q.z, 10, 3, 5, f.yaw, 'sandstone', 'concrete');
    b.lathe(q.x, 8, q.z, PRANG, 10, 'sandstone', 0.45);
  }
  // the temple mountain: three terraces, stairs on the arrival face
  const lv: Array<[number, number, number]> = [[22, 0, 5], [15, 5, 10], [9, 10, 15]];
  for (const [hw, y0, y1] of lv) {
    f.box(0, 0, y0, y1, hw * 2, hw * 2, 'sandstone');
    f.box(0, 0, y1 - 0.4, y1 - 0.1, hw * 2 + 0.3, hw * 2 + 0.3, 'stone', null);
  }
  b.stairs(f.at(-30, 0), f.at(-22, 0, 5), 6, 'stone', 'dark');
  b.stairs(f.at(-21.5, 0, 5), f.at(-15, 0, 10), 5, 'stone', 'dark');
  b.stairs(f.at(-14.5, 0, 10), f.at(-9, 0, 15), 4, 'stone', 'dark');
  // quincunx of lotus-bud towers
  const buds: THREE.Vector3[] = [];
  for (const [u, w, s] of [[-6.5, -6.5, 0.7], [-6.5, 6.5, 0.7], [6.5, -6.5, 0.7], [6.5, 6.5, 0.7], [0, 0, 1.15]] as const) {
    const q = f.at(u, w);
    b.lathe(q.x, 15, q.z, PRANG, 12, 'sandstone', s);
    ctx.physics.addStaticCylinder(v(q.x, 15 + 3 * s, q.z), 3.2 * s, 6 * s, 'concrete');
    // each bud carries a dark doorway
    const d = f.at(u - 3.3 * s, w, 15 + 1.6 * s);
    b.boxAt(d.x, d.y, d.z, 1.4 * s, 3.2 * s, 0.2, f.yaw + Math.PI / 2, 'dark', null);
    buds.push(v(q.x, 15 + 6 * s + 0.4, q.z));
  }
  info.anchors.buds = buds;
  info.anchors.templeTop = [f.at(-7.5, 0, 15.3)];
  // jungle and ruins outside the moat
  const inside = (x: number, z: number) => {
    const dx = x - ctx.c.x;
    const dz = z - ctx.c.z;
    const a = THREE.MathUtils.degToRad(info.def.angle);
    const u = dx * Math.cos(a) + dz * Math.sin(a);
    const w = -dx * Math.sin(a) + dz * Math.cos(a);
    return Math.abs(u) < M1 + 3 && Math.abs(w) < M1 + 3;
  };
  scatter(ctx, 'broadleaf', 30, 68, ctx.R - 5, inside, [1.1, 1.6]);
  scatter(ctx, 'banana', 10, 68, ctx.R - 5, inside);
  for (let k = 0; k < 6; k++) {
    const q = f.at(-20 + k * 9, (k % 2 ? 1 : -1) * 22);
    b.box(q.x - 1.2, q.x + 1.2, 0, 1 + (k % 3), q.z - 1.2, q.z + 1.2, 'stone');
  }
  const sg = f.at(-M1 - 10, 12);
  signBoard(ctx, sg.x, sg.z, f.face, 'Angkor Wat', 'Siem Reap · Cambodia');
  info.spawn.copy(f.at(-M1 - 8, -3, 0.2));
  info.wander.push({ c: f.at(-G + 8, 14), r: 6 }, { c: f.at(-G + 8, -14), r: 6 });
  info.parking.push({ pos: f.at(-M1 - 12, -14, 0.6), yaw: f.face, type: 'tuktuk' });
}

// ---------------------------------------------------------------- Giza

/** A stepped pyramid: every tier is a ledge you can jump to. */
function pyramid(ctx: IslandCtx, f: Frame, u: number, w: number, base: number, height: number, cap: boolean) {
  const tiers = Math.round(height / 1.6);
  const th = height / tiers;
  const inset = base / 2 / (tiers + 1);
  for (let i = 0; i < tiers; i++) {
    const half = base / 2 - i * inset;
    f.box(u, w, i * th, (i + 1) * th, half * 2, half * 2, cap && i >= tiers - 3 ? 'travertine' : 'sandstone');
  }
  const q = f.at(u, w, height);
  const tip = new THREE.ConeGeometry(inset * 1.4, th * 1.6, 4);
  tip.rotateY(Math.PI / 4 + f.yaw);
  tip.translate(q.x, height + th * 0.8, q.z);
  ctx.b.add(cap ? 'travertine' : 'sandstone', tip);
  return v(q.x, height + 0.2, q.z);
}

export function buildGiza(ctx: IslandCtx) {
  const { b, c, R, info } = ctx;
  const f = frame(ctx);
  islandBase(ctx, 'sand', 'rockRed');
  const khufu = pyramid(ctx, f, 18, -14, 54, 34, false);
  const khafre = pyramid(ctx, f, 26, 38, 44, 29, true);
  const menk = pyramid(ctx, f, -8, 50, 24, 15, false);
  // three queens' pyramids
  for (let k = 0; k < 3; k++) pyramid(ctx, f, 52, -30 + k * 11, 8, 5, false);
  info.anchors.khufuTop = [khufu];
  info.anchors.pyramidTops = [menk, khafre, khufu];
  // the Sphinx guarding the causeway, facing the bridge
  const sx = -28;
  const sw = -20;
  f.box(sx, sw, 0, 1, 26, 10, 'sandstone');
  f.box(sx + 2, sw, 1, 6, 16, 7, 'sandstone');
  f.box(sx - 8, sw, 1, 2.6, 6, 7.4, 'sandstone', null);
  for (const s of [-2.3, 2.3]) f.box(sx - 10, sw + s, 1, 2, 5, 1.8, 'sandstone', null);
  f.box(sx - 6, sw, 6, 11, 4.2, 4.6, 'sandstone');
  // nemes headdress flaps and the face
  for (const s of [-2.8, 2.8]) f.box(sx - 5.6, sw + s, 5.2, 10.2, 3, 1, 'travertine', null);
  f.box(sx - 8.2, sw, 7.2, 10, 0.3, 3, 'dark', null);
  f.box(sx - 8.5, sw, 9.4, 9.8, 0.3, 2.4, 'black', null);
  // causeway + temple to Khafre
  f.box(-8, 8, 0, 0.3, 46, 5, 'travertine', null);
  // oasis with palms near the arrival
  const oc = f.at(-52, 32);
  const pool = new THREE.CircleGeometry(9, 20);
  pool.rotateX(-Math.PI / 2);
  pool.translate(oc.x, 0.06, oc.z);
  b.recordFootprints = false;
  b.add('water', pool);
  b.recordFootprints = true;
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    ctx.veg.add('palm', oc.x + Math.cos(a) * 11, 0, oc.z + Math.sin(a) * 11, 0.9 + (k % 3) * 0.15, a);
  }
  scatter(ctx, 'boulder', 14, 60, R - 6, () => false, [0.6, 1.4]);
  // market stalls
  for (let k = 0; k < 4; k++) {
    const q = f.at(-58, -12 + k * 7);
    b.box(q.x - 2, q.x + 2, 0, 0.9, q.z - 1.4, q.z + 1.4, 'wood');
    for (const [dx, dz] of [[-1.9, -1.3], [1.9, -1.3], [-1.9, 1.3], [1.9, 1.3]]) b.cyl(q.x + dx, 0.9, q.z + dz, 0.06, 0.06, 2, 4, 'wood', null);
    b.box(q.x - 2.2, q.x + 2.2, 2.9, 3, q.z - 1.6, q.z + 1.6, k % 2 ? 'purple' : 'teal', null);
  }
  const sg = f.at(-R + 16, 12);
  signBoard(ctx, sg.x, sg.z, f.face, 'Pyramids of Giza', 'Cairo · Egypt');
  info.spawn.copy(f.at(-R + 14, -3, 0.2));
  info.wander.push({ c: f.at(-58, 0), r: 9 });
  info.parking.push({ pos: f.at(-R + 16, -16, 0.6), yaw: f.face, type: 'jeep' });
  void c;
}
