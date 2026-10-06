import * as THREE from 'three';
import type { IslandCtx } from './types';
import { v } from './types';
import { islandBase, lampPost, signBoard } from './base';
import { checkerTexture, wallEyeTexture } from '../Textures';
import { PALETTE } from '../Materials';

/** Ink Docks Speedway: a stadium circuit with curbs, pits, grandstands and stunt ramps. */
export function buildSpeedway(ctx: IslandCtx) {
  const { b, c, info } = ctx;
  islandBase(ctx, 'grassDark');
  const straight = 100;
  const rad = 34;
  const W = 14;
  const N = 64;
  const pts: THREE.Vector3[] = [];
  // stadium loop: two straights joined by semicircles (counter-clockwise)
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const perim = 2 * straight + 2 * Math.PI * rad;
    let d = t * perim;
    let p: THREE.Vector3;
    if (d < straight) p = v(-straight / 2 + d, 0, rad);
    else if ((d -= straight) < Math.PI * rad) {
      const a = Math.PI / 2 - d / rad;
      p = v(straight / 2 + Math.cos(a) * rad, 0, Math.sin(a) * rad);
    } else if ((d -= Math.PI * rad) < straight) p = v(straight / 2 - d, 0, -rad);
    else {
      d -= straight;
      const a = -Math.PI / 2 - d / rad;
      p = v(-straight / 2 + Math.cos(a) * rad, 0, Math.sin(a) * rad);
    }
    pts.push(p.add(c));
  }
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const bb = pts[(i + 1) % N];
    const len = a.distanceTo(bb);
    const yaw = Math.atan2(bb.x - a.x, bb.z - a.z);
    const mx = (a.x + bb.x) / 2;
    const mz = (a.z + bb.z) / 2;
    b.boxAt(mx, 0.05, mz, W, 0.12, len + 0.6, yaw, 'asphalt', null);
    // red/white curbs
    for (const s of [-1, 1]) {
      const ox = Math.cos(yaw) * s * (W / 2 + 0.6);
      const oz = -Math.sin(yaw) * s * (W / 2 + 0.6);
      b.boxAt(mx + ox, 0.12, mz + oz, 1.2, 0.2, len + 0.1, yaw, i % 2 ? 'trainRed' : 'white', null);
    }
    if (i % 2 === 0) b.boxAt(mx, 0.12, mz, 0.25, 0.02, len * 0.5, yaw, 'line', null);
  }
  info.anchors.track = pts.filter((_, i) => i % 4 === 0).map((p) => p.clone().setY(1.5));
  // start/finish gantry with checker
  const sf = pts[4];
  const chk = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.6), new THREE.MeshStandardMaterial({ map: checkerTexture(), side: THREE.DoubleSide }));
  chk.rotation.x = -Math.PI / 2;
  chk.position.set(sf.x, 0.14, sf.z);
  chk.rotation.z = Math.PI / 2;
  ctx.group.add(chk);
  for (const s of [-1, 1]) b.box(sf.x - 0.4, sf.x + 0.4, 0, 8, sf.z + s * (W / 2 + 2) - 0.4, sf.z + s * (W / 2 + 2) + 0.4, 'dark', 'concrete');
  b.box(sf.x - 0.6, sf.x + 0.6, 8, 9.5, sf.z - W / 2 - 2.4, sf.z + W / 2 + 2.4, 'black', null);
  // grandstands (stepped) along the main straight
  for (let k = 0; k < 6; k++) b.box(c.x - 50, c.x + 50, 0, 1 + k * 1.2, c.z + rad + 12 + k * 1.8, c.z + rad + 13.8 + k * 1.8, k % 2 ? 'white' : 'grey');
  b.box(c.x - 50, c.x + 50, 9, 9.4, c.z + rad + 10, c.z + rad + 24, 'black', null);
  // pit garages
  for (let k = 0; k < 6; k++) {
    const x = c.x - 40 + k * 14;
    b.box(x - 6, x + 6, 0, 6, c.z - rad - 22, c.z - rad - 12, 'white');
    b.box(x - 4.5, x + 4.5, 0.2, 4.8, c.z - rad - 12.05, c.z - rad - 11.95, 'black', null);
    info.parking.push({ pos: v(x, 0.6, c.z - rad - 8), yaw: Math.PI / 2, type: ['blotter', 'inkbox', 'buggy', 'tuktuk', 'blotter', 'inkbox'][k] });
  }
  // stunt ramps in the infield
  b.ramp(v(c.x - 20, 0, c.z), v(c.x - 4, 3.5, c.z), 8, 0.6, 'white', 'concrete');
  b.ramp(v(c.x + 4, 3.5, c.z + 6), v(c.x + 20, 0, c.z + 6), 8, 0.6, 'dark', 'concrete');
  // billboards with eyes
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), new THREE.MeshStandardMaterial({ map: wallEyeTexture(PALETTE.eyeFire, true), transparent: true, emissive: '#ff7a1a', emissiveIntensity: 0.3 }));
    m.position.set(c.x + s * (straight / 2 + rad + 8), 8, c.z);
    m.rotation.y = -s * Math.PI / 2;
    ctx.group.add(m);
  }
  for (let i = 0; i < 12; i++) lampPost(ctx, c.x - 60 + i * 11, 0, c.z + rad + 9, 7);
  signBoard(ctx, c.x + 60, c.z + rad + 30, 0, 'Ink Docks', 'Speedway · Garage');
  info.spawn.set(c.x + 50, 0.2, c.z + rad + 34);
  info.wander.push({ c: v(c.x, 0, c.z + rad + 30), r: 20 });
}

