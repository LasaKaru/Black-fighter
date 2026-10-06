import * as THREE from 'three';

export const PALETTE = {
  chalk: '#dedcd8',
  concrete: '#b9b7b4',
  graphite: '#4a4a50',
  ink: '#141418',
  voidPurple: '#6b2bff',
  routeTeal: '#17a9a3',
  eyeFire: '#ff7a1a',
  eyeCore: '#ffd27a',
  sky: '#9c9ca4',
} as const;

/**
 * Stylised PBR material with a subtle world-space grain so large flat blocks
 * read as concrete without textures. Works with instancing.
 */
export function worldMaterial(color: string, opts: { roughness?: number; grain?: number; emissive?: string; emissiveIntensity?: number; flat?: boolean } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.88,
    metalness: 0,
    flatShading: opts.flat ?? false,
    emissive: opts.emissive ?? '#000000',
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  const grain = opts.grain ?? 0.07;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrain = { value: grain };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vWNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vWNormal = normalize(mat3(modelMatrix) * objectNormal);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform float uGrain;
        float h31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float vnoise(vec3 x){
          vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(h31(i+vec3(0,0,0)),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float n = vnoise(vWPos * 2.3) * 0.6 + vnoise(vWPos * 9.0) * 0.4;
          float panel = 0.0;
          vec3 an = abs(vWNormal);
          vec2 uvp = an.y > 0.5 ? vWPos.xz : (an.x > 0.5 ? vWPos.zy : vWPos.xy);
          vec2 gl = abs(fract(uvp / 4.0) - 0.5);
          panel = smoothstep(0.485, 0.5, max(gl.x, gl.y));
          // darken towards the bottom of tall walls (fake AO / grime)
          float grime = an.y < 0.5 ? smoothstep(2.0, -6.0, vWPos.y) * 0.35 : 0.0;
          diffuseColor.rgb *= (1.0 - uGrain) + uGrain * 2.0 * n;
          diffuseColor.rgb *= 1.0 - panel * 0.12 - grime;
        }`,
      );
  };
  m.customProgramCacheKey = () => `world-grain-${grain}`;
  return m;
}

export interface WorldMaterials {
  white: THREE.MeshStandardMaterial;
  grey: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  teal: THREE.MeshStandardMaterial;
  purple: THREE.MeshStandardMaterial;
  goo: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  statue: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  // ---- world v2 biomes
  grass: THREE.MeshStandardMaterial;
  grassDark: THREE.MeshStandardMaterial;
  sand: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  rockRed: THREE.MeshStandardMaterial;
  sandstone: THREE.MeshStandardMaterial;
  marble: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  travertine: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  line: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  leafLight: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  tea: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  thatch: THREE.MeshStandardMaterial;
  trainBlue: THREE.MeshStandardMaterial;
  trainRed: THREE.MeshStandardMaterial;
  lotusPink: THREE.MeshStandardMaterial;
  lotusGreen: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  soapstone: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  cloud: THREE.MeshStandardMaterial;
  neonTeal: THREE.MeshStandardMaterial;
  neonPurple: THREE.MeshStandardMaterial;
}

export function createWorldMaterials(): WorldMaterials {
  return {
    white: worldMaterial(PALETTE.chalk, { grain: 0.06 }),
    grey: worldMaterial('#8d8b89', { grain: 0.08 }),
    dark: worldMaterial('#2c2c32', { grain: 0.1, roughness: 0.9 }),
    black: worldMaterial('#141418', { grain: 0.12, roughness: 0.55 }),
    teal: worldMaterial(PALETTE.routeTeal, { grain: 0.05, roughness: 0.5, emissive: '#0b4e4b', emissiveIntensity: 0.8 }),
    purple: worldMaterial(PALETTE.voidPurple, { grain: 0.05, roughness: 0.4, emissive: '#3a12a8', emissiveIntensity: 1.4 }),
    goo: worldMaterial('#7a3cff', { grain: 0.15, roughness: 0.15, emissive: '#4a18c8', emissiveIntensity: 1.6 }),
    wood: worldMaterial('#dcd8d0', { grain: 0.12 }),
    statue: worldMaterial('#e6e4e0', { grain: 0.04, flat: true, roughness: 0.75 }),
    glass: worldMaterial('#0f6763', { grain: 0.02, roughness: 0.15, emissive: '#0a3c3a', emissiveIntensity: 0.8 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#ffb066', emissive: '#ff7a1a', emissiveIntensity: 6 }),
    grass: worldMaterial('#7e9a62', { grain: 0.14, flat: true }),
    grassDark: worldMaterial('#56724a', { grain: 0.14, flat: true }),
    sand: worldMaterial('#d9c6a0', { grain: 0.12 }),
    rock: worldMaterial('#6d6863', { grain: 0.16, flat: true }),
    rockRed: worldMaterial('#a35a3a', { grain: 0.16, flat: true }),
    sandstone: worldMaterial('#d39a83', { grain: 0.14, flat: true }),
    marble: worldMaterial('#f1efe9', { grain: 0.03, roughness: 0.45 }),
    stone: worldMaterial('#a8a091', { grain: 0.15 }),
    travertine: worldMaterial('#cdb994', { grain: 0.15 }),
    brick: worldMaterial('#9a5c45', { grain: 0.15 }),
    asphalt: worldMaterial('#35353b', { grain: 0.1, roughness: 0.95 }),
    line: worldMaterial('#f2f0ea', { grain: 0.02, emissive: '#3a3a3a', emissiveIntensity: 0.4 }),
    water: new THREE.MeshStandardMaterial({ color: '#2b7d8c', roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.88 }),
    leaf: worldMaterial('#4f7a45', { grain: 0.18, flat: true }),
    leafLight: worldMaterial('#7da45a', { grain: 0.18, flat: true }),
    trunk: worldMaterial('#6b5340', { grain: 0.15, flat: true }),
    tea: worldMaterial('#5f8f4a', { grain: 0.2, flat: true }),
    roof: worldMaterial('#a8442f', { grain: 0.12, flat: true }),
    thatch: worldMaterial('#b39a63', { grain: 0.2, flat: true }),
    trainBlue: worldMaterial('#2c5aa0', { grain: 0.04, roughness: 0.45 }),
    trainRed: worldMaterial('#a8322c', { grain: 0.04, roughness: 0.45 }),
    lotusPink: worldMaterial('#c46fb1', { grain: 0.04, roughness: 0.4, emissive: '#5a1f55', emissiveIntensity: 0.6 }),
    lotusGreen: worldMaterial('#4f9a7a', { grain: 0.05, roughness: 0.5 }),
    gold: new THREE.MeshStandardMaterial({ color: '#d4a640', metalness: 0.9, roughness: 0.3 }),
    soapstone: worldMaterial('#dcdcd2', { grain: 0.05, flat: true, roughness: 0.65 }),
    metal: new THREE.MeshStandardMaterial({ color: '#8d9096', metalness: 0.8, roughness: 0.35 }),
    cloud: new THREE.MeshStandardMaterial({ color: '#f4f4f6', roughness: 1, flatShading: true }),
    neonTeal: new THREE.MeshStandardMaterial({ color: '#17a9a3', emissive: '#17a9a3', emissiveIntensity: 3 }),
    neonPurple: new THREE.MeshStandardMaterial({ color: '#6b2bff', emissive: '#6b2bff', emissiveIntensity: 3 }),
  };
}
