import * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import { softDotTexture, sparkleTexture, splatTexture } from '../world/Textures';

interface Blob {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  scale: number;
  color: THREE.Color;
  decal: boolean;
}

interface Pt {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  drag: number;
  grow: number;
  attract?: () => THREE.Vector3;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  radius: number;
}

const MAX_BLOBS = 500;
const MAX_POINTS = 2000;
const MAX_DECALS = 160;

/** Points rendered with per-particle size, colour and alpha. */
class PointLayer {
  readonly points: THREE.Points;
  readonly list: Pt[] = [];
  private pos = new Float32Array(MAX_POINTS * 3);
  private col = new Float32Array(MAX_POINTS * 3);
  private alpha = new Float32Array(MAX_POINTS);
  private size = new Float32Array(MAX_POINTS);
  private geo = new THREE.BufferGeometry();

  constructor(tex: THREE.Texture, additive: boolean) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: { value: 600 } },
      vertexShader: `
        attribute float alpha; attribute float size; attribute vec3 color;
        varying float vA; varying vec3 vC; uniform float scale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a * vA < 0.01) discard; gl_FragColor = vec4(vC * t.rgb, t.a * vA); }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  add(p: Pt) {
    if (this.list.length >= MAX_POINTS) this.list.shift();
    this.list.push(p);
  }

  update(dt: number) {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      if (p.attract) {
        const t = p.attract();
        const to = t.sub(p.pos);
        const d = to.length();
        p.vel.multiplyScalar(1 - Math.min(1, dt * 4)).add(to.multiplyScalar((dt * 40) / Math.max(0.2, d)));
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.size += p.grow * dt;
    }
    for (const p of this.list) {
      const k = p.life / p.max;
      this.pos[n * 3] = p.pos.x;
      this.pos[n * 3 + 1] = p.pos.y;
      this.pos[n * 3 + 2] = p.pos.z;
      this.col[n * 3] = p.color.r;
      this.col[n * 3 + 1] = p.color.g;
      this.col[n * 3 + 2] = p.color.b;
      this.alpha[n] = Math.min(1, k * 2.2);
      this.size[n] = p.size;
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'color', 'alpha', 'size']) (this.geo.attributes[name] as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Effects {
  private blobs: Blob[] = [];
  private blobMesh: THREE.InstancedMesh;
  private sparks: PointLayer;
  private dustLayer: PointLayer;
  private ambient: THREE.Points;
  private decals: THREE.Mesh[] = [];
  private decalMats = new Map<string, THREE.MeshStandardMaterial>();
  private decalGeo = new THREE.PlaneGeometry(1, 1);
  private rings: Ring[] = [];
  private puffRings: Array<{ mesh: THREE.InstancedMesh; mat: THREE.MeshStandardMaterial; life: number; max: number; center: THREE.Vector3; radius: number; seeds: Array<{ a: number; r: number; y: number; s: number }> }> = [];
  private puffGeo = new THREE.IcosahedronGeometry(1, 1);
  private trail: THREE.Mesh;
  private trailPts: THREE.Vector3[] = [];
  private trailTimer = 0;
  trailActive = false;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  particleScale = 1;

  constructor(private scene: THREE.Scene, private physics: Physics) {
    const blobGeo = new THREE.IcosahedronGeometry(0.5, 1);
    this.blobMesh = new THREE.InstancedMesh(blobGeo, new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1 }), MAX_BLOBS);
    this.blobMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobMesh.count = 0;
    this.blobMesh.frustumCulled = false;
    this.blobMesh.castShadow = true;
    this.blobMesh.setColorAt(0, new THREE.Color());
    scene.add(this.blobMesh);

    this.sparks = new PointLayer(sparkleTexture(), true);
    this.dustLayer = new PointLayer(softDotTexture(), false);
    scene.add(this.sparks.points, this.dustLayer.points);

    // ambient floating orange "+" sparkles (reference background)
    const n = 220;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 80;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.ambient = new THREE.Points(
      ag,
      new THREE.PointsMaterial({ map: sparkleTexture(), color: '#ff9a3c', size: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }),
    );
    this.ambient.frustumCulled = false;
    scene.add(this.ambient);

    // dash trail ribbon
    const tg = new THREE.BufferGeometry();
    const TRAIL = 24;
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const alpha = new Float32Array(TRAIL * 2);
    for (let i = 0; i < TRAIL; i++) alpha[i * 2] = alpha[i * 2 + 1] = 1 - i / (TRAIL - 1);
    tg.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    tg.setIndex(idx);
    this.trail = new THREE.Mesh(
      tg,
      new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color('#ff7a1a') }, fade: { value: 1 } },
        vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 color; uniform float fade; varying float vA; void main(){ gl_FragColor = vec4(color * 2.5, vA * vA * fade); }',
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    scene.add(this.trail);
  }

  private rnd(a: number, b: number) {
    return a + Math.random() * (b - a);
  }

  /** Enemy defeat: black ink explodes and splatters the surroundings (reference 8.5 s). */
  inkBurst(pos: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation = '#111114', count = 36) {
    const c = new THREE.Color(color);
    count = Math.round(count * this.particleScale);
    for (let i = 0; i < count; i++) {
      if (this.blobs.length >= MAX_BLOBS) this.blobs.shift();
      const v = new THREE.Vector3(this.rnd(-1, 1), this.rnd(-0.2, 1.2), this.rnd(-1, 1)).normalize().multiplyScalar(this.rnd(3, 10)).addScaledVector(dir, this.rnd(2, 7));
      const max = this.rnd(0.45, 0.9);
      this.blobs.push({ pos: pos.clone().add(new THREE.Vector3(this.rnd(-0.3, 0.3), this.rnd(-0.4, 0.4), this.rnd(-0.3, 0.3))), vel: v, life: max, max, scale: this.rnd(0.05, 0.2), color: c, decal: i % 5 === 0 });
    }
    // splats on nearby surfaces
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Vector3(this.rnd(-1, 1), this.rnd(-1, -0.2), this.rnd(-1, 1)).addScaledVector(dir, 0.8).normalize();
      const hit = this.physics.raycast(pos, d, 5);
      if (hit) this.splat(hit.point, hit.normal, c.getStyle(), this.rnd(0.8, 2.2));
    }
    this.dust(pos, 6, '#2a2a30', 0.45);
  }

  sparks3(pos: THREE.Vector3, color: THREE.ColorRepresentation, count: number, speed = 6, size = 0.25, gravity = 6) {
    const c = new THREE.Color(color);
    count = Math.round(count * this.particleScale);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(this.rnd(-1, 1), this.rnd(-1, 1), this.rnd(-1, 1)).normalize().multiplyScalar(this.rnd(0.3, 1) * speed);
      const max = this.rnd(0.25, 0.7);
      this.sparks.add({ pos: pos.clone(), vel: v, life: max, max, size: size * this.rnd(0.6, 1.4), color: c, gravity, drag: 3, grow: 0 });
    }
  }

  /** Sparks spiralling into a moving target (Eye absorb, reference 7.0 s). */
  absorbSpiral(from: THREE.Vector3, target: () => THREE.Vector3, color: THREE.ColorRepresentation, count = 40) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(this.rnd(-1, 1), this.rnd(-1, 1), this.rnd(-1, 1)).normalize().multiplyScalar(this.rnd(2, 5));
      const max = this.rnd(0.5, 0.9);
      this.sparks.add({ pos: from.clone().add(v.clone().multiplyScalar(0.15)), vel: v, life: max, max, size: this.rnd(0.12, 0.3), color: c, gravity: 0, drag: 1, grow: -0.2, attract: target });
    }
  }

  dust(pos: THREE.Vector3, count: number, color: THREE.ColorRepresentation = '#f2f0ec', size = 0.6, spread = 2) {
    const c = new THREE.Color(color);
    count = Math.round(count * this.particleScale);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(this.rnd(-1, 1), this.rnd(0, 0.6), this.rnd(-1, 1)).normalize().multiplyScalar(this.rnd(0.5, 1) * spread);
      const max = this.rnd(0.4, 0.9);
      this.dustLayer.add({ pos: pos.clone(), vel: v, life: max, max, size: size * this.rnd(0.6, 1.3), color: c, gravity: -0.5, drag: 3, grow: size * 1.5 });
    }
  }

  splat(point: THREE.Vector3, normal: THREE.Vector3, color: string, size: number) {
    const key = color + (Math.floor(Math.random() * 4) as number);
    let mat = this.decalMats.get(key);
    if (!mat) {
      const seed = Number(key.slice(-1));
      mat = new THREE.MeshStandardMaterial({ map: splatTexture(seed), color, transparent: true, alphaTest: 0.15, depthWrite: false, roughness: 0.2, polygonOffset: true, polygonOffsetFactor: -3 });
      this.decalMats.set(key, mat);
    }
    const m = new THREE.Mesh(this.decalGeo, mat);
    m.position.copy(point).addScaledVector(normal, 0.02 + Math.random() * 0.01);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size);
    m.renderOrder = 2;
    m.receiveShadow = true;
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > MAX_DECALS) this.decals.shift()!.removeFromParent();
  }

  /** Expanding smoke ring (super-jump, reference 12.5 s). */
  shockwave(pos: THREE.Vector3, color: THREE.ColorRepresentation = '#ffffff', radius = 6, vertical = false) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1, 0.28, 8, 40), mat);
    mesh.position.copy(pos);
    if (!vertical) mesh.rotation.x = Math.PI / 2;
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.7, max: 0.7, radius });
    // puffy smoke around the ring
    for (let i = 0; i < 28 * this.particleScale; i++) {
      const a = (i / 28) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const max = this.rnd(0.6, 1.1);
      this.dustLayer.add({ pos: pos.clone().addScaledVector(dir, 0.6), vel: dir.multiplyScalar(radius * this.rnd(1.2, 1.8)), life: max, max, size: this.rnd(0.9, 1.6), color: new THREE.Color(color), gravity: -0.4, drag: 2.5, grow: 2.2 });
    }
  }

  /**
   * Volumetric-looking smoke torus made of lit cloud puffs that bursts outward
   * and dissolves (reference: launching up through a white smoke ring).
   */
  smokeRing(pos: THREE.Vector3, radius = 5, life = 1.2) {
    const n = Math.max(12, Math.round(34 * this.particleScale));
    const mat = new THREE.MeshStandardMaterial({ color: '#f3f3f5', roughness: 1, flatShading: true, transparent: true, opacity: 1 });
    const mesh = new THREE.InstancedMesh(this.puffGeo, mat, n);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const seeds = Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2 + this.rnd(-0.08, 0.08), r: this.rnd(-0.25, 0.25), y: this.rnd(-0.35, 0.35), s: this.rnd(0.7, 1.3) }));
    this.scene.add(mesh);
    this.puffRings.push({ mesh, mat, life, max: life, center: pos.clone(), radius, seeds });
    // inner wisps
    for (let i = 0; i < 18 * this.particleScale; i++) {
      const a = this.rnd(0, Math.PI * 2);
      const dir = new THREE.Vector3(Math.cos(a), this.rnd(-0.1, 0.4), Math.sin(a));
      const max = this.rnd(0.5, 1);
      this.dustLayer.add({ pos: pos.clone(), vel: dir.multiplyScalar(radius * this.rnd(1, 2)), life: max, max, size: this.rnd(1.2, 2.2), color: new THREE.Color('#ffffff'), gravity: -0.2, drag: 2, grow: 2.5 });
    }
  }

  private trailRainbow = false;

  /** Dash ribbon colour (level unlocks); 'rainbow' cycles hue. */
  setTrailColor(color: string) {
    this.trailRainbow = color === 'rainbow';
    if (!this.trailRainbow) ((this.trail.material as THREE.ShaderMaterial).uniforms.color.value as THREE.Color).set(color);
  }

  /** Feed the dash ribbon with the character's current position. */
  trailPoint(p: THREE.Vector3) {
    this.trailPts.unshift(p.clone());
    if (this.trailPts.length > 24) this.trailPts.pop();
  }

  update(dt: number, camera: THREE.Camera, time: number) {
    // blobs
    let n = 0;
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const b = this.blobs[i];
      b.life -= dt;
      b.vel.y -= 18 * dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.life <= 0) this.blobs.splice(i, 1);
      else if (b.decal && b.vel.y < 0) {
        const hit = this.physics.raycast(b.pos, new THREE.Vector3(0, -1, 0), Math.max(0.05, -b.vel.y * dt * 1.5));
        if (hit) {
          this.splat(hit.point, hit.normal, '#' + b.color.getHexString(), b.scale * 5);
          this.blobs.splice(i, 1);
        }
      }
    }
    for (const b of this.blobs) {
      const k = Math.min(1, (b.life / b.max) * 2.5);
      const stretch = 1 + Math.min(2, b.vel.length() * 0.08);
      this.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.vel.clone().normalize());
      this.s.set(b.scale * k, b.scale * k * stretch, b.scale * k);
      this.m4.compose(b.pos, this.q, this.s);
      this.blobMesh.setMatrixAt(n, this.m4);
      this.blobMesh.setColorAt(n, b.color);
      n++;
    }
    this.blobMesh.count = n;
    this.blobMesh.instanceMatrix.needsUpdate = true;
    if (this.blobMesh.instanceColor) this.blobMesh.instanceColor.needsUpdate = true;

    this.sparks.update(dt);
    this.dustLayer.update(dt);

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const t = 1 - r.life / r.max;
      const s = 0.5 + (1 - Math.pow(1 - t, 3)) * r.radius;
      r.mesh.scale.set(s, s, 1 + t * 2);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
      if (r.life <= 0) {
        r.mesh.removeFromParent();
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }

    for (let i = this.puffRings.length - 1; i >= 0; i--) {
      const r = this.puffRings[i];
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.max;
      const ease = 1 - Math.pow(1 - t, 3);
      const R = r.radius * (0.3 + 0.7 * ease);
      const unit = r.radius / 5;
      r.seeds.forEach((sd, k) => {
        const rr = R * (1 + sd.r * 0.35);
        this.s.setScalar(sd.s * unit * (0.55 + 1.5 * ease) * (1 - t * t * 0.5));
        this.q.identity();
        this.m4.compose(new THREE.Vector3(r.center.x + Math.cos(sd.a) * rr, r.center.y + sd.y * unit * (1 + ease) + t * 1.2, r.center.z + Math.sin(sd.a) * rr), this.q, this.s);
        r.mesh.setMatrixAt(k, this.m4);
      });
      r.mesh.instanceMatrix.needsUpdate = true;
      r.mat.opacity = 1 - THREE.MathUtils.smoothstep(t, 0.45, 1);
      r.mat.depthWrite = t < 0.45;
      if (r.life <= 0) {
        r.mesh.removeFromParent();
        r.mesh.dispose();
        r.mat.dispose();
        this.puffRings.splice(i, 1);
      }
    }

    // ambient sparkles follow the camera loosely
    this.ambient.position.set(Math.round(camera.position.x / 40) * 40, 0, Math.round(camera.position.z / 40) * 40);
    (this.ambient.material as THREE.PointsMaterial).opacity = 0.6 + Math.sin(time * 2) * 0.25;

    // dash ribbon
    if (this.trailRainbow) ((this.trail.material as THREE.ShaderMaterial).uniforms.color.value as THREE.Color).setHSL((time * 0.6) % 1, 0.9, 0.55);
    this.trailTimer -= dt;
    const mat = this.trail.material as THREE.ShaderMaterial;
    if (this.trailActive) mat.uniforms.fade.value = 1;
    else mat.uniforms.fade.value = Math.max(0, mat.uniforms.fade.value - dt * 3);
    if (!this.trailActive && this.trailPts.length && mat.uniforms.fade.value <= 0) this.trailPts.length = 0;
    this.trail.visible = this.trailPts.length > 1 && mat.uniforms.fade.value > 0;
    if (this.trail.visible) {
      const pos = this.trail.geometry.attributes.position as THREE.BufferAttribute;
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      for (let i = 0; i < 24; i++) {
        const p = this.trailPts[Math.min(i, this.trailPts.length - 1)];
        const w = 0.35 * (1 - i / 24);
        pos.setXYZ(i * 2, p.x - camRight.x * w, p.y + 0.9 - camRight.y * w, p.z - camRight.z * w);
        pos.setXYZ(i * 2 + 1, p.x + camRight.x * w, p.y + 0.9 + camRight.y * w, p.z + camRight.z * w);
      }
      pos.needsUpdate = true;
    }
  }
}