/** Agent HQ: the black fortress where the faceless Agents keep the city "on model". */
export function buildAgentHQ(ctx: IslandCtx) {
  const { b, c, info } = ctx;
  islandBase(ctx, 'dark', 'black');
  // purple goo moat
  const moat = new THREE.RingGeometry(36, 44, 48);
  moat.rotateX(-Math.PI / 2);
  moat.translate(c.x, 0.08, c.z);
  b.add('goo', moat);
  b.physics.addStaticBox(v(c.x, 0.05, c.z), v(1, 0.1, 1), 'goo');
  // arena platform
  b.cyl(c.x, 0, c.z, 30, 31, 1.2, 40, 'black', 'concrete');
  const ring = new THREE.TorusGeometry(30.2, 0.25, 4, 64);
  ring.rotateX(Math.PI / 2);
  ring.translate(c.x, 1.25, c.z);
  b.add('neonPurple', ring);
  // the monolith with the watching eye
  b.box(c.x - 8, c.x + 8, 0, 64, c.z - 72, c.z - 56, 'black', 'ink');
  const eye = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: wallEyeTexture(PALETTE.voidPurple, true), transparent: true, emissive: '#6b2bff', emissiveIntensity: 0.8, emissiveMap: wallEyeTexture(PALETTE.voidPurple, true) }));
  eye.position.set(c.x, 46, c.z - 55.9);
  ctx.group.add(eye);
  for (let y = 4; y < 62; y += 6) b.box(c.x - 8.05, c.x + 8.05, y, y + 0.3, c.z - 72.05, c.z - 55.95, 'neonPurple', null);
  // fortress walls & guard towers
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const x = c.x + Math.cos(a) * 62;
    const z = c.z + Math.sin(a) * 62;
    if (Math.sin(a) > 0.85) continue; // open gate towards the bridge side
    b.boxAt(x, 6, z, 6, 12, 6, -a, 'black', 'ink');
    b.boxAt(x, 12.4, z, 7, 0.8, 7, -a, 'neonPurple', null);
    const nx = c.x + Math.cos(a + Math.PI / 10) * 62;
    const nz = c.z + Math.sin(a + Math.PI / 10) * 62;
    b.boxAt(nx, 4, nz, 3, 8, 34, -a - Math.PI / 10 + Math.PI / 2, 'dark', 'ink');
  }
  // bridges over the moat
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    b.boxAt(c.x + Math.cos(a) * 40, 0.5, c.z + Math.sin(a) * 40, 6, 1, 12, -a + Math.PI / 2, 'dark', 'concrete');
  }
  info.anchors.arena = [v(c.x, 1.4, c.z)];
  info.anchors.arenaSpawns = [0, 1, 2, 3, 4, 5].map((k) => v(c.x + Math.cos(k * 1.05) * 22, 1.4, c.z + Math.sin(k * 1.05) * 22));
  info.anchors.statue = [v(c.x, 0, c.z - 82)];
  signBoard(ctx, c.x + 12, c.z + 52, 0, 'Agent HQ', 'Stay on model');
  info.spawn.set(c.x, 0.2, c.z + 54);
  info.parking.push({ pos: v(c.x - 14, 0.6, c.z + 56), yaw: 0, type: 'blotter' });
}
