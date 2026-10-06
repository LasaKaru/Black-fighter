import * as THREE from 'three';
import { CharacterRig } from '../character/CharacterRig';
import { Animator, AnimState, AttackId, packAttack } from '../character/Animator';
import type { Appearance } from '../character/Appearance';
import type { CharacterBody, RayHit, Surface } from '../physics/Physics';
import type { GameContext } from '../core/GameContext';
import { TUNING, jumpVelocity } from '../../shared/tuning';
import { clamp, damp, dampAngle, lerp, moveTowards, wrapAngle } from '../core/math';
import { ATTACKS, HitInfo, Hittable, queryHits } from './Combat';
import type { EyeType } from '../world/City';
import { PALETTE } from '../world/Materials';

export enum PState {
  Ground,
  Air,
  WallRun,
  WallClimb,
  Mantle,
  Slide,
  Dodge,
  Attack,
  Dash,
  Charge,
  Catch,
  Absorb,
  Hit,
  Roll,
  KO,
  Emote,
  Stagger,
}

export const FLOW_TIERS = ['Cold', 'Warm', 'Hot', 'Inked', 'BLACKEYE'] as const;

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _move = new THREE.Vector3();
const _fwd = new THREE.Vector3();

interface MantleData {
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  vault: boolean;
  keepVel: THREE.Vector3;
}

export class Player implements Hittable {
  readonly key = 'local';
  readonly radius = 0.4;
  alive = true;
  rig: CharacterRig;
  anim: Animator;
  body: CharacterBody;
  readonly feet = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = Math.PI;
  state = PState.Ground;
  stateTime = 0;
  grounded = true;
  private coyote = 0;
  private airPeakY = 0;
  private airDodgeUsed = false;
  private climbUsed = false;
  private wallNormal = new THREE.Vector3();
  private wallSide = 0;
  private lastWallNormal = new THREE.Vector3();
  private wallCooldown = 0;
  private mantle: MantleData | null = null;
  private dodgeDir = new THREE.Vector3();
  private attackId = AttackId.Jab;
  private attackHitSet = new Set<string>();
  private combo = 0;
  private comboQueued = false;
  private comboReset = 0;
  private dashDir = new THREE.Vector3();
  private chargeT = 0;
  private catchType: EyeType = 'fire';
  private onCatchDone: (() => void) | null = null;
  private iframes = 0;
  private rollPending = 0;
  private stepTimer = 0;
  private lastSurface: Surface = 'concrete';
  private sprinting = false;

  health = 100;
  stamina: number = TUNING.stamina;
  eyes: Record<EyeType, number> = { fire: 0, sky: 0, void: 0 };
  selectedPower: EyeType = 'fire';
  flow = 0;
  private flowIdle = 0;
  checkpoint = new THREE.Vector3();
  /** Seconds since last damage (for health regen). */
  private sinceHurt = 10;
  firstPerson = false;
  private lastAnimState = AnimState.Idle;
  private lastAnimParam = 0;

  constructor(private ctx: GameContext, appearance: Appearance, spawn: THREE.Vector3, yaw: number) {
    this.rig = new CharacterRig(appearance);
    this.anim = new Animator(this.rig);
    ctx.renderer.scene.add(this.rig.root);
    this.body = ctx.physics.createCharacter(spawn, TUNING.radius, TUNING.halfHeight);
    this.feet.copy(spawn);
    this.yaw = yaw;
    this.checkpoint.copy(spawn);
    this.rig.root.position.copy(spawn);
  }

  setAppearance(a: Appearance) {
    this.rig.dispose();
    this.rig = new CharacterRig(a);
    this.anim = new Animator(this.rig);
    this.ctx.renderer.scene.add(this.rig.root);
  }

  get flowTier(): number {
    return this.flow >= 95 ? 4 : this.flow >= 70 ? 3 : this.flow >= 45 ? 2 : this.flow >= 20 ? 1 : 0;
  }

  addFlow(n: number) {
    this.flow = clamp(this.flow + n, 0, 100);
    this.flowIdle = 0;
  }

  center(out: THREE.Vector3) {
    return out.copy(this.feet).add(_w.set(0, 1.0, 0));
  }

  headWorld(out: THREE.Vector3) {
    return this.rig.headSocket.getWorldPosition(out);
  }

