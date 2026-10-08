import * as THREE from 'three';
import type { World } from '../world/World';
import type { Profile } from './Profile';
import type { Effects } from '../vfx/Effects';
import type { AudioEngine } from '../audio/Audio';
import type { Agent, AgentKind, BossKind } from '../ai/Agents';
import { markerTexture, softDotTexture } from '../world/Textures';
import { makeRng } from '../core/math';

export type MissionType = 'race' | 'climb' | 'collect' | 'survive' | 'koth' | 'delivery' | 'boss' | 'chase' | 'horde';

export interface MissionDef {
  id: string;
  name: string;
  island: string;
  type: MissionType;
  desc: string;
  time: number;
  reward: number;
  /** Island anchor list used for targets. */
  anchor: string;
  /** Destination island for deliveries. */
  dest?: string;
  count?: number;
  needVehicle?: boolean;
  /** Big fly-through rings (glide courses). */
  glide?: boolean;
  /** Start the mission standing on this anchor instead of the island spawn. */
  startAnchor?: string;
  /** Boss missions: which island boss. */
  boss?: BossKind;
  /** Multi-stop deliveries (taxi): island ids in order. */
  dests?: string[];
  /** Flow runs: keep the Flow meter at this tier or above between rings (4 s grace). */
  flow?: number;
}

