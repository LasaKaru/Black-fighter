import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Builder } from './Builder';
import type { Physics } from '../physics/Physics';
import { WorldMaterials, PALETTE } from './Materials';
import { billboardTexture, dripTexture, hazardTexture, inkGroundTexture, realGroundTexture, splatTexture, wallEyeTexture, knitTexture } from './Textures';
import { makeRng, Rng } from '../core/math';
import { Destructibles } from './Destructibles';

export type EyeType = 'fire' | 'sky' | 'void' | 'iron' | 'tide' | 'watcher' | 'storm';

export interface EyeNest {
  pos: THREE.Vector3;
  type: EyeType;
}

interface Watcher {
  pupil: THREE.Object3D;
  size: number;
  base: THREE.Vector3;
  normal: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  blink: number;
}

/**
 * Builds Ink City (README §13): a white plaza with ink blots, a terrace,
 * stacked towers floating above a cloud sea, rope bridges, a wall-run gap,
 * a super-jump tower, a goo ramp and a skyline of watching towers.
 *
 * Static geometry is merged per material, so the whole city is a handful of
 * draw calls.
 */
export class City extends Builder {
  readonly group = new THREE.Group();
  readonly spawn = new THREE.Vector3(0, 0, 32);
  readonly spawnYaw = Math.PI; // facing -Z (towards the stairs)
  readonly eyeNests: EyeNest[] = [];
  readonly agentSpawns: THREE.Vector3[] = [];
  readonly checkpoints: THREE.Vector3[] = [];
  readonly destructibles: Destructibles;
  private clouds: Array<{ obj: THREE.Object3D; speed: number; base: THREE.Vector3; phase: number }> = [];
  private watchers: Watcher[] = [];
  private spinners: THREE.Object3D[] = [];
  private rng: Rng;

  constructor(scene: THREE.Scene, physics: Physics, mats: WorldMaterials, seed = 1337) {
    super(physics, mats);
    this.rng = makeRng(seed);
    this.destructibles = new Destructibles(scene, physics, this.mats);
    this.build();
    scene.add(this.group);
  }

  // --------------------------------------------------------------- helpers

  /** Decorate a tower: ink drips from the top edge, wall eyes, teal windows. */
  private decorateTower(x0: number, x1: number, y1: number, z0: number, z1: number, dark: boolean, rng: Rng, opts: { eyes?: boolean } = {}) {
    const faces: Array<{ n: THREE.Vector3; c: THREE.Vector3; w: number }> = [
      { n: new THREE.Vector3(0, 0, 1), c: new THREE.Vector3((x0 + x1) / 2, 0, z1), w: x1 - x0 },
      { n: new THREE.Vector3(0, 0, -1), c: new THREE.Vector3((x0 + x1) / 2, 0, z0), w: x1 - x0 },
      { n: new THREE.Vector3(1, 0, 0), c: new THREE.Vector3(x1, 0, (z0 + z1) / 2), w: z1 - z0 },
      { n: new THREE.Vector3(-1, 0, 0), c: new THREE.Vector3(x0, 0, (z0 + z1) / 2), w: z1 - z0 },
    ];
    for (const f of faces) {
      if (!dark && rng.chance(0.75)) {
        const dw = Math.min(f.w * 0.9, rng.range(2, 5));
        const dh = dw * 2;
        const along = new THREE.Vector3(-f.n.z, 0, f.n.x).multiplyScalar(rng.range(-f.w / 2 + dw / 2, f.w / 2 - dw / 2));
        const seed = rng.int(0, 5);
        this.decal(`drip${seed}`, dripTexture(seed), '#ffffff', dw, dh, f.c.clone().add(along).setY(y1 - dh / 2 + 0.01), f.n);
      }
      if (opts.eyes !== false && rng.chance(0.35)) {
        const s = rng.range(1.2, 2.6);
        const iris = rng.pick(['#111114', PALETTE.voidPurple, PALETTE.routeTeal, PALETTE.eyeFire]);
        const along = new THREE.Vector3(-f.n.z, 0, f.n.x).multiplyScalar(rng.range(-f.w / 4, f.w / 4));
        const y = y1 - rng.range(2.5, 6);
        if (y > -20) this.decal(`eye${iris}`, wallEyeTexture(iris, iris === PALETTE.eyeFire), '#ffffff', s * 1.2, s * 1.2, f.c.clone().add(along).setY(y), f.n, 0, iris === PALETTE.eyeFire);
      }
      if (dark && rng.chance(0.5)) {
        // teal window panel
        const ww = Math.min(f.w * 0.5, 2.2);
        const along = new THREE.Vector3(-f.n.z, 0, f.n.x).multiplyScalar(rng.range(-f.w / 4, f.w / 4));
        const c = f.c.clone().add(along).setY(y1 - rng.range(2, 8)).add(f.n.clone().multiplyScalar(0.05));
        const g = new THREE.BoxGeometry(Math.abs(f.n.x) > 0.5 ? 0.1 : ww, ww * 0.9, Math.abs(f.n.z) > 0.5 ? 0.1 : ww);
        g.translate(c.x, c.y, c.z);
        this.add('glass', g);
      }
    }
  }

