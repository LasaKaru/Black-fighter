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
  };
}
