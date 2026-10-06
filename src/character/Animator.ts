import * as THREE from 'three';
import { CharacterRig, JointName, JOINTS } from './CharacterRig';
import { clamp, damp, lerp } from '../core/math';

/** Animation states. Numeric ids are sent over the network. */
export enum AnimState {
  Idle = 0,
  Move = 1,
  Air = 2,
  WallRun = 3,
  Slide = 4,
  Mantle = 5,
  Attack = 6,
  Hit = 7,
  Dodge = 8,
  Catch = 9,
  Absorb = 10,
  Charge = 11,
  Dash = 12,
  Emote = 13,
  KO = 14,
  WallClimb = 15,
  Roll = 16,
  Stagger = 17,
  Sit = 18,
}

/** Attack ids (packed into the animation param together with progress). */
export enum AttackId {
  Jab = 0,
  Cross = 1,
  Kick = 2,
  Tackle = 3,
  Uppercut = 4,
  Stomp = 5,
  AirKick = 6,
  SlideKick = 7,
  FlyingKick = 8,
}

export function packAttack(id: AttackId, t: number): number {
  return id + clamp(t, 0, 0.999);
}
export function unpackAttack(p: number): { id: AttackId; t: number } {
  const id = Math.floor(p) as AttackId;
  return { id, t: p - id };
}

export interface AnimInput {
  state: AnimState;
  /** State-specific parameter: attack packed value, wall side, progress… */
  param: number;
  /** Horizontal speed (m/s). */
  speed: number;
  vy: number;
  grounded: boolean;
}

type Rot = [number, number, number];
type Pose = Partial<Record<JointName, Rot>>;

interface PoseExtras {
  hipsY: number;
  pitch: number;
  roll: number;
  squash: number;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

/** Strike curve: wind-up (negative), extend to 1, recover to 0. */
function strike(t: number): number {
  if (t < 0.22) return -0.45 * (t / 0.22);
  if (t < 0.45) return lerp(-0.45, 1, (t - 0.22) / 0.23);
  if (t < 0.65) return 1;
  return 1 - (t - 0.65) / 0.35;
}

export class Animator {
  private phase = 0;
  private time = 0;
  private extras: PoseExtras = { hipsY: 0, pitch: 0, roll: 0, squash: 0 };
  private squashImpulse = 0;
  private lastState = AnimState.Idle;
  /** Smoothed values for blending locomotion. */
  private moveBlend = 0;

  constructor(private rig: CharacterRig) {}

  /** Landing squash; strength 0..1. */
  land(strength: number) {
    this.squashImpulse = Math.max(this.squashImpulse, clamp(strength, 0, 1));
  }