  /** Tower rising from the cloud sea. */
  private tower(x0: number, x1: number, z0: number, z1: number, top: number, dark: boolean, rng: Rng, collide = true) {
    this.box(x0, x1, -40, top, z0, z1, dark ? 'black' : 'white', collide ? (dark ? 'ink' : 'concrete') : null);
    // cap trim
    if (rng.chance(0.6)) this.box(x0 - 0.15, x1 + 0.15, top - 0.3, top + 0.05, z0 - 0.15, z1 + 0.15, dark ? 'dark' : 'grey', null);
    this.decorateTower(x0, x1, top, z0, z1, dark, rng);
  }

  /** Watching wall eye whose pupil follows the player. */
  private watcherEye(pos: THREE.Vector3, normal: THREE.Vector3, size: number, iris: string) {
    const g = new THREE.Group();
    const sclera = new THREE.Mesh(new THREE.CircleGeometry(size, 24), new THREE.MeshStandardMaterial({ color: '#f6f5f2', roughness: 0.6 }));
    sclera.scale.y = 0.7;
    const rim = new THREE.Mesh(new THREE.RingGeometry(size * 0.98, size * 1.1, 24), new THREE.MeshBasicMaterial({ color: '#111114' }));
    rim.scale.y = 0.7;
    const pupil = new THREE.Group();
    const irisM = new THREE.Mesh(new THREE.CircleGeometry(size * 0.42, 20), new THREE.MeshStandardMaterial({ color: iris, emissive: iris, emissiveIntensity: iris === PALETTE.eyeFire ? 1.6 : 0.3 }));
    const pup = new THREE.Mesh(new THREE.CircleGeometry(size * 0.2, 16), new THREE.MeshBasicMaterial({ color: '#0b0b0d' }));
    pup.position.z = 0.01;
    irisM.position.z = 0.005;
    pupil.add(irisM, pup);
    g.add(sclera, rim, pupil);
    g.position.copy(pos).add(normal.clone().multiplyScalar(0.03));
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.group.add(g);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
    this.watchers.push({ pupil, size, base: g.position.clone(), normal: normal.clone(), right, up, blink: 2 + Math.random() * 6 });
  }

  private mushroom(x: number, z: number, scale: number, y = 0) {
    const pts: THREE.Vector2[] = [];
    const s = scale;
    pts.push(new THREE.Vector2(0, 0));
    pts.push(new THREE.Vector2(0.55 * s, 0));
    pts.push(new THREE.Vector2(0.45 * s, 0.4 * s));
    pts.push(new THREE.Vector2(0.35 * s, 1.6 * s));
    pts.push(new THREE.Vector2(0.4 * s, 2.1 * s));
    pts.push(new THREE.Vector2(1.4 * s, 2.2 * s));
    pts.push(new THREE.Vector2(1.5 * s, 2.5 * s));
    pts.push(new THREE.Vector2(1.2 * s, 2.95 * s));
    pts.push(new THREE.Vector2(0.6 * s, 3.2 * s));
    pts.push(new THREE.Vector2(0, 3.3 * s));
    const g = new THREE.LatheGeometry(pts, 9);
    g.translate(x, y, z);
    this.add('statue', g);
    this.physics.addStaticCylinder(new THREE.Vector3(x, y + 1.05 * s, z), 0.45 * s, 2.1 * s);
    this.physics.addStaticCylinder(new THREE.Vector3(x, y + 2.7 * s, z), 1.45 * s, 1.1 * s);
    // ink drips on the cap
    const n = new THREE.Vector3(0, 0, 1);
    this.decal('drip1', dripTexture(1), '#ffffff', 1.2 * s, 1.4 * s, new THREE.Vector3(x, y + 2.55 * s, z + 1.52 * s), n);
  }

