import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Appearance } from './Appearance';
import { backPrintTexture, chestTextTexture, Expression, faceTexture, knitTexture, patchTexture, sparkleTexture } from '../world/Textures';

/**
 * Procedural "faceted toy / plush" character (README §7).
 *
 * The body is authored from many primitive parts (head, beanie, lapels,
 * fingers, laces…) that are merged at build time into a handful of
 * vertex-coloured SkinnedMeshes driven by a bone hierarchy. A full character
 * is ~4 skinned draw calls plus a few decals (face, prints, patches), so
 * crowds of NPCs and multiplayer rooms stay cheap.
 *
 * Coordinate frame: root at the feet, character faces +Z.
 */

export type JointName =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'shL' | 'armL' | 'elbowL' | 'handL'
  | 'shR' | 'armR' | 'elbowR' | 'handR'
  | 'thighL' | 'kneeL' | 'footL'
  | 'thighR' | 'kneeR' | 'footR';

export const JOINTS: JointName[] = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shL', 'armL', 'elbowL', 'handL', 'shR', 'armR', 'elbowR', 'handR',
  'thighL', 'kneeL', 'footL', 'thighR', 'kneeR', 'footR',
];

const HEAD_JOINTS = new Set<JointName>(['head']);

export const RIG = {
  hipsY: 0.7,
  thigh: 0.3,
  shin: 0.29,
  ankle: 0.1,
  spine: 0.07,
  chest: 0.18,
  neck: 0.2,
  headBase: 0.07,
  headCenter: 0.25,
  headRadius: 0.3,
  shoulderX: 0.25,
  upperArm: 0.23,
  forearm: 0.21,
};

/** Layer used for meshes hidden from the first-person camera (head, hat, face). */
export const LAYER_FP_HIDDEN = 1;

interface Part {
  geo: THREE.BufferGeometry;
  joint: JointName;
  color: THREE.Color;
  flat: boolean;
}

// Shared materials: colours live in vertex attributes so every character shares 2 programs.
let SHARED: { smooth: THREE.MeshStandardMaterial; flat: THREE.MeshStandardMaterial } | null = null;
function sharedMaterials() {
  if (!SHARED) {
    SHARED = {
      smooth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }),
      flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0, flatShading: true }),
    };
  }
  return SHARED;
}
const decalMatCache = new Map<string, THREE.MeshStandardMaterial>();
function decalMaterial(key: string, tex: THREE.Texture, color = '#ffffff'): THREE.MeshStandardMaterial {
  let m = decalMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ map: tex, color, transparent: true, alphaTest: 0.08, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
    decalMatCache.set(key, m);
  }
  return m;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export interface RigOptions {
  agent?: boolean;
  /** Build as a single-colour stone statue (no decals). */
  statue?: string;
}

export class CharacterRig {
  readonly root = new THREE.Group();
  /** Rotated by yaw; separate from root so the animator can lean/offset the body. */
  readonly body = new THREE.Group();
  readonly joints = {} as Record<JointName, THREE.Bone>;
  /** Rest local positions (the animator offsets hips from this). */
  readonly rest = {} as Record<JointName, THREE.Vector3>;
  private parts: Part[] = [];
  private faceMesh: THREE.Mesh | null = null;
  private faceMat: THREE.MeshBasicMaterial | null = null;
  private decals: THREE.Object3D[] = [];
  private expression: Expression = 'neutral';
  private blinkTimer = 2;
  private blinkHold = 0;
  private exprHold = 0;
  private holdExpr: Expression | null = null;
  private ownGeometries: THREE.BufferGeometry[] = [];
  private ownMaterials: THREE.Material[] = [];
  readonly meshes: THREE.SkinnedMesh[] = [];
  appearance: Appearance;
  readonly isAgent: boolean;
  readonly isStatue: boolean;
  /** Socket on the right glove (for held objects like the Eye). */
  readonly handSocketR = new THREE.Object3D();
  readonly chestSocket = new THREE.Object3D();
  readonly headSocket = new THREE.Object3D();
  private bs = 1;

  constructor(appearance: Appearance, opts: RigOptions = {}) {
    this.appearance = appearance;
    this.isAgent = !!opts.agent;
    this.isStatue = !!opts.statue;
    this.root.add(this.body);
    this.bs = appearance.body === 'slim' ? 0.88 : appearance.body === 'bulky' ? 1.16 : 1;
    this.buildSkeleton();
    this.buildParts();
    this.finalize(opts.statue);
  }

  // ------------------------------------------------------------ skeleton

