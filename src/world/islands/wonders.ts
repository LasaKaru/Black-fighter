import * as THREE from 'three';
import type { IslandCtx } from './types';
import { groundHeight, v } from './types';
import { hillCap, house, islandBase, jitter, lampPost, path, plaza, rockMass, scatter, signBoard } from './base';

/**
 * The New Seven Wonders, drawn in BLACKEYE's faceted ink style.
 * Each is built at gameplay scale (walkable, climbable, mission-ready).
 */

// ---------------------------------------------------------------- Taj Mahal

export function buildTaj(ctx: IslandCtx) {
  const { b, c, R, info } = ctx;
  islandBase(ctx, 'grass');
  const tz = c.z - 22;
  // plinth + front stairs
  b.box(c.x - 24, c.x + 24, 0, 4, tz - 24, tz + 24, 'marble');
  b.stairs(v(c.x, 0, tz + 34), v(c.x, 4, tz + 24), 10, 'marble', 'marble');
  // main octagonal hall
  const hall = new THREE.CylinderGeometry(15, 15, 18, 8);
  hall.rotateY(Math.PI / 8);
  hall.translate(c.x, 4 + 9, tz);
  b.add('marble', hall);
  b.physics.addStaticCylinder(v(c.x, 13, tz), 14.2, 18);
  // pishtaq arches on the four main faces (dark recess + pointed arch frame)
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const fx = Math.sin(a);
    const fz = Math.cos(a);
    const px = c.x + fx * 13.9;
    const pz = tz + fz * 13.9;
    b.boxAt(px, 4 + 7.5, pz, 7.5, 13, 0.6, a, 'soapstone', null);
    b.boxAt(px + fx * 0.25, 4 + 5.6, pz + fz * 0.25, 5, 9, 0.4, a, 'stone', null);
    const arch = new THREE.CylinderGeometry(2.5, 2.5, 0.4, 12, 1, false, -Math.PI / 2, Math.PI);
    arch.rotateX(Math.PI / 2);
    arch.rotateY(a);
    arch.translate(px + fx * 0.25, 4 + 10.1, pz + fz * 0.25);
    b.add('stone', arch);
    // small side alcoves
    for (const s of [-1, 1]) {
      const sx = px + Math.cos(a) * s * 5.4;
      const sz = pz - Math.sin(a) * s * 5.4;
      b.boxAt(sx, 4 + 4, sz, 2.2, 4, 0.5, a, 'stone', null);
      b.boxAt(sx, 4 + 10, sz, 2.2, 4, 0.5, a, 'stone', null);
    }
  }
  // drum + onion dome + finial
  b.cyl(c.x, 22, tz, 8, 8, 4, 24, 'marble', null);
  const domeY = 26;
  b.lathe(c.x, domeY, tz, [[0, 0], [8.2, 0], [9.6, 3], [10.2, 6.5], [9.6, 10], [7.4, 13.5], [4.2, 16.5], [1.4, 18.8], [0.4, 20], [0, 20.6]], 28, 'marble');
  b.physics.addStaticBall(v(c.x, domeY + 7, tz), 9.6);
  b.cyl(c.x, domeY + 20.4, tz, 0.08, 0.35, 5, 8, 'gold', null);
  // four chhatris on the roof
  for (const [sx, sz] of [[-9, -9], [9, -9], [-9, 9], [9, 9]] as const) {
    const x = c.x + sx;
    const z = tz + sz;
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]] as const) b.cyl(x + dx, 22, z + dz, 0.2, 0.2, 3, 6, 'marble', null);
    b.lathe(x, 25, z, [[0, 0], [2.2, 0], [2.4, 1], [1.8, 2.4], [0.6, 3.3], [0, 3.8]], 12, 'marble');
  }
  // minarets at the plinth corners
  for (const [sx, sz] of [[-21, -21], [21, -21], [-21, 21], [21, 21]] as const) {
    const x = c.x + sx;
    const z = tz + sz;
    b.cyl(x, 4, z, 1.25, 1.7, 34, 12, 'marble', 'concrete');
    for (const y of [14, 25, 35]) b.cyl(x, 4 + y - 2, z, 2.4, 2.0, 0.8, 12, 'soapstone', null);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.cyl(x + Math.cos(a) * 1.4, 38, z + Math.sin(a) * 1.4, 0.12, 0.12, 2.4, 5, 'marble', null);
    }
    b.lathe(x, 40.4, z, [[0, 0], [2, 0], [2.1, 0.8], [1.5, 2], [0.4, 3], [0, 3.6]], 12, 'marble');
  }
  // reflecting pool, fountains and cypress avenue
  const pz0 = tz + 34;
  const pz1 = c.z + R - 18;
  b.box(c.x - 3.4, c.x + 3.4, 0, 0.5, pz0, pz1, 'marble', 'concrete');
  b.box(c.x - 2.6, c.x + 2.6, 0.45, 0.55, pz0 + 0.8, pz1 - 0.8, 'water', null);
  for (let z = pz0 + 4; z < pz1 - 2; z += 6) b.cyl(c.x, 0.5, z, 0.12, 0.2, 1.2, 6, 'marble', null);
  b.box(c.x - 7, c.x + 7, 0, 0.6, (pz0 + pz1) / 2 - 7, (pz0 + pz1) / 2 + 7, 'marble', 'concrete');
  b.box(c.x - 5.5, c.x + 5.5, 0.55, 0.65, (pz0 + pz1) / 2 - 5.5, (pz0 + pz1) / 2 + 5.5, 'water', null);
  for (let z = pz0 + 3; z < pz1; z += 5) {
    for (const s of [-1, 1]) {
      ctx.veg.add('cypress', c.x + s * 6.5, 0, z, 1.0, 0);
      ctx.veg.add('cypress', c.x + s * 17, 0, z + 2.5, 0.9, 0);
    }
  }
  // lawns
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(18, 0.1, pz1 - pz0);
    g.translate(c.x + s * 13, 0.05, (pz0 + pz1) / 2);
    b.add('grassDark', g);
  }
  // red sandstone gate (Darwaza) at the far end
  const gz = c.z + R - 12;
  b.box(c.x - 13, c.x - 3, 0, 16, gz - 4, gz + 4, 'brick');
  b.box(c.x + 3, c.x + 13, 0, 16, gz - 4, gz + 4, 'brick');
  b.box(c.x - 3, c.x + 3, 11, 16, gz - 4, gz + 4, 'brick');
  b.box(c.x - 13.3, c.x + 13.3, 16, 17, gz - 4.3, gz + 4.3, 'marble', null);
  for (let k = 0; k < 11; k++) b.lathe(c.x - 11 + k * 2.2, 17, gz - 3.6, [[0, 0], [0.9, 0], [0.8, 0.8], [0.3, 1.4], [0, 1.6]], 8, 'marble');
  // mosque and guest house (red, either side)
  for (const s of [-1, 1]) {
    const x = c.x + s * 40;
    b.box(x - 7, x + 7, 0, 10, tz - 12, tz + 12, 'brick');
    for (let k = -1; k <= 1; k++) b.lathe(x, 10, tz + k * 7, [[0, 0], [3, 0], [3.2, 1.6], [2.2, 3.6], [0.7, 4.6], [0, 5.2]], 14, 'marble');
  }
  signBoard(ctx, c.x + 12, pz1 - 4, 0, 'Taj Mahal', 'Agra · India');
  info.anchors.gardens = [];
  for (let i = 0; i < 12; i++) info.anchors.gardens.push(v(c.x + (i % 2 ? 13 : -13) + ((i * 7) % 5), 1.2, pz0 + 3 + i * ((pz1 - pz0 - 6) / 12)));
  info.anchors.dome = [v(c.x, domeY + 20.6, tz)];
  info.spawn.set(c.x + 8, 0.2, pz1 - 2);
  info.wander.push({ c: v(c.x, 0, (pz0 + pz1) / 2), r: 16 });
  info.parking.push({ pos: v(c.x + 30, 0.6, pz1 - 4), yaw: Math.PI, type: 'tuktuk' });
  scatter(ctx, 'broadleaf', 16, 30, R - 8, (x) => Math.abs(x - c.x) < 34);
}