  facing(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  private setState(s: PState) {
    this.state = s;
    this.stateTime = 0;
  }

  // ------------------------------------------------------------ queries

  private ray(origin: THREE.Vector3, dir: THREE.Vector3, dist: number): RayHit | null {
    return this.ctx.physics.raycast(origin, dir, dist);
  }

  /** Detect a climbable ledge in front: returns the standing point on top and its height above the feet. */
  private findLedge(fwd: THREE.Vector3, maxH: number = TUNING.mantleMax): { top: THREE.Vector3; h: number; normal: THREE.Vector3 } | null {
    let wall: RayHit | null = null;
    for (const hgt of [0.5, 1.0, 1.5]) {
      const o = this.feet.clone().add(_v.set(0, hgt, 0));
      const h = this.ray(o, fwd, 0.95);
      if (h && Math.abs(h.normal.y) < 0.35) {
        wall = h;
        break;
      }
    }
    if (!wall) return null;
    const n = wall.normal.clone().setY(0).normalize();
    const probe = wall.point.clone().addScaledVector(n, -0.4);
    probe.y = this.feet.y + maxH + 0.6;
    const down = this.ray(probe, _v.set(0, -1, 0), maxH + 0.6);
    if (!down || down.normal.y < 0.7) return null;
    const h = down.point.y - this.feet.y;
    if (h < TUNING.vaultMin * 0.6 || h > maxH) return null;
    // need head clearance on top
    const clear = this.ray(down.point.clone().add(_v.set(0, 0.05, 0)), UP, 1.7);
    if (clear) return null;
    return { top: down.point.clone(), h, normal: n };
  }

  /** After a low obstacle, is there free ground beyond it to vault onto? */
  private vaultLanding(top: THREE.Vector3, fwd: THREE.Vector3): THREE.Vector3 | null {
    for (const d of [0.8, 1.2, 1.6]) {
      const p = top.clone().addScaledVector(fwd, d);
      p.y += 0.3;
      const down = this.ray(p, _v.set(0, -1, 0), 3);
      if (down && down.point.y < top.y - 0.3 && down.normal.y > 0.7) {
        // make sure the path over is clear at chest height
        const over = this.ray(top.clone().add(_v.set(0, 0.5, 0)), fwd, d + 0.4);
        if (over) return null;
        return down.point.clone().addScaledVector(fwd, 0.5);
      }
    }
    return null;
  }

  private findWall(dirs: THREE.Vector3[], dist: number): { hit: RayHit; idx: number } | null {
    const o = this.feet.clone().add(_v.set(0, 1.0, 0));
    for (let i = 0; i < dirs.length; i++) {
      const h = this.ray(o, dirs[i], dist);
      if (h && Math.abs(h.normal.y) < 0.25) return { hit: h, idx: i };
    }
    return null;
  }

  private groundSurface(): Surface {
    const h = this.ray(this.feet.clone().add(_v.set(0, 0.2, 0)), _v.set(0, -1, 0), 0.6);
    return h ? h.surface : this.lastSurface;
  }

  // ------------------------------------------------------------ input helpers

  /** Desired move direction in world space (length ≤ 1) relative to the camera. */
  private wish(out: THREE.Vector3): THREE.Vector3 {
    const m = this.ctx.input.moveVector();
    const cy = this.ctx.cameraRig.yaw;
    const fx = Math.sin(cy);
    const fz = Math.cos(cy);
    // camera right = (-fz, 0, fx)
    return out.set(fx * m.y - fz * m.x, 0, fz * m.y + fx * m.x);
  }

  // ------------------------------------------------------------ main update

  update(dt: number) {
    const ctx = this.ctx;
    const input = ctx.input;
    this.stateTime += dt;
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.rollPending = Math.max(0, this.rollPending - dt);
    this.comboReset -= dt;
    if (this.comboReset <= 0) this.combo = 0;
    this.sinceHurt += dt;
    if (this.sinceHurt > 4 && this.health < 100 && this.state !== PState.KO) this.health = Math.min(100, this.health + dt * 12);

    // flow decay
    this.flowIdle += dt;
    if (this.flowIdle > 1.5) this.flow = Math.max(0, this.flow - dt * 18);

    const wish = this.wish(_move);
    const wishLen = wish.length();
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);

    // power selection
    if (input.consume('power1')) this.selectPower('fire');
    if (input.consume('power2')) this.selectPower('sky');
    if (input.consume('power3')) this.selectPower('void');
    if (input.consume('nextPower')) this.cyclePower(1);
    if (input.consume('prevPower')) this.cyclePower(-1);
    if (input.consume('crouch')) this.rollPending = TUNING.rollWindow;

    const canAct = [PState.Ground, PState.Air, PState.Slide, PState.WallRun].includes(this.state);
    if (canAct && input.consume('emote') && this.state === PState.Ground) {
      this.setState(PState.Emote);
      ctx.emit('emote');
    }

    let gravityScale = 1;

    switch (this.state) {
      // ------------------------------------------------ GROUND
      case PState.Ground: {
        this.sprinting = input.down('sprint') && this.stamina > 1 && wishLen > 0.3;
        if (ctx.input.padActive && wishLen > 0.95 && !input.down('sprint')) this.sprinting = this.sprinting || hSpeed > 7.5;
        const bonus = 1 + this.flowTier * 0.035;
        const target = (wishLen < 0.5 ? TUNING.walkSpeed + (TUNING.runSpeed - TUNING.walkSpeed) * (wishLen / 0.5) * 0.4 : this.sprinting ? TUNING.sprintSpeed : TUNING.runSpeed) * bonus;
        const surface = this.groundSurface();
        this.lastSurface = surface;
        const friction = surface === 'goo' ? 0.12 : 1;
        this.accelerate(wish, target * Math.min(1, wishLen * 1.2), TUNING.accelGround * (surface === 'goo' ? 0.35 : 1), TUNING.decelGround * friction, dt);
        if (surface === 'goo') this.slopeBoost(dt, 6);
        if (this.sprinting) this.stamina = Math.max(0, this.stamina - TUNING.sprintDrain * dt);
        else this.stamina = Math.min(TUNING.stamina, this.stamina + TUNING.staminaRegen * dt);
        if (hSpeed > 0.5) this.faceTowards(this.vel.x, this.vel.z, dt, TUNING.turnRate);
        if (this.firstPerson) this.yaw = ctx.cameraRig.yaw;

        // footsteps
        this.stepTimer -= dt * hSpeed;
        if (this.stepTimer <= 0 && hSpeed > 1) {
          this.stepTimer = 1.6;
          ctx.audio.play('step', { pitch: surface === 'goo' ? 0.6 : surface === 'ink' ? 0.8 : 1, vol: 0.5 + hSpeed / 20 });
          if (surface === 'goo' || surface === 'ink') ctx.effects.dust(this.feet, 2, surface === 'goo' ? PALETTE.voidPurple : '#1a1a1e', 0.25, 1);
        }

        if (this.tryCombatInput(true, hSpeed)) break;
        if (input.buffered('jump')) {
          const f = hSpeed > 0.5 ? _fwd.set(this.vel.x, 0, this.vel.z).normalize() : this.facing(_fwd);
          if (wishLen > 0.2 && this.tryParkour(f, true, hSpeed)) {
            input.consume('jump');
            break;
          }
          input.consume('jump');
          this.jump(1);
          break;
        }
        // simple parkour: auto-vault while running into low obstacles
        if (ctx.settings.simpleParkour && hSpeed > 4 && wishLen > 0.5) {
          const f = _fwd.set(this.vel.x, 0, this.vel.z).normalize();
          if (this.tryParkour(f, false, hSpeed)) break;
        }
        if (this.rollPending > 0 && hSpeed > 5) {
          this.rollPending = 0;
          this.setState(PState.Slide);
          ctx.audio.play('whoosh', { pitch: 0.7 });
          ctx.effects.dust(this.feet, 6, '#e8e6e2', 0.4);
          ctx.emit('slide');
          this.addFlow(4);
          break;
        }
        break;
      }

      // ------------------------------------------------ AIR
      case PState.Air: {
        this.accelerate(wish, Math.max(TUNING.runSpeed, hSpeed), TUNING.accelGround * TUNING.airControl, 0, dt);
        if (hSpeed > 0.5 && !this.firstPerson) this.faceTowards(this.vel.x, this.vel.z, dt, TUNING.turnRate * 0.5);
        if (this.firstPerson) this.yaw = ctx.cameraRig.yaw;
        this.airPeakY = Math.max(this.airPeakY, this.feet.y);
        this.coyote -= dt;
        if (this.coyote > 0 && input.consume('jump')) {
          this.jump(1);
          break;
        }
        // variable jump height
        if (this.vel.y > 0 && !input.down('jump') && this.stateTime > 0.06) gravityScale = TUNING.gravityDown / TUNING.gravityUp;
        if (this.tryCombatInput(false, hSpeed)) break;

        const f = hSpeed > 0.5 ? _fwd.set(this.vel.x, 0, this.vel.z).normalize() : this.facing(_fwd);
        // ledge grab / mantle
        if (this.vel.y < 6 && (wishLen > 0.3 || input.buffered('jump'))) {
          if (this.tryParkour(f, false, hSpeed)) break;
        }
        // wall run
        if (this.wallCooldown <= 0 && hSpeed > TUNING.wallRunMinSpeed && wishLen > 0.3 && this.vel.y < 5) {
          const right = _v.set(-f.z, 0, f.x).clone();
          const wall = this.findWall([right, right.clone().multiplyScalar(-1)], 0.85);
          if (wall) {
            const n = wall.hit.normal.clone().setY(0).normalize();
            const sameWall = n.dot(this.lastWallNormal) > 0.95;
            if (!sameWall && Math.abs(f.dot(n)) < 0.8) {
              this.startWallRun(n, wall.idx === 0 ? 1 : -1);
              break;
            }
          }
        }
        // wall climb: head-on into a wall right after a jump
        if (!this.climbUsed && input.buffered('jump') && this.vel.y > -4) {
          const wall = this.findWall([f], 0.75);
          if (wall && wall.hit.normal.dot(f) < -0.7) {
            input.consume('jump');
            this.climbUsed = true;
            this.wallNormal.copy(wall.hit.normal).setY(0).normalize();
            this.setState(PState.WallClimb);
            ctx.audio.play('whoosh', { pitch: 1.2 });
            ctx.emit('wallrun');
            break;
          }
        }
        break;
      }

      // ------------------------------------------------ WALL RUN
      case PState.WallRun: {
        const n = this.wallNormal;
        const along = this.vel.clone().setY(0);
        along.addScaledVector(n, -along.dot(n));
        if (along.lengthSq() < 0.01) along.set(-n.z, 0, n.x);
        along.normalize();
        const sp = Math.max(Math.hypot(this.vel.x, this.vel.z), 7);
        this.vel.x = along.x * sp - n.x * 1.5;
        this.vel.z = along.z * sp - n.z * 1.5;
        this.vel.y -= TUNING.wallRunGravity * dt;
        gravityScale = 0;
        this.faceTowards(along.x, along.z, dt, TUNING.turnRate);
        this.addFlow(6 * dt);
        this.stepTimer -= dt;
        if (this.stepTimer <= 0) {
          this.stepTimer = 0.14;
          ctx.audio.play('wallrun', { pitch: 0.9 + Math.random() * 0.2 });
          ctx.effects.dust(this.feet.clone().addScaledVector(n, -0.3).add(_v.set(0, 0.4, 0)), 1, '#e8e6e2', 0.25, 0.5);
        }
        const still = this.findWall([n.clone().multiplyScalar(-1)], 1.0);
        if (input.consume('jump')) {
          this.wallKick(n, along);
          break;
        }
        if (!still || this.stateTime > TUNING.wallRunTime || input.consume('crouch')) {
          this.lastWallNormal.copy(n);
          this.wallCooldown = 0.25;
          this.setState(PState.Air);
          this.coyote = 0.1;
        }
        break;
      }

      // ------------------------------------------------ WALL CLIMB
      case PState.WallClimb: {
        const n = this.wallNormal;
        this.vel.set(-n.x * 1.2, TUNING.wallClimbSpeed, -n.z * 1.2);
        gravityScale = 0;
        this.yaw = Math.atan2(-n.x, -n.z);
        const f = _fwd.set(-n.x, 0, -n.z);
        const ledge = this.findLedge(f, 1.9);
        if (ledge) {
          this.startMantle(ledge.top, false);
          break;
        }
        if (input.consume('jump')) {
          this.wallKick(n, f.clone().multiplyScalar(-1));
          break;
        }
        if (this.stateTime > TUNING.wallClimbTime || !this.findWall([f], 0.9)) {
          this.vel.set(n.x * 2, Math.min(this.vel.y, 2), n.z * 2);
          this.setState(PState.Air);
        }
        break;
      }

      // ------------------------------------------------ MANTLE / VAULT
      case PState.Mantle: {
        const m = this.mantle!;
        m.t += dt / m.dur;
        const t = Math.min(1, m.t);
        // rise first, then move over
        const rise = clamp(t / 0.6, 0, 1);
        const over = clamp((t - (m.vault ? 0.2 : 0.45)) / (m.vault ? 0.8 : 0.55), 0, 1);
        const p = new THREE.Vector3(
          lerp(m.from.x, m.to.x, over),
          m.vault ? lerp(m.from.y, m.to.y, t) + Math.sin(t * Math.PI) * 0.9 : lerp(m.from.y, m.to.y + 0.05, 1 - Math.pow(1 - rise, 2)),
          lerp(m.from.z, m.to.z, over),
        );
        this.ctx.physics.placeCharacter(this.body, p);
        this.feet.copy(p);
        if (t >= 1) {
          this.vel.copy(m.keepVel);
          this.vel.y = 0;
          this.setState(PState.Ground);
          this.grounded = true;
          ctx.effects.dust(this.feet, 4, '#e8e6e2', 0.35);
        }
        this.rig.root.position.copy(this.feet);
        this.rig.root.rotation.y = this.yaw;
        this.animate(dt);
        return;
      }

      // ------------------------------------------------ SLIDE
      case PState.Slide: {
        const surface = this.groundSurface();
        const fr = surface === 'goo' ? 0.4 : TUNING.slideFriction;
        const sp = Math.max(0, Math.hypot(this.vel.x, this.vel.z) - fr * dt);
        const dir = _fwd.set(this.vel.x, 0, this.vel.z).normalize();
        if (wishLen > 0.2) dir.lerp(wish.clone().normalize(), damp(2, dt)).normalize();
        this.vel.x = dir.x * sp;
        this.vel.z = dir.z * sp;
        if (surface === 'goo') this.slopeBoost(dt, 10);
        this.faceTowards(dir.x, dir.z, dt, TUNING.turnRate);
        if (Math.random() < 0.5) ctx.effects.dust(this.feet, 1, surface === 'goo' ? PALETTE.voidPurple : '#e8e6e2', 0.3, 0.8);
        if (input.consume('jump')) {
          // slide-jump: a long, low leap
          this.vel.x *= 1.15;
          this.vel.z *= 1.15;
          this.jump(0.85);
          break;
        }
        if (input.consume('light') || input.consume('heavy')) {
          this.startAttack(AttackId.SlideKick);
          break;
        }
        const maxT = surface === 'goo' ? 99 : TUNING.slideTime;
        if (this.stateTime > maxT || sp < 2.5 || (surface === 'goo' && !input.down('crouch') && this.stateTime > TUNING.slideTime)) this.setState(PState.Ground);
        if (!this.grounded) {
          this.setState(PState.Air);
          this.coyote = TUNING.coyoteTime;
        }
        break;
      }

      // ------------------------------------------------ DODGE / ROLL
      case PState.Dodge: {
        const k = 1 - this.stateTime / TUNING.dodgeTime;
        this.vel.x = this.dodgeDir.x * TUNING.dodgeSpeed * Math.max(0.3, k);
        this.vel.z = this.dodgeDir.z * TUNING.dodgeSpeed * Math.max(0.3, k);
        if (this.stateTime > TUNING.dodgeTime) this.setState(this.grounded ? PState.Ground : PState.Air);
        break;
      }
      case PState.Roll: {
        const dir = _fwd.set(this.vel.x, 0, this.vel.z);
        if (dir.lengthSq() < 0.01) this.facing(dir);
        dir.normalize();
        const sp = Math.max(5, Math.hypot(this.vel.x, this.vel.z));
        this.vel.x = dir.x * sp;
        this.vel.z = dir.z * sp;
        if (this.stateTime > 0.45) this.setState(PState.Ground);
        break;
      }

      // ------------------------------------------------ ATTACK
      case PState.Attack: {
        const def = ATTACKS[this.attackId];
        const t = this.stateTime / def.dur;
        const f = this.facing(_fwd);
        if (this.attackId === AttackId.Stomp) {
          this.vel.set(0, -26, 0);
          gravityScale = 0;
          if (this.grounded) {
            this.stompImpact();
            this.setState(PState.Ground);
          }
          break;
        }
        // lunge forward
        const lungeK = this.attackId === AttackId.Tackle ? 1 - t * 0.5 : t < 0.5 ? 1 : 0.2;
        const lunge = def.lunge * lungeK;
        if (this.grounded || this.attackId === AttackId.AirKick) {
          this.vel.x = moveTowards(this.vel.x, f.x * lunge, 60 * dt);
          this.vel.z = moveTowards(this.vel.z, f.z * lunge, 60 * dt);
        }
        if (this.attackId === AttackId.AirKick) gravityScale = 0.35;
        if (this.attackId === AttackId.SlideKick) {
          this.vel.x *= 1 - dt * 2;
          this.vel.z *= 1 - dt * 2;
        }
        // soft lock: rotate to nearest target early in the attack
        if (t < 0.3) this.softLock(dt);
        if (t >= def.hitStart && t <= def.hitEnd) this.resolveAttackHits(def.range, def.arc);
        if (this.attackId === AttackId.Tackle) this.trySmash(1.2);
        if (t > 0.45 && input.consume('light')) this.comboQueued = true;
        if (t >= 1) {
          if (this.comboQueued && this.combo < 3 && this.grounded) {
            this.comboQueued = false;
            this.startAttack(this.combo === 1 ? AttackId.Cross : AttackId.Kick);
          } else {
            this.setState(this.grounded ? PState.Ground : PState.Air);
          }
        }
        break;
      }

      // ------------------------------------------------ EYE POWERS
      case PState.Dash: {
        this.vel.set(this.dashDir.x * TUNING.dashSpeed, 0, this.dashDir.z * TUNING.dashSpeed);
        gravityScale = 0;
        ctx.effects.trailPoint(this.feet);
        this.resolveAttackHits(1.6, -0.2, { dir: this.dashDir.clone(), damage: 30, knock: 14, lift: 5, kind: 'dash' });
        this.trySmash(1.5);
        if (Math.random() < 0.6) ctx.effects.sparks3(this.feet.clone().add(_v.set(0, 0.9, 0)), PALETTE.eyeFire, 2, 3, 0.2, 0);
        if (this.stateTime > TUNING.dashTime) {
          ctx.effects.trailActive = false;
          this.vel.multiplyScalar(0.55);
          this.setState(this.grounded ? PState.Ground : PState.Air);
          this.airPeakY = this.feet.y;
        }
        break;
      }
      case PState.Charge: {
        this.vel.x *= 1 - dt * 8;
        this.vel.z *= 1 - dt * 8;
        this.chargeT = Math.min(1, this.stateTime / TUNING.superJumpChargeTime);
        if (Math.random() < 0.5) ctx.effects.dust(this.feet, 1, '#ffffff', 0.4, 1.5);
        if (!input.down('power') || this.stateTime > TUNING.superJumpChargeTime + 0.4) this.superJump();
        break;
      }
      case PState.Catch: {
        this.vel.multiplyScalar(1 - dt * 6);
        gravityScale = this.grounded ? 1 : 0.05;
        if (this.stateTime > 0.55) {
          this.setState(PState.Absorb);
          this.rig.setExpression('halfLid', 1);
          ctx.audio.play('absorb');
          const target = () => this.rig.chestSocket.getWorldPosition(new THREE.Vector3());
          const col = this.catchType === 'fire' ? PALETTE.eyeFire : this.catchType === 'sky' ? '#ffffff' : PALETTE.voidPurple;
          ctx.effects.absorbSpiral(this.rig.handSocketR.getWorldPosition(new THREE.Vector3()), target, col, 46);
          ctx.cameraRig.startCinematic('absorb', 0.7, target, this.yaw);
        }
        break;
      }
      case PState.Absorb: {
        this.vel.multiplyScalar(1 - dt * 6);
        gravityScale = this.grounded ? 1 : 0.15;
        if (this.stateTime > 0.6) {
          const cb = this.onCatchDone;
          this.onCatchDone = null;
          cb?.();
          ctx.emit('absorb', this.catchType);
          ctx.broadcastFx('absorb', this.feet);
          ctx.effects.sparks3(this.rig.chestSocket.getWorldPosition(new THREE.Vector3()), PALETTE.eyeFire, 30, 7);
          ctx.renderer.flash('#ffb066', ctx.settings.reduceFlashes ? 0.05 : 0.25);
          ctx.cameraRig.addShake(0.25);
          this.setState(this.grounded ? PState.Ground : PState.Air);
        }
        break;
      }

      // ------------------------------------------------ HIT / KO / EMOTE
      case PState.Hit:
      case PState.Stagger: {
        this.vel.x = moveTowards(this.vel.x, 0, 14 * dt);
        this.vel.z = moveTowards(this.vel.z, 0, 14 * dt);
        if (this.stateTime > (this.state === PState.Stagger ? 0.5 : 0.38)) this.setState(this.grounded ? PState.Ground : PState.Air);
        break;
      }
      case PState.KO: {
        this.vel.x *= 1 - dt * 3;
        this.vel.z *= 1 - dt * 3;
        if (this.stateTime > 2.2) this.respawn();
        break;
      }
      case PState.Emote: {
        this.vel.x *= 1 - dt * 10;
        this.vel.z *= 1 - dt * 10;
        if (wishLen > 0.2 || input.buffered('jump')) this.setState(PState.Ground);
        break;
      }
    }

    // ---------------------------------------------- integrate
    if (gravityScale > 0) {
      const g = this.vel.y > 0 ? TUNING.gravityUp : TUNING.gravityDown;
      this.vel.y = Math.max(-TUNING.terminalVelocity, this.vel.y - g * gravityScale * dt);
    }

    const want = this.vel.clone().multiplyScalar(dt);
    const actual = new THREE.Vector3();
    const res = ctx.physics.moveCharacter(this.body, want, actual);
    const wasGrounded = this.grounded;
    this.grounded = res.grounded && this.vel.y <= 0.5;
    if (res.hitCeiling && this.vel.y > 0) this.vel.y = 0;
    // feet position = previous + actual movement (kinematic body moves next step)
    this.feet.add(actual);
    // remove velocity blocked by walls so it does not build up
    if (dt > 0) {
      const ax = actual.x / dt;
      const az = actual.z / dt;
      if (Math.abs(ax) < Math.abs(this.vel.x) * 0.9 && this.state !== PState.WallRun) this.vel.x = ax;
      if (Math.abs(az) < Math.abs(this.vel.z) * 0.9 && this.state !== PState.WallRun) this.vel.z = az;
    }

    if (this.grounded) {
      if (this.vel.y < 0) this.vel.y = 0;
      this.coyote = TUNING.coyoteTime;
      this.climbUsed = false;
      this.airDodgeUsed = false;
      this.lastWallNormal.set(0, 0, 0);
      if (!wasGrounded || this.state === PState.Air || this.state === PState.WallRun || this.state === PState.WallClimb) this.onLand();
    } else if (wasGrounded && (this.state === PState.Ground || this.state === PState.Emote)) {
      this.setState(PState.Air);
      this.airPeakY = this.feet.y;
    }

    // kill plane
    if (this.feet.y < TUNING.killPlaneY) this.respawn();
    this.updateCheckpoint();

    this.rig.root.position.copy(this.feet);
    this.rig.root.rotation.y = this.yaw;
    this.animate(dt);
  }