export const MISSIONS: MissionDef[] = [
  { id: 'lotus_leap', name: 'Lotus Leap', island: 'colombo', type: 'race', anchor: 'lotusRings', time: 150, reward: 250, desc: 'Fly through the sky rings around the Lotus Tower. Pads spiral up the shaft — Sky Eyes help.' },
  { id: 'tuktuk_rush', name: 'Tuk-Tuk Rush', island: 'colombo', type: 'delivery', anchor: 'station', dest: 'ella', time: 120, reward: 300, needVehicle: true, desc: 'Grab a tuk-tuk and race the bridge to Ella station before the tea goes cold.' },
  { id: 'nine_arch', name: 'Nine Arch Express', island: 'ella', type: 'race', anchor: 'nineArch', time: 70, reward: 220, desc: 'Sprint the Nine Arch Bridge, arch by arch, before the train catches you.' },
  { id: 'lion_rock', name: "Lion's Rock", island: 'sigiriya', type: 'climb', anchor: 'summit', time: 120, reward: 250, desc: 'Through the paw gate and up the mirror stairs to the summit palace.' },
  { id: 'marble_eyes', name: 'Marble Eyes', island: 'taj', type: 'collect', anchor: 'gardens', time: 120, reward: 250, desc: 'Ink drops are scattered through the gardens. Collect them all.' },
  { id: 'serpent_steps', name: 'Serpent Steps', island: 'chichen', type: 'koth', anchor: 'pyramidTopFloor', count: 25, time: 150, reward: 320, desc: 'Hold the top of El Castillo for 25 seconds while the Agents climb.' },
  { id: 'cloud_citadel', name: 'Cloud Citadel', island: 'machu', type: 'race', anchor: 'terraces', time: 120, reward: 250, desc: 'Parkour up the Inca terraces to the Temple of the Sun.' },
  { id: 'gladiator', name: 'Gladiator Ink', island: 'colosseum', type: 'survive', anchor: 'arenaSpawns', count: 12, time: 180, reward: 400, desc: 'Three waves of Agents in the arena. Ink twelve of them.' },
  { id: 'rose_relics', name: 'Rose City Relics', island: 'petra', type: 'collect', anchor: 'relics', time: 150, reward: 300, desc: 'Relics hide in the Siq — and two high on the Treasury.' },
  { id: 'dragon_run', name: "Dragon's Spine", island: 'greatwall', type: 'race', anchor: 'wall', time: 140, reward: 300, desc: 'Run the Great Wall tower to tower.' },
  { id: 'redeemer', name: 'Open Arms', island: 'rio', type: 'climb', anchor: 'hands', time: 200, reward: 400, desc: "Reach the Redeemer's hand. Cable car, super-jump, or both." },
  { id: 'speedway', name: 'Speedway Lap', island: 'speedway', type: 'race', anchor: 'track', time: 75, reward: 350, needVehicle: true, desc: 'One flying lap of the Ink Docks circuit. Drift with Space, nitro with Shift.' },
  { id: 'sky_line', name: 'Sky Line', island: 'colombo', type: 'race', anchor: 'skyLine', startAnchor: 'lotusTop', glide: true, time: 90, reward: 380, desc: 'Leap off the Lotus Tower and glide through the rings all the way to Ella. Jump, then hold Space. Shift boosts, C dives.' },
  { id: 'cable_rush', name: 'Cable Rush', island: 'ella', type: 'race', anchor: 'zipRings', time: 150, reward: 300, desc: 'Ride the zip-lines over the stacks. Every ring hangs under a cable: grab with F or jump into the line.' },
  { id: 'rampart_run', name: 'Rampart Run', island: 'galle', type: 'race', anchor: 'ramparts', time: 110, reward: 300, desc: 'Lap the star-fort walls of Galle, bastion to bastion, before the tide turns.' },
  { id: 'pilgrim_dawn', name: "Pilgrim's Dawn", island: 'adamspeak', type: 'race', anchor: 'pilgrim', time: 120, reward: 320, desc: "Race the lamp-lit stair to the top of Adam's Peak. Every landing is a checkpoint." },
  { id: 'lotus_buds', name: 'Five Lotus Buds', island: 'angkor', type: 'collect', anchor: 'buds', time: 150, reward: 340, desc: 'Cross the causeway, scale the temple mountain and touch the crown of all five towers.' },
  { id: 'pharaoh_climb', name: "Pharaoh's Climb", island: 'giza', type: 'race', anchor: 'pyramidTops', time: 180, reward: 420, desc: 'Summit all three pyramids, smallest to greatest. Every tier is a jump.' },
  { id: 'ink_cab', name: 'Ink Cab', island: 'colombo', type: 'delivery', anchor: 'station', dests: ['ella', 'sigiriya', 'taj'], time: 300, reward: 450, needVehicle: true, desc: 'Three fares across the ring: Ella, Sigiriya, then the Taj. Keep the meter running.' },
  { id: 'island_gp', name: 'Island Grand Prix', island: 'colombo', type: 'race', anchor: 'ringRace', time: 200, reward: 500, needVehicle: true, desc: 'Bridge to bridge to bridge: race the ring road from Colombo to the Taj.' },
  { id: 'courier', name: 'Tail the Courier', island: 'petra', type: 'chase', anchor: 'courierRoute', count: 15, time: 150, reward: 420, needVehicle: true, desc: 'An Agent courier is flying the stolen ink out. Stay on its tail for 15 seconds before it escapes.' },
  { id: 'horde', name: 'Horde Night', island: 'agenthq', type: 'horde', anchor: 'arenaSpawns', time: 1800, reward: 0, desc: 'Endless waves in the HQ arena. Every fifth wave brings a boss. How long can you last?' },
  { id: 'warden', name: 'The Warden', island: 'agenthq', type: 'boss', anchor: 'arenaSpawns', time: 240, reward: 800, desc: 'Face the Warden in the HQ arena. Bring every Eye you have.' },
  { id: 'lion_guardian', name: 'Lion Guardian', island: 'sigiriya', type: 'boss', boss: 'lion', anchor: 'gate', time: 240, reward: 650, desc: 'The stone lion of the paw gate wakes up. It pounces — dodge the landing shockwave, then punish.' },
  { id: 'kukulkan', name: 'Kukulkan', island: 'chichen', type: 'boss', boss: 'serpent', anchor: 'pyramidTopFloor', time: 240, reward: 700, desc: 'The feathered serpent circles El Castillo. It is armoured in the air: dodge its dive, then hit it while it is dazed.' },
  { id: 'spire_climb', name: 'The Ink Spire', island: 'metro', type: 'climb', anchor: 'spireTop', time: 240, reward: 500, desc: 'Run the spiral ramp — or wall-run, grapple and super-jump — to the observation deck 110 m up.' },
  { id: 'metro_flow', name: 'Rooftop Flow', island: 'metro', type: 'race', anchor: 'rooftops', flow: 1, time: 150, reward: 520, desc: 'A flow run over the rooftop row. Keep your Flow burning — chain jumps, wall-runs and rope bridges. Drop to zero for 4 s and the run is over.' },
  { id: 'spire_dive', name: 'Spire Dive', island: 'metro', type: 'race', anchor: 'diveRings', startAnchor: 'spireTop', glide: true, time: 90, reward: 480, desc: 'Leap off the Ink Spire and glide through the rings down to the Central Park lake.' },
  { id: 'expressway', name: 'Expressway Rush', island: 'metro', type: 'race', anchor: 'highway', needVehicle: true, time: 70, reward: 450, desc: 'Up the on-ramp, flat out along the elevated expressway, and down the far side.' },
  { id: 'downtown_brawl', name: 'Downtown Brawl', island: 'metro', type: 'survive', anchor: 'plazaSpawns', count: 16, time: 200, reward: 520, desc: 'The Agents take the Spire plaza. Ink sixteen of them.' },
  { id: 'gladiator_king', name: 'Gladiator King', island: 'colosseum', type: 'boss', boss: 'gladiator', anchor: 'arenaSpawns', time: 240, reward: 700, desc: 'Shield, spin attack and thrown spears. Break the shield with a tackle or an explosion, or get behind him.' },
];

