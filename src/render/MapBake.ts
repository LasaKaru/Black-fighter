import * as THREE from 'three';

/** A baked top-down image of the world (north = -Z up, +X right). */
export interface MapImage {
  canvas: HTMLCanvasElement;
  /** World X / Z of the image's top-left corner. */
  minX: number;
  minZ: number;
  /** Side length in metres. */
  size: number;
  /** Pixels per metre. */
  ppm: number;
}

/**
 * Render the static world once from straight above with a height-shaded
 * material: white ground, darker the taller something is, the cloud sea
 * as a flat grey. Exact shapes of every landmark, tower, tree and road,
 * with no hand-authored map data. Used by the mini-map and the world map.
 */
export function bakeTopDown(renderer: THREE.WebGLRenderer, scene: THREE.Scene, area: { minX: number; minZ: number; size: number }, px: number, skip: (o: THREE.Object3D) => boolean): MapImage {
  const { minX, minZ, size } = area;
  const rt = new THREE.WebGLRenderTarget(px, px, { depthBuffer: true });
  const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 1, 1400);
  const cx = minX + size / 2;
  const cz = minZ + size / 2;
  cam.position.set(cx, 700, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, 0, cz);
  cam.layers.enableAll();
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();

  const mat = new THREE.MeshBasicMaterial({ fog: false, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vMapY;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vMapY = (modelMatrix * wp).y;
        }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMapY;')
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `float y = vMapY;
        vec3 sea = vec3(0.55, 0.55, 0.585);
        vec3 low = vec3(0.43, 0.43, 0.46);
        vec3 ground = vec3(0.89, 0.885, 0.865);
        vec3 mid = vec3(0.60, 0.595, 0.585);
        vec3 tall = vec3(0.26, 0.26, 0.29);
        vec3 top = vec3(0.09, 0.09, 0.11);
        vec3 c = y < -25.0 ? sea : y < -1.5 ? mix(low, mid, smoothstep(-25.0, -1.5, y)) : y < 1.2 ? ground : y < 6.0 ? mix(mid, tall, smoothstep(1.2, 6.0, y)) : mix(tall, top, smoothstep(6.0, 26.0, y));
        vec4 diffuseColor = vec4(c, 1.0);`,
      );
  };
  mat.customProgramCacheKey = () => 'map-bake';

  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) return;
    const isMesh = (o as THREE.Mesh).isMesh;
    if (!isMesh && ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite)) {
      o.visible = false;
      hidden.push(o);
      return;
    }
    if ((o as THREE.SkinnedMesh).isSkinnedMesh || o.userData.noMap || (isMesh && skip(o))) {
      o.visible = false;
      hidden.push(o);
      return;
    }
    if (isMesh) {
      const m = (o as THREE.Mesh).material as THREE.Material;
      // beams, decals and glows: transparent and not depth-writing
      if (m && !Array.isArray(m) && m.transparent && !m.depthWrite) {
        o.visible = false;
        hidden.push(o);
      }
    }
  });
  const prevBg = scene.background;
  const prevOverride = scene.overrideMaterial;
  const prevTarget = renderer.getRenderTarget();
  const prevShadow = renderer.shadowMap.autoUpdate;
  const prevTone = renderer.toneMapping;
  scene.background = new THREE.Color(0.55, 0.55, 0.585);
  scene.overrideMaterial = mat;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, cam);
  const buf = new Uint8Array(px * px * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, px, px, buf);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  renderer.shadowMap.autoUpdate = prevShadow;
  scene.overrideMaterial = prevOverride;
  scene.background = prevBg;
  for (const o of hidden) o.visible = true;
  rt.dispose();
  mat.dispose();

  // GL rows start at the bottom: flip so row 0 is the north edge (minZ)
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(px, px);
  const row = px * 4;
  for (let y = 0; y < px; y++) img.data.set(buf.subarray((px - 1 - y) * row, (px - y) * row), y * row);
  ctx.putImageData(img, 0, 0);
  return { canvas, minX, minZ, size, ppm: px / size };
}