  // ------------------------------------------------------------ movement helpers

  private accelerate(wish: THREE.Vector3, speed: number, accel: number, decel: number, dt: number) {
    const tx = wish.x * speed;
    const tz = wish.z * speed;
    const len = Math.hypot(wish.x, wish.z);
    const a = len > 0.05 ? accel : decel;
    if (a <= 0) return;
    const dx = tx - this.vel.x;
    const dz = tz - this.vel.z;
    const d = Math.hypot(dx, dz);
    const step = a * dt;
    if (d <= step) {
      this.vel.x = tx;
      this.vel.z = tz;
    } else {
      this.vel.x += (dx / d) * step;
      this.vel.z += (dz / d) * step;
    }
  }

  /** Accelerate downhill on slippery surfaces (goo surfing). */
  private slopeBoost(dt: number, strength: number) {
    const h = this.ray(this.feet.clone().add(_v.set(0, 0.3, 0)), _v.set(0, -1, 0), 0.8);
    if (!h) return;
    const n = h.normal;
    const downhill = new THREE.Vector3(n.x, 0, n.z);
    if (downhill.lengthSq() < 0.0004) return;
    this.vel.addScaledVector(downhill.normalize(), strength * Math.sqrt(1 - n.y * n.y) * 3 * dt);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const max = 16;
    if (sp > max) {
      this.vel.x *= max / sp;
      this.vel.z *= max / sp;
    }
  }

