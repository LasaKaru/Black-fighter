import * as THREE from 'three';
import type { WorldMaterials } from '../world/Materials';
import type { ArtStyle } from '../core/Settings';

/**
 * Natural colours for the "Realistic" art style. Gameplay colours (teal
 * routes, purple goo, neon, fire eyes, lamps) stay as they are so the game
 * still reads the same; everything else moves from the ink palette to
 * concrete, grass, sandstone, brick, water and foliage colours.
 */
const REAL: Partial<Record<keyof WorldMaterials, string>> = {
  white: '#c9c3b6',
  grey: '#8f8a82',
  dark: '#4a4642',
  black: '#57524c',
  wood: '#8c6a48',
  statue: '#d2cbbd',
  glass: '#4f7486',
  grass: '#5d7d3c',
  grassDark: '#3f5c2d',
  sand: '#d8c59b',
  rock: '#75706a',
  rockRed: '#8f5c45',
  sandstone: '#c49c6c',
  marble: '#ece7dc',
  stone: '#a59d8f',
  travertine: '#d3c7af',
  brick: '#8e4c37',
  asphalt: '#3b3b40',
  water: '#2a6e82',
  leaf: '#3f6b2e',
  leafLight: '#6c9c46',
  trunk: '#4c3828',
  tea: '#3f7c3a',
  roof: '#6c3b2d',
  thatch: '#9c7c4b',
  trainBlue: '#2b4c8c',
  trainRed: '#a93b2d',
  soapstone: '#d9d2c4',
  floatRock: '#7d7870',
};

interface Entry {
  m: THREE.MeshStandardMaterial;
  ink: THREE.Color;
  real: THREE.Color;
  emissive: number;
}

export class Realism {
  /** 0 = ink, 1 = realistic (eased). */
  amount = 0;
  private target = 0;
  private entries: Entry[] = [];
  private inkUniforms: Array<{ grain: { value: number }; density: { value: number }; accents: { value: number }; base: { grain: number; density: number; accents: number } }> = [];

  constructor(mats: WorldMaterials) {
    for (const [key, m] of Object.entries(mats) as Array<[keyof WorldMaterials, THREE.Material]>) {
      if (!(m instanceof THREE.MeshStandardMaterial)) continue;
      const ink = m.userData.ink;
      if (ink) this.inkUniforms.push(ink);
      const real = REAL[key];
      // glass glow is driven by the Atmosphere (night lights), so only its colour changes here
      if (real) this.entries.push({ m, ink: m.color.clone(), real: new THREE.Color(real), emissive: key === 'glass' ? 0 : m.emissiveIntensity });
    }
  }

  private swaps: THREE.MeshStandardMaterial[] = [];
  private decals: Array<{ m: THREE.MeshStandardMaterial; opacity: number; color: THREE.Color }> = [];

  /** Pick up the decal materials once the world is built. */
  collect(scene: THREE.Object3D) {
    const seen = new Set<THREE.Material>();
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!(m instanceof THREE.MeshStandardMaterial) || seen.has(m)) return;
      seen.add(m);
      if (m.userData.decal === 'ink') this.decals.push({ m, opacity: m.opacity, color: m.color.clone() });
      if (m.userData.swapMap) this.swaps.push(m);
    });
    this.apply();
  }

  set(style: ArtStyle, instant = false) {
    this.target = style === 'realistic' ? 1 : 0;
    if (instant) {
      this.amount = this.target;
      this.apply();
    }
  }

  update(dt: number) {
    if (this.amount === this.target) return;
    const step = dt * 1.5;
    this.amount = this.amount < this.target ? Math.min(this.target, this.amount + step) : Math.max(this.target, this.amount - step);
    this.apply();
  }

  private apply() {
    const k = this.amount;
    for (const e of this.entries) {
      e.m.color.copy(e.ink).lerp(e.real, k);
      // glass and water glow teal in the ink look; realistic keeps a faint sheen
      if (e.emissive > 0 && e.emissive < 2) e.m.emissiveIntensity = e.emissive * (1 - k * 0.8);
    }
    for (const m of this.swaps) {
      const want = k > 0.5 ? m.userData.swapMap.real : m.userData.swapMap.ink;
      if (m.map !== want) {
        m.map = want;
        m.needsUpdate = true;
      }
    }
    // ink puddles and drips become faint grime and water stains
    const stain = new THREE.Color('#2e2a24');
    for (const d of this.decals) {
      d.m.opacity = d.opacity * (1 - k * 0.72);
      d.m.color.copy(d.color).lerp(stain, k * 0.6);
    }
    for (const u of this.inkUniforms) {
      u.density.value = u.base.density * (1 - k);
      u.accents.value = k > 0.5 ? 0 : u.base.accents;
      u.grain.value = u.base.grain * (1 - k * 0.4);
    }
  }
}