  private joint(name: JointName, parent: THREE.Object3D, x: number, y: number, z: number) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    parent.add(b);
    this.joints[name] = b;
    this.rest[name] = b.position.clone();
    return b;
  }

  private buildSkeleton() {
    const R = RIG;
    const hips = this.joint('hips', this.body, 0, R.hipsY, 0);
    const spine = this.joint('spine', hips, 0, R.spine, 0);
    const chest = this.joint('chest', spine, 0, R.chest, 0);
    const neck = this.joint('neck', chest, 0, R.neck, 0);
    this.joint('head', neck, 0, R.headBase, 0);
    for (const s of [1, -1] as const) {
      const L = s === 1 ? 'L' : 'R';
      const sh = this.joint(`sh${L}` as JointName, chest, R.shoulderX * s * this.bs, 0.16, 0);
      const arm = this.joint(`arm${L}` as JointName, sh, 0, 0, 0);
      const elbow = this.joint(`elbow${L}` as JointName, arm, 0, -R.upperArm, 0);
      this.joint(`hand${L}` as JointName, elbow, 0, -R.forearm, 0);
      const thigh = this.joint(`thigh${L}` as JointName, hips, 0.11 * s * this.bs, -0.03, 0);
      const knee = this.joint(`knee${L}` as JointName, thigh, 0, -R.thigh, 0);
      this.joint(`foot${L}` as JointName, knee, 0, -R.shin, 0);
    }
    this.joints.handR.add(this.handSocketR);
    this.handSocketR.position.set(0, -0.12, 0.08);
    this.joints.chest.add(this.chestSocket);
    this.chestSocket.position.set(0, 0.06, 0.2);
    this.joints.head.add(this.headSocket);
    this.headSocket.position.set(0, RIG.headCenter + 0.02, 0.12);
  }

  // ------------------------------------------------------------ part helpers

  /** Add a primitive part attached to a joint (merged into the skinned mesh later). */
  private part(joint: JointName, geo: THREE.BufferGeometry, color: string | THREE.Color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, flat = false) {
    tmpE.set(rx, ry, rz);
    tmpQ.setFromEuler(tmpE);
    tmpP.set(x, y, z);
    tmpS.set(sx, sy, sz);
    tmpM.compose(tmpP, tmpQ, tmpS);
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(tmpM);
    geo.dispose();
    this.parts.push({ geo: g, joint, color: color instanceof THREE.Color ? color : new THREE.Color(color), flat });
  }

  /** Textured decal plane attached to a bone (face, prints, patches). */
  private decal(joint: JointName, key: string, tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry = 0, color = '#ffffff', fpHidden = false) {
    if (this.isStatue) return null;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMaterial(key, tex, color));
    this.ownGeometries.push(m.geometry);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.renderOrder = 1;
    if (fpHidden) m.layers.set(LAYER_FP_HIDDEN);
    this.joints[joint].add(m);
    this.decals.push(m);
    return m;
  }

  private shade(hex: string, k: number): THREE.Color {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l * k + (k > 1 ? 0.03 : 0), 0, 1));
    return c;
  }

  // ------------------------------------------------------------ the model

  private buildParts() {
    const a = this.appearance;
    const c = a.colors;
    const bs = this.bs;
    const metal = '#cfd0d6';
    const ink = '#111114';
    const hasAcc = (x: string) => a.acc.includes(x as never);

    // ---------- head
    const head = new THREE.IcosahedronGeometry(RIG.headRadius, 2);
    this.part('head', head, c.skin, 0, RIG.headCenter, 0, 0, 0, 0, 1.06, 0.97, 1.0, true);
    for (const s of [1, -1]) {
      this.part('head', new THREE.IcosahedronGeometry(0.07, 0), c.skin, s * 0.31, RIG.headCenter - 0.03, 0, 0, 0, 0, 0.5, 1, 0.8, true);
    }
    if (hasAcc('earring')) this.part('head', new THREE.TorusGeometry(0.025, 0.008, 6, 12), metal, 0.325, RIG.headCenter - 0.1, 0.01, 0, Math.PI / 2, 0);
    // drawn face
    if (!this.isStatue && a.face !== 'none') {
      const faceGeo = new THREE.SphereGeometry(RIG.headRadius * 1.035, 24, 12, Math.PI / 2 - 0.95, 1.9, Math.PI / 2 - 0.62, 1.15);
      this.faceMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
      this.ownMaterials.push(this.faceMat);
      this.ownGeometries.push(faceGeo);
      this.faceMesh = new THREE.Mesh(faceGeo, this.faceMat);
      this.faceMesh.position.set(0, RIG.headCenter, 0);
      this.faceMesh.scale.set(1.06, 0.97, 1.0);
      this.faceMesh.renderOrder = 2;
      this.faceMesh.layers.set(LAYER_FP_HIDDEN);
      this.joints.head.add(this.faceMesh);
      this.decals.push(this.faceMesh);
      this.setFaceTexture('neutral');
    }

    // ---------- hair (visible under open hats)
    const hairVisible = a.hat === 'none' || a.hat === 'cap' || a.hat === 'headphones';
    if (hairVisible && a.hair !== 'none') {
      const top = RIG.headCenter + RIG.headRadius * 0.85;
      if (a.hair === 'tuft') {
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          this.part('head', new THREE.ConeGeometry(0.07, 0.18, 5), c.hair, Math.cos(ang) * 0.09, top + 0.02, Math.sin(ang) * 0.09 - 0.03, Math.sin(ang) * 0.5, 0, -Math.cos(ang) * 0.5, 1, 1, 1, true);
        }
      } else if (a.hair === 'curls') {
        for (let i = 0; i < 12; i++) {
          const ang = (i / 12) * Math.PI * 2;
          const r = i % 2 ? 0.2 : 0.12;
          this.part('head', new THREE.IcosahedronGeometry(0.075, 1), c.hair, Math.cos(ang) * r, top - 0.02 + (i % 3) * 0.02, Math.sin(ang) * r - 0.04, 0, 0, 0, 1, 1, 1, true);
        }
      } else if (a.hair === 'buns') {
        for (const s of [1, -1]) this.part('head', new THREE.IcosahedronGeometry(0.1, 1), c.hair, s * 0.19, top, -0.05, 0, 0, 0, 1, 1, 1, true);
      }
    }

    // ---------- hats
    const hc = RIG.headCenter;
    if (a.hat === 'beanie' && !this.isStatue) {
      // textured knit beanie stays its own mesh (rib texture)
      const knit = decalMaterial('knit:' + c.hat, knitTexture(c.hat), '#ffffff');
      knit.transparent = false;
      knit.depthWrite = true;
      knit.alphaTest = 0;
      knit.polygonOffset = false;
      knit.roughness = 1;
      const crownG = new THREE.SphereGeometry(RIG.headRadius * 1.1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
      const crown = new THREE.Mesh(crownG, knit);
      crown.position.set(0, hc + 0.06, -0.01);
      crown.scale.set(1.08, 1.12, 1.06);
      crown.rotation.x = -0.12;
      const cuffG = new THREE.CylinderGeometry(RIG.headRadius * 1.15, RIG.headRadius * 1.17, 0.12, 20, 1, false);
      const cuff = new THREE.Mesh(cuffG, knit);
      cuff.position.set(0, hc + 0.08, -0.01);
      cuff.scale.set(1.08, 1, 1.05);
      cuff.rotation.x = -0.12;
      for (const m of [crown, cuff]) {
        m.castShadow = true;
        m.layers.set(LAYER_FP_HIDDEN);
        this.joints.head.add(m);
        this.ownGeometries.push(m.geometry);
      }
      // fold line
      this.part('head', new THREE.TorusGeometry(RIG.headRadius * 1.16, 0.012, 4, 28), this.shade(c.hat, 0.6), 0, hc + 0.025, -0.01, Math.PI / 2 - 0.12, 0, 0, 1.08, 1.05, 1);
    } else if (a.hat === 'beanie') {
      this.part('head', new THREE.SphereGeometry(RIG.headRadius * 1.12, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), c.hat, 0, hc + 0.05, 0, -0.12, 0, 0, 1.08, 1.12, 1.06, true);
    } else if (a.hat === 'cap') {
      this.part('head', new THREE.SphereGeometry(RIG.headRadius * 1.07, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), c.hat, 0, hc + 0.04, 0, 0, 0, 0, 1.08, 1.0, 1.05);
      this.part('head', new RoundedBoxGeometry(0.42, 0.025, 0.24, 2, 0.01), this.shade(c.hat, 0.85), 0, hc + 0.13, 0.3, 0.12);
      this.part('head', new THREE.SphereGeometry(0.03, 8, 6), this.shade(c.hat, 0.7), 0, hc + 0.36, 0);
      this.part('head', new THREE.CircleGeometry(0.06, 12), c.accent, 0, hc + 0.2, 0.31, -0.35);
    } else if (a.hat === 'bucket') {
      this.part('head', new THREE.CylinderGeometry(RIG.headRadius * 0.95, RIG.headRadius * 1.12, 0.22, 16, 1), c.hat, 0, hc + 0.2, 0, -0.06);
      this.part('head', new THREE.CylinderGeometry(RIG.headRadius * 1.12, RIG.headRadius * 1.6, 0.06, 18, 1, true), this.shade(c.hat, 0.9), 0, hc + 0.07, 0, -0.06);
      this.part('head', new THREE.CylinderGeometry(RIG.headRadius * 1.0, RIG.headRadius * 1.0, 0.03, 16), c.accent, 0, hc + 0.13, 0, -0.06);
    } else if (a.hat === 'hood') {
      this.part('head', new THREE.SphereGeometry(RIG.headRadius * 1.16, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), c.top, 0, hc + 0.0, -0.03, -0.25, 0, 0, 1.08, 1.12, 1.1);
      this.part('head', new THREE.TorusGeometry(RIG.headRadius * 1.02, 0.035, 6, 24), this.shade(c.top, 0.75), 0, hc - 0.01, 0.13, -0.25, 0, 0, 1.04, 1.12, 1);
    } else if (a.hat === 'headphones') {
      this.part('head', new THREE.TorusGeometry(RIG.headRadius * 1.08, 0.025, 6, 24, Math.PI), c.hat, 0, hc + 0.02, 0, 0, 0, 0);
      for (const s of [1, -1]) {
        this.part('head', new THREE.CylinderGeometry(0.09, 0.09, 0.07, 14), c.hat, s * 0.32, hc - 0.02, 0, 0, 0, Math.PI / 2);
        this.part('head', new THREE.CylinderGeometry(0.06, 0.06, 0.075, 12), c.accent, s * 0.335, hc - 0.02, 0, 0, 0, Math.PI / 2);
      }
    }
    if (hasAcc('glasses')) {
      for (const s of [1, -1]) this.part('head', new THREE.TorusGeometry(0.075, 0.012, 6, 16), ink, s * 0.1, hc - 0.01, RIG.headRadius * 1.01, 0, 0, 0);
      this.part('head', new THREE.BoxGeometry(0.06, 0.015, 0.015), ink, 0, hc + 0.0, RIG.headRadius * 1.02);
    }
    if (hasAcc('mask')) {
      this.part('head', new THREE.SphereGeometry(RIG.headRadius * 1.04, 18, 8, Math.PI / 2 - 0.9, 1.8, Math.PI * 0.6, Math.PI * 0.25), c.accent, 0, hc, 0, 0, 0, 0, 1.06, 0.97, 1.02);
    }

    // ---------- torso
    const top = a.top;
    const torsoColor = top === 'tee' ? c.shirt : c.top;
    const darker = this.shade(torsoColor, 0.75);
    const lighter = this.shade(torsoColor, 1.25);
    this.part('chest', new RoundedBoxGeometry(0.5 * bs, 0.34, 0.31 * bs, 3, 0.09), torsoColor, 0, 0.07, 0);
    const lowerLen = top === 'bomber' ? 0.24 : top === 'tee' ? 0.26 : 0.32;
    this.part('spine', new RoundedBoxGeometry(0.5 * bs, lowerLen, 0.31 * bs, 3, 0.08), torsoColor, 0, 0.11 - lowerLen / 2, 0, 0, 0, 0, top === 'jacket' ? 1.03 : 1, 1, top === 'jacket' ? 1.03 : 1);
    // neck
    this.part('neck', new THREE.CylinderGeometry(0.075, 0.085, 0.2, 10), c.shirt, 0, -0.06, 0);
    if (top === 'jacket') {
      // open front showing the tee, lapels in a V, folded collar
      this.part('chest', new THREE.BoxGeometry(0.15, 0.31, 0.02), c.shirt, 0, 0.055, 0.152 * bs);
      this.part('spine', new THREE.BoxGeometry(0.13, lowerLen - 0.04, 0.02), c.shirt, 0, 0.11 - lowerLen / 2 + 0.02, 0.157 * bs);
      for (const s of [1, -1]) {
        this.part('chest', new THREE.BoxGeometry(0.075, 0.27, 0.025), lighter, s * 0.1 * bs, 0.08, 0.165 * bs, 0.08, 0, s * 0.28);
        this.part('chest', new THREE.BoxGeometry(0.018, 0.33, 0.03), darker, s * 0.083, 0.05, 0.158 * bs);
        this.part('spine', new THREE.BoxGeometry(0.018, lowerLen - 0.03, 0.03), darker, s * 0.075, 0.11 - lowerLen / 2, 0.16 * bs);
        // flap pockets
        this.part('spine', new THREE.BoxGeometry(0.13, 0.015, 0.03), darker, s * 0.15 * bs, -0.02, 0.163 * bs);
        // buttons
        this.part('spine', new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8), metal, s * 0.11, 0.05 - (s > 0 ? 0 : 0.09), 0.165 * bs, Math.PI / 2);
      }
      this.part('chest', new THREE.BoxGeometry(0.34 * bs, 0.08, 0.06), lighter, 0, 0.25, -0.12 * bs, -0.6);
      this.part('chest', new THREE.CylinderGeometry(0.13, 0.17, 0.08, 12, 1, true), lighter, 0, 0.245, -0.02);
      // hem seam
      this.part('spine', new THREE.BoxGeometry(0.5 * bs * 1.04, 0.02, 0.32 * bs * 1.04), darker, 0, 0.11 - lowerLen + 0.012, 0);
    } else if (top === 'hoodie') {
      this.part('spine', new RoundedBoxGeometry(0.3, 0.12, 0.04, 2, 0.015), darker, 0, -0.06, 0.155 * bs);
      if (a.hat !== 'hood') this.part('chest', new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), this.shade(torsoColor, 0.9), 0, 0.2, -0.13 * bs, -1.2, 0, 0, 1.2, 0.8, 0.8);
      for (const s of [1, -1]) this.part('chest', new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5), c.accent, s * 0.05, 0.13, 0.16 * bs);
      this.part('chest', new THREE.CylinderGeometry(0.11, 0.15, 0.07, 12, 1, true), darker, 0, 0.245, -0.01);
    } else if (top === 'bomber') {
      this.part('spine', new THREE.BoxGeometry(0.5 * bs * 1.02, 0.06, 0.32 * bs * 1.02), c.accent, 0, 0.11 - lowerLen + 0.03, 0);
      this.part('chest', new THREE.CylinderGeometry(0.12, 0.15, 0.08, 12, 1, true), c.accent, 0, 0.245, -0.01);
      this.part('chest', new THREE.BoxGeometry(0.015, 0.33, 0.03), metal, 0, 0.05, 0.158 * bs);
      this.part('spine', new THREE.BoxGeometry(0.015, lowerLen - 0.06, 0.03), metal, 0, 0.11 - lowerLen / 2 + 0.02, 0.157 * bs);
    } else {
      this.part('chest', new THREE.TorusGeometry(0.1, 0.018, 6, 16), this.shade(c.shirt, 0.8), 0, 0.24, 0.02, Math.PI / 2 - 0.35);
    }
    // belt / pelvis
    this.part('hips', new RoundedBoxGeometry(0.42 * bs, 0.18, 0.28 * bs, 2, 0.06), c.pants, 0, -0.03, 0);
    this.part('hips', new THREE.BoxGeometry(0.43 * bs, 0.035, 0.29 * bs), ink, 0, 0.04, 0);
    this.part('hips', new THREE.BoxGeometry(0.06, 0.04, 0.02), metal, 0, 0.04, 0.147 * bs);

    // chain of links
    if (hasAcc('chain')) {
      for (let i = 0; i < 11; i++) {
        const t = (i / 10 - 0.5) * 2.2;
        this.part('chest', new THREE.TorusGeometry(0.016, 0.006, 4, 8), metal, Math.sin(t) * 0.12, 0.23 - (1 - Math.cos(t)) * 0.13, 0.08 + Math.cos(t) * 0.07, 0, i % 2 ? Math.PI / 2 : 0, t);
      }
    }
    if (hasAcc('scarf')) {
      this.part('chest', new THREE.TorusGeometry(0.13, 0.055, 8, 18), c.accent, 0, 0.24, 0.0, Math.PI / 2 - 0.15, 0, 0, 1, 1.05, 0.8);
      this.part('chest', new RoundedBoxGeometry(0.09, 0.26, 0.04, 2, 0.015), this.shade(c.accent, 0.85), 0.08, 0.1, 0.17 * bs, 0.1, 0, 0.12);
    }
    if (hasAcc('backpack')) {
      this.part('chest', new RoundedBoxGeometry(0.34 * bs, 0.36, 0.16, 3, 0.06), c.hat, 0, 0.02, -0.23 * bs);
      this.part('chest', new RoundedBoxGeometry(0.24, 0.12, 0.05, 2, 0.02), c.accent, 0, -0.07, -0.32 * bs);
      for (const s of [1, -1]) this.part('chest', new THREE.BoxGeometry(0.045, 0.36, 0.02), this.shade(c.hat, 0.7), s * 0.14 * bs, 0.06, 0.158 * bs, 0, 0, 0);
    }

    // ---------- arms
    for (const s of [1, -1] as const) {
      const L = s === 1 ? 'L' : 'R';
      const sh = `sh${L}` as JointName;
      const arm = `arm${L}` as JointName;
      const elbow = `elbow${L}` as JointName;
      const hand = `hand${L}` as JointName;
      if (top === 'tee') {
        this.part(sh, new THREE.SphereGeometry(0.1 * bs, 10, 8), c.shirt, 0, -0.01, 0);
        this.part(arm, new THREE.CylinderGeometry(0.1 * bs, 0.095 * bs, 0.13, 10), c.shirt, 0, -0.05, 0);
        this.part(arm, new THREE.CapsuleGeometry(0.062, 0.14, 4, 8), c.skin, 0, -0.14, 0);
        this.part(elbow, new THREE.CapsuleGeometry(0.058, 0.14, 4, 8), c.skin, 0, -RIG.forearm / 2 + 0.01, 0);
      } else {
        this.part(sh, new THREE.SphereGeometry(0.11 * bs, 10, 8), c.top, 0, -0.01, 0);
        this.part(arm, new THREE.CapsuleGeometry(0.092 * bs, 0.15, 4, 10), c.top, 0, -RIG.upperArm / 2, 0);
        this.part(elbow, new THREE.CapsuleGeometry(0.088 * bs, 0.12, 4, 10), c.top, 0, -RIG.forearm / 2 + 0.02, 0);
        // rolled / ribbed cuff
        const cuffColor = top === 'bomber' ? c.accent : top === 'jacket' ? lighter : darker;
        this.part(elbow, new THREE.CylinderGeometry(0.098 * bs, 0.1 * bs, 0.06, 12), cuffColor, 0, -RIG.forearm + 0.05, 0);
      }
      // ---------- hands
      const palmColor = a.gloves === 'bare' ? c.skin : c.gloves;
      const fingerColor = a.gloves === 'mitts' ? c.gloves : c.skin;
      const plush = a.gloves === 'mitts' ? 1 : 0.8;
      this.part(hand, new RoundedBoxGeometry(0.15 * plush, 0.14, 0.1 * plush, 3, 0.045), palmColor, 0, -0.065, 0, 0, s * 0.1, 0, 1, 1, 1, true);
      for (let i = 0; i < 4; i++) {
        const fx = (i - 1.5) * 0.036 * plush;
        const len = i === 0 || i === 3 ? 0.045 : 0.06;
        this.part(hand, new THREE.CapsuleGeometry(0.024 * plush + 0.004, len, 3, 8), fingerColor, fx, -0.165, 0.01, 0.25, 0, (i - 1.5) * 0.06, 1, 1, 1, true);
      }
      this.part(hand, new THREE.CapsuleGeometry(0.026 * plush + 0.003, 0.05, 3, 8), fingerColor, -s * 0.06 * plush, -0.075, 0.05, 0.9, 0, -s * 0.5, 1, 1, 1, true);
      this.part(hand, new THREE.CylinderGeometry(0.072, 0.078, 0.045, 10), a.gloves === 'bare' ? c.skin : this.shade(c.gloves, 0.92), 0, 0.0, 0);
      // sleeve patches
      if (a.patches && top !== 'tee') {
        this.decal(arm, `patch:${s}:${c.patchA}:${c.patchB}`, patchTexture(s === 1 ? 'splat' : 'burst', s === 1 ? c.patchB : c.patchA), 0.1, 0.1, s * 0.094 * bs, -0.1, 0, (s * Math.PI) / 2);
        this.decal(elbow, `sparkle:${c.patchA}`, sparkleTexture(), 0.05, 0.05, s * 0.09 * bs, -0.09, 0.02, (s * Math.PI) / 2, c.patchA);
      }
    }

    // ---------- legs
    for (const s of [1, -1] as const) {
      const L = s === 1 ? 'L' : 'R';
      const thigh = `thigh${L}` as JointName;
      const knee = `knee${L}` as JointName;
      const foot = `foot${L}` as JointName;
      if (a.bottom === 'shorts') {
        this.part(thigh, new THREE.CylinderGeometry(0.125 * bs, 0.13 * bs, 0.2, 12), c.pants, 0, -0.08, 0);
        this.part(thigh, new THREE.CapsuleGeometry(0.065, 0.1, 4, 8), c.skin, 0, -0.22, 0);
        this.part(knee, new THREE.CapsuleGeometry(0.06, 0.18, 4, 8), c.skin, 0, -RIG.shin / 2, 0);
      } else {
        const r = a.bottom === 'cargo' ? 0.115 : 0.104;
        this.part(thigh, new THREE.CapsuleGeometry(r * bs, 0.17, 4, 10), c.pants, 0, -RIG.thigh / 2, 0);
        if (a.bottom === 'cargo') {
          this.part(thigh, new RoundedBoxGeometry(0.05, 0.13, 0.13, 1, 0.02), this.shade(c.pants, 1.2), s * 0.115 * bs, -0.18, 0);
          this.part(knee, new THREE.CapsuleGeometry(0.104 * bs, 0.15, 4, 10), c.pants, 0, -RIG.shin / 2 + 0.02, 0);
          // stacked hem over the sneaker
          this.part(knee, new THREE.CylinderGeometry(0.112 * bs, 0.125 * bs, 0.05, 12), this.shade(c.pants, 1.1), 0, -RIG.shin + 0.06, 0);
          this.part(knee, new THREE.CylinderGeometry(0.12 * bs, 0.13 * bs, 0.05, 12), c.pants, 0, -RIG.shin + 0.02, 0);
        } else {
          this.part(knee, new THREE.CylinderGeometry(0.095 * bs, 0.075, 0.24, 10), c.pants, 0, -RIG.shin / 2 + 0.02, 0);
          this.part(knee, new THREE.CylinderGeometry(0.078, 0.08, 0.05, 10), this.shade(c.pants, 0.7), 0, -RIG.shin + 0.04, 0);
        }
      }
      // ---------- shoes
      if (a.shoes === 'slides') {
        this.part(foot, new RoundedBoxGeometry(0.12, 0.08, 0.24, 2, 0.035), c.skin, 0, -0.03, 0.05);
        this.part(foot, new RoundedBoxGeometry(0.17, 0.045, 0.3, 2, 0.02), c.sole, 0, -0.085, 0.05);
        this.part(foot, new RoundedBoxGeometry(0.16, 0.05, 0.1, 2, 0.02), c.shoes, 0, -0.02, 0.09);
      } else {
        const high = a.shoes === 'hightop';
        this.part(foot, new RoundedBoxGeometry(0.165, high ? 0.2 : 0.125, 0.28, 2, 0.05), c.shoes, 0, high ? 0.0 : -0.04, 0.05);
        this.part(foot, new RoundedBoxGeometry(0.17, 0.08, 0.11, 2, 0.04), this.shade(c.shoes, 0.95), 0, -0.065, 0.15);
        this.part(foot, new RoundedBoxGeometry(0.19, 0.065, 0.315, 2, 0.025), c.sole, 0, -0.105, 0.05);
        this.part(foot, new THREE.BoxGeometry(0.192, 0.012, 0.317), this.shade(c.sole, 0.75), 0, -0.085, 0.05);
        // tongue + laces
        this.part(foot, new RoundedBoxGeometry(0.08, 0.06, 0.08, 1, 0.02), this.shade(c.shoes, 0.9), 0, high ? 0.09 : 0.03, 0.0, -0.4);
        for (let i = 0; i < (high ? 4 : 3); i++) this.part(foot, new THREE.BoxGeometry(0.09, 0.012, 0.016), ink, 0, (high ? 0.06 : 0.025) - i * 0.03, 0.05 + i * 0.035, -0.5);
        if (high) this.part(foot, new THREE.TorusGeometry(0.07, 0.018, 6, 14), c.accent, 0, 0.1, 0.0, Math.PI / 2);
        // heel tab
        this.part(foot, new THREE.BoxGeometry(0.05, 0.06, 0.02), c.accent, 0, high ? 0.05 : 0.0, -0.09);
      }
    }

    // ---------- decals (patches, prints)
    if (a.patches && top !== 'tee') {
      this.decal('chest', `patch:burst:${c.patchA}`, patchTexture('burst', c.patchA), 0.13, 0.13, 0.155 * bs, 0.12, 0.17 * bs);
      this.decal('spine', `patch:splat:${c.patchB}`, patchTexture('splat', c.patchB), 0.11, 0.11, -0.16 * bs, 0.03, 0.167 * bs);
      this.decal('chest', `patch:splat2:${c.patchB}`, patchTexture('splat', c.patchB), 0.08, 0.08, -0.17 * bs, 0.14, 0.162 * bs);
      for (const [x, y] of [[0.2, -0.02], [-0.06, 0.2], [0.14, 0.2]] as const) {
        this.decal('chest', `sparkle:${c.patchA}`, sparkleTexture(), 0.045, 0.045, x * bs, y, 0.162 * bs, 0, c.patchA);
      }
    }
    if (a.chest && top !== 'tee') this.decal('spine', `chest:${a.chest}`, chestTextTexture(a.chest), 0.15, 0.075, 0.135 * bs, -0.08, 0.167 * bs);
    if (a.chest && top === 'tee') this.decal('chest', `chest:${a.chest}`, chestTextTexture(a.chest), 0.26, 0.13, 0, 0.05, 0.158 * bs);
    if ((a.print || a.patches) && !hasAcc('backpack')) {
      this.decal('chest', `print:${a.print}:${c.patchA}:${c.patchB}:${c.shirt}`, backPrintTexture(a.print, c.patchA, c.patchB, c.shirt), 0.42 * bs, 0.42, 0, 0.03, -0.158 * bs, Math.PI);
    }
  }

  /** Merge parts into skinned meshes bound to the skeleton. */
  private finalize(statue?: string) {
    this.root.updateMatrixWorld(true);
    const bones = JOINTS.map((j) => this.joints[j]);
    const boneIndex = new Map<JointName, number>(JOINTS.map((j, i) => [j, i]));
    const skeleton = new THREE.Skeleton(bones);
    const statueColor = statue ? new THREE.Color(statue) : null;
    const groups = new Map<string, THREE.BufferGeometry[]>();
    for (const p of this.parts) {
      const g = p.geo;
      g.applyMatrix4(this.joints[p.joint].matrixWorld);
      if (g.attributes.uv) g.deleteAttribute('uv');
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const cc = statueColor ?? p.color;
      for (let i = 0; i < n; i++) {
        col[i * 3] = cc.r;
        col[i * 3 + 1] = cc.g;
        col[i * 3 + 2] = cc.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const si = new Uint16Array(n * 4);
      const sw = new Float32Array(n * 4);
      const bi = boneIndex.get(p.joint)!;
      for (let i = 0; i < n; i++) {
        si[i * 4] = bi;
        sw[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      const key = (HEAD_JOINTS.has(p.joint) ? 'head' : 'body') + (p.flat || statue ? ':flat' : ':smooth');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(g);
    }
    const mats = sharedMaterials();
    for (const [key, list] of groups) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      this.ownGeometries.push(merged);
      const mesh = new THREE.SkinnedMesh(merged, key.endsWith('flat') ? mats.flat : mats.smooth);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (key.startsWith('head')) mesh.layers.set(LAYER_FP_HIDDEN);
      this.body.add(mesh);
      mesh.bind(skeleton);
      // generous bounds that cover any pose
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.9);
      this.meshes.push(mesh);
    }
    this.parts = [];
  }

  // ------------------------------------------------------------ face & LOD

  private setFaceTexture(e: Expression) {
    if (!this.faceMat) return;
    const tex = faceTexture(this.appearance.face, e, this.appearance.colors.skin);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1;
    this.faceMat.map = tex;
    this.faceMat.needsUpdate = true;
  }

  /** Show an expression for a while, then return to neutral. */
  setExpression(e: Expression, hold = 0.6) {
    this.holdExpr = e;
    this.exprHold = hold;
  }

  /** Far-away characters skip their decals (prints, patches, face). */
  setDetail(near: boolean) {
    for (const d of this.decals) d.visible = near;
  }

  updateFace(dt: number) {
    if (!this.faceMat) return;
    let want: Expression = 'neutral';
    if (this.holdExpr) {
      this.exprHold -= dt;
      want = this.holdExpr;
      if (this.exprHold <= 0) this.holdExpr = null;
    }
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkHold = 0.12;
      this.blinkTimer = 2 + Math.random() * 4;
    }
    if (this.blinkHold > 0) {
      this.blinkHold -= dt;
      if (want === 'neutral' || want === 'halfLid' || want === 'focus') want = 'blink';
    }
    if (want !== this.expression) {
      this.expression = want;
      this.setFaceTexture(want);
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const g of this.ownGeometries) g.dispose();
    for (const m of this.ownMaterials) m.dispose();
    for (const m of this.meshes) m.skeleton.dispose();
    this.ownGeometries = [];
    this.ownMaterials = [];
  }
}