  private faceTowards(x: number, z: number, dt: number, rate: number) {
    const target = Math.atan2(x, z);
    const diff = wrapAngle(target - this.yaw);
    const step = rate * dt;
    this.yaw = wrapAngle(this.yaw + clamp(diff, -step, step));
  }

  private jump(mult: number) {
    this.vel.y = jumpVelocity(TUNING.jumpApex) * mult;
    this.grounded = false;
    this.coyote = 0;
    this.airPeakY = this.feet.y;
    this.setState(PState.Air);
    this.ctx.audio.play('jump');
    this.ctx.effects.dust(this.feet, 4, '#e8e6e2', 0.35, 1.2);
    this.ctx.emit('jump');
  }

  private tryParkour(fwd: THREE.Vector3, fromGround: boolean, hSpeed: number): boolean {
    const ledge = this.findLedge(fwd);
    if (!ledge) return false;
    if (fromGround && ledge.h < 0.35) return false;
    // low obstacle while moving: vault over if there is a landing, else step-vault onto it
    if (ledge.h <= TUNING.vaultMax && hSpeed > 3) {
      const landing = this.vaultLanding(ledge.top, fwd);
      this.yaw = Math.atan2(fwd.x, fwd.z);
      if (landing) {
        this.startMantle(landing, true, fwd.clone().multiplyScalar(Math.max(hSpeed, TUNING.runSpeed)));
        this.ctx.emit('vault');
        this.addFlow(8);
        return true;
      }
      this.startMantle(ledge.top.clone().addScaledVector(fwd, 0.3), true, fwd.clone().multiplyScalar(Math.max(hSpeed * 0.9, 4)));
      this.ctx.emit('vault');
      this.addFlow(6);
      return true;
    }
    if (ledge.h > TUNING.vaultMin) {
      this.yaw = Math.atan2(-ledge.normal.x, -ledge.normal.z);
      this.startMantle(ledge.top.clone().addScaledVector(ledge.normal, -0.35), false, fwd.clone().multiplyScalar(Math.min(hSpeed, 4)));
      this.ctx.emit('mantle');
      this.addFlow(6);
      return true;
    }
    return false;
  }

