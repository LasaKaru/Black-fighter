import * as THREE from 'three';
import type { IslandCtx } from './types';
import { groundHeight, v } from './types';
import { hillCap, house, islandBase, jitter, lampPost, path, plaza, rockMass, scatter, signBoard } from './base';

/**
 * Sri Lanka ("Ceylon") islands: Colombo with the Lotus Tower, Ella with the
 * tea hills, Ella Rock and the Nine Arch Bridge railway, and Sigiriya — the
 * Lion Rock fortress with its paw gate, water gardens and summit palace.
 */

// ---------------------------------------------------------------- Colombo / Lotus Tower

export function buildColombo(ctx: IslandCtx) {
  const { b, c, R, rng, info } = ctx;
  islandBase(ctx, 'grass');
  // beach ring
  const beach = new THREE.RingGeometry(R - 12, R - 0.5, 48);
  beach.rotateX(-Math.PI / 2);
  beach.translate(c.x, 0.05, c.z);
  // ground paint: its bounding box would otherwise cover every building lot
  b.recordFootprints = false;
  b.add('sand', beach);
  b.recordFootprints = true;
  plaza(ctx, c.x, c.z, 26, 'stone');

  // --- Lotus Tower
  const tx = c.x;
  const tz = c.z - 8;
  b.cyl(tx, 0, tz, 15, 16, 4, 8, 'marble', 'concrete');
  b.cyl(tx, 4, tz, 11, 13, 3, 8, 'lotusPink', 'concrete');
  b.stairs(v(tx, 0, tz + 22), v(tx, 7, tz + 12), 6, 'marble');
  // tapering green shaft
  b.cyl(tx, 7, tz, 2.6, 4.4, 88, 14, 'lotusGreen', 'concrete');
  for (let y = 15; y < 92; y += 9) b.cyl(tx, y, tz, 3.6 - y * 0.012, 3.6 - y * 0.012, 0.5, 14, 'lotusPink', null);
  // the lotus bud
  const budY = 95;
  b.lathe(tx, budY, tz, [[0.5, 0], [4, 1.5], [8, 6], [9.6, 12], [8.6, 19], [5.5, 25], [2, 29.5], [0, 31]], 16, 'lotusPink');
  b.physics.addStaticBall(v(tx, budY + 13, tz), 9.2);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const petal = new THREE.IcosahedronGeometry(1, 1);
    petal.scale(2.6, 10, 1.1);
    petal.translate(0, 6, 0);
    petal.rotateX(0.55);
    petal.rotateY(a);
    petal.translate(tx + Math.sin(a) * 6.5, budY + 1.5, tz + Math.cos(a) * 6.5);
    b.add(i % 2 ? 'lotusPink' : 'lotusGreen', petal);
  }
  const deck = new THREE.TorusGeometry(10.5, 0.6, 6, 32);
  deck.rotateX(Math.PI / 2);
  deck.translate(tx, budY + 3, tz);
  b.add('neonPurple', deck);
  b.cyl(tx, budY + 31, tz, 0.15, 1.2, 26, 8, 'metal', null);
  // parkour spiral of floating pads around the shaft (Lotus Leap mission)
  const pads: THREE.Vector3[] = [];
  for (let i = 0; i < 16; i++) {
    const a = i * 0.72;
    const r = 9.5;
    const p = v(tx + Math.cos(a) * r, 9 + i * 3.4, tz + Math.sin(a) * r);
    b.boxAt(p.x, p.y - 0.25, p.z, 3.4, 0.5, 3.4, -a, 'marble', 'concrete');
    b.boxAt(p.x, p.y - 0.52, p.z, 3.5, 0.08, 3.5, -a, 'neonTeal', null);
    pads.push(p);
  }
  info.anchors.lotusPads = pads;
  info.anchors.lotusRings = [v(tx + 14, 20, tz), v(tx, 34, tz + 14), v(tx - 14, 48, tz), v(tx, 60, tz - 14), v(tx + 12, 72, tz + 8), v(tx - 6, 86, tz + 13), v(tx + 16, 100, tz), v(tx, 132, tz)];
  info.anchors.lotusTop = [v(tx, budY + 31, tz)];

  // --- downtown blocks
  const blocks: Array<[number, number, number, number, number]> = [[-46, -30, 10, 12, 28], [-52, 6, 12, 10, 18], [44, -26, 11, 11, 34], [50, 14, 10, 14, 22], [-30, 46, 14, 9, 14], [28, 48, 12, 10, 16]];
  for (const [bx, bz, w, d, h] of blocks) {
    const x = c.x + bx;
    const z = c.z + bz;
    b.box(x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, rng.chance(0.5) ? 'white' : 'marble');
    for (let y = 3; y < h - 1; y += 3) {
      b.box(x - w / 2 - 0.05, x + w / 2 + 0.05, y, y + 1.4, z - d / 2 - 0.05, z + d / 2 + 0.05, 'glass', null);
    }
    b.box(x - w / 2 + 1, x + w / 2 - 1, h, h + 1.5, z - d / 2 + 1, z + d / 2 - 1, 'dark', null);
    lampPost(ctx, x + w / 2 + 2, 0, z + d / 2 + 2);
  }
  // market stalls with colourful awnings
  const awnings = ['trainRed', 'lotusPink', 'neonTeal', 'roof'] as const;
  for (let i = 0; i < 8; i++) {
    const a = -0.4 + i * 0.12;
    const x = c.x + Math.cos(a) * 34;
    const z = c.z + Math.sin(a) * 34 + 30;
    b.boxAt(x, 0.5, z, 2.6, 1, 1.6, -a, 'trunk', 'wood');
    const aw = new THREE.BoxGeometry(3, 0.12, 2.2);
    aw.rotateX(0.25);
    aw.rotateY(-a);
    aw.translate(x, 2.4, z);
    b.add(awnings[i % 4], aw);
    for (const s of [-1, 1]) b.cyl(x + Math.cos(-a) * s * 1.3, 0, z - Math.sin(-a) * s * 1.3, 0.05, 0.05, 2.4, 4, 'dark', null);
  }
  // Galle-Face-style promenade palms
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    ctx.veg.add('palm', c.x + Math.cos(a) * (R - 16), 0, c.z + Math.sin(a) * (R - 16), rng.range(0.9, 1.3));
  }
  scatter(ctx, 'bush', 30, 18, R - 20, (x, z) => Math.hypot(x - tx, z - tz) < 18);
  signBoard(ctx, c.x - 18, c.z + 22, 0.3, 'Colombo', 'Lotus Tower · Sri Lanka');
  info.spawn.set(c.x - 12, 0.2, c.z + 26);
  info.wander.push({ c: v(c.x, 0, c.z + 20), r: 30 });
  info.parking.push({ pos: v(c.x + 18, 0.6, c.z + 20), yaw: 0.4, type: 'tuktuk' }, { pos: v(c.x + 22, 0.6, c.z + 14), yaw: 0.4, type: 'tuktuk' }, { pos: v(c.x - 24, 0.6, c.z + 16), yaw: -0.6, type: 'inkbox' });
}