export interface MissionHost {
  world: World;
  profile: Profile;
  effects: Effects;
  audio: AudioEngine;
  scene: THREE.Scene;
  playerPos(): THREE.Vector3;
  inVehicle(): boolean;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  spawnMissionAgent(pos: THREE.Vector3, boss: boolean | BossKind, kind?: AgentKind): Agent;
  /** Horde results: pay out and record the best wave. */
  onHordeOver?(wave: number): void;
  clearMissionAgents(): void;
  onComplete?(def: MissionDef): void;
  /** Online, not host: combat missions mirror the host (no local spawns or win checks). */
  mirror?(): boolean;
  /** Mission lifecycle hooks (ghosts, time trials). */
  onStart?(def: MissionDef): void;
  /** Returns an extra line for the result toast. */
  onEnd?(def: MissionDef, success: boolean, time: number, prevBest: number | undefined): string;
  /** The player's Flow tier (flow runs). */
  flowTier?(): number;
}

interface Active {
  def: MissionDef;
  t: number;
  targets: THREE.Vector3[];
  index: number;
  objects: THREE.Object3D[];
  defeats: number;
  hold: number;
  waveTimer: number;
  spawned: number;
  boss: Agent | null;
  /** Flow runs: seconds spent below the required Flow tier. */
  flowLow: number;
  /** Chase: the fleeing courier, its progress along the route and how long you've stayed on it. */
  courier?: { mesh: THREE.Object3D; s: number; route: THREE.Vector3[]; lens: number[] };
}

/** Agents in a horde wave. */
function hordeSize(wave: number): number {
  return wave % 5 === 0 ? 3 + wave : 3 + wave * 2;
}

/** Who shows up as the waves climb. */
function hordeKind(wave: number, i: number): AgentKind {
  const pool: AgentKind[] = ['agent', 'runner'];
  if (wave >= 3) pool.push('shield');
  if (wave >= 4) pool.push('sniper', 'brute');
  if (wave >= 6) pool.push('drone');
  if (wave >= 8) pool.push('static', 'drone');
  return pool[(i * 7 + wave * 3) % pool.length];
}