// ---------------------------------------------------------------- Chichen Itza

export function buildChichen(ctx: IslandCtx) {
  const { b, c, R, info } = ctx;
  islandBase(ctx, 'grassDark');
  plaza(ctx, c.x, c.z, 34, 'sand');
  // El Castillo: nine terraces + four staircases + temple
  const tiers = 9;
  const tierH = 2.3;
  const base = 34;
  for (let i = 0; i < tiers; i++) {
    const w = base - i * 3.2;
    b.box(c.x - w / 2, c.x + w / 2, i * tierH, (i + 1) * tierH, c.z - w / 2, c.z + w / 2, 'stone');
    // shadow band
    b.box(c.x - w / 2 - 0.05, c.x + w / 2 + 0.05, (i + 1) * tierH - 0.5, (i + 1) * tierH - 0.25, c.z - w / 2 - 0.05, c.z + w / 2 + 0.05, 'travertine', null);
  }
  const topY = tiers * tierH;
  const topW = base - (tiers - 1) * 3.2;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const fx = Math.sin(a);
    const fz = Math.cos(a);
    const start = v(c.x + fx * (base / 2 + 9), 0, c.z + fz * (base / 2 + 9));
    const end = v(c.x + fx * (topW / 2), topY, c.z + fz * (topW / 2));
    b.stairs(start, end, 6, 'travertine', 'stone');
    // Kukulcán serpent heads at the foot of the north stair
    if (k === 0) {
      for (const s of [-1, 1]) {
        const hx = start.x + s * 3.6;
        b.boxAt(hx, 0.9, start.z + 0.5, 1.8, 1.8, 2.6, a, 'stone', 'concrete');
        const jaw = new THREE.ConeGeometry(0.9, 1.6, 4);
        jaw.rotateX(Math.PI / 2);
        jaw.translate(hx, 0.7, start.z + 2.2);
        b.add('travertine', jaw);
      }
    }
  }
  // temple on top
  b.box(c.x - 5, c.x + 5, topY, topY + 6, c.z - 5, c.z + 5, 'travertine');
  b.box(c.x - 5.6, c.x + 5.6, topY + 6, topY + 6.8, c.z - 5.6, c.z + 5.6, 'stone', null);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    b.boxAt(c.x + Math.sin(a) * 5.02, topY + 2, c.z + Math.cos(a) * 5.02, 2.2, 4, 0.1, a, 'black', null);
  }
  info.anchors.pyramidTop = [v(c.x, topY + 6.9, c.z)];
  info.anchors.pyramidTopFloor = [v(c.x + 7, topY + 0.2, c.z)];
  // ball court
  for (const s of [-1, 1]) {
    const x = c.x + s * 9 - 52;
    b.box(x - 2.5, x + 2.5, 0, 7, c.z - 30, c.z + 30, 'stone');
    const ring = new THREE.TorusGeometry(1.3, 0.35, 6, 16);
    ring.rotateY(Math.PI / 2);
    ring.translate(x - s * 2.6, 6, c.z);
    b.add('travertine', ring);
  }
  // Temple of the Warriors: platform with columns
  b.box(c.x + 34, c.x + 58, 0, 6, c.z - 40, c.z - 20, 'stone');
  b.stairs(v(c.x + 46, 0, c.z - 10), v(c.x + 46, 6, c.z - 20), 6, 'travertine');
  for (let x = 0; x < 6; x++) for (let z = 0; z < 4; z++) b.cyl(c.x + 36 + x * 4, 0, c.z - 16 + z * 3.5 - 8 + 20, 0.6, 0.6, 3.5, 8, 'travertine', 'concrete');
  // sacred cenote
  const cen = new THREE.CylinderGeometry(9, 9, 0.2, 24);
  cen.translate(c.x - 10, 0.08, c.z + 48);
  b.add('water', cen);
  const rim = new THREE.TorusGeometry(9.3, 0.9, 6, 24);
  rim.rotateX(Math.PI / 2);
  rim.translate(c.x - 10, 0.3, c.z + 48);
  b.add('rock', rim);
  scatter(ctx, 'broadleaf', 46, 40, R - 6, () => false, [1.1, 1.8]);
  scatter(ctx, 'banana', 26, 38, R - 6);
  scatter(ctx, 'palm', 10, 45, R - 8);
  signBoard(ctx, c.x + 14, c.z + base / 2 + 22, 0, 'Chichén Itzá', 'Yucatán · Mexico');
  info.spawn.set(c.x + 6, 0.2, c.z + base / 2 + 24);
  info.wander.push({ c: v(c.x, 0, c.z + 28), r: 10 });
  info.parking.push({ pos: v(c.x - 24, 0.6, c.z + 36), yaw: 0, type: 'buggy' });
}