  private startMantle(to: THREE.Vector3, vault: boolean, keepVel = new THREE.Vector3()) {
    const h = to.y - this.feet.y;
    this.mantle = { from: this.feet.clone(), to: to.clone(), t: 0, dur: vault ? 0.3 : 0.28 + Math.max(0, h) * 0.07, vault, keepVel: keepVel.clone() };
    this.setState(PState.Mantle);
    this.ctx.audio.play('whoosh', { pitch: vault ? 1.3 : 0.9 });
  }

  private startWallRun(n: THREE.Vector3, side: number) {
    this.wallNormal.copy(n);
    this.wallSide = side;
    this.vel.y = Math.max(this.vel.y, 2.2);
    this.setState(PState.WallRun);
    this.ctx.audio.play('whoosh', { pitch: 1.1 });
    this.ctx.emit('wallrun');
    this.addFlow(5);
  }

  private wallKick(n: THREE.Vector3, along: THREE.Vector3) {
    const wish = this.wish(new THREE.Vector3());
    const out = n.clone().multiplyScalar(TUNING.wallKickSpeed).addScaledVector(along, 4);
    if (wish.lengthSq() > 0.04) out.addScaledVector(wish, 3);
    this.vel.set(out.x, TUNING.wallKickUp, out.z);
    this.lastWallNormal.copy(n);
    this.wallCooldown = 0.2;
    this.airPeakY = this.feet.y;
    this.setState(PState.Air);
    this.ctx.audio.play('jump', { pitch: 1.2 });
    this.ctx.effects.dust(this.feet.clone().addScaledVector(n, -0.3).add(_v.set(0, 0.6, 0)), 6, '#e8e6e2', 0.45, 2);
    this.ctx.cameraRig.kickFov(4);
    this.ctx.emit('wallkick');
    this.addFlow(10);
  }

