import * as THREE from 'three';
import type { IslandCtx } from './types';
import { v } from './types';
import { islandBase, lampPost, signBoard } from './base';
import { towerBlock, zipline } from './inkKit';
import type { Tower } from './inkKit';

/**
 * Ink Metropolis: the biggest island, a whole downtown at the far end of the
 * Ink Docks bridge. A street grid with skyscrapers that rise toward the
 * centre, the 110 m Ink Spire (a spiral ramp winds all the way to the
 * observation deck), Central Park with a lake and a waterfall that hides a
 * cave, an elevated expressway with on-ramps for cars, and a rooftop row
 * linked by rope bridges for flow runs. Secrets are tucked in on purpose.
 */
export function buildMetro(ctx: IslandCtx) {
  const { b, c, R, rng, info, veg } = ctx;
  islandBase(ctx, 'white', 'rock');
  const towers: Tower[] = [];
  const BLOCK = 40;
  const STREET = 12;
  const half = (BLOCK - STREET) / 2;
  const inside = (x: number, z: number, m = 0) => Math.hypot(x - c.x, z - c.z) < R - 10 - m;

  // ---- landmarks claim their blocks first (grid index from the centre)
  const SPIRE = [0, 0];
  const PARK = [[1, -1], [2, -1], [1, -2], [2, -2]];
  const isPark = (i: number, j: number) => PARK.some(([a, bb]) => a === i && bb === j);
  const HWY_J = 3; // expressway runs over this street row
  const ROOF_I = -2; // the rooftop row for flow runs

  // ---- streets: asphalt with lane lines and crosswalks
  const span = Math.floor((R - 14) / BLOCK);
  for (let k = -span; k <= span; k++) {
    const off = k * BLOCK + BLOCK / 2;
    const len = 2 * Math.sqrt(Math.max(0, (R - 8) ** 2 - off ** 2));
    if (len < 20) continue;
    b.recordFootprints = false;
    b.box(c.x - len / 2, c.x + len / 2, 0.01, 0.06, c.z + off - STREET / 2, c.z + off + STREET / 2, 'asphalt', null);
    b.box(c.x + off - STREET / 2, c.x + off + STREET / 2, 0.012, 0.062, c.z - len / 2, c.z + len / 2, 'asphalt', null);
    for (let t = -len / 2 + 4; t < len / 2 - 4; t += 8) {
      b.box(c.x + t, c.x + t + 4, 0.07, 0.08, c.z + off - 0.15, c.z + off + 0.15, 'line', null);
      b.box(c.x + off - 0.15, c.x + off + 0.15, 0.07, 0.08, c.z + t, c.z + t + 4, 'line', null);
    }
    b.recordFootprints = true;
  }

  // ---- blocks
  const lots: Array<{ i: number; j: number; x: number; z: number }> = [];
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      const x = c.x + i * BLOCK;
      const z = c.z + j * BLOCK;
      if (!inside(x, z, half)) continue;
      lots.push({ i, j, x, z });
    }
  }
  const arrival = info.gates[0]?.p ?? c.clone().add(v(-R, 0, 0));
  const nearArrival = (x: number, z: number) => Math.hypot(x - arrival.x, z - arrival.z) < 46;
  for (const L of lots) {
    const { i, j, x, z } = L;
    if ((i === SPIRE[0] && j === SPIRE[1]) || isPark(i, j) || nearArrival(x, z)) continue;
    // sidewalk slab (not a footprint: the towers stand on it)
    b.recordFootprints = false;
    b.box(x - half, x + half, 0, 0.18, z - half, z + half, 'grey', 'concrete');
    b.recordFootprints = true;
    const d = Math.hypot(x - c.x, z - c.z);
    if (i === ROOF_I) continue; // built below as the rooftop row
    const downtown = d < 80;
    const mid = d < 140;
    const n = downtown ? 1 + (rng.chance(0.4) ? 1 : 0) : mid ? 2 + rng.int(0, 2) : rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const w = downtown ? rng.range(12, 22) : rng.range(7, 13);
      const dd = downtown ? rng.range(12, 22) : rng.range(7, 13);
      const ox = n === 1 ? 0 : rng.range(-half + w / 2, half - w / 2);
      const oz = n === 1 ? 0 : rng.range(-half + dd / 2, half - dd / 2);
      const t: Tower = {
        x0: x + ox - w / 2,
        x1: x + ox + w / 2,
        z0: z + oz - dd / 2,
        z1: z + oz + dd / 2,
        h: downtown ? rng.range(48, 96) : mid ? rng.range(14, 42) : rng.range(5, 16),
        dark: rng.chance(0.5),
        links: 0,
      };
      if (!b.lotFree(t.x0, t.x1, t.z0, t.z1, 1.2, t.h + 2)) continue;
      towerBlock(b, t, rng);
      towers.push(t);
      // fire escapes zig-zag up some mid-rise towers so the roofs are reachable on foot
      if (mid && !downtown && t.h > 14 && rng.chance(0.45)) fireEscape(ctx, t);
    }
    // street furniture
    if (rng.chance(0.5)) lampPost(ctx, x - half + 1, 0.18, z - half + 1);
  }

  // ---- the rooftop row: equal-height roofs linked by rope bridges (flow runs)
  const roofs: THREE.Vector3[] = [];
  const row = lots.filter((L) => L.i === ROOF_I && !nearArrival(L.x, L.z)).sort((p, q) => p.j - q.j);
  let prev: Tower | null = null;
  row.forEach((L, k) => {
    const h = 20 + (k % 3) * 2;
    const t: Tower = { x0: L.x - 12, x1: L.x + 12, z0: L.z - 12, z1: L.z + 12, h, dark: k % 2 === 0, links: 0 };
    towerBlock(b, t, rng);
    towers.push(t);
    roofs.push(v(L.x, h + 0.2, L.z));
    if (prev) {
      const pa = v(L.x, prev.h, prev.z1 - 0.2);
      const pb = v(L.x, h, t.z0 + 0.2);
      b.ropeBridge(pa, pb, 2.4);
    }
    prev = t;
  });
  // stairs up to the first roof
  if (row.length) {
    const f = row[0];
    b.stairs(v(f.x - 6, 0.18, f.z - 12 - 22), v(f.x - 6, 20, f.z - 12 - 0.3), 3.2, 'grey', 'dark');
  }
  info.anchors.rooftops = roofs;

  // ---- Ink Spire: core tower + a spiral ramp to the observation deck
  const sx = c.x + SPIRE[0] * BLOCK;
  const sz = c.z + SPIRE[1] * BLOCK;
  const H = 110;
  b.box(sx - 6, sx + 6, 0, H, sz - 6, sz + 6, 'black', 'ink');
  b.box(sx - 16, sx + 16, 0, 0.3, sz - 16, sz + 16, 'stone', 'concrete');
  const lane = 9;
  const perTurn = 32;
  const rise = 9;
  const turns = (H - 2) / rise;
  let last = v(sx + lane, 0.3, sz);
  for (let s = 1; s <= Math.ceil(turns * perTurn); s++) {
    const a = (s / perTurn) * Math.PI * 2;
    const y = Math.min(H, 0.3 + (s / perTurn) * rise);
    const p = v(sx + Math.cos(a) * lane, y, sz + Math.sin(a) * lane);
    b.ramp(last, p, 4.6, 0.4, s % 2 ? 'grey' : 'dark', 'concrete');
    // outer kerb every few segments
    if (s % 4 === 0) b.boxAt(sx + Math.cos(a) * (lane + 2.4), y + 0.45, sz + Math.sin(a) * (lane + 2.4), 0.25, 0.9, 1.8, -a, 'teal', null);
    last = p;
  }
  // observation deck on top
  b.box(sx - 14, sx + 14, H - 0.4, H, sz - 14, sz + 14, 'white', 'concrete');
  for (const [dx, dz, w, d] of [[-14, 0, 0.4, 28], [14, 0, 0.4, 28], [0, -14, 28, 0.4], [0, 14, 28, 0.4]] as const) b.box(sx + dx - w / 2, sx + dx + w / 2, H, H + 1.1, sz + dz - d / 2, sz + dz + d / 2, 'glass', null);
  b.cyl(sx, H, sz, 0.6, 1.4, 22, 8, 'metal', null);
  b.cyl(sx, H + 22, sz, 0.1, 0.6, 8, 6, 'neonTeal', null);
  const spireTop = v(sx + 8, H + 0.3, sz + 8);
  info.anchors.spireTop = [spireTop];
  info.anchors.summit = [spireTop.clone()];
  info.extraNests.push({ pos: v(sx - 8, H + 1.6, sz - 8), type: 'storm' });

  // ---- Central Park: lawn, trees, lake, and the falls with a cave behind them
  const pk = PARK.map(([i, j]) => v(c.x + i * BLOCK, 0, c.z + j * BLOCK));
  const px0 = Math.min(...pk.map((p) => p.x)) - half - STREET / 2;
  const px1 = Math.max(...pk.map((p) => p.x)) + half + STREET / 2;
  const pz0 = Math.min(...pk.map((p) => p.z)) - half - STREET / 2;
  const pz1 = Math.max(...pk.map((p) => p.z)) + half + STREET / 2;
  b.recordFootprints = false;
  b.box(px0, px1, 0.02, 0.2, pz0, pz1, 'grass', 'concrete');
  b.recordFootprints = true;
  const lx = (px0 + px1) / 2;
  const lz = (pz0 + pz1) / 2 + 6;
  b.cyl(lx, 0, lz, 21, 22, 0.5, 32, 'stone', 'concrete');
  b.cyl(lx, 0.45, lz, 19.5, 19.5, 0.12, 32, 'water', null);
  info.anchors.parkLake = [v(lx, 1, lz)];
  // cliff of rock blocks along the north edge, with a gap behind the water sheet
  const cz = pz0 + 4;
  const cliffH = 26;
  b.box(px0 + 4, lx - 3, 0, cliffH, cz - 6, cz + 2, 'rock', 'concrete');
  b.box(lx + 3, px1 - 4, 0, cliffH, cz - 6, cz + 2, 'rock', 'concrete');
  b.box(lx - 3, lx + 3, 5, cliffH, cz - 6, cz + 2, 'rock', 'concrete');
  // the cave: a room cut into the rock behind the falls
  b.box(lx - 7, lx + 7, 0, 0.2, cz - 16, cz - 6, 'stone', 'concrete');
  b.box(lx - 7.5, lx - 7, 0, 6, cz - 16, cz - 6, 'rock', 'concrete');
  b.box(lx + 7, lx + 7.5, 0, 6, cz - 16, cz - 6, 'rock', 'concrete');
  b.box(lx - 7.5, lx + 7.5, 0, 6, cz - 16.5, cz - 16, 'rock', 'concrete');
  b.box(lx - 7.5, lx + 7.5, 6, 6.6, cz - 16.5, cz - 6, 'rock', 'concrete');
  b.box(lx - 3, lx + 3, 0, 5, cz - 6, cz - 5.6, 'goo', null);
  // the falling water sheet (no collider: walk straight through it)
  b.box(lx - 3.2, lx + 3.2, 0.4, cliffH + 0.4, cz + 2.2, cz + 2.8, 'water', null);
  b.box(lx - 4, lx + 4, cliffH, cliffH + 0.5, cz - 6, cz + 3, 'water', null);
  ctx.group.add(waterfallSheet(v(lx, cliffH / 2 + 0.4, cz + 3), 6.6, cliffH));
  info.anchors.fallsCave = [v(lx, 0.6, cz - 11)];
  // stairs up the side of the cliff to the top of the falls
  b.stairs(v(px1 - 8, 0.2, cz + 26), v(px1 - 8, cliffH, cz + 2.2), 3.4, 'stone', null);
  info.anchors.fallsTop = [v(lx + 6, cliffH + 0.3, cz - 2)];
  for (let k = 0; k < 26; k++) {
    const x = rng.range(px0 + 6, px1 - 6);
    const z = rng.range(cz + 6, pz1 - 6);
    if (Math.hypot(x - lx, z - lz) < 25) continue;
    veg.add(rng.chance(0.3) ? 'pine' : rng.chance(0.5) ? 'broadleaf' : 'bush', x, 0.2, z, rng.range(0.9, 1.5));
  }
  for (let k = 0; k < 6; k++) lampPost(ctx, lx + Math.cos(k) * 25, 0.2, lz + Math.sin(k) * 25);

  // ---- elevated expressway over one street row, with on-ramps at both ends
  const hz = c.z + HWY_J * BLOCK + BLOCK / 2;
  const hl = Math.sqrt(Math.max(0, (R - 30) ** 2 - (hz - c.z) ** 2));
  const HY = 10;
  const rampL = 60;
  const hx0 = c.x - hl + rampL;
  const hx1 = c.x + hl - rampL;
  b.box(hx0, hx1, HY - 0.6, HY, hz - 7, hz + 7, 'asphalt', 'concrete');
  b.ramp(v(hx0 - rampL, 0.1, hz), v(hx0, HY, hz), 14, 0.6, 'asphalt', 'concrete');
  b.ramp(v(hx1, HY, hz), v(hx1 + rampL, 0.1, hz), 14, 0.6, 'asphalt', 'concrete');
  for (let x = hx0; x <= hx1; x += 24) b.box(x - 1, x + 1, 0, HY - 0.6, hz - 1.5, hz + 1.5, 'grey', 'concrete');
  for (const s of [-1, 1]) b.box(hx0, hx1, HY, HY + 0.9, hz + s * 7 - 0.25, hz + s * 7 + 0.25, 'grey', 'concrete');
  for (let x = hx0; x < hx1; x += 8) b.box(x, x + 4, HY + 0.01, HY + 0.02, hz - 0.15, hz + 0.15, 'line', null);
  const hwy: THREE.Vector3[] = [];
  for (let k = 0; k <= 8; k++) hwy.push(v(hx0 - rampL * 0.6 + ((hx1 - hx0 + rampL * 1.2) * k) / 8, k === 0 || k === 8 ? 3 : HY + 1, hz));
  info.anchors.highway = hwy;
  // under the overpass: a hidden graffiti hall
  const ux = (hx0 + hx1) / 2;
  info.anchors.underpass = [v(ux, 0.4, hz)];

  // ---- a long zip-line from the spire deck down to the park
  zipline(b, info.ziplines, v(sx + 13, H + 5, sz + 13), v(lx - 10, 4, lz + 22), H, 0.2);

  // ---- downtown plaza for fights, signs, arrival
  info.anchors.plazaSpawns = [0, 1, 2, 3, 4, 5].map((k) => v(sx + Math.cos(k) * 22, 0.4, sz + Math.sin(k) * 22));
  const inward = c.clone().sub(arrival).setY(0).normalize();
  const side = v(-inward.z, 0, inward.x);
  const sp = arrival.clone().addScaledVector(inward, 16).setY(0.2);
  info.spawn.copy(sp);
  signBoard(ctx, sp.x + side.x * 8, sp.z + side.z * 8, Math.atan2(-inward.x, -inward.z), 'Ink Metropolis', 'Downtown · Ink City');
  info.wander.push({ c: sp.clone().addScaledVector(inward, 10), r: 10 }, { c: v(lx, 0, lz + 26), r: 10 });
  info.parking.push(
    { pos: sp.clone().addScaledVector(side, -12).setY(0.6), yaw: Math.atan2(inward.x, inward.z), type: 'blotter' },
    { pos: sp.clone().addScaledVector(side, 12).setY(0.6), yaw: Math.atan2(inward.x, inward.z), type: 'moto' },
    { pos: v(hx0 - rampL - 8, 0.6, hz), yaw: Math.PI / 2, type: 'inkbox' },
  );
  info.towers = towers;
  // loot: a legendary crate in the cave, rare ones on the deck and the roof row
  info.loot.push({ kind: 'crate', pos: v(lx + 4, 0.3, cz - 13), rarity: 2 }, { kind: 'crate', pos: v(sx - 10, H + 0.1, sz + 10), rarity: 1 });
  if (roofs.length > 3) info.loot.push({ kind: 'crate', pos: roofs[Math.floor(roofs.length / 2)].clone().add(v(5, 0, 0)), rarity: 1 });
  info.loot.push({ kind: 'log', pos: v(ux + 3, 0.4, hz + 3) });
}

