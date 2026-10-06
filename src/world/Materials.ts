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

export interface BlotOpts {
  /** Ink colour of the big blots on up-facing surfaces. */
  ink: string;
  /** 0 = none, 1 = the reference plaza (about a third of the floor inked). */
  density: number;
  /** Also scatter teal / purple goo splats. */
  accents: boolean;
}

/**
 * Stylised PBR material with a subtle world-space grain so large flat blocks
 * read as concrete without textures. Works with instancing. With `blots`,
 * up-facing surfaces get procedural ink splats (world space, no UVs needed),
 * which is how every island floor matches the reference's inked plaza.
 */
export function worldMaterial(color: string, opts: { roughness?: number; grain?: number; emissive?: string; emissiveIntensity?: number; flat?: boolean; blots?: BlotOpts } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.88,
    metalness: 0,
    flatShading: opts.flat ?? false,
    emissive: opts.emissive ?? '#000000',
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  const grain = opts.grain ?? 0.07;
  const blots = opts.blots;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrain = { value: grain };
    if (blots) {
      shader.uniforms.uBlotInk = { value: new THREE.Color(blots.ink) };
      shader.uniforms.uBlotDensity = { value: blots.density };
      shader.uniforms.uBlotAccents = { value: blots.accents ? 1 : 0 };
      shader.uniforms.uTeal = { value: new THREE.Color(PALETTE.routeTeal) };
      shader.uniforms.uPurple = { value: new THREE.Color(PALETTE.voidPurple) };
    }
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
          #ifdef INK_BLOTS
          if (vWNormal.y > 0.6) {
            vec2 q = vWPos.xz;
            // domain-warped value noise gives organic splat outlines
            vec2 w = vec2(vnoise(vec3(q * 0.05, 3.1)), vnoise(vec3(q * 0.05, 7.7))) * 9.0;
            float b = vnoise(vec3((q + w) * 0.075, 1.0)) * 0.62 + vnoise(vec3((q + w) * 0.3, 2.0)) * 0.28 + vnoise(vec3(q * 1.3, 4.0)) * 0.1;
            float thr = mix(0.95, 0.56, uBlotDensity);
            float ink = smoothstep(thr, thr + 0.012, b);
            // satellite droplets around the blots
            float drops = smoothstep(0.86, 0.87, vnoise(vec3(q * 1.7, 5.0))) * smoothstep(thr - 0.12, thr, b);
            diffuseColor.rgb = mix(diffuseColor.rgb, uBlotInk, max(ink, drops));
            if (uBlotAccents > 0.5) {
              float a = vnoise(vec3((q + w * 0.5) * 0.08, 11.0)) * 0.7 + vnoise(vec3(q * 0.6, 13.0)) * 0.3;
              float t = smoothstep(0.835, 0.845, a);
              float p = smoothstep(0.835, 0.845, vnoise(vec3((q - w * 0.5) * 0.07, 17.0)) * 0.7 + vnoise(vec3(q * 0.5, 19.0)) * 0.3);
              diffuseColor.rgb = mix(diffuseColor.rgb, uTeal, t);
              diffuseColor.rgb = mix(diffuseColor.rgb, uPurple, p * (1.0 - t));
            }
          }
          #endif
        }`,
      );
    if (blots) {
      shader.defines = { ...(shader.defines ?? {}), INK_BLOTS: '' };
      shader.fragmentShader = shader.fragmentShader.replace(
        'uniform float uGrain;',
        'uniform float uGrain;\n        #ifdef INK_BLOTS\n        uniform vec3 uBlotInk; uniform float uBlotDensity; uniform float uBlotAccents; uniform vec3 uTeal; uniform vec3 uPurple;\n        #endif',
      );
    }
  };
  m.customProgramCacheKey = () => `world-grain-${grain}-${blots ? `${blots.ink}-${blots.density}-${blots.accents}` : 'none'}`;
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
    white: worldMaterial(PALETTE.chalk, { grain: 0.06, blots: { ink: '#121216', density: 0.38, accents: true } }),
    grey: worldMaterial('#8d8b89', { grain: 0.08 }),
    dark: worldMaterial('#2c2c32', { grain: 0.1, roughness: 0.9 }),
    black: worldMaterial('#141418', { grain: 0.12, roughness: 0.55, blots: { ink: '#e4e2de', density: 0.12, accents: true } }),
    teal: worldMaterial(PALETTE.routeTeal, { grain: 0.05, roughness: 0.5, emissive: '#0b4e4b', emissiveIntensity: 0.8 }),
    purple: worldMaterial(PALETTE.voidPurple, { grain: 0.05, roughness: 0.4, emissive: '#3a12a8', emissiveIntensity: 1.4 }),
    goo: worldMaterial('#7a3cff', { grain: 0.15, roughness: 0.15, emissive: '#4a18c8', emissiveIntensity: 1.6 }),
    wood: worldMaterial('#dcd8d0', { grain: 0.12 }),
    statue: worldMaterial('#e6e4e0', { grain: 0.04, flat: true, roughness: 0.75 }),
    glass: worldMaterial('#0f6763', { grain: 0.02, roughness: 0.15, emissive: '#0a3c3a', emissiveIntensity: 0.8 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#ffb066', emissive: '#ff7a1a', emissiveIntensity: 6 }),
    // ---- world v3 "ink" art direction: every biome is redrawn in the
    // reference palette (white/black concrete, teal + purple goo, fire eyes)
    grass: worldMaterial('#dcdad5', { grain: 0.07, flat: true, blots: { ink: '#111115', density: 0.74, accents: true } }),
    grassDark: worldMaterial('#2a2a30', { grain: 0.1, flat: true, blots: { ink: '#0c0c0f', density: 0.45, accents: true } }),
    sand: worldMaterial('#c9c6c0', { grain: 0.1, blots: { ink: '#141418', density: 0.35, accents: false } }),
    rock: worldMaterial('#45454c', { grain: 0.16, flat: true }),
    rockRed: worldMaterial('#4c4240', { grain: 0.16, flat: true, blots: { ink: '#17a9a3', density: 0.25, accents: false } }),
    sandstone: worldMaterial('#9e908a', { grain: 0.14, flat: true }),
    marble: worldMaterial('#f1efe9', { grain: 0.03, roughness: 0.45 }),
    stone: worldMaterial('#a6a39e', { grain: 0.15, blots: { ink: '#141418', density: 0.3, accents: true } }),
    travertine: worldMaterial('#c4c0b8', { grain: 0.15 }),
    brick: worldMaterial('#38363b', { grain: 0.15 }),
    asphalt: worldMaterial('#2b2b31', { grain: 0.1, roughness: 0.95, blots: { ink: '#0d0d10', density: 0.25, accents: true } }),
    line: worldMaterial('#f2f0ea', { grain: 0.02, emissive: '#3a3a3a', emissiveIntensity: 0.4 }),
    water: new THREE.MeshStandardMaterial({ color: '#0e3d3b', roughness: 0.06, metalness: 0.3, emissive: '#0b4e4b', emissiveIntensity: 0.5, transparent: true, opacity: 0.92 }),
    leaf: worldMaterial('#18181d', { grain: 0.18, flat: true }),
    leafLight: worldMaterial('#e4e2de', { grain: 0.12, flat: true }),
    trunk: worldMaterial('#141418', { grain: 0.15, flat: true }),
    tea: worldMaterial(PALETTE.routeTeal, { grain: 0.2, flat: true, emissive: '#06302e', emissiveIntensity: 0.6 }),
    roof: worldMaterial('#141418', { grain: 0.12, flat: true }),
    thatch: worldMaterial('#3a3a40', { grain: 0.2, flat: true }),
    trainBlue: worldMaterial('#18181d', { grain: 0.04, roughness: 0.45 }),
    trainRed: worldMaterial('#e9e7e2', { grain: 0.04, roughness: 0.45 }),
    lotusPink: worldMaterial(PALETTE.voidPurple, { grain: 0.04, roughness: 0.4, emissive: '#3a12a8', emissiveIntensity: 1.2 }),
    lotusGreen: worldMaterial(PALETTE.routeTeal, { grain: 0.05, roughness: 0.5, emissive: '#0b4e4b', emissiveIntensity: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: '#ff9a3a', emissive: '#ff7a1a', emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.35 }),
    soapstone: worldMaterial('#e6e4e0', { grain: 0.05, flat: true, roughness: 0.65 }),
    metal: new THREE.MeshStandardMaterial({ color: '#8d9096', metalness: 0.8, roughness: 0.35 }),
    cloud: new THREE.MeshStandardMaterial({ color: '#f4f4f6', roughness: 1, flatShading: true }),
    neonTeal: new THREE.MeshStandardMaterial({ color: '#17a9a3', emissive: '#17a9a3', emissiveIntensity: 3 }),
    neonPurple: new THREE.MeshStandardMaterial({ color: '#6b2bff', emissive: '#6b2bff', emissiveIntensity: 3 }),
  };
}
