import * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import { Vehicle } from './Vehicle';
import { VEHICLES, VehicleType } from './VehicleModels';
import type { ParkingSpot } from '../world/islands/types';

export const VEHICLE_TYPES: VehicleType[] = ['tuktuk', 'inkbox', 'blotter', 'buggy'];

/**
 * Owns every drivable vehicle: parked ones placed by the islands, and ones
 * summoned by players. Far-away vehicles are frozen (kinematic) to save CPU.
 * Ids are deterministic so multiplayer clients agree on which car is which.
 */
export class VehicleManager {
  readonly vehicles = new Map<number, Vehicle>();
  private summoned = 0;

  constructor(private physics: Physics, private scene: THREE.Scene, parking: ParkingSpot[], hubSpots: ParkingSpot[]) {
    let id = 1;
    for (const p of [...hubSpots, ...parking]) {
      const type = (VEHICLE_TYPES.includes(p.type as VehicleType) ? p.type : 'inkbox') as VehicleType;
      const paints = VEHICLES[type].paint;
      this.add(new Vehicle(physics, id, type, p.pos, p.yaw, paints[id % paints.length]));
      id++;
    }
  }

  private add(v: Vehicle) {
    this.vehicles.set(v.id, v);
    this.scene.add(v.group);
  }

  /** Spawn a fresh vehicle in front of a position (the "summon" action). */
  summon(type: VehicleType, pos: THREE.Vector3, yaw: number, ownerId: number): Vehicle {
    // reuse the player's previous summon
    const id = 10000 + ownerId * 10 + (this.summoned++ % 2);
    this.vehicles.get(id)?.dispose();
    const paints = VEHICLES[type].paint;
    const v = new Vehicle(this.physics, id, type, pos, yaw, paints[0]);
    this.add(v);
    return v;
  }

  ensure(id: number, type: VehicleType, pos: THREE.Vector3, yaw: number): Vehicle {
    let v = this.vehicles.get(id);
    if (!v || v.type !== type) {
      v?.dispose();
      v = new Vehicle(this.physics, id, type, pos, yaw, VEHICLES[type].paint[0]);
      this.add(v);
    }
    return v;
  }

  nearest(p: THREE.Vector3, maxDist: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = maxDist;
    for (const v of this.vehicles.values()) {
      if (v.driver !== 'none') continue;
      const d = v.position.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  fixedUpdate(dt: number, focus: THREE.Vector3) {
    for (const v of this.vehicles.values()) {
      const near = v.driver !== 'none' || v.position.distanceTo(focus) < 140;
      if (near !== v.active) {
        v.active = near;
        if (v.driver !== 'remote') v.setKinematic(!near);
      }
      v.fixedUpdate(dt);
      // fell into the clouds: bring it home
      if (v.position.y < -40 && v.driver === 'none') v.reset(v.home.pos, v.home.yaw);
    }
  }

  sync(dt: number, camera: THREE.Vector3) {
    for (const v of this.vehicles.values()) {
      v.group.visible = v.position.distanceTo(camera) < 320;
      if (v.group.visible) v.sync(dt);
    }
  }
}