  update(dt: number, inp: AnimInput) {
    this.time += dt;
    const sp = inp.speed;
    this.phase += dt * (sp * 1.9 + (sp > 0.2 ? 1.5 : 0));
    this.moveBlend = lerp(this.moveBlend, clamp(sp / 6, 0, 1.5), damp(10, dt));

    const pose: Pose = {};
    const ex: PoseExtras = { hipsY: 0, pitch: 0, roll: 0, squash: 0 };
    let rate = 18;

    switch (inp.state) {
      case AnimState.Idle:
        this.idle(pose, ex);
        if (this.moveBlend > 0.05) this.locomotion(pose, ex, this.moveBlend);
        break;
      case AnimState.Move:
        this.locomotion(pose, ex, clamp(sp / 6, 0.25, 1.5));
        rate = 26;
        break;
      case AnimState.Air:
        this.air(pose, ex, inp.vy);
        rate = 10;
        break;
      case AnimState.WallRun:
        this.locomotion(pose, ex, 1.3);
        this.wallRun(pose, ex, inp.param);
        rate = 22;
        break;
      case AnimState.WallClimb:
        this.wallClimb(pose, ex);
        rate = 24;
        break;
      case AnimState.Slide:
        this.slide(pose, ex);
        rate = 16;
        break;
      case AnimState.Mantle:
        this.mantle(pose, ex, inp.param);
        rate = 22;
        break;
      case AnimState.Attack: {
        const { id, t } = unpackAttack(inp.param);
        if (inp.grounded && sp > 1 && id !== AttackId.Tackle && id !== AttackId.SlideKick) this.locomotion(pose, ex, clamp(sp / 6, 0.2, 1));
        else this.guard(pose, ex);
        this.attack(pose, ex, id, t);
        rate = 30;
        break;
      }
      case AnimState.Hit:
        this.hit(pose, ex, inp.param);
        rate = 30;
        break;
      case AnimState.Stagger:
        this.hit(pose, ex, 1);
        ex.hipsY -= 0.12;
        break;
      case AnimState.Dodge:
        this.dodge(pose, ex, inp.param);
        rate = 26;
        break;
      case AnimState.Catch:
        this.catchPose(pose, ex, inp.grounded);
        rate = 14;
        break;
      case AnimState.Absorb:
        this.absorb(pose, ex, inp.param);
        rate = 12;
        break;
      case AnimState.Charge:
        this.charge(pose, ex, inp.param);
        rate = 14;
        break;
      case AnimState.Dash:
        this.dash(pose, ex);
        rate = 24;
        break;
      case AnimState.Emote:
        this.emote(pose, ex);
        rate = 14;
        break;
      case AnimState.KO:
        this.ko(pose, ex);
        rate = 8;
        break;
      case AnimState.Roll:
        this.roll(pose, ex, inp.param);
        rate = 40;
        break;
      case AnimState.Sit:
        this.sit(pose, ex, inp.param);
        rate = 14;
        break;
    }

    if (inp.state !== this.lastState) this.lastState = inp.state;

    // apply joint rotations with smoothing
    const k = damp(rate, dt);
    for (const j of JOINTS) {
      const r = pose[j] ?? [0, 0, 0];
      _e.set(r[0], r[1], r[2], 'XYZ');
      _q.setFromEuler(_e);
      this.rig.joints[j].quaternion.slerp(_q, k);
    }
    // extras
    const e = this.extras;
    e.hipsY = lerp(e.hipsY, ex.hipsY, damp(rate, dt));
    e.pitch = lerp(e.pitch, ex.pitch, inp.state === AnimState.Roll ? 1 : damp(rate * 0.7, dt));
    e.roll = lerp(e.roll, ex.roll, damp(10, dt));
    this.squashImpulse = Math.max(0, this.squashImpulse - dt * 6);
    const sq = this.squashImpulse;
    const hips = this.rig.joints.hips;
    hips.position.y = this.rig.rest.hips.y + e.hipsY - sq * 0.12;
    // rotate the body around a pivot at waist height instead of the feet
    const P = 0.55;
    this.rig.body.rotation.x = e.pitch;
    this.rig.body.rotation.z = e.roll;
    this.rig.body.position.set(P * Math.sin(e.roll), P - P * Math.cos(e.pitch) * Math.cos(e.roll), -P * Math.sin(e.pitch));
    this.rig.body.scale.set(1 + sq * 0.06, 1 - sq * 0.08, 1 + sq * 0.06);
    this.rig.updateFace(dt);
  }

  // ------------------------------------------------------------- poses

  private idle(p: Pose, ex: PoseExtras) {
    const b = Math.sin(this.time * 1.8);
    p.spine = [0.03 + b * 0.015, 0, 0];
    p.chest = [b * 0.02, 0, 0];
    p.head = [-0.04, Math.sin(this.time * 0.37) * 0.25, Math.sin(this.time * 0.5) * 0.04];
    p.armL = [0.05, 0, 0.12 + b * 0.02];
    p.armR = [0.05, 0, -0.12 - b * 0.02];
    p.elbowL = [-0.25, 0, 0];
    p.elbowR = [-0.25, 0, 0];
    p.thighL = [0, 0, 0.04];
    p.thighR = [0, 0, -0.04];
    p.kneeL = [0.05, 0, 0];
    p.kneeR = [0.05, 0, 0];
    ex.hipsY = b * 0.006;
  }