// ---------------------------------------------------------------- Ella / Nine Arch Bridge

export function buildElla(ctx: IslandCtx) {
  const { b, c, R, rng, info } = ctx;
  islandBase(ctx, 'grass');
  const hills = [
    hillCap(ctx, c.x - 38, c.z - 22, 34, 20, 'grass'),
    hillCap(ctx, c.x + 34, c.z - 34, 28, 15, 'grass'),
    hillCap(ctx, c.x + 6, c.z + 52, 24, 11, 'grassDark'),
    hillCap(ctx, c.x - 62, c.z + 30, 22, 9, 'grassDark'),
  ];
  // Ella Rock
  rockMass(ctx, c.x - 72, c.z - 50, 14, 6, 44, 'rock', 11, 4);
  // tea rows contouring the hills
  for (const h of hills.slice(0, 3)) {
    for (let ring = 6; ring < h.r - 3; ring += 3.2) {
      const n = Math.floor((ring * Math.PI * 2) / 2.4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring;
        const x = h.x + Math.cos(a) * ring;
        const z = h.z + Math.sin(a) * ring;
        if (Math.hypot(x - c.x, z - c.z) > R - 6) continue;
        ctx.veg.add('tea', x, groundHeight(info.hills, x, z) - 0.1, z, rng.range(0.85, 1.15), a, false);
      }
    }
  }
  // shade trees among the tea (silver oak style)
  scatter(ctx, 'broadleaf', 22, 10, R - 10, () => false, [0.9, 1.5]);
  scatter(ctx, 'banana', 14, 20, R - 12);

  // --- railway loop on a viaduct, with the Nine Arch section on the south side
  const H = 10;
  const rx = 66;
  const rz = 50;
  const N = 72;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    pts.push(v(c.x + Math.cos(t) * rx, H, c.z + Math.sin(t) * rz));
  }
  info.movers.push({ kind: 'train', points: pts, closed: true });
  const archFrom = Math.round(N * 0.25 - 7);
  const archTo = Math.round(N * 0.25 + 7);
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const bb = pts[(i + 1) % N];
    const len = a.distanceTo(bb);
    const yaw = Math.atan2(bb.x - a.x, bb.z - a.z);
    const mx = (a.x + bb.x) / 2;
    const mz = (a.z + bb.z) / 2;
    const inHill = groundHeight(info.hills, mx, mz) > H + 1;
    if (inHill) continue; // tunnel through the hill
    const nine = i >= archFrom && i < archTo;
    b.boxAt(mx, H - 0.4, mz, 5.2, 0.8, len + 0.1, yaw, nine ? 'stone' : 'dark', 'concrete');
    // sleepers + rails
    for (let k = 0; k < 3; k++) {
      const t = k / 3;
      b.boxAt(a.x + (bb.x - a.x) * t, H + 0.05, a.z + (bb.z - a.z) * t, 3, 0.15, 0.35, yaw, 'trunk', null);
    }
    for (const s of [-0.75, 0.75]) b.boxAt(mx + Math.cos(yaw) * s, H + 0.2, mz - Math.sin(yaw) * s, 0.12, 0.15, len + 0.1, yaw, 'metal', null);
    // parapets
    for (const s of [-2.5, 2.5]) b.boxAt(mx + Math.cos(yaw) * s, H + 0.5, mz - Math.sin(yaw) * s, 0.3, 1.0, len + 0.1, yaw, nine ? 'stone' : 'dark', 'concrete');
    if (nine) {
      // brick piers and arches
      const gy = groundHeight(info.hills, a.x, a.z);
      b.boxAt(a.x, (gy + H - 0.8) / 2 - 3, a.z, 2.4, H - 0.8 - gy + 6, 5, yaw, 'stone', 'concrete');
      const arch = new THREE.TorusGeometry(len / 2 - 0.9, 0.9, 6, 12, Math.PI);
      arch.scale(1, 1.4, 1);
      arch.rotateY(yaw + Math.PI / 2);
      arch.translate(mx, H - 1.4 - (len / 2) * 1.4 + 0.2, mz);
      b.add('stone', arch);
      b.boxAt(mx, H - 1.3, mz, 4.9, 1.4, len - 1.6, yaw, 'stone', null);
    } else if (i % 3 === 0) {
      const gy = groundHeight(info.hills, a.x, a.z);
      b.cyl(a.x, gy - 4, a.z, 0.9, 1.2, H - 0.8 - gy + 4, 8, 'dark', 'concrete');
    }
  }
  // tunnel portals where the track meets the hills
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const bb = pts[(i + 1) % N];
    const ga = groundHeight(info.hills, a.x, a.z) > H + 1;
    const gb = groundHeight(info.hills, bb.x, bb.z) > H + 1;
    if (ga !== gb) {
      const p = ga ? bb : a;
      const yaw = Math.atan2(bb.x - a.x, bb.z - a.z);
      const portal = new THREE.TorusGeometry(3.4, 0.8, 6, 10, Math.PI);
      portal.rotateY(yaw + Math.PI / 2);
      portal.translate(p.x, H, p.z);
      b.add('stone', portal);
      b.boxAt(p.x, H + 1.5, p.z, 5.4, 3.4, 0.4, yaw + Math.PI / 2, 'black', null);
    }
  }
  info.anchors.nineArch = pts.slice(archFrom, archTo + 1).map((p) => p.clone().setY(H + 1));
  // station platform
  const st = pts[0];
  b.box(st.x + 3, st.x + 8, 0, H + 0.2, st.z - 12, st.z + 12, 'marble');
  b.box(st.x + 3.5, st.x + 8, H + 4, H + 4.4, st.z - 10, st.z + 10, 'roof', null);
  for (const z of [-9, 0, 9]) b.cyl(st.x + 7.5, H + 0.2, st.z + z, 0.15, 0.15, 4, 6, 'dark', null);
  b.stairs(v(st.x + 5.5, 0, st.z + 28), v(st.x + 5.5, H + 0.2, st.z + 12), 3.5, 'marble');
  signBoard(ctx, st.x + 10, st.z - 4, Math.PI / 2, 'Ella', 'Station · 1041 m');
  info.anchors.station = [v(st.x + 5.5, H + 0.4, st.z)];

  // tea factory + bungalows
  b.box(c.x - 8, c.x + 14, 0, 9, c.z + 6, c.z + 18, 'white');
  for (let x = -6; x < 14; x += 3.5) b.box(c.x + x, c.x + x + 2, 3, 5, c.z + 17.95, c.z + 18.05, 'glass', null);
  const roof = new THREE.BoxGeometry(23, 0.5, 13);
  roof.translate(c.x + 3, 9.3, c.z + 12);
  b.add('grassDark', roof);
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(20, R - 15);
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    if (groundHeight(info.hills, x, z) > 0.5) continue;
    house(ctx, x, z, 5, 4, 3, rng.range(0, 6), 'white', 'roof');
  }
  plaza(ctx, c.x + 18, c.z + 26, 10, 'sand');
  path(ctx, [v(c.x + 18, 0, c.z + 26), v(st.x + 5.5, 0, st.z + 28)], 3, 'sand');
  signBoard(ctx, c.x + 24, c.z + 34, -0.5, 'Nine Arch', 'Bridge in the sky · Ella');
  info.spawn.set(c.x + 18, 0.2, c.z + 30);
  info.wander.push({ c: v(c.x + 18, 0, c.z + 26), r: 18 });
  info.parking.push({ pos: v(c.x + 26, 0.6, c.z + 20), yaw: 0.8, type: 'tuktuk' });
}