const ringGeo = new THREE.TorusGeometry(3, 0.35, 8, 32);
const dropGeo = new THREE.IcosahedronGeometry(0.45, 1);

function beaconMaterial(color: string) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
}

/** Mission markers, active mission logic and rewards. */
export class MissionManager {
  active: Active | null = null;
  private markers: Array<{ def: MissionDef; pos: THREE.Vector3; group: THREE.Group }> = [];
  private targetBeacon: THREE.Mesh;
  private time = 0;
  /** Mission near the player that can be started (for the HUD prompt). */
  nearby: MissionDef | null = null;

  constructor(private host: MissionHost) {
    for (const def of MISSIONS) {
      const isl = host.world.island(def.island);
      if (!isl) continue;
      // beacons of the same island stand in a row, 7 m apart
      const same = MISSIONS.filter((m) => m.island === def.island);
      const k = same.indexOf(def) - (same.length - 1) / 2;
      const inward = isl.center.clone().sub(isl.spawn).setY(0).normalize();
      const side = new THREE.Vector3(-inward.z, 0, inward.x);
      const pos = isl.spawn.clone().addScaledVector(inward, 6).addScaledVector(side, k * 7);
      pos.y = 0;
      const g = new THREE.Group();
      const color = def.type === 'boss' ? '#6b2bff' : def.needVehicle ? '#ffd27a' : def.type === 'survive' || def.type === 'koth' ? '#ff7a1a' : '#17a9a3';
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 60, 16, 1, true), beaconMaterial(color));
      beam.position.y = 30;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.12, 6, 32), new THREE.MeshBasicMaterial({ color }));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.1;
      const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(color, def.type === 'boss' ? '☠' : def.needVehicle ? '⚑' : '!'), depthTest: false }));
      icon.scale.set(1.6, 1.6, 1);
      icon.position.y = 3.2;
      icon.renderOrder = 11;
      g.add(beam, ring, icon);
      g.position.copy(pos);
      host.scene.add(g);
      this.markers.push({ def, pos, group: g });
    }
    this.targetBeacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 80, 12, 1, true), beaconMaterial('#ffd27a'));
    this.targetBeacon.visible = false;
    host.scene.add(this.targetBeacon);
  }

  markerPositions(): Array<{ def: MissionDef; pos: THREE.Vector3 }> {
    return this.markers.map((m) => ({ def: m.def, pos: m.pos }));
  }

  start(def: MissionDef) {
    if (this.active) this.end(false, true);
    const isl = this.host.world.island(def.island);
    if (!isl) return;
    let targets = (isl.anchors[def.anchor] ?? []).map((p) => p.clone());
    if (def.type === 'delivery') {
      const ids = def.dests ?? [def.dest!];
      targets = ids.map((id) => this.host.world.island(id)?.spawn.clone()).filter((p): p is THREE.Vector3 => !!p);
    }
    if (!targets.length) {
      this.host.toast('Mission data missing', 'warn');
      return;
    }
    const a: Active = { def, t: def.time, targets, index: 0, objects: [], defeats: 0, hold: 0, waveTimer: 1, spawned: 0, boss: null, flowLow: 0 };
    this.active = a;
    if (def.type === 'race') {
      targets.forEach((p, i) => {
        const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: i === targets.length - 1 ? '#ffd27a' : '#17a9a3', transparent: true, opacity: 0.85 }));
        r.position.copy(p).add(new THREE.Vector3(0, def.needVehicle ? 1.5 : 1.2, 0));
        const next = targets[i + 1] ?? targets[i - 1];
        if (next) r.lookAt(next.clone().add(new THREE.Vector3(0, 1.2, 0)));
        if (def.needVehicle) r.scale.setScalar(2.2);
        if (def.glide) r.scale.setScalar(2.6);
        this.host.scene.add(r);
        a.objects.push(r);
      });
    } else if (def.type === 'collect') {
      const mat = new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.1, metalness: 0.4, emissive: '#17a9a3', emissiveIntensity: 0.6 });
      for (const p of targets) {
        const m = new THREE.Mesh(dropGeo, mat);
        m.position.copy(p).add(new THREE.Vector3(0, 0.6, 0));
        m.scale.set(1, 1.4, 1);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: '#17a9a3', blending: THREE.AdditiveBlending, depthWrite: false }));
        glow.scale.setScalar(2.4);
        m.add(glow);
        this.host.scene.add(m);
        a.objects.push(m);
      }
    }
    if (def.type === 'chase') {
      // the courier: a getaway glider flying the route, a little ahead of you
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.8, 3.2, 6), new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.3, metalness: 0.5, emissive: '#ff2a4a', emissiveIntensity: 0.35 }));
      body.rotation.x = Math.PI / 2;
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 0.08, 1), new THREE.MeshStandardMaterial({ color: '#ff2a4a', roughness: 0.4 }));
      wing.position.z = -0.4;
      mesh.add(body, wing);
      mesh.userData.noMap = true;
      this.host.scene.add(mesh);
      a.objects.push(mesh);
      const route = targets;
      const lens = route.slice(1).map((p, i) => p.distanceTo(route[i]));
      a.courier = { mesh, s: 0, route, lens };
    }
    this.host.onStart?.(def);
    this.host.audio.play('catch');
    this.host.toast(`MISSION · ${def.name}`, 'power');
  }

  /** The player went down: ends a horde run with its results. */
  onPlayerKO() {
    const a = this.active;
    if (!a || a.def.type !== 'horde') return;
    const wave = Math.max(1, a.hold);
    this.end(false, true);
    this.host.onHordeOver?.(wave);
  }

  /** Called by the game whenever an Agent is inked. */
  onDefeat(agent: Agent) {
    const a = this.active;
    if (!a || !(agent as Agent & { missionTag?: boolean }).missionTag) return;
    a.defeats++;
    if (a.boss === agent) this.end(true);
  }

  end(success: boolean, silent = false) {
    const a = this.active;
    if (!a) return;
    for (const o of a.objects) o.removeFromParent();
    this.active = null;
    this.targetBeacon.visible = false;
    this.host.clearMissionAgents();
    const time = a.def.time - a.t;
    const prev = this.host.profile.data.best[a.def.id];
    const extra = this.host.onEnd?.(a.def, success && !silent, time, prev) ?? '';
    if (silent) return;
    if (success) {
      this.host.profile.completeMission(a.def.id, time, a.def.reward);
      this.host.onComplete?.(a.def);
      this.host.toast(`MISSION COMPLETE · +${a.def.reward} Ink · ${time.toFixed(1)} s${prev === undefined || time < prev ? ' · NEW BEST' : ''}${extra}`, 'power');
      this.host.audio.play('absorb');
      this.host.effects.shockwave(this.host.playerPos(), '#ffd27a', 5);
    } else {
      this.host.toast(`Mission failed · ${a.def.name}`, 'warn');
      this.host.audio.play('hurt');
    }
  }

  /** Text for the HUD. */
  hud(): { name: string; objective: string; progress: string; time: number; target: THREE.Vector3 | null } | null {
    const a = this.active;
    if (!a) return null;
    const d = a.def;
    let objective = d.desc;
    let progress = '';
    let target: THREE.Vector3 | null = a.targets[Math.min(a.index, a.targets.length - 1)];
    switch (d.type) {
      case 'race':
        objective = d.flow ? `Keep the Flow burning (×${d.flow}+) through the rings` : d.needVehicle ? 'Drive through the rings' : 'Pass through the rings';
        progress = `${a.index}/${a.targets.length}`;
        if (d.flow && a.flowLow > 0.3) progress += ` · FLOW DROPPING ${Math.max(0, 4 - a.flowLow).toFixed(1)}s`;
        break;
      case 'collect':
        objective = 'Collect the ink drops';
        progress = `${a.index}/${a.targets.length}`;
        target = null;
        for (const o of a.objects) if (o.visible) target = o.position;
        break;
      case 'climb':
        objective = 'Reach the marker';
        break;
      case 'delivery':
        objective = !this.host.inVehicle() ? 'Get in a vehicle (F)' : a.targets.length > 1 ? `Fare ${a.index + 1}: drive to ${this.host.world.island((d.dests ?? [])[a.index])?.def.name ?? 'the stop'}` : 'Drive to the destination';
        if (a.targets.length > 1) progress = `${a.index}/${a.targets.length} fares`;
        break;
      case 'chase':
        objective = !this.host.inVehicle() ? 'Get in a vehicle (F) and tail the courier' : 'Stay within 30 m of the courier';
        progress = `${a.hold.toFixed(1)}/${d.count ?? 15} s on its tail`;
        target = a.courier?.mesh.position ?? target;
        break;
      case 'survive':
        objective = 'Ink the Agents';
        progress = `${a.defeats}/${d.count}`;
        break;
      case 'koth':
        objective = 'Hold the summit';
        progress = `${a.hold.toFixed(0)}/${d.count} s`;
        break;
      case 'horde': {
        const left = a.spawned - a.defeats + Math.max(0, hordeSize(a.hold) - a.spawned);
        objective = a.waveTimer > 0 && a.spawned === 0 ? `Wave ${a.hold} incoming…` : 'Survive the horde';
        progress = `Wave ${a.hold} · ${left} left`;
        target = null;
        break;
      }
      case 'boss':
        objective = `Defeat ${a.boss?.bossName ?? 'the boss'}`;
        progress = a.boss ? `${a.boss.bossName} · ${Math.max(0, Math.round(a.boss.hp))} HP` : '';
        target = a.boss?.feet ?? target;
        break;
    }
    return { name: d.name, objective, progress, time: a.t, target };
  }

  update(dt: number) {
    this.time += dt;
    const p = this.host.playerPos();
    // markers: bob + prompt
    this.nearby = null;
    for (const m of this.markers) {
      const icon = m.group.children[2];
      icon.position.y = 3.2 + Math.sin(this.time * 2 + m.pos.x) * 0.25;
      m.group.visible = !this.active && m.pos.distanceTo(p) < 500;
      if (!this.active && Math.hypot(m.pos.x - p.x, m.pos.z - p.z) < 3.5 && Math.abs(m.pos.y - p.y) < 3) this.nearby = m.def;
    }
    const a = this.active;
    if (!a) return;
    a.t -= dt;
    if (a.t <= 0) {
      this.end(false);
      return;
    }
    const d = a.def;
    if (this.host.mirror?.() && (d.type === 'survive' || d.type === 'koth' || d.type === 'boss' || d.type === 'horde')) {
      a.t = Math.max(a.t, 1);
      return;
    }
    const target = a.targets[Math.min(a.index, a.targets.length - 1)];
    const radius = d.needVehicle ? 9 : d.glide ? 7 : 3.6;
    switch (d.type) {
      case 'race': {
        a.objects.forEach((o, i) => {
          o.visible = i >= a.index;
          const s = (d.needVehicle ? 2.2 : d.glide ? 2.6 : 1) * (i === a.index ? 1 + Math.sin(this.time * 6) * 0.08 : 0.8);
          o.scale.setScalar(s);
        });
        if (d.needVehicle && !this.host.inVehicle()) break;
        // flow runs: once the first ring is through, the Flow meter must keep burning
        if (d.flow && a.index > 0 && this.host.flowTier) {
          if (this.host.flowTier() < d.flow) {
            a.flowLow += dt;
            if (a.flowLow > 4) {
              this.host.toast('Flow broken — the run is over. Chain moves to keep it burning.', 'warn');
              this.end(false);
              return;
            }
          } else a.flowLow = 0;
        }
        if (p.distanceTo(target.clone().add(new THREE.Vector3(0, 1.2, 0))) < radius) {
          this.host.audio.play('ui');
          this.host.effects.sparks3(target.clone().add(new THREE.Vector3(0, 1.2, 0)), '#17a9a3', 16, 5);
          a.index++;
          if (a.index >= a.targets.length) this.end(true);
        }
        break;
      }
      case 'collect': {
        a.objects.forEach((o) => {
          if (!o.visible) return;
          o.rotation.y += dt * 2;
          if (o.position.distanceTo(p.clone().add(new THREE.Vector3(0, 0.8, 0))) < 1.9) {
            o.visible = false;
            a.index++;
            this.host.audio.play('ui');
            this.host.effects.sparks3(o.position, '#17a9a3', 14, 4);
            if (a.index >= a.targets.length) this.end(true);
          }
        });
        break;
      }
      case 'climb':
        if (p.distanceTo(target) < 3.5 || (a.targets.length > 1 && a.targets.some((t) => p.distanceTo(t) < 3.5))) this.end(true);
        break;
      case 'delivery':
        if (this.host.inVehicle() && Math.hypot(p.x - target.x, p.z - target.z) < 14) {
          a.index++;
          if (a.index >= a.targets.length) this.end(true);
          else {
            this.host.audio.play('ui', { pitch: 1.4 });
            this.host.toast(`Fare dropped! Next stop: ${this.host.world.island((d.dests ?? [])[a.index])?.def.name ?? ''}`, 'info');
          }
        }
        break;
      case 'chase': {
        const c = a.courier!;
        const pos = c.mesh.position;
        const dist = Math.hypot(p.x - pos.x, p.z - pos.z);
        // rubber band: waits for you when far, bolts when you are close
        const speed = dist > 60 ? 8 : dist > 30 ? 15 : 21;
        c.s += speed * dt;
        let s = c.s;
        let i = 0;
        while (i < c.lens.length && s > c.lens[i]) s -= c.lens[i++];
        if (i >= c.lens.length) {
          this.end(false);
          this.host.toast('The courier got away.', 'warn');
          break;
        }
        const from = c.route[i];
        const to = c.route[i + 1];
        pos.copy(from).lerp(to, s / c.lens[i]);
        pos.y += Math.sin(this.time * 2) * 0.4;
        c.mesh.lookAt(to);
        if (this.host.inVehicle() && dist < 30) {
          a.hold += dt;
          if (Math.random() < 0.3) this.host.effects.sparks3(pos, '#ff2a4a', 2, 2, 0.25, 0);
        }
        if (a.hold >= (d.count ?? 15)) this.end(true);
        break;
      }
      case 'survive': {
        a.waveTimer -= dt;
        const alive = a.spawned - a.defeats;
        if (a.waveTimer <= 0 && alive < 4 && a.spawned < (d.count ?? 12)) {
          const sp = a.targets[a.spawned % a.targets.length];
          this.host.spawnMissionAgent(sp, false);
          a.spawned++;
          a.waveTimer = alive < 2 ? 0.6 : 2.5;
        }
        if (a.defeats >= (d.count ?? 12)) this.end(true);
        break;
      }
      case 'koth': {
        if (p.distanceTo(target) < 6) a.hold += dt;
        a.waveTimer -= dt;
        if (a.waveTimer <= 0 && a.spawned - a.defeats < 4) {
          const ang = a.spawned * 1.7;
          this.host.spawnMissionAgent(target.clone().add(new THREE.Vector3(Math.cos(ang) * 5, 0, Math.sin(ang) * 5)), false);
          a.spawned++;
          a.waveTimer = 6;
        }
        if (a.hold >= (d.count ?? 25)) this.end(true);
        break;
      }
      case 'horde': {
        // a.hold = wave number, a.spawned/a.defeats count within the wave
        if (a.hold === 0) {
          a.hold = 1;
          a.waveTimer = 3;
        }
        a.t = d.time; // no clock: the run lasts until you drop
        const size = hordeSize(a.hold);
        if (a.waveTimer > 0) {
          a.waveTimer -= dt;
          break;
        }
        const alive = a.spawned - a.defeats;
        if (a.spawned < size && alive < Math.min(8, 3 + a.hold)) {
          const sp = a.targets[a.spawned % a.targets.length].clone();
          const bossWave = a.hold % 5 === 0 && a.spawned === 0;
          const boss: BossKind | false = bossWave ? (['gladiator', 'lion', 'warden'] as BossKind[])[(a.hold / 5 - 1) % 3] : false;
          this.host.spawnMissionAgent(sp, boss, bossWave ? undefined : hordeKind(a.hold, a.spawned));
          a.spawned++;
        }
        if (a.spawned >= size && a.defeats >= size) {
          this.host.audio.play('absorb');
          this.host.toast(`Wave ${a.hold} cleared!  +${a.hold * 20} Ink`, 'power');
          this.host.profile.addInk(a.hold * 20);
          a.hold++;
          a.spawned = 0;
          a.defeats = 0;
          a.waveTimer = 6;
        }
        break;
      }
      case 'boss': {
        if (!a.boss) {
          a.boss = this.host.spawnMissionAgent(a.targets[0], d.boss ?? true);
          a.spawned++;
        }
        a.waveTimer -= dt;
        if (a.waveTimer <= 0 && a.spawned - a.defeats < 4) {
          this.host.spawnMissionAgent(a.targets[(a.spawned + 1) % a.targets.length], false);
          a.spawned++;
          a.waveTimer = 9;
        }
        break;
      }
    }
    const hud = this.hud();
    if (hud?.target) {
      this.targetBeacon.visible = true;
      this.targetBeacon.position.copy(hud.target).add(new THREE.Vector3(0, 40, 0));
    } else this.targetBeacon.visible = false;
  }
}

