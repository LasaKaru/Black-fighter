import * as THREE from 'three';
import type { Renderer } from './Renderer';
import type { WorldMaterials } from '../world/Materials';

export type TimeOfDay = 'cycle' | 'morning' | 'noon' | 'dusk' | 'night';
export type WeatherSetting = 'dynamic' | 'clear' | 'rain' | 'fog';
type Weather = 'clear' | 'rain' | 'fog';

interface Key {
  t: number;
  top: string;
  mid: string;
  bottom: string;
  fog: string;
  sun: string;
  sunI: number;
  hemi: number;
  env: number;
  /** 0 = day, 1 = full neon night (lamps, windows, stars). */
  night: number;
}

/** Overcast ink-city day by default; nights are dark blue with neon. */
const KEYS: Key[] = [
  { t: 0.0, top: '#0b0d18', mid: '#1f2236', bottom: '#262838', fog: '#1d1f2e', sun: '#8fa3ff', sunI: 0.22, hemi: 0.2, env: 0.05, night: 1 },
  { t: 0.22, top: '#1c2034', mid: '#4a4660', bottom: '#5a5468', fog: '#46435a', sun: '#a9b6ff', sunI: 0.32, hemi: 0.3, env: 0.08, night: 0.8 },
  { t: 0.28, top: '#4a4f6e', mid: '#c7a7a0', bottom: '#d8c2b8', fog: '#b8a8aa', sun: '#ffb27a', sunI: 0.95, hemi: 0.6, env: 0.16, night: 0.25 },
  { t: 0.38, top: '#545663', mid: '#aeacb4', bottom: '#c6c4ca', fog: '#a9a8b0', sun: '#fff4e6', sunI: 1.55, hemi: 0.85, env: 0.22, night: 0 },
  { t: 0.62, top: '#545663', mid: '#aeacb4', bottom: '#c6c4ca', fog: '#a9a8b0', sun: '#fff4e6', sunI: 1.55, hemi: 0.85, env: 0.22, night: 0 },
  { t: 0.72, top: '#3b3550', mid: '#c98a6b', bottom: '#d29a7a', fog: '#9c8088', sun: '#ff8a4a', sunI: 0.9, hemi: 0.55, env: 0.15, night: 0.3 },
  { t: 0.79, top: '#1c1d33', mid: '#4b3b55', bottom: '#5a4558', fog: '#3e3548', sun: '#9fb0ff', sunI: 0.28, hemi: 0.26, env: 0.07, night: 0.85 },
  { t: 1.0, top: '#0b0d18', mid: '#1f2236', bottom: '#262838', fog: '#1d1f2e', sun: '#8fa3ff', sunI: 0.22, hemi: 0.2, env: 0.05, night: 1 },
];

const FIXED: Record<Exclude<TimeOfDay, 'cycle'>, number> = { morning: 0.3, noon: 0.5, dusk: 0.73, night: 0.02 };
/** Real minutes per in-game day. */
const DAY_MINUTES = 24;
const RAIN_N = 1400;

const _a = new THREE.Color();
const _b = new THREE.Color();

/**
 * Time of day and weather: sky dome colours, sun/moon direction and colour,
 * ambient and image-based light, fog, night glow (lamps, neon, windows,
 * stars), rain streaks with wet low-roughness ground, and fog banks.
 */
export class Atmosphere {
  /** 0..1, 0 = midnight. */
  tod = 0.3;
  weather: Weather = 'clear';
  /** Smoothed weather amounts 0..1. */
  rain = 0;
  fogAmt = 0;
  /** Exposed for gameplay: wet surfaces are slippery. */
  get wet(): number {
    return this.rain;
  }
  night = 0;
  setting: { time: TimeOfDay; weather: WeatherSetting } = { time: 'cycle', weather: 'dynamic' };
  private elapsed = 0;
  private nextWeather = 240;
  private rainMesh: THREE.InstancedMesh;
  private drops: Float32Array;
  private baseRough = new Map<THREE.MeshStandardMaterial, number>();
  private baseEmissive = new Map<THREE.MeshStandardMaterial, number>();

  constructor(private r: Renderer, mats: WorldMaterials) {
    const geo = new THREE.PlaneGeometry(0.03, 0.9);
    this.rainMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#dfe6f0', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, fog: false }), RAIN_N);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.rainMesh.userData.noMap = true;
    r.scene.add(this.rainMesh);
    this.drops = new Float32Array(RAIN_N * 3);
    for (let i = 0; i < RAIN_N; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * 60;
      this.drops[i * 3 + 1] = Math.random() * 30;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    for (const m of Object.values(mats)) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      this.baseRough.set(m, m.roughness);
    }
    // only light sources glow brighter at night; painted surfaces stay put
    for (const m of [mats.lamp, mats.neonTeal, mats.neonPurple, mats.glass, mats.goo]) this.baseEmissive.set(m, m.emissiveIntensity);
  }

  /** Current weather name for HUD/debug. */
  get label(): string {
    return this.weather;
  }