  /** Giant bust statue: a faceted head wearing a beanie (reference background). */
  private bust(pos: THREE.Vector3, scale: number, rotY: number, collide: boolean) {
    const head = new THREE.IcosahedronGeometry(1 * scale, 1);
    head.scale(1.05, 0.95, 1);
    head.translate(0, 1.6 * scale, 0);
    const neck = new THREE.CylinderGeometry(0.35 * scale, 0.5 * scale, 0.8 * scale, 7);
    neck.translate(0, 0.45 * scale, 0);
    const shoulders = new THREE.CylinderGeometry(0.9 * scale, 1.3 * scale, 0.7 * scale, 8);
    shoulders.translate(0, 0.0, 0);
    const parts = [head, neck, shoulders].map((g) => {
      g.rotateY(rotY);
      g.translate(pos.x, pos.y, pos.z);
      return g;
    });
    for (const p of parts) this.add('statue', p);
    const hat = new THREE.SphereGeometry(1.08 * scale, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
    hat.scale(1.05, 1.0, 1.04);
    hat.translate(pos.x, pos.y + 1.75 * scale, pos.z);
    const hatMesh = new THREE.Mesh(hat, new THREE.MeshStandardMaterial({ color: '#1a1a1e', roughness: 1, map: knitTexture('#1a1a1e') }));
    hatMesh.castShadow = true;
    this.group.add(hatMesh);
    if (collide) {
      this.physics.addStaticBall(new THREE.Vector3(pos.x, pos.y + 1.6 * scale, pos.z), 1.0 * scale);
      this.physics.addStaticCylinder(new THREE.Vector3(pos.x, pos.y + 0.2 * scale, pos.z), 1.1 * scale, 1.2 * scale);
    }
  }

  private cloud(pos: THREE.Vector3, scale: number, speed: number) {
    const rng = this.rng;
    const parts: THREE.BufferGeometry[] = [];
    const n = rng.int(3, 6);
    for (let i = 0; i < n; i++) {
      const g = new THREE.IcosahedronGeometry(rng.range(0.7, 1.2) * scale, 1);
      g.translate(rng.range(-1.4, 1.4) * scale, rng.range(-0.2, 0.5) * scale, rng.range(-0.6, 0.6) * scale);
      parts.push(g);
    }
    const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
    const mesh = new THREE.Mesh(merged, this.cloudMat);
    mesh.position.copy(pos);
    mesh.castShadow = scale > 2;
    mesh.userData.noMap = true;
    this.group.add(mesh);
    this.clouds.push({ obj: mesh, speed, base: pos.clone(), phase: rng.range(0, 10) });
  }

  private cloudMat = new THREE.MeshStandardMaterial({ color: '#f4f4f6', roughness: 1, flatShading: true });

  private billboard(pos: THREE.Vector3, w: number, h: number, rotY: number, kind: number) {
    const mat = new THREE.MeshStandardMaterial({ map: billboardTexture(kind), emissive: '#ffffff', emissiveMap: billboardTexture(kind), emissiveIntensity: 0.55, roughness: 0.5 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.copy(pos);
    m.rotation.y = rotY;
    this.group.add(m);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.25), this.mats.dark);
    back.position.copy(pos).add(new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).multiplyScalar(-0.15));
    back.rotation.y = rotY;
    back.castShadow = true;
    this.group.add(back);
  }