// ---------------------------------------------------------------- Machu Picchu

export function buildMachu(ctx: IslandCtx) {
  const { b, c, R, rng, info } = ctx;
  islandBase(ctx, 'grassDark');
  // Huayna Picchu peak behind the citadel
  rockMass(ctx, c.x + 4, c.z - 58, 26, 5, 74, 'grassDark', 21, 6);
  rockMass(ctx, c.x - 48, c.z - 40, 16, 4, 38, 'grass', 22, 4);
  // agricultural terraces climbing to the citadel plateau
  const steps = 8;
  const stepH = 2.2;
  for (let i = 0; i < steps; i++) {
    const z0 = c.z + 52 - i * 5.5;
    const half = 44 - i * 1.5;
    b.box(c.x - half, c.x + half, 0, (i + 1) * stepH, z0 - 5.5, z0, i % 2 ? 'grass' : 'grassDark');
    b.box(c.x - half - 0.05, c.x + half + 0.05, 0, (i + 1) * stepH - 0.2, z0 - 0.4, z0 + 0.05, 'stone', null);
  }
  const plateauY = steps * stepH;
  b.box(c.x - 40, c.x + 40, 0, plateauY, c.z - 34, c.z + 52 - steps * 5.5, 'grass');
  // central stone staircase
  b.stairs(v(c.x, 0, c.z + 60), v(c.x, plateauY, c.z + 52 - steps * 5.5), 4, 'stone', 'stone');
  // citadel houses with thatched gable roofs
  const houses: THREE.Vector3[] = [];
  for (let gx = -3; gx <= 3; gx++) {
    for (let gz = 0; gz < 3; gz++) {
      if (gx === 0 && gz === 1) continue; // main plaza
      const x = c.x + gx * 10 + rng.range(-1, 1);
      const z = c.z - 28 + gz * 10 + rng.range(-1, 1);
      const w = rng.range(5, 7);
      const d = rng.range(4, 5);
      // stone walls
      const yaw = rng.chance(0.5) ? 0 : Math.PI / 2;
      b.boxAt(x, plateauY + 1.6, z, w, 3.2, d, yaw, 'stone', 'concrete');
      const roof = new THREE.CylinderGeometry(1, 1, d + 0.6, 3, 1);
      roof.rotateX(Math.PI / 2);
      roof.rotateZ(Math.PI / 2);
      roof.scale((w / 2 + 0.6) / Math.cos(Math.PI / 6), 1.8, 1);
      roof.rotateY(yaw);
      roof.translate(x, plateauY + 3.2 + 0.9, z);
      b.add('thatch', roof);
      houses.push(v(x, plateauY + 4.8, z));
    }
  }
  // Temple of the Sun (curved tower) and the Intihuatana stone
  b.cyl(c.x + 30, plateauY, c.z - 6, 5, 5.5, 6, 16, 'stone', 'concrete');
  b.box(c.x - 30, c.x - 28, plateauY, plateauY + 2.2, c.z - 6, c.z - 4, 'stone');
  info.anchors.citadel = houses;
  info.anchors.peak = [v(c.x + 4, 74.5, c.z - 58)];
  info.anchors.terraces = [v(c.x - 30, 2.4, c.z + 50), v(c.x + 30, 6.8, c.z + 39), v(c.x - 20, 11.2, c.z + 28), v(c.x + 18, 15.6, c.z + 17), v(c.x, plateauY + 0.2, c.z - 18), v(c.x + 30, plateauY + 6.2, c.z - 6)];
  scatter(ctx, 'pine', 20, 50, R - 6, (x, z) => z < c.z + 60 && Math.abs(x - c.x) < 45, [0.9, 1.4]);
  scatter(ctx, 'boulder', 16, 20, R - 6, (x, z) => z > c.z - 34 && z < c.z + 55 && Math.abs(x - c.x) < 45, [1, 2]);
  signBoard(ctx, c.x + 12, c.z + 70, 0, 'Machu Picchu', 'Andes · Peru');
  info.spawn.set(c.x + 6, 0.2, c.z + 72);
  info.wander.push({ c: v(c.x, plateauY, c.z - 18), r: 12 });
  info.parking.push({ pos: v(c.x - 20, 0.6, c.z + 70), yaw: 0, type: 'buggy' });
}

