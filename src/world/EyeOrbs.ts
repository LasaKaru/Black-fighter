import * as THREE from 'three';
import type { EyeNest, EyeType } from './City';
import type { GameContext } from '../core/GameContext';
import { Player, PState } from '../player/Player';
import { eyeOrbTexture } from './Textures';
import { PALETTE } from './Materials';

const COLORS: Record<EyeType, { iris: string; flame: string; core: string }> = {
  fire: { iris: PALETTE.eyeFire, flame: '#ff6a10', core: '#ffd27a' },
  sky: { iris: '#7fd8ff', flame: '#e8f6ff', core: '#ffffff' },
  void: { iris: PALETTE.voidPurple, flame: '#8a4dff', core: '#d7c2ff' },
  iron: { iris: '#5d6678', flame: '#c9d2e3', core: '#ffffff' },
  tide: { iris: PALETTE.routeTeal, flame: '#3fe0d6', core: '#c8fffa' },
  watcher: { iris: '#d4a640', flame: '#ffd24a', core: '#fff3c4' },
  storm: { iris: '#111114', flame: '#9a4dff', core: '#ff7a1a' },
};

const RESPAWN = 22;

interface Orb {
  type: EyeType;
  nest: EyeNest | null;
  group: THREE.Group;
  flame: THREE.Mesh;
  light: THREE.PointLight;
  state: 'idle' | 'homing' | 'held' | 'gone';
  timer: number;
  vel: THREE.Vector3;
  phase: number;
}