  private hazardBeam(a: THREE.Vector3, b: THREE.Vector3, thickness = 0.5) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const tex = hazardTexture().clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(len / 2, 1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, thickness, thickness), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
    m.castShadow = true;
    this.group.add(m);
  }

  private lamp(x: number, y: number, z: number) {
    this.box(x - 0.08, x + 0.08, y, y + 3.2, z - 0.08, z + 0.08, 'dark', null);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), this.mats.lamp);
    bulb.position.set(x, y + 3.3, z);
    this.group.add(bulb);
  }

  private crystals(x: number, y: number, z: number, rng: Rng) {
    for (let i = 0; i < rng.int(2, 4); i++) {
      const h = rng.range(0.4, 1.1);
      const g = new THREE.ConeGeometry(rng.range(0.12, 0.25), h, 4);
      g.rotateZ(rng.range(-0.4, 0.4));
      g.rotateX(rng.range(-0.4, 0.4));
      g.translate(x + rng.range(-0.5, 0.5), y + h / 2 - 0.05, z + rng.range(-0.5, 0.5));
      this.add('teal', g);
    }
  }

  private eyeNest(pos: THREE.Vector3, type: EyeType) {
    this.box(pos.x - 0.6, pos.x + 0.6, pos.y, pos.y + 0.35, pos.z - 0.6, pos.z + 0.6, 'dark', 'concrete');
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 24), type === 'fire' ? this.mats.lamp : type === 'sky' ? this.mats.white : this.mats.purple);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(pos.x, pos.y + 0.37, pos.z);
    this.group.add(ring);
    this.spinners.push(ring);
    this.eyeNests.push({ pos: new THREE.Vector3(pos.x, pos.y + 1.6, pos.z), type });
  }

  // ---------------------------------------------------------------- build

  private build() {
    const rng = this.rng;

    // ---------- plaza ground (own mesh for the ink-blot texture)
    const groundGeo = new THREE.BoxGeometry(90, 1, 85);
    const groundMat = new THREE.MeshStandardMaterial({ map: inkGroundTexture(), roughness: 0.85 });
    // the realistic art style swaps the inked plaza for paving slabs
    groundMat.userData.swapMap = { ink: groundMat.map, real: realGroundTexture() };
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -0.5, 2.5);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.physics.addStaticBox(new THREE.Vector3(0, -0.5, 2.5), new THREE.Vector3(90, 1, 85), 'concrete');
    // foundation under the plaza (floating island look)
    this.box(-44, 44, -38, -1, -38, 43, 'dark', null);

    // ---------- plaza perimeter low walls with drips
    // perimeter walls with gaps where the bridges to the islands leave the plaza
    this.box(-45, -44, 0, 1.2, -40, -7, 'white');
    this.box(-45, -44, 0, 1.2, 7, 45, 'white');
    this.box(44, 45, 0, 1.2, -8, 3, 'white');
    this.box(44, 45, 0, 1.2, 17, 45, 'white');
    this.box(-45, -6, 0, 1.2, 44, 45, 'white');
    this.box(6, 45, 0, 1.2, 44, 45, 'white');
    // gate pillars with eye lamps at each exit
    for (const [x, z] of [[-44.5, -7.5], [-44.5, 7.5], [44.5, 2.5], [44.5, 17.5], [-6.5, 44.5], [6.5, 44.5]] as const) {
      this.box(x - 0.6, x + 0.6, 0, 4, z - 0.6, z + 0.6, 'black', 'ink');
      this.lamp(x, 4, z);
    }

    // ---------- grand stairs north up to the terrace
    this.stairs(new THREE.Vector3(0, 0, -16), new THREE.Vector3(0, 4, -28), 10);
    // ---------- terrace
    this.box(-16, 16, 0, 4, -40, -28, 'white');
    this.box(-16, 16, 3.95, 4.05, -40, -39.6, 'dark', null);
    this.decal('drip2', dripTexture(2), '#ffffff', 6, 4, new THREE.Vector3(-11, 2, -28), new THREE.Vector3(0, 0, 1));
    this.decal('drip3', dripTexture(3), '#ffffff', 6, 4, new THREE.Vector3(11, 2, -28), new THREE.Vector3(0, 0, 1));
    this.watcherEye(new THREE.Vector3(-11, 2.2, -27.95), new THREE.Vector3(0, 0, 1), 0.9, PALETTE.eyeFire);
    this.destructibles.add(new THREE.Vector3(-5, 4, -36.5), new THREE.Vector3(10, 3.5, 1));
    this.lamp(-14, 4, -30);
    this.lamp(14, 4, -30);
    this.agentSpawns.push(new THREE.Vector3(-10, 4, -34), new THREE.Vector3(10, 4, -35));
    this.eyeNest(new THREE.Vector3(12, 4, -38), 'fire');
    this.checkpoints.push(new THREE.Vector3(0, 4, -31));

    // ---------- the stacks (towers above the cloud sea)
    this.tower(-12, -4, -50, -44, 6, false, rng); // A
    this.tower(2, 10, -52, -44, 6, true, rng); // B
    // wall-run wall west of the A→C gap
    this.box(-13.5, -12.5, -40, 14, -61, -49, 'black', 'ink');
    this.decal('drip4', dripTexture(4), '#ffffff', 1, 4, new THREE.Vector3(-12.5, 12, -55), new THREE.Vector3(1, 0, 0));
    this.watcherEye(new THREE.Vector3(-12.48, 9, -55), new THREE.Vector3(1, 0, 0), 1.3, PALETTE.voidPurple);
    // teal route paint on the wall-run wall
    this.box(-12.52, -12.48, 6.6, 7.0, -58, -51, 'teal', null);
    this.tower(-12, -4, -66, -58, 6, false, rng); // C
    this.ropeBridge(new THREE.Vector3(-4, 6, -62), new THREE.Vector3(8, 6, -62), 2);
    this.tower(8, 16, -68, -56, 6, true, rng); // D
    this.eyeNest(new THREE.Vector3(12, 6, -64), 'sky');
    this.checkpoints.push(new THREE.Vector3(12, 6, -60));
    this.agentSpawns.push(new THREE.Vector3(10, 6, -60));
    // stepping blocks up to E
    this.tower(17, 19, -56, -54, 8, false, rng);
    this.tower(20, 22, -55, -53, 10, true, rng);
    this.tower(23, 25, -56, -54, 12, false, rng);
    this.tower(25, 27, -59, -57, 14, true, rng);
    // E: the high tower
    this.tower(18, 26, -70, -60, 16, false, rng);
    this.eyeNest(new THREE.Vector3(22, 16, -66), 'void');
    this.checkpoints.push(new THREE.Vector3(22, 16, -63));
    this.billboard(new THREE.Vector3(22, 20.5, -69.5), 7, 3.5, 0, 1);
    this.box(21.8, 22.2, 16, 18.7, -69.8, -69.4, 'dark', null);
    this.hazardBeam(new THREE.Vector3(-4, 9, -46), new THREE.Vector3(2, 9, -46));
    this.hazardBeam(new THREE.Vector3(16, 12, -58), new THREE.Vector3(18, 14, -60), 0.35);

    // ---------- goo ramp from E back to the east terrace
    this.ramp(new THREE.Vector3(29, 16, -61), new THREE.Vector3(29, 4, -24), 6, 0.6, 'black', 'goo');
    this.ramp(new THREE.Vector3(29, 16.06, -61), new THREE.Vector3(29, 4.06, -24), 4, 0.05, 'goo', 'goo');
    for (let z = -56; z <= -28; z += 7) {
      const t = (z + 61) / 37;
      const y = 16 - 12 * t;
      this.box(28.4, 29.6, -40, y - 0.6, z - 0.6, z + 0.6, 'dark', null);
    }
    this.box(26, 32, 15.4, 16, -62, -60, 'black', 'concrete');
    // east terrace + stairs down
    this.box(24, 40, 0, 4, -24, -8, 'black', 'ink');
    this.decal('drip5', dripTexture(5), '#ffffff', 8, 3.5, new THREE.Vector3(36, 2.3, -8), new THREE.Vector3(0, 0, 1));
    this.stairs(new THREE.Vector3(24, 4, -15), new THREE.Vector3(12, 0, -15), 6);
    this.eyeNest(new THREE.Vector3(36, 4, -20), 'fire');
    this.checkpoints.push(new THREE.Vector3(32, 4, -14));
    this.agentSpawns.push(new THREE.Vector3(30, 4, -12));
    this.crystals(26, 4, -10, rng);
    this.crystals(38, 4, -22, rng);
    this.lamp(39, 4, -9);

    // ---------- plaza obstacle course & props
    this.box(-8, -6, 0, 1, 10, 12, 'white'); // vault
    this.box(-3, -1, 0, 1, 8, 10, 'grey');
    this.box(3, 6, 0, 2.2, 6, 9, 'black', 'ink'); // mantle
    this.box(6, 9, 0, 4.2, 6, 9, 'white'); // two-step climb
    this.decorateTower(6, 9, 4.2, 6, 9, false, rng, { eyes: false });
    this.box(-34, -24, 0, 5, -20, -18, 'black', 'ink'); // climb wall
    this.box(-34, -24, 5, 5.2, -22, -18, 'grey');
    this.box(-34, -24, 0, 5, -22, -20, 'black', 'ink');
    this.box(-34.02, -24, 2, 2.4, -18.02, -17.98, 'teal', null);
    this.watcherEye(new THREE.Vector3(-29, 3.2, -17.97), new THREE.Vector3(0, 0, 1), 1.0, PALETTE.routeTeal);
    // destructible tutorial wall with a Fire Eye behind it
    this.destructibles.add(new THREE.Vector3(-18, 0, 4.5), new THREE.Vector3(8, 3.5, 1));
    this.eyeNest(new THREE.Vector3(-18, 0, 0), 'fire');
    this.eyeNest(new THREE.Vector3(18, 0, -4), 'sky');
    // goo pool
    this.box(-36, -26, -0.02, 0.06, 4, 26, 'goo', 'goo');
    this.box(-36.5, -25.5, 0, 0.3, 3.5, 4, 'dark', 'concrete');
    this.box(-36.5, -25.5, 0, 0.3, 26, 26.5, 'dark', 'concrete');
    // goo kicker ramp
    this.ramp(new THREE.Vector3(-31, 0, 14), new THREE.Vector3(-31, 1.6, 20), 4, 0.4, 'goo', 'goo');
    // mushrooms & busts
    this.mushroom(-20, -12, 1.2);
    this.mushroom(-14, 26, 0.9);
    this.mushroom(25, 24, 1.4);
    this.mushroom(-36, 36, 1.0);
    this.mushroom(-12, -36, 0.7, 4);
    this.bust(new THREE.Vector3(22, 0.6, 10), 2.2, -0.6, true);
    this.box(19.5, 24.5, 0, 0.6, 7.5, 12.5, 'dark');
    // lamps around
    for (const [x, z] of [[-10, 18], [10, 18], [-22, -8], [22, -2], [-40, 0], [40, 20]] as const) this.lamp(x, 0, z);
    for (let i = 0; i < 8; i++) this.crystals(rng.range(-40, 40), 0, rng.range(-25, 40), rng);
    // ink puddles (decals on the ground)
    for (let i = 0; i < 14; i++) {
      const s = rng.range(2, 6);
      this.decal(`splat${i % 4}`, splatTexture(i % 4), '#111114', s, s * rng.range(0.6, 1), new THREE.Vector3(rng.range(-40, 40), 0.005, rng.range(-30, 42)), new THREE.Vector3(0, 1, 0), rng.range(0, 6));
    }
    for (let i = 0; i < 6; i++) {
      const s = rng.range(1.5, 3.5);
      this.decal(`splat${i % 4}`, splatTexture(i % 4), i % 2 ? PALETTE.routeTeal : PALETTE.voidPurple, s, s, new THREE.Vector3(rng.range(-40, 40), 0.01, rng.range(-30, 42)), new THREE.Vector3(0, 1, 0), rng.range(0, 6));
    }
    // billboards on the plaza edge
    this.billboard(new THREE.Vector3(-30, 7, 44), 10, 5, Math.PI, 0);
    this.box(-30.3, -29.7, 0, 4.5, 43.6, 44.2, 'dark', 'concrete');
    this.billboard(new THREE.Vector3(43.8, 6, 30), 9, 4.5, -Math.PI / 2, 2);
    this.box(43.6, 44.2, 0, 3.8, 29.7, 30.3, 'dark', 'concrete');
    // west buildings bordering the plaza
    this.box(-58, -46, -40, 9, -30, -14, 'white', 'concrete');
    this.decorateTower(-58, -46, 9, -30, -14, false, rng);
    this.box(-56, -46, -40, 13, 10, 24, 'black', 'ink');
    this.decorateTower(-56, -46, 13, 10, 24, true, rng);
    this.box(-58, -47, -40, 6, 28, 44, 'white', 'concrete');
    this.decorateTower(-58, -47, 6, 28, 44, false, rng);

    // ---------- agent spawns & checkpoints on the plaza
    this.agentSpawns.push(new THREE.Vector3(-30, 0, -10), new THREE.Vector3(30, 0, 30), new THREE.Vector3(-35, 0, 32), new THREE.Vector3(8, 0, -8), new THREE.Vector3(-20, 0, 15));
    this.checkpoints.unshift(this.spawn.clone());

    // ---------- skyline (no collision, out of reach)
    for (let i = 0; i < 140; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(80, 190);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r - 20;
      const w = rng.range(5, 14);
      const d = rng.range(5, 14);
      const h = rng.range(5, 70) * (r > 140 ? 1.3 : 1);
      const dark = rng.chance(0.55);
      // keep the three bridge corridors (east z=10, south x=0, west z=0) clear
      if ((x > 0 && Math.abs(z - 10) < 16) || (z > 0 && Math.abs(x) < 16) || (x < 0 && Math.abs(z) < 16)) continue;
      this.box(x - w / 2, x + w / 2, -40, h, z - d / 2, z + d / 2, dark ? 'black' : 'white', null);
      this.decorateTower(x - w / 2, x + w / 2, h, z - d / 2, z + d / 2, dark, rng);
      if (rng.chance(0.3)) this.box(x - w / 2 - 0.5, x + w / 2 + 0.5, h, h + rng.range(1, 4), z - d / 2 - 0.5, z + d / 2 + 0.5, dark ? 'white' : 'dark', null);
      if (rng.chance(0.12)) this.lamp(x, h, z);
    }
    // giant statues in the distance
    this.bust(new THREE.Vector3(-70, 30, -150), 14, 0.4, false);
    this.bust(new THREE.Vector3(110, 18, -60), 10, -1.2, false);
    this.bust(new THREE.Vector3(30, 40, -190), 18, 0.1, false);
    // watching eyes on skyline faces facing the plaza
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + rng.range(-1.2, 1.2);
      const r = rng.range(70, 90);
      const p = new THREE.Vector3(Math.cos(a) * r, rng.range(10, 30), Math.sin(a) * r - 20);
      const n = p.clone().setY(0).multiplyScalar(-1).normalize();
      this.box(p.x - 3, p.x + 3, -40, p.y + 6, p.z - 3, p.z + 3, 'black', null);
      this.watcherEye(p.clone().add(n.clone().multiplyScalar(3.05)), n, 2.4, rng.pick([PALETTE.eyeFire, PALETTE.voidPurple, PALETTE.routeTeal]));
    }
    // floating rocks
    for (let i = 0; i < 26; i++) {
      const g = new THREE.DodecahedronGeometry(rng.range(0.8, 3.5), 0);
      // keep them out of the playable area
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(65, 150);
      g.translate(Math.cos(a) * r, rng.range(-15, 40), Math.sin(a) * r - 20);
      this.add('floatRock', g);
    }
    // clouds
    for (let i = 0; i < 34; i++) {
      this.cloud(new THREE.Vector3(rng.range(-140, 140), rng.range(22, 60), rng.range(-180, 90)), rng.range(1.5, 4.5), rng.range(0.3, 1.2));
    }
    // cables between towers
    const cableMat = new THREE.LineBasicMaterial({ color: '#1b1b20' });
    const cablePts: THREE.Vector3[] = [];
    // sagging power cables strung between distant towers
    for (let i = 0; i < 16; i++) {
      const a = new THREE.Vector3(rng.range(-120, 120), rng.range(18, 50), rng.range(-200, -95));
      const b = a.clone().add(new THREE.Vector3(rng.range(-35, 35), rng.range(-6, 6), rng.range(-15, 15)));
      const sag = a.distanceTo(b) * 0.08;
      let prev = a;
      for (let k = 1; k <= 8; k++) {
        const t = k / 8;
        const p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * sag;
        cablePts.push(prev, p);
        prev = p;
      }
    }
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cablePts), cableMat));

    this.finalize(this.group);
  }

  update(dt: number, time: number, focus: THREE.Vector3) {
    for (const c of this.clouds) {
      c.obj.position.x = c.base.x + Math.sin(time * 0.02 * c.speed + c.phase) * 12;
      c.obj.position.y = c.base.y + Math.sin(time * 0.3 + c.phase) * 0.6;
    }
    for (const s of this.spinners) s.rotation.z += dt * 1.5;
    // watcher eyes follow the focus point
    for (const w of this.watchers) {
      const to = focus.clone().sub(w.base).normalize();
      const x = THREE.MathUtils.clamp(to.dot(w.right), -0.6, 0.6);
      const y = THREE.MathUtils.clamp(to.dot(w.up), -0.6, 0.6);
      w.pupil.position.set(x * w.size * 0.9, y * w.size * 0.5, 0.004);
      w.blink -= dt;
      w.pupil.parent!.scale.y = w.blink < 0.12 && w.blink > 0 ? 0.08 : 1;
      if (w.blink <= 0) w.blink = 2.5 + Math.random() * 6;
    }
    this.destructibles.update(dt);
  }
}