// ---------------------------------------------------------------- Colosseum

export function buildColosseum(ctx: IslandCtx) {
  const { b, c, R, info } = ctx;
  islandBase(ctx, 'grass');
  plaza(ctx, c.x, c.z, 56, 'travertine');
  const ax = 44;
  const az = 35;
  const bays = 64;
  const tierH = 7;
  for (let i = 0; i < bays; i++) {
    const t0 = (i / bays) * Math.PI * 2;
    const t1 = ((i + 1) / bays) * Math.PI * 2;
    const tm = (t0 + t1) / 2;
    const p0 = v(c.x + Math.cos(t0) * ax, 0, c.z + Math.sin(t0) * az);
    const p1 = v(c.x + Math.cos(t1) * ax, 0, c.z + Math.sin(t1) * az);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const len = p0.distanceTo(p1);
    const yaw = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    // the north side is the ruined one (lower)
    const ruined = Math.sin(tm) < -0.35;
    const levels = ruined ? 2 : 4;
    for (let l = 0; l < levels; l++) {
      const y0 = l * tierH;
      if (l < 3) {
        // pier + arch lintel: openings between piers
        b.boxAt(p0.x, y0 + tierH / 2, p0.z, 1.6, tierH, 3, yaw, 'travertine', l === 0 ? 'concrete' : null);
        b.boxAt(mid.x, y0 + tierH - 1, mid.z, len, 2, 3, yaw, 'travertine', null);
        b.boxAt(mid.x, y0 + 0.2, mid.z, len, 0.4, 3.2, yaw, 'stone', null);
        // engaged column on the pier face
        const n = new THREE.Vector3(Math.cos(tm) / ax, 0, Math.sin(tm) / az).normalize();
        b.cyl(p0.x + n.x * 1.6, y0, p0.z + n.z * 1.6, 0.35, 0.4, tierH - 1, 6, 'stone', null);
      } else {
        // solid attic storey with small windows
        b.boxAt(mid.x, y0 + tierH / 2, mid.z, len + 0.1, tierH, 3, yaw, 'travertine', null);
        if (i % 2 === 0) b.boxAt(mid.x, y0 + tierH / 2, mid.z, 1.2, 1.6, 3.1, yaw, 'black', null);
      }
    }
    // walkable floor slabs for upper storeys (ring corridor)
    for (let l = 1; l < levels; l++) b.boxAt(mid.x, l * tierH - 0.25, mid.z, len + 0.2, 0.5, 3, yaw, 'stone', 'concrete');
    // seating cavea: stepped bands from the arena wall up to the outer ring
    for (let k = 0; k < 4; k++) {
      const s = 0.62 + k * 0.085;
      const q0 = v(c.x + Math.cos(t0) * ax * s, 0, c.z + Math.sin(t0) * az * s);
      const q1 = v(c.x + Math.cos(t1) * ax * s, 0, c.z + Math.sin(t1) * az * s);
      const qm = q0.clone().add(q1).multiplyScalar(0.5);
      const h = 3 + k * 3;
      if (ruined && k > 2) continue;
      b.boxAt(qm.x, h / 2, qm.z, q0.distanceTo(q1) + 0.2, h, 4, yaw, k % 2 ? 'stone' : 'travertine', 'concrete');
    }
  }
  // arena floor (sand) + wooden hypogeum edge
  const arena = new THREE.CylinderGeometry(1, 1, 0.3, 48);
  arena.scale(ax * 0.6, 1, az * 0.6);
  arena.translate(c.x, 0.15, c.z);
  b.add('sand', arena);
  // arch of Constantine-style gate on the approach
  const gz = c.z + az + 22;
  b.box(c.x - 10, c.x - 3, 0, 14, gz - 3, gz + 3, 'marble');
  b.box(c.x + 3, c.x + 10, 0, 14, gz - 3, gz + 3, 'marble');
  b.box(c.x - 3, c.x + 3, 9.5, 14, gz - 3, gz + 3, 'marble');
  b.box(c.x - 10.5, c.x + 10.5, 14, 17, gz - 3.3, gz + 3.3, 'travertine');
  for (const s of [-1, 1]) for (const k of [0, 1]) b.cyl(c.x + s * (4 + k * 5), 0, gz + 3.4, 0.5, 0.5, 13, 8, 'travertine', null);
  info.anchors.arena = [v(c.x, 0.4, c.z)];
  info.anchors.arenaSpawns = [0, 1, 2, 3, 4, 5].map((k) => v(c.x + Math.cos(k) * ax * 0.45, 0.4, c.z + Math.sin(k) * az * 0.45));
  scatter(ctx, 'cypress', 26, 60, R - 6, () => false, [0.9, 1.3]);
  scatter(ctx, 'pine', 10, 62, R - 8);
  for (let i = 0; i < 10; i++) lampPost(ctx, c.x + Math.cos(i * 0.63) * 54, 0, c.z + Math.sin(i * 0.63) * 54);
  signBoard(ctx, c.x + 16, gz + 6, 0, 'Colosseum', 'Rome · Italy');
  info.spawn.set(c.x, 0.2, gz + 8);
  info.wander.push({ c: v(c.x, 0, gz + 4), r: 12 });
  info.parking.push({ pos: v(c.x - 22, 0.6, gz + 8), yaw: 0, type: 'blotter' });
}