/** Fresnel flame shell around the burning eye. */
function flameMaterial(color: string, core: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uCore: { value: new THREE.Color(core) } },
    vertexShader: `
      uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        vec3 p = position;
        float w = sin(p.y * 9.0 + uTime * 9.0) * 0.06 + sin(p.x * 7.0 - uTime * 6.0) * 0.05;
        p += normal * (w + max(0.0, p.y) * 0.25 * (0.6 + 0.4 * sin(uTime * 12.0 + p.x * 5.0)));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = p;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; uniform vec3 uCore; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        float f = pow(1.0 - abs(dot(vN, vV)), 1.6);
        float flick = 0.6 + 0.4 * sin(vP.y * 14.0 - uTime * 16.0 + sin(vP.x * 10.0) * 2.0);
        vec3 c = mix(uColor, uCore, f * 0.5) * 2.2;
        gl_FragColor = vec4(c, clamp(f * flick * 1.3, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * The burning Eyes (README §11): they hover at nests, fly towards a player in
 * high Flow (reference 4.5 s), get caught, absorbed, and respawn.
 */
export class EyeOrbs {
  private orbs: Orb[] = [];
  private eyeGeo = new THREE.SphereGeometry(0.32, 24, 16);
  private flameGeo = new THREE.IcosahedronGeometry(0.42, 3);
  private time = 0;
  private skyTimer = 14;

  constructor(private ctx: GameContext, nests: EyeNest[]) {
    for (const n of nests) this.create(n.type, n, n.pos.clone());
  }

  private create(type: EyeType, nest: EyeNest | null, pos: THREE.Vector3): Orb {
    const c = COLORS[type];
    const group = new THREE.Group();
    const eye = new THREE.Mesh(
      this.eyeGeo,
      new THREE.MeshStandardMaterial({ map: eyeOrbTexture(c.iris), emissive: c.core, emissiveMap: eyeOrbTexture(c.iris), emissiveIntensity: 0.9, roughness: 0.2 }),
    );
    const flame = new THREE.Mesh(this.flameGeo, flameMaterial(c.flame, c.core));
    group.add(eye, flame);
    const light = new THREE.PointLight(c.flame, 6, 7, 2);
    light.castShadow = false;
    group.add(light);
    group.position.copy(pos);
    this.ctx.renderer.scene.add(group);
    const orb: Orb = { type, nest, group, flame, light, state: 'idle', timer: 0, vel: new THREE.Vector3(), phase: Math.random() * 10 };
    this.orbs.push(orb);
    return orb;
  }

  update(dt: number, player: Player) {
    this.time += dt;
    const hand = player.rig.handSocketR.getWorldPosition(new THREE.Vector3());
    const chest = player.center(new THREE.Vector3());

    // in high Flow, eyes come to you from the sky
    this.skyTimer -= dt;
    if (this.skyTimer <= 0) {
      this.skyTimer = 16 + Math.random() * 10;
      if (player.flowTier >= 2 && !player.busy) {
        const dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        const o = this.create(Math.random() < 0.6 ? 'fire' : 'sky', null, chest.clone().addScaledVector(dir, 14).add(new THREE.Vector3(0, 9, 0)));
        o.state = 'homing';
        o.vel.set(0, -2, 0);
        this.ctx.toast('An Eye is falling towards you — catch it!', 'power');
      }
    }

    // only light the 4 nearest orbs (point lights are expensive)
    const sorted = this.orbs.filter((o) => o.state !== 'gone').sort((a, b) => a.group.position.distanceToSquared(chest) - b.group.position.distanceToSquared(chest));
    sorted.forEach((o, i) => (o.light.visible = i < 4));

    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      (o.flame.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time + o.phase;
      switch (o.state) {
        case 'idle': {
          const base = o.nest!.pos;
          o.group.position.set(base.x, base.y + Math.sin(this.time * 2 + o.phase) * 0.15, base.z);
          o.group.lookAt(chest);
          const d = o.group.position.distanceTo(chest);
          if (d < 6 && !player.busy && player.alive) {
            // the eye notices you and flies into your hand
            o.state = 'homing';
            o.vel.set(0, 2.5, 0);
          }
          break;
        }
        case 'homing': {
          const to = hand.clone().sub(o.group.position);
          const d = to.length();
          o.vel.lerp(to.normalize().multiplyScalar(Math.min(14, 4 + d * 2)), Math.min(1, dt * 5));
          o.group.position.addScaledVector(o.vel, dt);
          o.group.rotation.x += dt * 10;
          o.group.rotation.y += dt * 7;
          if (Math.random() < 0.4) this.ctx.effects.sparks3(o.group.position, COLORS[o.type].flame, 1, 1.5, 0.25, -1);
          if (d < 0.9 && !player.busy) {
            const ok = player.catchEye(o.type, () => {
              o.state = 'gone';
              o.group.visible = false;
              o.timer = RESPAWN;
            });
            if (ok) o.state = 'held';
          }
          if (o.nest && o.group.position.distanceTo(o.nest.pos) > 30) this.returnHome(o);
          break;
        }
        case 'held': {
          // catch interrupted (hit, respawn…): the eye escapes back to its nest
          if (player.state !== PState.Catch && player.state !== PState.Absorb) {
            if (o.nest) this.returnHome(o);
            else o.state = 'gone';
            break;
          }
          // follows the glove, then shrinks into the chest during absorb
          const absorbing = player.state === PState.Absorb;
          const target = absorbing ? player.rig.chestSocket.getWorldPosition(new THREE.Vector3()) : hand;
          o.group.position.lerp(target, Math.min(1, dt * (absorbing ? 6 : 20)));
          o.group.lookAt(this.ctx.renderer.camera.position);
          const s = absorbing ? Math.max(0.05, o.group.scale.x - dt * 1.3) : 1;
          o.group.scale.setScalar(s);
          break;
        }
        case 'gone': {
          if (!o.nest) {
            o.group.removeFromParent();
            this.orbs.splice(i, 1);
            break;
          }
          o.timer -= dt;
          if (o.timer <= 0) this.returnHome(o);
          break;
        }
      }
    }
  }

  private returnHome(o: Orb) {
    if (!o.nest) {
      o.state = 'gone';
      o.timer = 0;
      return;
    }
    o.state = 'idle';
    o.group.visible = true;
    o.group.scale.setScalar(1);
    o.group.position.copy(o.nest.pos);
    this.ctx.effects.sparks3(o.nest.pos, COLORS[o.type].flame, 16, 4);
  }

  /** Reset all orbs (e.g. on mode change). */
  reset() {
    for (const o of this.orbs) if (o.nest) this.returnHome(o);
  }
}