  private guard(p: Pose, ex: PoseExtras) {
    p.spine = [0.12, 0, 0];
    p.armL = [-0.9, 0, 0.25];
    p.armR = [-0.9, 0, -0.25];
    p.elbowL = [-1.9, 0, 0];
    p.elbowR = [-1.9, 0, 0];
    p.thighL = [-0.3, 0, 0.12];
    p.thighR = [0.25, 0, -0.12];
    p.kneeL = [0.45, 0, 0];
    p.kneeR = [0.35, 0, 0];
    ex.hipsY = -0.06;
  }

  private locomotion(p: Pose, ex: PoseExtras, k: number) {
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const legA = 0.45 + 0.42 * k;
    const kneeA = 0.55 + 0.9 * k;
    p.thighL = [-s * legA - 0.05 * k, 0, 0.03];
    p.thighR = [s * legA - 0.05 * k, 0, -0.03];
    p.kneeL = [Math.max(0, c) * kneeA + 0.12, 0, 0];
    p.kneeR = [Math.max(0, -c) * kneeA + 0.12, 0, 0];
    p.footL = [-0.15 * s, 0, 0];
    p.footR = [0.15 * s, 0, 0];
    const armA = 0.45 + 0.55 * k;
    p.armL = [s * armA, 0, 0.14];
    p.armR = [-s * armA, 0, -0.14];
    p.elbowL = [-0.8 - 0.6 * k, 0, 0];
    p.elbowR = [-0.8 - 0.6 * k, 0, 0];
    p.hips = [0, -s * 0.12, 0];
    p.spine = [0.06 + 0.16 * k, 0, 0];
    p.chest = [0.02, s * 0.2, 0];
    p.head = [-0.08 - 0.12 * k, 0, 0];
    ex.hipsY = Math.abs(c) * 0.045 * k - 0.035 * k;
  }

  private air(p: Pose, ex: PoseExtras, vy: number) {
    const flail = Math.sin(this.time * 11);
    if (vy > 1.5) {
      p.thighL = [-1.0, 0, 0.05];
      p.kneeL = [1.3, 0, 0];
      p.thighR = [0.35, 0, -0.05];
      p.kneeR = [0.7, 0, 0];
      p.armL = [-0.4, 0, 0.7];
      p.armR = [0.5, 0, -0.6];
      p.elbowL = [-0.6, 0, 0];
      p.elbowR = [-0.4, 0, 0];
      p.spine = [0.15, 0, 0];
      p.head = [-0.15, 0, 0];
    } else {
      // falling: arms out wide for balance (reference 3.0 s)
      const f = clamp(-vy / 12, 0, 1);
      p.armL = [-0.2 + flail * 0.15 * f, 0, 0.9 + f * 0.5];
      p.armR = [-0.2 - flail * 0.15 * f, 0, -0.9 - f * 0.5];
      p.elbowL = [-0.3, 0, 0];
      p.elbowR = [-0.3, 0, 0];
      p.thighL = [-0.5 + flail * 0.2 * f, 0, 0.12 + 0.15 * f];
      p.thighR = [0.1 - flail * 0.2 * f, 0, -0.12 - 0.15 * f];
      p.kneeL = [0.7, 0, 0];
      p.kneeR = [0.5, 0, 0];
      p.spine = [0.05, 0, 0];
      p.head = [0.1 * f, 0, 0];
    }
    ex.hipsY = 0.05;
  }

  private wallRun(p: Pose, ex: PoseExtras, side: number) {
    // side: +1 wall on the right, -1 wall on the left
    ex.roll = -side * 0.38;
    if (side > 0) {
      p.armR = [-0.4, 0, -1.25];
      p.elbowR = [-0.2, 0, 0];
    } else {
      p.armL = [-0.4, 0, 1.25];
      p.elbowL = [-0.2, 0, 0];
    }
    p.head = [-0.1, -side * 0.25, 0];
  }