/** Animated falling water: scrolling white/teal streaks plus a foam cloud at the bottom. */
function waterfallSheet(center: THREE.Vector3, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(160,220,225,0.55)';
  x.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 90; i++) {
    const px = Math.random() * 128;
    const len = 30 + Math.random() * 90;
    const py = Math.random() * 256;
    x.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.55})`;
    x.fillRect(px, py, 1 + Math.random() * 3, len);
    x.fillRect(px, py - 256, 1 + Math.random() * 3, len);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.5, h / 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  sheet.position.copy(center);
  sheet.onBeforeRender = () => {
    tex.offset.y = (performance.now() / 1000) * 1.6;
  };
  sheet.userData.noMap = true;
  g.add(sheet);
  // foam where it hits the pool
  const foamMat = new THREE.MeshBasicMaterial({ color: '#f4fbfb', transparent: true, opacity: 0.75, depthWrite: false });
  for (let i = 0; i < 9; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.8 + Math.random() * 0.9, 8, 6), foamMat);
    f.position.set(center.x + (Math.random() - 0.5) * w, 0.6 + Math.random() * 0.6, center.z + Math.random() * 1.6);
    f.scale.y = 0.55;
    const ph = Math.random() * 6;
    f.onBeforeRender = () => {
      const t = performance.now() / 1000 + ph;
      f.scale.setScalar(0.85 + Math.sin(t * 3) * 0.15);
      f.scale.y = 0.5 + Math.sin(t * 2.3) * 0.1;
    };
    g.add(f);
  }
  return g;
}

/** Zig-zag steel stairs up one face of a tower to its roof. */
function fireEscape(ctx: IslandCtx, t: Tower) {
  const { b } = ctx;
  const x = t.x1 + 1.4;
  const flight = 4;
  let y = 0.18;
  let z0 = t.z0 + 1;
  let z1 = t.z1 - 1;
  let dir = 1;
  while (y < t.h - 0.5) {
    const top = Math.min(t.h, y + flight);
    const from = v(x, y, dir > 0 ? z0 : z1);
    const to = v(x, top, dir > 0 ? z1 : z0);
    b.ramp(from, to, 2.2, 0.2, 'metal', 'concrete');
    b.box(x - 1.1, x + 1.1, top - 0.2, top, (dir > 0 ? z1 : z0) - 1.1, (dir > 0 ? z1 : z0) + 1.1, 'metal', 'concrete');
    y = top;
    dir = -dir;
    [z0, z1] = [z0, z1];
  }
  // step across onto the roof
  b.box(t.x1 - 0.2, x + 1.1, t.h - 0.2, t.h, t.z0 + 0.5, t.z0 + 2.5, 'metal', 'concrete');
}
