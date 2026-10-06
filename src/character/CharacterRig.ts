import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Appearance } from './Appearance';
import { backPrintTexture, chestTextTexture, Expression, faceTexture, knitTexture, patchTexture } from '../world/Textures';

/**
 * Procedural low-poly "faceted toy" character: oversized faceted head with a
 * drawn-on face, beanie, streetwear jacket with eye patches, chunky gloves and
 * sneakers. Built as a joint hierarchy so it can be posed procedurally.
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

export class CharacterRig {
  readonly root = new THREE.Group();
  /** Rotated by yaw; separate from root so the animator can lean/offset the body. */
  readonly body = new THREE.Group();
  readonly joints = {} as Record<JointName, THREE.Group>;
  /** Rest local positions (the animator offsets hips from this). */
  readonly rest = {} as Record<JointName, THREE.Vector3>;
  private faceMesh!: THREE.Mesh;
  private faceMat!: THREE.MeshBasicMaterial;
  private expression: Expression = 'neutral';
  private blinkTimer = 2;
  private blinkHold = 0;
  private exprHold = 0;
  private holdExpr: Expression | null = null;
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  appearance: Appearance;
  readonly isAgent: boolean;
  /** Socket on the right glove (for held objects like the Eye). */
  readonly handSocketR = new THREE.Object3D();
  readonly chestSocket = new THREE.Object3D();
  readonly headSocket = new THREE.Object3D();

  constructor(appearance: Appearance, opts: { agent?: boolean } = {}) {
    this.appearance = appearance;
    this.isAgent = !!opts.agent;
    this.root.add(this.body);
    this.buildSkeleton();
    this.buildMeshes();
  }

  private joint(name: JointName, parent: THREE.Object3D, x: number, y: number, z: number) {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    this.joints[name] = g;
    this.rest[name] = g.position.clone();
    return g;
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
      const sh = this.joint(`sh${L}` as JointName, chest, R.shoulderX * s, 0.16, 0);
      const arm = this.joint(`arm${L}` as JointName, sh, 0, 0, 0);
      const elbow = this.joint(`elbow${L}` as JointName, arm, 0, -R.upperArm, 0);
      this.joint(`hand${L}` as JointName, elbow, 0, -R.forearm, 0);
      const thigh = this.joint(`thigh${L}` as JointName, hips, 0.11 * s, -0.03, 0);
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

  private mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });
    this.disposables.push(m);
    return m;
  }

  private add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, fpHidden = false): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    if (fpHidden) m.layers.set(LAYER_FP_HIDDEN);
    parent.add(m);
    this.disposables.push(geo);
    return m;
  }

  private decal(parent: THREE.Object3D, tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry = 0, fpHidden = false) {
    const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.08, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
    this.disposables.push(mat);
    const m = this.add(parent, new THREE.PlaneGeometry(w, h), mat, x, y, z, fpHidden);
    m.rotation.y = ry;
    m.castShadow = false;
    return m;
  }

  private buildMeshes() {
    const a = this.appearance;
    const c = a.colors;
    const J = this.joints;
    const bodyScale = a.body === 'slim' ? 0.88 : a.body === 'bulky' ? 1.16 : 1;

    const skin = this.mat(c.skin, { flatShading: true, roughness: 0.7 });
    const jacket = this.mat(c.jacket, { roughness: 0.92 });
    const shirt = this.mat(c.shirt);
    const pants = this.mat(c.pants, { roughness: 0.95 });
    const shoe = this.mat(c.shoes, { roughness: 0.6 });
    const sole = this.mat(c.sole, { roughness: 0.7 });
    const glove = this.mat(c.gloves, { roughness: 0.55, flatShading: true });
    const metal = this.mat('#d8d8de', { metalness: 1, roughness: 0.25 });
    const ink = this.mat('#111114');

    // ---------------- head
    const headGeo = new THREE.IcosahedronGeometry(RIG.headRadius, 2);
    const head = this.add(J.head, headGeo, skin, 0, RIG.headCenter, 0, true);
    head.scale.set(1.06, 0.97, 1.0);
    // ears
    const earGeo = new THREE.IcosahedronGeometry(0.07, 0);
    for (const s of [1, -1]) {
      const ear = this.add(J.head, earGeo, skin, s * 0.31, RIG.headCenter - 0.03, 0, true);
      ear.scale.set(0.5, 1, 0.8);
    }
    if (!this.isAgent) {
      const ring = this.add(J.head, new THREE.TorusGeometry(0.025, 0.007, 6, 12), metal, 0.325, RIG.headCenter - 0.1, 0.01, true);
      ring.rotation.y = Math.PI / 2;
    }
    // face decal: a sphere patch hugging the front of the head
    const faceGeo = new THREE.SphereGeometry(RIG.headRadius * 1.035, 24, 12, Math.PI / 2 - 0.95, 1.9, Math.PI / 2 - 0.62, 1.15);
    this.faceMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.disposables.push(this.faceMat);
    this.faceMesh = this.add(J.head, faceGeo, this.faceMat, 0, RIG.headCenter, 0, true);
    this.faceMesh.scale.set(1.06, 0.97, 1.0);
    this.faceMesh.castShadow = false;
    this.faceMesh.renderOrder = 2;
    this.setFaceTexture('neutral');

    // ---------------- hat
    if (a.hat === 'beanie') {
      const knit = this.mat(c.beanie, { map: knitTexture(c.beanie), roughness: 1 });
      const crown = this.add(J.head, new THREE.SphereGeometry(RIG.headRadius * 1.1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), knit, 0, RIG.headCenter + 0.06, -0.01, true);
      crown.scale.set(1.08, 1.12, 1.06);
      crown.rotation.x = -0.12;
      const knitDS = this.mat(c.beanie, { map: knitTexture(c.beanie), roughness: 1, side: THREE.DoubleSide });
      const cuff = this.add(J.head, new THREE.CylinderGeometry(RIG.headRadius * 1.15, RIG.headRadius * 1.17, 0.12, 20, 1, true), knitDS, 0, RIG.headCenter + 0.08, -0.01, true);
      cuff.scale.set(1.08, 1, 1.05);
      cuff.rotation.x = -0.12;
    } else if (a.hat === 'cap') {
      const capMat = this.mat(c.beanie, { roughness: 0.8 });
      const crown = this.add(J.head, new THREE.SphereGeometry(RIG.headRadius * 1.07, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), capMat, 0, RIG.headCenter + 0.04, 0, true);
      crown.scale.set(1.08, 1.0, 1.05);
      const brim = this.add(J.head, new RoundedBoxGeometry(0.42, 0.025, 0.24, 2, 0.01), capMat, 0, RIG.headCenter + 0.13, 0.3, true);
      brim.rotation.x = 0.12;
    }

    // ---------------- torso
    const chestGeo = new RoundedBoxGeometry(0.5 * bodyScale, 0.34, 0.31 * bodyScale, 3, 0.09);
    this.add(J.chest, chestGeo, jacket, 0, 0.07, 0);
    const lowerGeo = new RoundedBoxGeometry(0.47 * bodyScale, 0.28, 0.3 * bodyScale, 3, 0.08);
    this.add(J.spine, lowerGeo, jacket, 0, 0.02, 0);
    // open jacket front showing the tee
    this.add(J.chest, new THREE.BoxGeometry(0.13, 0.3, 0.02), shirt, 0, 0.06, 0.152 * bodyScale);
    this.add(J.spine, new THREE.BoxGeometry(0.12, 0.2, 0.02), shirt, 0, 0.04, 0.147 * bodyScale);
    // zipper edges
    for (const s of [1, -1]) {
      this.add(J.chest, new THREE.BoxGeometry(0.02, 0.32, 0.03), ink, s * 0.075, 0.06, 0.155 * bodyScale);
    }
    // collar + neck
    this.add(J.chest, new THREE.CylinderGeometry(0.13, 0.17, 0.09, 12, 1, true), this.mat(c.jacket, { roughness: 0.92, side: THREE.DoubleSide }), 0, 0.25, -0.01);
    this.add(J.neck, new THREE.CylinderGeometry(0.075, 0.085, 0.18, 10), shirt, 0, -0.06, 0);
    if (a.chain) {
      const chain = this.add(J.chest, new THREE.TorusGeometry(0.11, 0.012, 6, 24), metal, 0, 0.2, 0.07);
      chain.rotation.x = Math.PI / 2 - 0.55;
    }
    // patches & print
    if (a.patches) {
      this.decal(J.chest, patchTexture('burst', c.patchA), 0.13, 0.13, 0.15 * bodyScale, 0.12, 0.157 * bodyScale);
      this.decal(J.spine, patchTexture('splat', c.patchB), 0.11, 0.11, -0.15 * bodyScale, 0.02, 0.152 * bodyScale);
    }
    if (a.chest) {
      this.decal(J.spine, chestTextTexture(a.chest), 0.15, 0.075, 0.13 * bodyScale, -0.07, 0.152 * bodyScale);
    }
    if (a.print || a.patches) {
      this.decal(J.chest, backPrintTexture(a.print, c.patchA, c.patchB, c.shirt), 0.42 * bodyScale, 0.42, 0, 0.03, -0.158 * bodyScale, Math.PI);
    }
    // belt / pelvis
    this.add(J.hips, new RoundedBoxGeometry(0.4 * bodyScale, 0.18, 0.27 * bodyScale, 2, 0.06), pants, 0, -0.03, 0);

    // ---------------- arms
    for (const s of [1, -1] as const) {
      const L = s === 1 ? 'L' : 'R';
      const arm = J[`arm${L}` as JointName];
      const elbow = J[`elbow${L}` as JointName];
      const hand = J[`hand${L}` as JointName];
      this.add(J[`sh${L}` as JointName], new THREE.SphereGeometry(0.11 * bodyScale, 10, 8), jacket, 0, -0.01, 0);
      this.add(arm, new THREE.CapsuleGeometry(0.088 * bodyScale, 0.15, 4, 10), jacket, 0, -RIG.upperArm / 2, 0);
      if (a.patches) {
        const pt = this.decal(arm, patchTexture(s === 1 ? 'splat' : 'burst', s === 1 ? c.patchB : c.patchA), 0.1, 0.1, s * 0.09 * bodyScale, -0.1, 0, (s * Math.PI) / 2);
        pt.renderOrder = 1;
      }
      this.add(elbow, new THREE.CapsuleGeometry(0.083 * bodyScale, 0.13, 4, 10), jacket, 0, -RIG.forearm / 2 + 0.01, 0);
      // cuff
      this.add(elbow, new THREE.CylinderGeometry(0.09, 0.095, 0.05, 10), ink, 0, -RIG.forearm + 0.03, 0);
      // glove: oversized mitten with 3 fingers + thumb
      const palm = this.add(hand, new RoundedBoxGeometry(0.14, 0.15, 0.09, 2, 0.04), glove, 0, -0.07, 0.0);
      palm.rotation.y = s * 0.1;
      const fingerGeo = new THREE.CapsuleGeometry(0.03, 0.06, 3, 8);
      for (let i = 0; i < 3; i++) {
        const f = this.add(hand, fingerGeo, glove, (i - 1) * 0.042, -0.17, 0.005);
        f.rotation.x = 0.15;
      }
      // thumb points forward and towards the body midline
      const thumb = this.add(hand, new THREE.CapsuleGeometry(0.028, 0.05, 3, 8), glove, -s * 0.06, -0.07, 0.05);
      thumb.rotation.set(0.9, 0, -s * 0.5);
      // glove cuff
      this.add(hand, new THREE.CylinderGeometry(0.075, 0.08, 0.04, 10), glove, 0, 0.0, 0);
    }

    // ---------------- legs
    for (const s of [1, -1] as const) {
      const L = s === 1 ? 'L' : 'R';
      const thigh = J[`thigh${L}` as JointName];
      const knee = J[`knee${L}` as JointName];
      const foot = J[`foot${L}` as JointName];
      this.add(thigh, new THREE.CapsuleGeometry(0.11 * bodyScale, 0.17, 4, 10), pants, 0, -RIG.thigh / 2, 0);
      // cargo pocket
      this.add(thigh, new RoundedBoxGeometry(0.05, 0.12, 0.12, 1, 0.02), pants, s * 0.11 * bodyScale, -0.18, 0);
      this.add(knee, new THREE.CapsuleGeometry(0.1 * bodyScale, 0.16, 4, 10), pants, 0, -RIG.shin / 2, 0);
      // baggy hem
      this.add(knee, new THREE.CylinderGeometry(0.105 * bodyScale, 0.12 * bodyScale, 0.08, 10), pants, 0, -RIG.shin + 0.04, 0);
      // chunky sneaker
      this.add(foot, new RoundedBoxGeometry(0.16, 0.12, 0.28, 2, 0.05), shoe, 0, -0.04, 0.05);
      this.add(foot, new RoundedBoxGeometry(0.18, 0.055, 0.31, 2, 0.02), sole, 0, -0.1, 0.05);
      this.add(foot, new THREE.BoxGeometry(0.07, 0.015, 0.11), ink, 0, 0.022, 0.08);
    }
  }

  private setFaceTexture(e: Expression) {
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

  updateFace(dt: number) {
    if (this.appearance.face === 'none') return;
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

  setVisibleForFirstPerson(_fp: boolean) {
    // handled with camera layers; kept for API symmetry
  }

  dispose() {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