  private onLand() {
    const fall = this.airPeakY - this.feet.y;
    const prev = this.state;
    this.airPeakY = this.feet.y;
    if (prev === PState.Dash || prev === PState.Attack || prev === PState.Mantle || prev === PState.Slide || prev === PState.Dodge) return;
    if ([PState.Catch, PState.Absorb, PState.Hit, PState.KO, PState.Charge].includes(prev)) return;
    // stepping down kerbs and stairs is not a "landing"
    if (fall < 0.6 && (prev === PState.Ground || prev === PState.Emote || prev === PState.Roll)) return;
    const strength = clamp(fall / 8, 0.15, 1);
    this.anim.land(strength);
    this.ctx.audio.play('land', { vol: 0.4 + strength * 0.6 });
    this.ctx.effects.dust(this.feet, Math.round(4 + strength * 10), '#e8e6e2', 0.4 + strength * 0.4, 1.5 + strength * 2);
    if (fall > 6) this.ctx.cameraRig.addShake(0.15 + strength * 0.25);
    this.ctx.emit('land', fall);
    if (fall > 4 && this.rollPending > 0) {
      this.rollPending = 0;
      this.setState(PState.Roll);
      this.addFlow(8);
      return;
    }
    if (fall > TUNING.hardLandingHeight) {
      this.setState(PState.Stagger);
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
      return;
    }
    this.setState(PState.Ground);
  }

  // ------------------------------------------------------------ combat

  private tryCombatInput(grounded: boolean, hSpeed: number): boolean {
    const input = this.ctx.input;
    if (input.consume('light')) {
      if (!grounded) this.startAttack(AttackId.AirKick);
      else {
        this.combo = this.combo % 3;
        this.startAttack(this.combo === 0 ? AttackId.Jab : this.combo === 1 ? AttackId.Cross : AttackId.Kick);
      }
      return true;
    }
    if (input.consume('heavy')) {
      if (!grounded) {
        this.startAttack(AttackId.Stomp);
      } else if (hSpeed > 5 && this.stamina > 5) {
        this.stamina -= TUNING.heavyCost;
        this.startAttack(AttackId.Tackle);
      } else {
        this.stamina = Math.max(0, this.stamina - TUNING.heavyCost * 0.5);
        this.startAttack(AttackId.Uppercut);
      }
      return true;
    }
    if (input.consume('dodge') && this.stamina >= TUNING.dodgeCost && (grounded || !this.airDodgeUsed)) {
      this.stamina -= TUNING.dodgeCost;
      if (!grounded) this.airDodgeUsed = true;
      const w = this.wish(new THREE.Vector3());
      if (w.lengthSq() < 0.04) this.facing(w).multiplyScalar(-1);
      this.dodgeDir.copy(w.normalize());
      this.iframes = TUNING.dodgeIFrames;
      this.setState(PState.Dodge);
      this.ctx.audio.play('whoosh', { pitch: 1.4 });
      return true;
    }
    if (this.ctx.input.consume('power')) {
      this.usePower();
      return true;
    }
    return false;
  }

  private startAttack(id: AttackId) {
    this.attackId = id;
    this.attackHitSet.clear();
    this.comboQueued = false;
    if (id === AttackId.Jab || id === AttackId.Cross || id === AttackId.Kick) {
      this.combo++;
      this.comboReset = 0.7;
    }
    this.setState(PState.Attack);
    this.ctx.audio.play('whoosh', { pitch: id === AttackId.Tackle ? 0.6 : 1 + Math.random() * 0.2 });
    if (id === AttackId.Tackle) {
      const f = this.facing(new THREE.Vector3());
      this.vel.x = f.x * 11;
      this.vel.z = f.z * 11;
      this.ctx.cameraRig.kickFov(6);
    }
    if (id === AttackId.Stomp) this.vel.set(0, 3, 0);
    this.rig.setExpression('focus', ATTACKS[id].dur + 0.3);
  }

  private softLock(dt: number) {
    const f = this.facing(new THREE.Vector3());
    let best: Hittable | null = null;
    let bestScore = Infinity;
    const c = new THREE.Vector3();
    for (const t of this.ctx.playerTargets()) {
      if (!t.alive) continue;
      t.center(c);
      const d = c.distanceTo(this.feet);
      if (d > 3.5) continue;
      const dir = c.clone().sub(this.feet).setY(0).normalize();
      const score = d * (2 - dir.dot(f));
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) {
      best.center(c);
      this.yaw = dampAngle(this.yaw, Math.atan2(c.x - this.feet.x, c.z - this.feet.z), 25, dt);
    }
  }

  private resolveAttackHits(range: number, arc: number, override?: HitInfo) {
    const def = ATTACKS[this.attackId];
    const f = this.facing(new THREE.Vector3());
    const origin = this.feet.clone().add(_v.set(0, 1.0, 0)).addScaledVector(f, range * 0.45);
    const hits = queryHits(origin, f, range * 0.75, arc, this.ctx.playerTargets(), this.attackHitSet);
    let landed = false;
    for (const t of hits) {
      this.attackHitSet.add(t.key);
      const c = t.center(new THREE.Vector3());
      const dir = c.clone().sub(this.feet).setY(0).normalize();
      if (dir.lengthSq() < 0.01) dir.copy(f);
      const info: HitInfo = override ?? { dir, damage: def.damage, knock: def.knock, lift: def.lift, kind: def.kind };
      if (override) info.dir = dir.lerp(override.dir, 0.5).normalize();
      if (t.receiveHit(info)) {
        landed = true;
        this.ctx.effects.sparks3(c, '#ffffff', 10, 6, 0.3, 4);
        this.ctx.effects.splat(this.feet.clone().addScaledVector(dir, 1.2).add(_v.set(0, 0.03, 0)), UP, Math.random() < 0.5 ? PALETTE.routeTeal : '#111114', 0.9);
        this.ctx.emit('hit', info);
        this.addFlow(6);
      }
    }
    if (landed) {
      const heavy = def.kind !== 'light' || override;
      this.ctx.hitstop(override ? TUNING.hitstopHeavy : def.hitstop);
      this.ctx.cameraRig.addShake(heavy ? 0.35 : 0.18);
      this.ctx.audio.play(heavy ? 'heavyHit' : 'hit');
      this.ctx.renderer.chromaFx = Math.max(this.ctx.renderer.chromaFx, heavy ? 0.6 : 0.25);
    }
  }