// ---------------------------------------------------------------- Petra

export function buildPetra(ctx: IslandCtx) {
  const { b, c, R, rng, info } = ctx;
  islandBase(ctx, 'sand', 'sandstone');
  const cliff = (x0: number, x1: number, z0: number, z1: number, h: number, seed: number) => {
    const g = jitter(new THREE.BoxGeometry(x1 - x0, h, z1 - z0, 4, 6, 4), 1.6, seed);
    g.translate((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    b.add('sandstone', g);
    b.physics.addStaticBox(v((x0 + x1) / 2, h / 2, (z0 + z1) / 2), v(x1 - x0 - 1.5, h, z1 - z0 - 1.5));
  };
  // the Siq: a narrow canyon from the south edge to the Treasury plaza
  const x = c.x;
  const z = c.z;
  cliff(x - 62, x - 7, z - 20, z + 70, 38, 1);
  cliff(x + 7, x + 62, z - 20, z + 70, 42, 2);
  cliff(x - 62, x - 16, z - 62, z - 20, 44, 3);
  cliff(x + 16, x + 62, z - 62, z - 20, 40, 4);
  cliff(x - 34, x + 34, z - 80, z - 46, 48, 5);
  // Al-Khazneh (the Treasury) carved into the back cliff, facing +z
  const fz = z - 46;
  b.box(x - 13, x + 13, 0, 1.2, fz, fz + 4, 'sandstone');
  for (let k = 0; k < 6; k++) {
    const cx = x - 10 + k * 4;
    b.cyl(cx, 1.2, fz + 1.6, 0.8, 0.85, 12, 10, 'sandstone', 'concrete');
    b.box(cx - 1.1, cx + 1.1, 13.2, 14, fz + 0.5, fz + 2.6, 'rockRed', null);
  }
  b.box(x - 13, x + 13, 14, 16, fz, fz + 2.8, 'sandstone', null);
  const ped = new THREE.CylinderGeometry(1, 1, 2.6, 3, 1);
  ped.rotateX(Math.PI / 2);
  ped.rotateZ(Math.PI / 2);
  ped.scale(13.4, 3.4, 1);
  ped.translate(x, 17.6, fz + 1.4);
  b.add('sandstone', ped);
  b.box(x - 2.2, x + 2.2, 1.2, 8.5, fz - 0.1, fz + 0.2, 'black', null);
  // upper storey: tholos with columns between broken half-pediments
  b.cyl(x, 20, fz + 2.4, 3.6, 3.6, 10, 16, 'sandstone', null);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI - Math.PI;
    b.cyl(x + Math.cos(a) * 4.2, 20, fz + 2.4 - Math.sin(a) * 4.2, 0.45, 0.45, 9, 8, 'sandstone', null);
  }
  b.lathe(x, 30, fz + 2.4, [[0, 0], [4.4, 0], [3.4, 1.6], [1.6, 3], [0, 3.4]], 16, 'sandstone');
  b.lathe(x, 33.4, fz + 2.4, [[0, 0], [0.9, 0.4], [1.1, 1.6], [0.5, 2.6], [0, 2.8]], 10, 'sandstone');
  for (const s of [-1, 1]) {
    for (let k = 0; k < 2; k++) b.cyl(x + s * (8 + k * 3.2), 20, fz + 1.6, 0.6, 0.6, 9, 8, 'sandstone', null);
    const hp = new THREE.CylinderGeometry(1, 1, 2.4, 3, 1, false, 0, Math.PI);
    hp.rotateX(Math.PI / 2);
    hp.scale(5, 2.6, 1);
    hp.translate(x + s * 9.6, 30.4, fz + 1.2);
    b.add('sandstone', hp);
  }
  // royal tombs: dark doorways along the cliffs
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const zz = z - 12 + (i >> 1) * 16;
    const xx = x + side * (side > 0 ? 7.1 : 7.1);
    b.boxAt(xx, 4 + (i % 3) * 3, zz, 0.2, 4, 2.4, Math.PI / 2, 'black', null);
  }
  info.anchors.treasury = [v(x, 1.4, fz + 6)];
  info.anchors.relics = [];
  for (let i = 0; i < 8; i++) info.anchors.relics.push(v(x + rng.range(-5, 5), 1, z + 66 - i * 14));
  info.anchors.relics.push(v(x, 30.6, fz + 2.4), v(x + 9.6, 33, fz + 1.2));
  scatter(ctx, 'palm', 12, 72, R - 6, () => false, [0.8, 1.1]);
  scatter(ctx, 'boulder', 20, 70, R - 4, () => false, [0.8, 2.2]);
  signBoard(ctx, x + 12, z + 80, 0, 'Petra', "Ma'an · Jordan");
  info.spawn.set(x, 0.2, z + 82);
  info.wander.push({ c: v(x, 0, fz + 14), r: 8 });
  info.parking.push({ pos: v(x - 16, 0.6, z + 84), yaw: 0, type: 'buggy' });
  void groundHeight;
}