  private wallClimb(p: Pose, ex: PoseExtras) {
    const s = Math.sin(this.time * 16);
    p.armL = [-2.5 + s * 0.45, 0, 0.2];
    p.armR = [-2.5 - s * 0.45, 0, -0.2];
    p.elbowL = [-0.5, 0, 0];
    p.elbowR = [-0.5, 0, 0];
    p.thighL = [-0.9 - s * 0.5, 0, 0.05];
    p.thighR = [-0.9 + s * 0.5, 0, -0.05];
    p.kneeL = [1.4, 0, 0];
    p.kneeR = [1.4, 0, 0];
    p.head = [-0.5, 0, 0];
    ex.pitch = -0.1;
  }

  private slide(p: Pose, ex: PoseExtras) {
    p.spine = [-0.55, 0, 0];
    p.chest = [-0.1, 0.2, 0];
    p.head = [0.45, 0, 0];
    p.thighL = [-1.35, 0, 0.05];
    p.kneeL = [0.15, 0, 0];
    p.thighR = [-0.5, 0, -0.1];
    p.kneeR = [1.7, 0, 0];
    p.armL = [-0.5, 0, 0.6];
    p.armR = [0.6, 0, -0.9];
    p.elbowL = [-0.6, 0, 0];
    p.elbowR = [-0.2, 0, 0];
    ex.hipsY = -0.36;
  }

  private mantle(p: Pose, ex: PoseExtras, t: number) {
    const push = clamp((t - 0.35) / 0.4, 0, 1);
    p.armL = [lerp(-2.6, -0.4, push), 0, 0.25];
    p.armR = [lerp(-2.6, -0.4, push), 0, -0.25];
    p.elbowL = [lerp(-0.3, -0.1, push), 0, 0];
    p.elbowR = [lerp(-0.3, -0.1, push), 0, 0];
    p.thighL = [-1.3, 0, 0.1];
    p.thighR = [-0.6, 0, -0.1];
    p.kneeL = [1.7, 0, 0];
    p.kneeR = [1.2, 0, 0];
    p.spine = [0.35 + push * 0.2, 0, 0];
    p.head = [-0.3, 0, 0];
    ex.hipsY = -0.05;
  }

  private attack(p: Pose, ex: PoseExtras, id: AttackId, t: number) {
    const e = strike(t);
    switch (id) {
      case AttackId.Jab:
        p.chest = [0.05, 0.45 * e, 0];
        p.armR = [lerp(-0.9, -1.55, Math.max(0, e)), 0, -0.1];
        p.elbowR = [lerp(-1.9, -0.05, Math.max(0, e)), 0, 0];
        break;
      case AttackId.Cross:
        p.chest = [0.05, -0.5 * e, 0];
        p.armL = [lerp(-0.9, -1.55, Math.max(0, e)), 0, 0.1];
        p.elbowL = [lerp(-1.9, -0.05, Math.max(0, e)), 0, 0];
        break;
      case AttackId.Kick:
        p.spine = [-0.25 * e, 0.2, 0];
        p.thighR = [lerp(0.2, -1.55, Math.max(0, e)), 0, -0.1];
        p.kneeR = [lerp(1.2, 0.1, Math.max(0, e)), 0, 0];
        p.armL = [-0.6, 0, 0.8];
        p.armR = [0.4, 0, -0.9];
        break;
      case AttackId.Tackle:
        p.spine = [0.55, 0, 0];
        p.chest = [0.15, -0.55, 0];
        p.head = [-0.35, 0.3, 0];
        p.armL = [-0.35, 0, 0.25];
        p.elbowL = [-2.2, 0, 0];
        p.armR = [0.5, 0, -0.3];
        p.elbowR = [-1.4, 0, 0];
        p.thighL = [-0.9, 0, 0.05];
        p.kneeL = [0.7, 0, 0];
        p.thighR = [0.6, 0, -0.05];
        p.kneeR = [0.4, 0, 0];
        ex.pitch = 0.15;
        ex.hipsY = -0.08;
        break;
      case AttackId.Uppercut:
        p.chest = [lerp(0.4, -0.3, Math.max(0, e)), 0.4, 0];
        p.armR = [lerp(0.7, -2.7, Math.max(0, e)), 0, -0.2];
        p.elbowR = [lerp(-1.6, -0.4, Math.max(0, e)), 0, 0];
        ex.hipsY = lerp(-0.18, 0.05, Math.max(0, e));
        break;
      case AttackId.Stomp:
        p.armL = [-0.2, 0, 2.2];
        p.armR = [-0.2, 0, -2.2];
        p.thighL = [-0.1, 0, 0.15];
        p.thighR = [-0.1, 0, -0.15];
        p.kneeL = [0.3, 0, 0];
        p.kneeR = [0.3, 0, 0];
        p.head = [0.4, 0, 0];
        break;
      case AttackId.AirKick:
      case AttackId.FlyingKick:
        p.spine = [-0.35, 0, 0];
        p.thighR = [lerp(0.3, -1.6, Math.max(0, e)), 0, -0.05];
        p.kneeR = [lerp(1.3, 0.05, Math.max(0, e)), 0, 0];
        p.thighL = [-0.2, 0, 0.1];
        p.kneeL = [1.6, 0, 0];
        p.armL = [-0.4, 0, 1.0];
        p.armR = [0.3, 0, -1.1];
        ex.pitch = -0.15 * Math.max(0, e);
        break;
      case AttackId.SlideKick:
        this.slide(p, ex);
        p.thighL = [-1.5, 0.3 * e, 0.3];
        break;
    }
  }