  private stompImpact() {
    const def = ATTACKS[AttackId.Stomp];
    this.ctx.effects.shockwave(this.feet.clone().add(_v.set(0, 0.15, 0)), '#ffffff', 3);
    this.ctx.audio.play('heavyHit');
    this.ctx.cameraRig.addShake(0.4);
    this.attackHitSet.clear();
    const hits = queryHits(this.feet.clone().add(_v.set(0, 0.6, 0)), this.facing(new THREE.Vector3()), def.range, -1, this.ctx.playerTargets(), this.attackHitSet);
    for (const t of hits) {
      const dir = t.center(new THREE.Vector3()).sub(this.feet).setY(0).normalize();
      if (t.receiveHit({ dir, damage: def.damage, knock: def.knock, lift: def.lift, kind: 'stomp' })) {
        this.ctx.emit('hit');
        this.addFlow(6);
      }
    }
    this.ctx.broadcastFx('shock', this.feet);
  }

  private trySmash(range: number) {
    const ds = this.ctx.city.destructibles;
    const p = this.feet.clone().add(_v.set(0, 1.0, 0)).addScaledVector(this.facing(new THREE.Vector3()), 0.6);
    const id = ds.findNear(p, range * 0.6);
    if (id === null) return;
    const dir = this.facing(new THREE.Vector3());
    ds.smash(id, p, dir);
    this.ctx.audio.play('smash');
    this.ctx.cameraRig.addShake(0.55);
    this.ctx.hitstop(0.06);
    this.ctx.effects.dust(p, 18, '#e8e6e2', 0.8, 4);
    this.ctx.emit('smash');
    this.addFlow(12);
  }

  receiveHit(h: HitInfo): boolean {
    if (this.iframes > 0 || this.state === PState.KO || this.state === PState.Dash || this.state === PState.Mantle) return false;
    const mult = this.ctx.settings.difficulty === 'chill' ? 0.5 : this.ctx.settings.difficulty === 'hard' ? 1.4 : 1;
    this.health -= h.damage * mult;
    this.sinceHurt = 0;
    this.flow = Math.max(0, this.flow - 35);
    this.vel.set(h.dir.x * h.knock, h.lift, h.dir.z * h.knock);
    this.yaw = Math.atan2(-h.dir.x, -h.dir.z);
    this.iframes = 0.35;
    this.rig.setExpression('wince', 0.6);
    this.ctx.audio.play('hurt');
    this.ctx.cameraRig.addShake(0.3);
    this.ctx.renderer.damageFx = Math.min(1, this.ctx.renderer.damageFx + 0.5);
    this.ctx.effects.sparks3(this.center(new THREE.Vector3()), '#ffffff', 8, 5);
    this.ctx.emit('hurt', h);
    this.ctx.effects.trailActive = false;
    if (this.health <= 0) {
      this.health = 0;
      this.setState(PState.KO);
      this.rig.setExpression('ko', 3);
      this.ctx.emit('ko');
      this.ctx.effects.inkBurst(this.center(new THREE.Vector3()), h.dir, '#111114', 20);
    } else {
      this.setState(PState.Hit);
    }
    this.grounded = false;
    return true;
  }

  // ------------------------------------------------------------ eye powers

  private selectPower(t: EyeType) {
    this.selectedPower = t;
    this.ctx.audio.play('ui');
  }

  private cyclePower(dir: number) {
    const order: EyeType[] = ['fire', 'sky', 'void'];
    const i = order.indexOf(this.selectedPower);
    this.selectPower(order[(i + dir + 3) % 3]);
  }

  private usePower() {
    const type = this.selectedPower;
    if (this.eyes[type] <= 0) {
      // auto-pick a power that has charges
      const other = (['fire', 'sky', 'void'] as EyeType[]).find((t) => this.eyes[t] > 0);
      if (!other) {
        this.ctx.toast('No Eye charges — catch a burning Eye!', 'warn');
        this.ctx.audio.play('uiBack');
        return;
      }
      this.selectedPower = other;
    }
    const t = this.selectedPower;
    this.eyes[t]--;
    if (t === 'fire') this.fireDash();
    else if (t === 'sky') {
      if (this.grounded) {
        this.setState(PState.Charge);
        this.chargeT = 0;
      } else {
        this.chargeT = 0.5;
        this.superJump();
      }
    } else this.voidBlink();
  }

  private fireDash() {
    const w = this.wish(new THREE.Vector3());
    if (w.lengthSq() < 0.04) this.ctx.cameraRig.forward(w);
    this.dashDir.copy(w.setY(0).normalize());
    this.yaw = Math.atan2(this.dashDir.x, this.dashDir.z);
    this.attackHitSet.clear();
    this.setState(PState.Dash);
    this.ctx.effects.trailActive = true;
    this.ctx.audio.play('dash');
    this.ctx.cameraRig.kickFov(12);
    this.ctx.cameraRig.addShake(0.2);
    this.ctx.renderer.chromaFx = 0.8;
    this.ctx.emit('dash');
    this.ctx.broadcastFx('dash', this.feet, this.dashDir);
    this.addFlow(5);
    this.iframes = TUNING.dashTime;
  }

  private superJump() {
    const h = lerp(TUNING.superJumpMinHeight, TUNING.superJumpMaxHeight, this.chargeT);
    this.vel.y = jumpVelocity(h);
    this.grounded = false;
    this.airPeakY = this.feet.y;
    this.setState(PState.Air);
    const p = this.feet.clone().add(_v.set(0, 0.2, 0));
    this.ctx.effects.shockwave(p, '#ffffff', 6);
    this.ctx.effects.dust(p, 20, '#ffffff', 1.0, 6);
    this.ctx.audio.play('shock');
    this.ctx.cameraRig.addShake(0.5);
    this.ctx.cameraRig.kickFov(18);
    this.ctx.cameraRig.startCinematic('launch', 0.5, () => this.feet.clone().add(new THREE.Vector3(0, 1.4, 0)), this.yaw);
    this.ctx.slowmo(0.5, 0.2);
    // knock back nearby enemies
    const hits = queryHits(this.feet.clone().add(_v.set(0, 0.6, 0)), this.facing(new THREE.Vector3()), 4, -1, this.ctx.playerTargets(), new Set());
    for (const t of hits) {
      const dir = t.center(new THREE.Vector3()).sub(this.feet).setY(0).normalize();
      t.receiveHit({ dir, damage: 15, knock: 12, lift: 6, kind: 'shock' });
    }
    this.ctx.emit('superjump');
    this.ctx.broadcastFx('shock', p);
    this.addFlow(10);
  }

