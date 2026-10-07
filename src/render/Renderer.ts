import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SettingsData } from '../core/Settings';
import { LAYER_FP_HIDDEN } from '../character/CharacterRig';

/** Final grade: contrast, desaturation with protected accents, vignette, grain, radial speed blur, chromatic pulse, flash. */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uSpeed: { value: 0 },
    uChroma: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.045 },
    uDamage: { value: 0 },
    uSlowmo: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uSpeed, uChroma, uFlash, uVignette, uGrain, uDamage, uSlowmo;
    uniform vec3 uFlashColor;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      vec3 col;
      // radial speed blur
      if (uSpeed > 0.001) {
        vec3 acc = vec3(0.0);
        float wsum = 0.0;
        for (int i = 0; i < 10; i++) {
          float t = float(i) / 9.0;
          float w = 1.0 - t * 0.6;
          vec2 suv = 0.5 + c * (1.0 - t * uSpeed * 0.09 * smoothstep(0.08, 0.6, length(c)));
          acc += texture2D(tDiffuse, suv).rgb * w;
          wsum += w;
        }
        col = acc / wsum;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      // chromatic aberration pulse
      if (uChroma > 0.001) {
        vec2 off = c * min(uChroma, 0.7) * 0.006;
        col.r = mix(col.r, texture2D(tDiffuse, uv + off).r, 0.85);
        col.b = mix(col.b, texture2D(tDiffuse, uv - off).b, 0.85);
      }
      // grade: slight desaturation but keep strong accents (purple/teal/orange)
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      float sat = max(max(col.r, col.g), col.b) - min(min(col.r, col.g), col.b);
      // (reference look: near-monochrome world, only teal / purple / fire pop)
      float keep = smoothstep(0.16, 0.42, sat);
      col = mix(vec3(l), col, mix(0.42, 1.15, keep));
      // filmic S-curve: deep inks, soft overcast whites
      col = (col - 0.5) * 1.12 + 0.5;
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.25);
      col *= vec3(0.97, 0.99, 1.03);
      // slow-motion desaturation
      col = mix(col, vec3(l) * vec3(0.95, 0.97, 1.05), uSlowmo * 0.35);
      // vignette
      float v = smoothstep(0.85, 0.25, length(c * vec2(1.0, 0.8)));
      col *= mix(1.0 - uVignette, 1.0, v);
      // damage edge ink
      col = mix(col, vec3(0.02), uDamage * smoothstep(0.35, 0.75, length(c)) * 0.85);
      // grain
      col += (hash(uv * 1000.0 + fract(uTime) * 100.0) - 0.5) * uGrain;
      // flash
      col = mix(col, uFlashColor, uFlash);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private gtao: GTAOPass;
  private output: OutputPass;
  private final: ShaderPass;
  private shadowTarget = new THREE.Vector3();
  private usePost = true;
  private skyTime = { value: 0 };
  speedFx = 0;
  chromaFx = 0;
  flashFx = 0;
  damageFx = 0;
  slowmoFx = 0;
  private resScale = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 2600);
    this.camera.layers.enable(LAYER_FP_HIDDEN);

    // overcast sky (reference): soft grey gradient dome + fog
    const skyColor = new THREE.Color('#9d9da6');
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog('#a9a8b0', 100, 760);
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(2200, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color('#545663') },
          mid: { value: new THREE.Color('#aeacb4') },
          bottom: { value: new THREE.Color('#c6c4ca') },
          sunDir: { value: new THREE.Vector3(30, 60, 20).normalize() },
          time: this.skyTime,
        },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
          uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; uniform vec3 sunDir; uniform float time; varying vec3 vP;
          float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
            return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
          void main(){
            float h = vP.y;
            vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.65, h)) : mix(mid, bottom, smoothstep(0.0, -0.2, h));
            // warm sun glow through the overcast
            float s = max(dot(normalize(vP), sunDir), 0.0);
            c += vec3(1.0, 0.86, 0.66) * (pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.08);
            // high streaky cloud bands
            if (h > 0.02) {
              vec2 uv = vP.xz / (h + 0.25) * 2.2 + vec2(time * 0.004, time * 0.002);
              float n = noise(uv * 1.3) * 0.6 + noise(uv * 3.1) * 0.3 + noise(uv * 7.0) * 0.1;
              float cl = smoothstep(0.55, 0.8, n) * smoothstep(0.02, 0.25, h) * (1.0 - smoothstep(0.6, 0.95, h));
              c = mix(c, vec3(0.93, 0.93, 0.95), cl * 0.55);
            }
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    sky.userData.noMap = true;
    this.scene.add(sky);
    sky.onBeforeRender = () => sky.position.copy(this.camera.position);

    // soft image-based lighting for the plastic-toy look
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;

    this.hemi = new THREE.HemisphereLight('#d4d5de', '#5f5a55', 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4e6', 1.55);
    this.sun.position.set(30, 60, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -45;
    s.right = 45;
    s.top = 45;
    s.bottom = -45;
    s.near = 1;
    s.far = 180;
    s.layers.enableAll();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.gtao = new GTAOPass(this.scene, this.camera, 512, 512);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.1 });
    this.composer.addPass(this.gtao);
    // high threshold: only emissives (eyes, fire, lamps) bloom, never the white concrete
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.45, 1.25);
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  applySettings(s: SettingsData) {
    this.resScale = s.resolutionScale;
    // toggling shadows changes shader defines: only then recompile materials
    const shadowsChanged = this.renderer.shadowMap.enabled !== s.shadows;
    this.renderer.shadowMap.enabled = s.shadows;
    this.sun.castShadow = s.shadows;
    const size = s.graphics === 'ultra' ? 4096 : s.graphics === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.bloom.enabled = s.bloom;
    this.gtao.enabled = s.ao;
    this.usePost = s.graphics !== 'low' || s.bloom;
    this.camera.fov = s.fov;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = 100 * s.viewDistance;
    fog.far = 760 * s.viewDistance;
    this.resize();
    if (shadowsChanged) {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
        else if (m) m.needsUpdate = true;
      });
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, 2) * this.resScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow frustum centred on the player. */
  followShadows(p: THREE.Vector3) {
    // snap to texel grid to avoid shimmering
    const step = 90 / this.sun.shadow.mapSize.x;
    this.shadowTarget.set(Math.round(p.x / step) * step, Math.round(p.y / step) * step, Math.round(p.z / step) * step);
    this.sun.target.position.copy(this.shadowTarget);
    this.sun.position.copy(this.shadowTarget).add(new THREE.Vector3(30, 60, 20));
  }

  render(dt: number, time: number) {
    const u = this.final.uniforms;
    u.uTime.value = time;
    this.skyTime.value = time;
    u.uSpeed.value = this.speedFx;
    u.uChroma.value = this.chromaFx;
    u.uFlash.value = this.flashFx;
    u.uDamage.value = this.damageFx;
    u.uSlowmo.value = this.slowmoFx;
    this.flashFx = Math.max(0, this.flashFx - dt * 5);
    this.chromaFx = Math.max(0, this.chromaFx - dt * 3);
    if (this.usePost) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  flash(color: THREE.ColorRepresentation, amount: number) {
    (this.final.uniforms.uFlashColor.value as THREE.Color).set(color);
    this.flashFx = Math.max(this.flashFx, amount);
  }
}