  private hit(p: Pose, ex: PoseExtras, strength: number) {
    p.spine = [-0.45 * strength, 0, 0.1];
    p.chest = [-0.2, 0.2, 0];
    p.head = [-0.45, 0.2, 0];
    p.armL = [-0.8, 0, 0.6];
    p.armR = [-0.6, 0, -0.8];
    p.elbowL = [-0.4, 0, 0];
    p.elbowR = [-0.4, 0, 0];
    p.thighL = [0.3, 0, 0.1];
    p.kneeL = [0.6, 0, 0];
    ex.hipsY = -0.06;
  }

  private dodge(p: Pose, ex: PoseExtras, side: number) {
    p.spine = [0.3, 0, side * 0.35];
    p.armL = [-0.9, 0, 0.6];
    p.armR = [-0.9, 0, -0.6];
    p.elbowL = [-1.6, 0, 0];
    p.elbowR = [-1.6, 0, 0];
    p.thighL = [-0.8, 0, 0.3];
    p.thighR = [-0.2, 0, -0.3];
    p.kneeL = [1.2, 0, 0];
    p.kneeR = [1.0, 0, 0];
    ex.hipsY = -0.22;
    ex.roll = -side * 0.15;
  }

  private catchPose(p: Pose, ex: PoseExtras, grounded: boolean) {
    ex.hipsY = grounded ? -0.04 : 0.05;
    p.armR = [-2.15, 0.2, -0.35];
    p.elbowR = [-0.35, 0, 0];
    p.armL = [-0.3, 0, 1.0];
    p.elbowL = [-0.3, 0, 0];
    p.head = [-0.25, 0.15, 0];
    p.chest = [-0.1, 0.25, 0];
    if (!grounded) {
      // starfish float (reference 5.0 s)
      p.thighL = [-0.3, 0, 0.35];
      p.thighR = [0.1, 0, -0.35];
      p.kneeL = [0.5, 0, 0];
      p.kneeR = [0.3, 0, 0];
    }
  }

  private absorb(p: Pose, ex: PoseExtras, t: number) {
    // hand pushes the eye into the chest (reference 6.5 s)
    const push = clamp(t * 1.6, 0, 1);
    p.armR = [lerp(-1.6, -0.75, push), 0, lerp(-0.3, 0.45, push)];
    p.elbowR = [lerp(-0.6, -2.0, push), 0.0, 0];
    p.armL = [-0.2, 0, 0.35];
    p.elbowL = [-0.4, 0, 0];
    p.head = [0.35, 0.05, 0];
    p.spine = [0.18 + push * 0.12, 0, 0];
    p.chest = [0.1, -0.15, 0];
    ex.hipsY = -0.04 - push * 0.04;
  }