  private voidBlink() {
    const dir = this.wish(new THREE.Vector3());
    if (dir.lengthSq() < 0.04) this.ctx.cameraRig.forward(dir);
    dir.setY(0).normalize();
    const from = this.feet.clone();
    const chest = from.clone().add(_v.set(0, 1.0, 0));
    const hit = this.ray(chest, dir, TUNING.blinkDistance);
    let dist = hit ? Math.max(0, hit.distance - 0.6) : TUNING.blinkDistance;
    // try to pass through thin walls: check the far side
    if (hit && hit.distance < TUNING.blinkDistance - 1.5) {
      const beyond = hit.point.clone().addScaledVector(dir, 1.2);
      const back = this.ray(beyond, dir.clone().multiplyScalar(-1), 1.1);
      const blocked = this.ray(beyond.clone().addScaledVector(dir, -0.05), dir, 0.8);
      if (back && !blocked) dist = Math.min(TUNING.blinkDistance, hit.distance + 1.2);
    }
    const to = from.clone().addScaledVector(dir, dist);
    // find ground under destination if any
    const down = this.ray(to.clone().add(_v.set(0, 1.2, 0)), _v.set(0, -1, 0), 1.6);
    if (down) to.y = down.point.y;
    this.ctx.effects.sparks3(chest, PALETTE.voidPurple, 30, 6, 0.3, 0);
    this.ctx.effects.inkBurst(chest, dir, PALETTE.voidPurple, 10);
    this.ctx.physics.placeCharacter(this.body, to);
    this.feet.copy(to);
    this.ctx.effects.sparks3(to.clone().add(_v.set(0, 1, 0)), PALETTE.voidPurple, 30, 6, 0.3, 0);
    this.ctx.audio.play('blink');
    this.ctx.renderer.chromaFx = 1;
    this.ctx.cameraRig.kickFov(8);
    this.iframes = 0.3;
    this.ctx.emit('blink');
    this.ctx.broadcastFx('blink', to);
    this.addFlow(6);
  }

  /** Called by the game when an Eye reaches the player's hand. */
  catchEye(type: EyeType, onDone: () => void) {
    if (this.state === PState.Catch || this.state === PState.Absorb || this.state === PState.KO) return false;
    this.catchType = type;
    this.onCatchDone = () => {
      this.eyes[type] = Math.min(3, this.eyes[type] + (type === 'void' ? 2 : type === 'sky' ? 2 : 3));
      this.selectedPower = type;
      this.addFlow(20);
      onDone();
    };
    this.ctx.effects.trailActive = false;
    this.setState(PState.Catch);
    this.rig.setExpression('halfLid', 1.5);
    this.ctx.audio.play('catch');
    const hand = () => this.rig.handSocketR.getWorldPosition(new THREE.Vector3()).lerp(this.headWorld(new THREE.Vector3()), 0.4);
    this.ctx.cameraRig.startCinematic('catch', 0.6, hand, this.yaw);
    this.ctx.slowmo(0.3, 0.55);
    this.ctx.emit('catch', type);
    return true;
  }

  get busy(): boolean {
    return this.state === PState.Catch || this.state === PState.Absorb || this.state === PState.KO;
  }

  // ------------------------------------------------------------ respawn / checkpoints

  private updateCheckpoint() {
    if (!this.grounded) return;
    for (const c of this.ctx.city.checkpoints) {
      if (c.distanceToSquared(this.feet) < 36 && !c.equals(this.checkpoint)) {
        this.checkpoint.copy(c);
        this.ctx.emit('checkpoint');
      }
    }
  }

  respawn(at?: THREE.Vector3) {
    const p = at ?? this.checkpoint;
    this.onCatchDone = null;
    this.ctx.physics.placeCharacter(this.body, p);
    this.feet.copy(p);
    this.vel.set(0, 0, 0);
    this.health = 100;
    this.flow = 0;
    this.setState(PState.Ground);
    this.ctx.effects.trailActive = false;
    this.ctx.effects.inkBurst(p.clone().add(_v.set(0, 1, 0)), UP, '#111114', 16);
    this.ctx.emit('respawn');
  }

  // ------------------------------------------------------------ animation

  /** Current network-friendly animation state. */
  animState(): { a: AnimState; ap: number } {
    return { a: this.lastAnimState, ap: this.lastAnimParam };
  }

  private animate(dt: number) {
    let a = AnimState.Idle;
    let ap = 0;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    switch (this.state) {
      case PState.Ground:
        a = hs > 0.4 ? AnimState.Move : AnimState.Idle;
        break;
      case PState.Air:
        a = AnimState.Air;
        break;
      case PState.WallRun:
        a = AnimState.WallRun;
        ap = this.wallSide;
        break;
      case PState.WallClimb:
        a = AnimState.WallClimb;
        break;
      case PState.Mantle:
        a = AnimState.Mantle;
        ap = this.mantle?.t ?? 0;
        break;
      case PState.Slide:
        a = AnimState.Slide;
        break;
      case PState.Dodge:
        a = AnimState.Dodge;
        ap = 1;
        break;
      case PState.Roll:
        a = AnimState.Roll;
        ap = clamp(this.stateTime / 0.45, 0, 1);
        break;
      case PState.Attack:
        a = AnimState.Attack;
        ap = packAttack(this.attackId, this.stateTime / ATTACKS[this.attackId].dur);
        break;
      case PState.Dash:
        a = AnimState.Dash;
        break;
      case PState.Charge:
        a = AnimState.Charge;
        ap = this.chargeT;
        break;
      case PState.Catch:
        a = AnimState.Catch;
        break;
      case PState.Absorb:
        a = AnimState.Absorb;
        ap = this.stateTime / 0.6;
        break;
      case PState.Hit:
        a = AnimState.Hit;
        ap = 1;
        break;
      case PState.Stagger:
        a = AnimState.Stagger;
        break;
      case PState.KO:
        a = AnimState.KO;
        break;
      case PState.Emote:
        a = AnimState.Emote;
        break;
    }
    this.lastAnimState = a;
    this.lastAnimParam = ap;
    this.anim.update(dt, { state: a, param: ap, speed: hs, vy: this.vel.y, grounded: this.grounded });
  }

  /** Data for the camera rig. */
  cameraTarget() {
    return {
      feet: this.feet,
      vel: this.vel,
      facingYaw: this.yaw,
      headWorld: this.headWorld(new THREE.Vector3()),
      grounded: this.grounded,
      inCombat: this.state === PState.Attack,
      wallSide: this.state === PState.WallRun ? this.wallSide : 0,
      airborneFall: this.state === PState.Air && this.vel.y < -9,
    };
  }

  dispose() {
    this.rig.dispose();
    this.ctx.physics.removeCharacter(this.body);
  }
}
