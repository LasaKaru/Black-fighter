import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type Surface = 'concrete' | 'ink' | 'goo' | 'paint' | 'wood' | 'glass' | 'statue' | 'debris';

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  surface: Surface;
  collider: RAPIER.Collider;
}

export interface CharacterBody {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  controller: RAPIER.KinematicCharacterController;
  radius: number;
  halfHeight: number;
}

let initialized = false;

export async function initPhysics(): Promise<void> {
  if (initialized) return;
  await RAPIER.init();
  initialized = true;
}

export class Physics {
  readonly world: RAPIER.World;
  readonly R = RAPIER;
  private surfaces = new Map<number, Surface>();
  /** Colliders owned by characters, excluded from environment queries. */
  private characterColliders = new Set<number>();
  /** Extra per-collider data (e.g. destructible wall id). */
  readonly tags = new Map<number, { destructible?: number; oneWay?: boolean }>();
  /** Moving platforms (train carriages, cable cars): collider handle → last step movement. */
  private platforms = new Map<number, { delta: THREE.Vector3 }>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -22, z: 0 });
    this.world.timestep = 1 / 60;
  }

  step(dt: number) {
    this.world.timestep = dt;
    this.world.step();
  }

  addStaticBox(center: THREE.Vector3, size: THREE.Vector3, surface: Surface = 'concrete', rotation?: THREE.Quaternion): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
      .setTranslation(center.x, center.y, center.z)
      .setFriction(0.6);
    if (rotation) desc.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    const c = this.world.createCollider(desc);
    this.surfaces.set(c.handle, surface);
    return c;
  }

  addStaticCylinder(center: THREE.Vector3, radius: number, height: number, surface: Surface = 'statue'): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(center.x, center.y, center.z);
    const c = this.world.createCollider(desc);
    this.surfaces.set(c.handle, surface);
    return c;
  }

  addStaticBall(center: THREE.Vector3, radius: number, surface: Surface = 'statue'): RAPIER.Collider {
    const c = this.world.createCollider(RAPIER.ColliderDesc.ball(radius).setTranslation(center.x, center.y, center.z));
    this.surfaces.set(c.handle, surface);
    return c;
  }

  removeCollider(c: RAPIER.Collider) {
    this.surfaces.delete(c.handle);
    this.tags.delete(c.handle);
    this.world.removeCollider(c, false);
  }

  /** Dynamic debris chunk (destruction). */
  addDebris(center: THREE.Vector3, half: THREE.Vector3, rot: THREE.Quaternion): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y, center.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setLinearDamping(0.2)
        .setAngularDamping(0.4)
        .setCcdEnabled(false),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setDensity(0.6).setFriction(0.8).setRestitution(0.15),
      body,
    );
    this.surfaces.set(collider.handle, 'debris');
    return { body, collider };
  }

  removeBody(body: RAPIER.RigidBody) {
    for (let i = 0; i < body.numColliders(); i++) {
      const c = body.collider(i);
      this.surfaces.delete(c.handle);
    }
    this.world.removeRigidBody(body);
  }

  createCharacter(pos: THREE.Vector3, radius: number, halfHeight: number): CharacterBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y + halfHeight + radius, pos.z),
    );
    const collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius).setFriction(0), body);
    const controller = this.world.createCharacterController(0.02);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    controller.enableAutostep(0.45, 0.2, false);
    controller.enableSnapToGround(0.35);
    controller.setSlideEnabled(true);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(70);
    this.characterColliders.add(collider.handle);
    return { body, collider, controller, radius, halfHeight };
  }

  removeCharacter(c: CharacterBody) {
    this.characterColliders.delete(c.collider.handle);
    this.world.removeCharacterController(c.controller);
    this.world.removeRigidBody(c.body);
  }

  /**
   * Move a character by a desired delta, resolving collisions. Returns the
   * actual movement and whether the character ended up grounded.
   */
  moveCharacter(c: CharacterBody, delta: THREE.Vector3, out: THREE.Vector3): { grounded: boolean; hitCeiling: boolean; hitWall: boolean } {
    c.controller.computeColliderMovement(c.collider, { x: delta.x, y: delta.y, z: delta.z }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (col) => !this.characterColliders.has(col.handle));
    const m = c.controller.computedMovement();
    out.set(m.x, m.y, m.z);
    const t = c.body.translation();
    c.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    let hitCeiling = false;
    let hitWall = false;
    for (let i = 0; i < c.controller.numComputedCollisions(); i++) {
      const col = c.controller.computedCollision(i);
      if (!col) continue;
      const n = col.normal1;
      if (n.y < -0.5) hitCeiling = true;
      if (Math.abs(n.y) < 0.3) hitWall = true;
    }
    return { grounded: c.controller.computedGrounded(), hitCeiling, hitWall };
  }

  /** Teleport a character so its feet are at `feet`. */
  placeCharacter(c: CharacterBody, feet: THREE.Vector3) {
    const p = { x: feet.x, y: feet.y + c.halfHeight + c.radius, z: feet.z };
    c.body.setTranslation(p, true);
    c.body.setNextKinematicTranslation(p);
  }

  /** Feet position of a character (bottom of capsule). */
  feetOf(c: CharacterBody, out: THREE.Vector3): THREE.Vector3 {
    const t = c.body.translation();
    return out.set(t.x, t.y - c.halfHeight - c.radius, t.z);
  }

  surfaceOf(c: RAPIER.Collider): Surface {
    return this.surfaces.get(c.handle) ?? 'concrete';
  }

  /** Raycast against the environment (fixed + debris, never characters). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, includeDynamic = false): RayHit | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const flags = includeDynamic ? RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC : RAPIER.QueryFilterFlags.ONLY_FIXED;
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, flags, undefined, undefined, undefined, (col) => !this.characterColliders.has(col.handle));
    if (!hit) return null;
    const point = new THREE.Vector3(origin.x + dir.x * hit.timeOfImpact, origin.y + dir.y * hit.timeOfImpact, origin.z + dir.z * hit.timeOfImpact);
    return {
      point,
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      distance: hit.timeOfImpact,
      surface: this.surfaceOf(hit.collider),
      collider: hit.collider,
    };
  }

  isCharacter(c: RAPIER.Collider): boolean {
    return this.characterColliders.has(c.handle);
  }

  /** Enable/disable a character capsule (e.g. while driving). */
  setCharacterEnabled(c: CharacterBody, enabled: boolean) {
    c.collider.setEnabled(enabled);
  }

  /** Kinematic moving body with a box collider (train carriage, gondola floor…). */
  addKinematicBox(center: THREE.Vector3, half: THREE.Vector3, platform: { delta: THREE.Vector3 }): { body: RAPIER.RigidBody; colliders: RAPIER.Collider[] } {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z));
    const col = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setFriction(1), body);
    this.platforms.set(col.handle, platform);
    this.surfaces.set(col.handle, 'concrete');
    return { body, colliders: [col] };
  }

  /** Add an extra collider (offset box) to a kinematic platform body. */
  addPlatformPart(body: RAPIER.RigidBody, offset: THREE.Vector3, half: THREE.Vector3, platform: { delta: THREE.Vector3 }) {
    const col = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(offset.x, offset.y, offset.z), body);
    this.platforms.set(col.handle, platform);
    return col;
  }

  /** Movement of the platform the character is standing on (null if none). */
  platformUnder(feet: THREE.Vector3): THREE.Vector3 | null {
    const ray = new RAPIER.Ray({ x: feet.x, y: feet.y + 0.3, z: feet.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 0.7, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, undefined, undefined, (col) => !this.characterColliders.has(col.handle));
    if (!hit) return null;
    return this.platforms.get(hit.collider.handle)?.delta ?? null;
  }

  /** Sphere sweep used by the camera spring arm. Returns safe distance along dir. */
  sphereCast(origin: THREE.Vector3, dir: THREE.Vector3, radius: number, maxDist: number): number {
    const shape = new RAPIER.Ball(radius);
    const hit = this.world.castShape(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dir.x, y: dir.y, z: dir.z },
      shape,
      0,
      maxDist,
      true,
      RAPIER.QueryFilterFlags.ONLY_FIXED,
    );
    return hit ? hit.time_of_impact : maxDist;
  }
}