// ---------------------------------------------------------------- Great Wall

export function buildGreatWall(ctx: IslandCtx) {
  const { b, c, R, info } = ctx;
  islandBase(ctx, 'grass');
  hillCap(ctx, c.x - 60, c.z + 20, 40, 18, 'grass');
  hillCap(ctx, c.x - 10, c.z - 30, 46, 26, 'grassDark');
  hillCap(ctx, c.x + 52, c.z + 6, 40, 20, 'grass');
  hillCap(ctx, c.x + 20, c.z + 62, 30, 10, 'grassDark');
  // the wall follows the ridges in a snaking line
  const ctrl = [v(-100, 0, 40), v(-72, 0, 22), v(-48, 0, 10), v(-26, 0, -18), v(-6, 0, -34), v(18, 0, -20), v(40, 0, 0), v(62, 0, 8), v(84, 0, -12), v(102, 0, -30)];
  const curve = new THREE.CatmullRomCurve3(ctrl.map((p) => p.add(c)));
  const N = 60;
  const W = 6;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= N; i++) {
    const p = curve.getPoint(i / N);
    p.y = groundHeight(info.hills, p.x, p.z) + 6;
    pts.push(p);
  }
  // smooth the walkway heights a little
  for (let k = 0; k < 2; k++) for (let i = 1; i < N; i++) pts[i].y = (pts[i - 1].y + pts[i].y * 2 + pts[i + 1].y) / 4;
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const bb = pts[i + 1];
    if (Math.hypot(a.x - c.x, a.z - c.z) > R - 4) continue;
    b.ramp(a, bb, W, 1, 'stone', 'concrete');
    const yaw = Math.atan2(bb.x - a.x, bb.z - a.z);
    const mid = a.clone().add(bb).multiplyScalar(0.5);
    const gy = Math.min(groundHeight(info.hills, a.x, a.z), groundHeight(info.hills, bb.x, bb.z));
    // wall body down to the ground
    b.boxAt(mid.x, (gy + mid.y - 1) / 2 - 1, mid.z, W - 0.4, mid.y - 1 - gy + 2, a.distanceTo(bb), yaw, 'travertine', null);
    // crenellated parapets
    for (const s of [-1, 1]) {
      const ox = Math.cos(yaw) * s * (W / 2 - 0.25);
      const oz = -Math.sin(yaw) * s * (W / 2 - 0.25);
      b.ramp(a.clone().add(v(ox, 1.0, oz)), bb.clone().add(v(ox, 1.0, oz)), 0.5, 1.0, 'stone', 'concrete');
      for (let k = 0; k < 3; k++) {
        const t = (k + 0.5) / 3;
        const p = a.clone().lerp(bb, t);
        b.boxAt(p.x + ox, p.y + 1.35, p.z + oz, 0.55, 0.7, 0.9, yaw, 'stone', null);
      }
    }
    // watchtowers every 8 segments
    if (i % 8 === 0) {
      b.boxAt(a.x, a.y - 3, a.z, 10, 6 + 6, 10, yaw, 'travertine', 'concrete');
      b.boxAt(a.x, a.y + 3, a.z, 10, 6, 10, yaw, 'travertine', null);
      b.boxAt(a.x, a.y + 2, a.z, 6.2, 4, 10.2, yaw, 'black', null);
      for (let k = 0; k < 8; k++) {
        const ang = yaw + (k / 8) * Math.PI * 2;
        b.boxAt(a.x + Math.sin(ang) * 4.6, a.y + 6.5, a.z + Math.cos(ang) * 4.6, 1.2, 1, 1.2, ang, 'stone', null);
      }
      const roof = new THREE.ConeGeometry(5.5, 3, 4);
      roof.rotateY(yaw + Math.PI / 4);
      roof.translate(a.x, a.y + 8.5, a.z);
      b.add('roof', roof);
    }
  }
  info.anchors.wall = pts.filter((_, i) => i % 6 === 3).map((p) => p.clone().setY(p.y + 0.4));
  info.anchors.wallStart = [pts[3].clone().setY(pts[3].y + 0.4)];
  // access stairs to the wall at the first tower
  const s0 = pts[8];
  b.stairs(v(s0.x, groundHeight(info.hills, s0.x + 14, s0.z + 14), s0.z + 16), v(s0.x, s0.y, s0.z + 5), 3, 'stone', 'stone');
  scatter(ctx, 'pine', 70, 8, R - 6, (x, z) => pts.some((p) => Math.hypot(p.x - x, p.z - z) < 7), [0.9, 1.6]);
  house(ctx, c.x + 30, c.z + 40, 8, 6, 4, 0.3, 'brick', 'roof');
  signBoard(ctx, c.x + 6, c.z + 74, 0.2, 'Great Wall', 'Ming dynasty · China');
  info.spawn.set(c.x, 0.2, c.z + 78);
  info.wander.push({ c: v(c.x + 10, 0, c.z + 76), r: 10 });
  info.parking.push({ pos: v(c.x - 14, 0.6, c.z + 80), yaw: 0, type: 'buggy' });
  path(ctx, [v(c.x, 0, c.z + 78), v(s0.x, 0, s0.z + 20)], 3, 'sand');
}