  private charge(p: Pose, ex: PoseExtras, t: number) {
    const c = clamp(t, 0, 1);
    p.thighL = [-0.8 - c * 0.4, 0, 0.15];
    p.thighR = [-0.8 - c * 0.4, 0, -0.15];
    p.kneeL = [1.4 + c * 0.5, 0, 0];
    p.kneeR = [1.4 + c * 0.5, 0, 0];
    p.footL = [-0.5, 0, 0];
    p.footR = [-0.5, 0, 0];
    p.spine = [0.5, 0, 0];
    p.armL = [0.9, 0, 0.35];
    p.armR = [0.9, 0, -0.35];
    p.head = [-0.4, 0, 0];
    ex.hipsY = -0.22 - c * 0.12;
  }

  private dash(p: Pose, ex: PoseExtras) {
    this.locomotion(p, ex, 1.5);
    p.spine = [0.55, 0, 0];
    p.armL = [1.1, 0, 0.3];
    p.armR = [1.1, 0, -0.3];
    p.elbowL = [-0.1, 0, 0];
    p.elbowR = [-0.1, 0, 0];
    p.head = [-0.4, 0, 0];
  }

  private emote(p: Pose, ex: PoseExtras) {
    const t = this.time * 6.5;
    const s = Math.sin(t);
    p.hips = [0, s * 0.2, s * 0.1];
    p.spine = [0, 0, -s * 0.15];
    p.armL = [-0.3 + Math.sin(t * 2) * 0.3, 0, 1.4 + s * 0.4];
    p.armR = [-0.3 - Math.sin(t * 2) * 0.3, 0, -1.4 + s * 0.4];
    p.elbowL = [-1.0, 0, 0];
    p.elbowR = [-1.0, 0, 0];
    p.head = [Math.abs(s) * 0.2, -s * 0.2, 0];
    p.thighL = [-Math.max(0, s) * 0.6, 0, 0.1];
    p.thighR = [-Math.max(0, -s) * 0.6, 0, -0.1];
    p.kneeL = [Math.max(0, s) * 1.0, 0, 0];
    p.kneeR = [Math.max(0, -s) * 1.0, 0, 0];
    ex.hipsY = -Math.abs(s) * 0.05;
  }

  private ko(p: Pose, ex: PoseExtras) {
    p.spine = [-0.2, 0, 0.3];
    p.head = [0.5, 0, 0.3];
    p.armL = [-0.2, 0, 1.4];
    p.armR = [-0.2, 0, -1.4];
    p.thighL = [-1.4, 0, 0.3];
    p.thighR = [-1.4, 0, -0.3];
    p.kneeL = [0.2, 0, 0];
    p.kneeR = [0.2, 0, 0];
    ex.pitch = -1.45;
    ex.hipsY = -0.55;
  }

  /** Seated driving pose; param = steering (-1..1) leans the body and arms. */
  private sit(p: Pose, ex: PoseExtras, steer: number) {
    p.thighL = [-1.45, 0, 0.12];
    p.thighR = [-1.45, 0, -0.12];
    p.kneeL = [1.35, 0, 0];
    p.kneeR = [1.35, 0, 0];
    p.spine = [0.05, 0, steer * 0.12];
    p.armL = [-1.1, 0, 0.2 - steer * 0.25];
    p.armR = [-1.1, 0, -0.2 - steer * 0.25];
    p.elbowL = [-0.7, 0, 0];
    p.elbowR = [-0.7, 0, 0];
    p.head = [-0.05, steer * 0.3, 0];
    ex.hipsY = -0.02;
  }

  private roll(p: Pose, ex: PoseExtras, t: number) {
    p.spine = [0.8, 0, 0];
    p.head = [0.6, 0, 0];
    p.thighL = [-2.0, 0, 0.1];
    p.thighR = [-2.0, 0, -0.1];
    p.kneeL = [2.2, 0, 0];
    p.kneeR = [2.2, 0, 0];
    p.armL = [-1.2, 0, 0.3];
    p.armR = [-1.2, 0, -0.3];
    p.elbowL = [-1.5, 0, 0];
    p.elbowR = [-1.5, 0, 0];
    ex.pitch = t * Math.PI * 2;
    ex.hipsY = -0.35 * Math.sin(t * Math.PI);
  }
}