/** Collectible ink drops scattered around every island (+5 Ink each). */
export class InkDrops {
  private mesh: THREE.InstancedMesh;
  private pts: THREE.Vector3[] = [];
  private gone: number[] = [];
  private time = 0;

  constructor(scene: THREE.Scene, world: World, private onCollect: (n: number) => void) {
    const rng = makeRng(808);
    for (const isl of world.islands) {
      for (let i = 0; i < 9; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(8, isl.def.radius * 0.55);
        const x = isl.spawn.x + Math.cos(a) * r * 0.6;
        const z = isl.spawn.z + Math.sin(a) * r * 0.6;
        this.pts.push(new THREE.Vector3(x, 1.0, z));
      }
    }
    for (let i = 0; i < 24; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(5, 38);
      this.pts.push(new THREE.Vector3(Math.cos(a) * r, 1.0, Math.sin(a) * r + 5));
    }
    this.gone = this.pts.map(() => 0);
    this.mesh = new THREE.InstancedMesh(dropGeo, new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.08, metalness: 0.5, emissive: '#6b2bff', emissiveIntensity: 0.35 }), this.pts.length);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Snap drops onto whatever is below them (call once after physics settles). */
  settle(ground: (p: THREE.Vector3) => number) {
    for (const p of this.pts) p.y = ground(p) + 0.9;
  }

  update(dt: number, player: THREE.Vector3) {
    this.time += dt;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    this.pts.forEach((p, i) => {
      if (this.gone[i] > 0) {
        this.gone[i] -= dt;
        s.setScalar(0);
      } else {
        s.set(1, 1.4, 1);
        if (p.distanceToSquared(player.clone().add(new THREE.Vector3(0, 0.9, 0))) < 2.6) {
          this.gone[i] = 90;
          this.onCollect(5);
        }
      }
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.time * 2 + i);
      m.compose(p.clone().setY(p.y + Math.sin(this.time * 2.5 + i) * 0.15), q, s);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