// ---------------------------------------------------------------- Sigiriya

export function buildSigiriya(ctx: IslandCtx) {
  const { b, c, R, info } = ctx;
  islandBase(ctx, 'grass');
  const rx = c.x;
  const rz = c.z - 10;
  const H = 48;
  const rBot = 26;
  const rTop = 18;
  rockMass(ctx, rx, rz, rBot, rTop, H, 'rockRed', 7, 6);
  // summit palace: brick foundations, a pool, the throne
  const top = H + 0.3;
  const sg = new THREE.CylinderGeometry(rTop - 1.5, rTop - 1, 0.6, 20);
  sg.translate(rx, top - 0.3, rz);
  b.add('grass', sg);
  b.physics.addStaticCylinder(v(rx, top - 0.3, rz), rTop - 1, 0.6);
  for (const [x0, z0, w, d] of [[-10, -8, 8, 6], [2, -10, 7, 7], [-6, 3, 12, 5], [4, 4, 6, 8]] as const) {
    const x = rx + x0;
    const z = rz + z0;
    b.box(x, x + w, top, top + 1.2, z, z + 0.6, 'brick');
    b.box(x, x + w, top, top + 1.2, z + d - 0.6, z + d, 'brick');
    b.box(x, x + 0.6, top, top + 1.2, z, z + d, 'brick');
  }
  b.box(rx - 4, rx + 4, top - 0.05, top + 0.05, rz + 9, rz + 14, 'water', null);
  b.box(rx - 1, rx + 1, top, top + 1.5, rz - 3, rz - 1, 'stone');
  info.anchors.summit = [v(rx, top + 0.2, rz)];

  // Lion Paw terrace at the north-facing gate (towards +z here)
  const gz = rz + rBot + 6;
  b.box(rx - 12, rx + 12, 0, 3, gz - 6, gz + 6, 'brick');
  b.stairs(v(rx, 0, gz + 14), v(rx, 3, gz + 6), 6, 'stone');
  for (const s of [-1, 1]) {
    const px = rx + s * 6.5;
    b.boxAt(px, 3 + 1.6, gz + 1, 4, 3.2, 7, 0, 'sandstone', 'concrete');
    for (let k = 0; k < 4; k++) {
      const claw = new THREE.ConeGeometry(0.45, 1.6, 5);
      claw.rotateX(Math.PI / 2 + 0.4);
      claw.translate(px - 1.4 + k * 0.95, 3.6, gz + 4.8);
      b.add('marble', claw);
    }
  }
  // the climb: stair flights spiralling up around the rock
  const flights = 8;
  const rise = (top - 3) / flights;
  let ang = Math.PI / 2;
  let y = 3;
  const radiusAt = (yy: number) => THREE.MathUtils.lerp(rBot, rTop, yy / H) + 5.5;
  const landing = (a: number, yy: number) => v(rx + Math.cos(a) * radiusAt(yy), yy, rz + Math.sin(a) * radiusAt(yy));
  let prev = landing(ang, y);
  b.boxAt(prev.x, y - 0.3, prev.z, 5, 0.6, 5, 0, 'stone', 'concrete');
  const climb: THREE.Vector3[] = [prev.clone()];
  for (let i = 0; i < flights; i++) {
    ang += 0.72;
    y += rise;
    const next = landing(ang, y);
    b.stairs(prev, next, 3, 'stone', 'brick');
    b.boxAt(next.x, y - 0.3, next.z, 4.6, 0.6, 4.6, -ang, 'stone', 'concrete');
    // mirror wall: plastered parapet on the outside of each flight
    climb.push(next.clone());
    prev = next;
  }
  // bridge from the last landing to the summit
  b.ramp(prev, v(rx + Math.cos(ang) * (rTop - 2), top, rz + Math.sin(ang) * (rTop - 2)), 3, 0.5, 'stone', 'concrete');
  info.anchors.climb = climb;

  // water gardens (south) and moat
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const x = rx + s * 9;
      const z = rz - rBot - 12 - k * 14;
      b.box(x - 5, x + 5, 0, 0.5, z - 5, z + 5, 'stone', 'concrete');
      b.box(x - 4.3, x + 4.3, 0.42, 0.5, z - 4.3, z + 4.3, 'water', null);
      b.cyl(x, 0.5, z, 0.3, 0.4, 1.4, 6, 'marble', null);
    }
  }
  path(ctx, [v(rx, 0, rz - rBot - 2), v(rx, 0, c.z - R + 10)], 5, 'sand');
  const moat = new THREE.RingGeometry(rBot + 14, rBot + 18, 48);
  moat.rotateX(-Math.PI / 2);
  moat.translate(rx, 0.06, rz);
  b.add('water', moat);
  scatter(ctx, 'broadleaf', 40, rBot + 20, R - 6, (x, z) => Math.abs(x - rx) < 18 && z < rz, [1, 1.6]);
  scatter(ctx, 'palm', 12, rBot + 20, R - 8);
  // jungle skirt hugging the rock inside the moat (gate side kept clear, no colliders near the stairs)
  for (let i = 0; i < 70; i++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const r = ctx.rng.range(rBot + 2.5, rBot + 12.5);
    const x = rx + Math.cos(a) * r;
    const z = rz + Math.sin(a) * r;
    if (Math.abs(x - rx) < 16 && z > rz) continue;
    const kind = i % 5 === 0 ? 'banana' : i % 3 === 0 ? 'bush' : 'broadleaf';
    ctx.veg.add(kind, x, 0, z, ctx.rng.range(0.9, 1.5), ctx.rng.range(0, Math.PI * 2), false);
  }
  scatter(ctx, 'boulder', 14, rBot + 6, R - 6, () => false, [1, 2.5]);
  signBoard(ctx, rx + 14, gz + 18, 0, 'Sigiriya', 'Lion Rock · 5th century');
  info.spawn.set(rx - 6, 0.2, gz + 20);
  info.anchors.gate = [v(rx, 3.2, gz)];
  info.wander.push({ c: v(rx, 0, gz + 16), r: 12 });
  info.parking.push({ pos: v(rx + 18, 0.6, gz + 22), yaw: 0, type: 'tuktuk' });
  void jitter;
}