  update(dt: number, camera: THREE.Camera) {
    const camPos = camera.position;
    this.elapsed += dt;
    // time of day
    if (this.setting.time === 'cycle') this.tod = (this.tod + dt / (DAY_MINUTES * 60)) % 1;
    else this.tod += (FIXED[this.setting.time] - this.tod) * Math.min(1, dt * 2);
    // weather schedule: clear for the first minutes, then random spells
    if (this.setting.weather === 'dynamic') {
      if (this.elapsed > this.nextWeather) {
        const r = Math.random();
        this.weather = r < 0.5 ? 'clear' : r < 0.82 ? 'rain' : 'fog';
        this.nextWeather = this.elapsed + 150 + Math.random() * 200;
      }
    } else this.weather = this.setting.weather;
    this.rain += ((this.weather === 'rain' ? 1 : 0) - this.rain) * Math.min(1, dt * 0.25);
    this.fogAmt += ((this.weather === 'fog' ? 1 : 0) - this.fogAmt) * Math.min(1, dt * 0.2);
    this.apply();
    this.updateRain(dt, camPos, camera);
  }

  private key(): Key {
    const t = this.tod;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t < t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const k = THREE.MathUtils.smoothstep(t, a.t, b.t);
    const mix = (x: string, y: string) => '#' + _a.set(x).lerp(_b.set(y), k).getHexString();
    return {
      t,
      top: mix(a.top, b.top),
      mid: mix(a.mid, b.mid),
      bottom: mix(a.bottom, b.bottom),
      fog: mix(a.fog, b.fog),
      sun: mix(a.sun, b.sun),
      sunI: a.sunI + (b.sunI - a.sunI) * k,
      hemi: a.hemi + (b.hemi - a.hemi) * k,
      env: a.env + (b.env - a.env) * k,
      night: a.night + (b.night - a.night) * k,
    };
  }

  private apply() {
    const k = this.key();
    const r = this.r;
    const u = r.skyUniforms;
    const storm = this.rain * 0.55 + this.fogAmt * 0.3;
    const grey = new THREE.Color('#6e6f78');
    u.top.value.set(k.top).lerp(grey, storm * 0.5);
    u.mid.value.set(k.mid).lerp(grey, storm * 0.6);
    u.bottom.value.set(k.bottom).lerp(grey, storm * 0.5);
    u.stars.value = k.night * (1 - storm);
    this.night = k.night;
    // sun/moon: arcs overhead, never too low (keeps shadows readable)
    const ang = (this.tod - 0.25) * Math.PI * 2;
    const el = Math.max(0.35, Math.abs(Math.sin(ang)));
    const az = Math.cos(ang) * 0.9 + 0.6;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(Math.asin(el)), el, Math.sin(az) * Math.cos(Math.asin(el))).normalize();
    u.sunDir.value.copy(dir);
    r.sunOffset.copy(dir).multiplyScalar(72);
    r.sun.color.set(k.sun);
    r.sun.intensity = k.sunI * (1 - storm * 0.6);
    r.hemi.intensity = k.hemi * (1 - storm * 0.2);
    r.hemi.color.set(k.night > 0.5 ? '#6a74a0' : '#d4d5de');
    r.scene.environmentIntensity = k.env;
    const fog = r.scene.fog as THREE.Fog;
    fog.color.set(k.fog).lerp(grey, storm * 0.6);
    (r.scene.background as THREE.Color).copy(fog.color);
    r.fogNear = THREE.MathUtils.lerp(100, 6, this.fogAmt) * (1 - this.rain * 0.35);
    r.fogFar = THREE.MathUtils.lerp(760, 120, this.fogAmt) * (1 - this.rain * 0.4);
    r.applyFog();
    // darker exposure at night so white concrete reads as moonlit, not lit
    r.renderer.toneMappingExposure = 0.92 * (1 - k.night * 0.3);
    // night glow: lamps, neon, teal windows, goo
    const glow = 1 + k.night * 1.6;
    for (const [m, base] of this.baseEmissive) m.emissiveIntensity = base * glow;
    // wet ground
    const wet = this.rain;
    for (const [m, base] of this.baseRough) m.roughness = base * (1 - wet * 0.6);
  }

  private updateRain(dt: number, cam: THREE.Vector3, camera: THREE.Camera) {
    const on = this.rain > 0.02;
    this.rainMesh.visible = on;
    if (!on) return;
    (this.rainMesh.material as THREE.MeshBasicMaterial).opacity = 0.45 * this.rain;
    const m = new THREE.Matrix4();
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(fwd.x, fwd.z), 0.12, 'YXZ'));
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const count = Math.floor(RAIN_N * this.rain);
    for (let i = 0; i < RAIN_N; i++) {
      let y = this.drops[i * 3 + 1] - dt * 26;
      if (y < -4) y += 34;
      this.drops[i * 3 + 1] = y;
      if (i >= count) {
        m.makeScale(0, 0, 0);
        this.rainMesh.setMatrixAt(i, m);
        continue;
      }
      // wrap the volume around the camera
      const wx = ((((this.drops[i * 3] - cam.x) % 60) + 90) % 60) - 30;
      const wz = ((((this.drops[i * 3 + 2] - cam.z) % 60) + 90) % 60) - 30;
      p.set(cam.x + wx, cam.y - 8 + y, cam.z + wz);
      m.compose(p, q, s);
      this.rainMesh.setMatrixAt(i, m);
    }
    this.rainMesh.instanceMatrix.needsUpdate = true;
  }
}
