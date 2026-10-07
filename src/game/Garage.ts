import * as THREE from 'three';
import type { Vehicle } from '../vehicles/Vehicle';
import type { VehicleType } from '../vehicles/VehicleModels';
import type { Hittable } from '../player/Combat';
import type { Profile } from './Profile';
import type { Effects } from '../vfx/Effects';
import type { AudioEngine } from '../audio/Audio';
import type { CameraRig } from '../camera/CameraRig';
import type { AgentManager } from '../ai/Agents';

export const PAINTS = ['#111114', '#eceae6', '#17a9a3', '#6b2bff', '#ff7a1a', '#ff2a4a', '#ffd27a', '#ff6ec7', '#2a6bff', '#3a3a40'];
export const RIMS: Record<string, string> = { chrome: '#c8cad0', black: '#16161a', gold: '#d8a040', teal: '#17a9a3', purple: '#6b2bff' };
export const NITROS: Record<string, string> = { fire: '#ff7a1a', teal: '#17a9a3', void: '#6b2bff', chalk: '#f6f5f2', blood: '#ff2a4a' };

export interface CarStyle {
  paint?: string;
  rims?: string;
  nitro?: string;
}

export interface GarageHost {
  profile: Profile;
  effects: Effects;
  audio: AudioEngine;
  cameraRig: CameraRig;
  agents: AgentManager;
  targets(): Iterable<Hittable>;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  event(name: string): void;
}

interface Slick {
  pos: THREE.Vector3;
  t: number;
  mesh: THREE.Mesh;
}

const _c = new THREE.Vector3();

/**
 * Car customisation (paint, rims, nitro flame per vehicle type) and vehicle
 * combat: ramming Agents and props at speed, and ink oil slicks dropped
 * behind you that make pursuers slip and crawl.
 */
export class Garage {
  private hitCd = new Map<string, number>();
  private slicks: Slick[] = [];
  private slickGeo = new THREE.CircleGeometry(1, 24);
  private slickMat = new THREE.MeshStandardMaterial({ color: '#0b0b0e', roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

  constructor(private h: GarageHost, private scene: THREE.Scene) {}

  style(type: VehicleType): CarStyle {
    return this.h.profile.data.garage[type] ?? {};
  }

  setStyle(type: VehicleType, patch: CarStyle) {
    const g = this.h.profile.data.garage;
    g[type] = { ...(g[type] ?? {}), ...patch };
    this.h.profile.save();
  }

  /** Apply the saved rims to a freshly built vehicle. */
  dress(v: Vehicle) {
    const st = this.style(v.type);
    if (st.rims && RIMS[st.rims]) v.setRims(RIMS[st.rims]);
  }

  nitroColor(type: VehicleType): string {
    return NITROS[this.style(type).nitro ?? 'fire'] ?? NITROS.fire;
  }

  /** Drop an ink oil slick behind the car. */
  dropSlick(v: Vehicle) {
    const back = v.position.addScaledVector(v.forward(new THREE.Vector3()).setY(0).normalize(), -3);
    const mesh = new THREE.Mesh(this.slickGeo, this.slickMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(3.6, 2.6, 1);
    mesh.position.copy(back).setY(back.y - (v.spec.half[1] + v.spec.rest + v.spec.wheelR) + 0.06);
    mesh.receiveShadow = true;
    mesh.userData.noMap = true;
    this.scene.add(mesh);
    this.slicks.push({ pos: mesh.position.clone(), t: 12, mesh });
    this.h.effects.inkBurst(mesh.position.clone().setY(mesh.position.y + 0.3), new THREE.Vector3(0, 1, 0), '#111114', 24);
    this.h.audio.play('ink', { pitch: 0.6 });
  }

  fixedUpdate(dt: number, driving: Vehicle | null) {
    for (const [k, t] of this.hitCd) {
      if (t - dt <= 0) this.hitCd.delete(k);
      else this.hitCd.set(k, t - dt);
    }
    // slicks: Agents crawl and slip
    const zones = this.h.agents.slowZones;
    for (let i = this.slicks.length - 1; i >= 0; i--) {
      const s = this.slicks[i];
      s.t -= dt;
      if (s.t <= 0) {
        s.mesh.removeFromParent();
        this.slicks.splice(i, 1);
        continue;
      }
      if (s.t < 1) (s.mesh.material as THREE.MeshStandardMaterial).opacity = 0.92;
      s.mesh.scale.setScalar(Math.min(1, s.t));
      s.mesh.scale.set(3.6 * Math.min(1, s.t), 2.6 * Math.min(1, s.t), 1);
      zones.push({ c: s.pos, r: 3.4, f: 0.25 });
      for (const a of this.h.agents.agents.values()) {
        if (!a.alive || a.feet.distanceTo(s.pos) > 3.2 || this.hitCd.has('slip:' + a.key)) continue;
        this.hitCd.set('slip:' + a.key, 2.2);
        a.receiveHit({ dir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), damage: 4, knock: 3, lift: 2.5, kind: 'light' });
      }
    }
    if (!driving) return;
    // ramming: anything hittable in front of a fast car
    const speed = Math.abs(driving.speed);
    if (speed < 6) return;
    const fwd = driving.forward(new THREE.Vector3()).setY(0).normalize();
    const nose = driving.position.addScaledVector(fwd, driving.spec.half[2] * 0.6);
    const reach = Math.max(driving.spec.half[0], driving.spec.half[2] * 0.6) + 1.1;
    for (const t of this.h.targets()) {
      if (!t.alive || this.hitCd.has(t.key)) continue;
      t.center(_c);
      if (Math.abs(_c.y - nose.y) > 2.2 || Math.hypot(_c.x - nose.x, _c.z - nose.z) > reach) continue;
      this.hitCd.set(t.key, 0.8);
      const dir = _c.clone().sub(driving.position).setY(0).normalize().lerp(fwd, 0.5).normalize();
      t.receiveHit({ dir, damage: Math.min(80, speed * 2.6), knock: Math.min(22, 6 + speed * 0.6), lift: 5 + speed * 0.15, kind: 'tackle' });
      this.h.effects.inkBurst(_c.clone(), dir, '#111114', 18);
      this.h.audio.play('heavyHit', { vol: 0.7 });
      this.h.cameraRig.addShake(0.25);
      if (!t.isProp) this.h.event('rams');
    }
  }

  /** Nitro flames out of the back while boosting. */
  frame(v: Vehicle | null) {
    if (!v || !v.boosting) return;
    const back = v.position.addScaledVector(v.forward(new THREE.Vector3()), -v.spec.half[2] - 0.2);
    this.h.effects.sparks3(back, this.nitroColor(v.type), 3, 4, 0.3, -1);
  }
}