// ---------------------------------------------------------------- Christ the Redeemer (Rio)

export function buildRio(ctx: IslandCtx) {
  const { b, c, R, info } = ctx;
  islandBase(ctx, 'grassDark');
  // beach crescent + sugarloaf-like dome
  const beach = new THREE.RingGeometry(R - 14, R - 0.5, 48, 1, 0, Math.PI);
  beach.rotateX(-Math.PI / 2);
  beach.translate(c.x, 0.05, c.z);
  b.add('sand', beach);
  rockMass(ctx, c.x - 58, c.z + 34, 14, 7, 30, 'rock', 31, 4);
  // Corcovado: the peak with a summit plateau
  const px = c.x + 6;
  const pz = c.z - 18;
  const H = 62;
  rockMass(ctx, px, pz, 46, 10, H, 'grassDark', 33, 8);
  const sumY = H + 0.2;
  b.cyl(px, H - 0.5, pz, 10.5, 10.5, 1, 18, 'stone', 'concrete');
  // the statue (30 m): pedestal, robe, chest, outstretched arms, head
  const sy = H + 0.5;
  b.box(px - 3.4, px + 3.4, sy, sy + 7, pz - 3.4, pz + 3.4, 'soapstone');
  const robe = [[3.0, 0], [2.9, 3], [2.4, 9], [2.25, 14], [2.6, 17], [2.8, 18.5], [1.2, 19.2], [0, 19.3]] as Array<[number, number]>;
  b.lathe(px, sy + 7, pz, robe, 14, 'soapstone');
  b.box(px - 2.9, px + 2.9, sy + 21, sy + 25.5, pz - 1.6, pz + 1.6, 'soapstone', null);
  // arms span along X, statue faces +Z (towards Ink City)
  b.box(px - 14.5, px + 14.5, sy + 23.2, sy + 25.2, pz - 1.2, pz + 1.2, 'soapstone', null);
  for (const s of [-1, 1]) {
    const drape = new THREE.BoxGeometry(9, 2.2, 1.8);
    drape.rotateZ(s * 0.18);
    drape.translate(px + s * 8, sy + 22.3, pz);
    b.add('soapstone', drape);
    const hand = new THREE.IcosahedronGeometry(0.9, 0);
    hand.scale(1, 1.3, 0.8);
    hand.translate(px + s * 15.1, sy + 23.8, pz);
    b.add('soapstone', hand);
  }
  b.cyl(px, sy + 25.5, pz, 0.7, 0.8, 1, 8, 'soapstone', null);
  const head = new THREE.IcosahedronGeometry(1.6, 1);
  head.scale(1, 1.2, 1);
  head.translate(px, sy + 28, pz);
  b.add('soapstone', head);
  // summit platform colliders on the statue: arms are walkable (super-jump challenge)
  b.physics.addStaticBox(v(px, sy + 24.2, pz), v(29, 2, 2.4));
  b.physics.addStaticCylinder(v(px, sy + 3.5 + 7, pz), 3.2, 21);
  info.anchors.summit = [v(px, sumY + 0.4, pz + 6)];
  info.anchors.hands = [v(px - 13.5, sy + 25.4, pz), v(px + 13.5, sy + 25.4, pz)];
  // cable car from the beach station up to the summit plateau
  const base = v(px + 30, 0, pz + 52);
  const top = v(px + 7, sumY, pz + 8);
  b.box(base.x - 4, base.x + 4, 0, 4, base.z - 4, base.z + 4, 'white');
  b.stairs(v(base.x - 10, 0, base.z), v(base.x - 4, 4, base.z), 3, 'white');
  b.box(top.x - 3, top.x + 3, sumY - 0.4, sumY + 0.2, top.z - 3, top.z + 3, 'stone');
  const cabA = base.clone().setY(4.2);
  const cabB = top.clone().setY(sumY + 0.3);
  info.movers.push({ kind: 'cable', points: [cabA, cabB], closed: false });
  const cable = new THREE.BufferGeometry().setFromPoints([cabA.clone().setY(cabA.y + 4.6), cabB.clone().setY(cabB.y + 4.6)]);
  ctx.group.add(new THREE.Line(cable, new THREE.LineBasicMaterial({ color: '#1b1b20' })));
  for (const p of [cabA, cabB]) b.box(p.x - 0.4, p.x + 0.4, p.y, p.y + 5, p.z - 0.4, p.z + 0.4, 'dark', null);
  info.anchors.cableBase = [cabA.clone()];
  scatter(ctx, 'palm', 26, R - 24, R - 8, () => false);
  scatter(ctx, 'broadleaf', 24, 20, R - 20, (x, z) => Math.hypot(x - px, z - pz) < 44, [1, 1.6]);
  signBoard(ctx, base.x + 8, base.z + 10, 0, 'Cristo Redentor', 'Rio de Janeiro · Brazil');
  info.spawn.set(base.x + 2, 0.2, base.z + 14);
  info.wander.push({ c: v(base.x, 0, base.z + 12), r: 10 });
  info.parking.push({ pos: v(base.x + 18, 0.6, base.z + 10), yaw: 0, type: 'buggy' });
}
