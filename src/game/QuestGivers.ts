import * as THREE from 'three';
import { CharacterRig } from '../character/CharacterRig';
import { Animator, AnimState } from '../character/Animator';
import { AGENT_APPEARANCE, DEFAULT_APPEARANCE, type Appearance } from '../character/Appearance';
import type { Profile } from './Profile';
import { markerTexture } from '../world/Textures';

interface QuestDef {
  id: string;
  ask: string;
  /** Progress is the rise of this profile counter since the quest was accepted. */
  counter: string;
  goal: number;
  reward: number;
  thanks: string;
}

interface NpcDef {
  id: string;
  name: string;
  island: string;
  offset: [number, number];
  look: Partial<Appearance['colors']> & { hat?: Appearance['hat'] };
  greet: string;
  quests: QuestDef[];
  pitch: number;
}

const NPCS: NpcDef[] = [
  {
    id: 'photographer', name: 'Pixel', island: 'hub', offset: [0, 0], look: { top: '#ff7a1a', hat: 'cap' }, pitch: 1.3,
    greet: 'Hey Blank! The city looks better through a lens.',
    quests: [
      { id: 'snap1', ask: 'Take a photo for my wall — press K for photo mode, then Space to snap.', counter: 'photos', goal: 1, reward: 80, thanks: 'Gorgeous. You have an eye for this.' },
      { id: 'zip1', ask: 'Ride three zip-lines. I want action shots!', counter: 'zips', goal: 3, reward: 120, thanks: 'Perfect blur. Thanks!' },
    ],
  },
  {
    id: 'vendor', name: 'Auntie Kamala', island: 'colombo', offset: [5, 3], look: { top: '#17a9a3' }, pitch: 1.2,
    greet: 'Aiyo, the Agents broke my stall again!',
    quests: [
      { id: 'crates1', ask: 'Crack open two loot crates and bring me luck.', counter: 'crates', goal: 2, reward: 120, thanks: 'Lucky child! Take this.' },
      { id: 'defeat1', ask: 'Ink five Agents so I can sell in peace.', counter: 'defeats', goal: 5, reward: 180, thanks: 'Peace and quiet. Bless you.' },
    ],
  },
  {
    id: 'keeper', name: 'Lighthouse Keeper', island: 'galle', offset: [4, -4], look: { top: '#eceae6', hat: 'beanie' }, pitch: 0.8,
    greet: 'The lamp still turns. Barely.',
    quests: [{ id: 'eyes1', ask: 'Catch two Eyes for the lamp. It burns on them.', counter: 'eyes', goal: 2, reward: 160, thanks: 'Look at it shine.' }],
  },
  {
    id: 'picker', name: 'Tea Picker Nila', island: 'ella', offset: [5, 4], look: { top: '#3a7a3a' }, pitch: 1.25,
    greet: 'The best leaves grow where the Agents never walk.',
    quests: [{ id: 'wall1', ask: 'Wall-run ten times — show me how you climb so fast.', counter: 'wallruns', goal: 10, reward: 140, thanks: 'Like a monkey on the terraces!' }],
  },
  {
    id: 'mechanic', name: 'Gearbox', island: 'speedway', offset: [6, 2], look: { top: '#2a2a30', hat: 'beanie' }, pitch: 0.9,
    greet: 'You drive like you mean it. I like that.',
    quests: [{ id: 'ram1', ask: 'Ram three Agents with any vehicle. Paint job’s on me.', counter: 'rams', goal: 3, reward: 220, thanks: 'Ha! Dents are character.' }],
  },
  {
    id: 'archaeologist', name: 'Dr. Ostrava', island: 'angkor', offset: [5, -3], look: { top: '#c8a060', hat: 'bucket' }, pitch: 1.0,
    greet: 'Every stone here remembers something.',
    quests: [{ id: 'coll1', ask: 'Find two collectibles anywhere — stickers, tags, logs.', counter: 'collectibles', goal: 2, reward: 200, thanks: 'Fascinating. Into the archive they go.' }],
  },
  {
    id: 'guide', name: 'Desert Guide Amun', island: 'giza', offset: [5, 4], look: { top: '#e8d8b0', hat: 'hood' }, pitch: 0.85,
    greet: 'The Sphinx watches the bridge. So do I.',
    quests: [{ id: 'grap1', ask: 'Grapple five times. Up here, ropes save lives.', counter: 'grapples', goal: 5, reward: 180, thanks: 'Now you climb like the builders did.' }],
  },
];

export interface QuestHost {
  scene: THREE.Scene;
  profile: Profile;
  islandSpawn(id: string): THREE.Vector3 | null;
  /** The story may claim a talk (returns true when it did). */
  storyTalk(npc: string): boolean;
  say(who: string, text: string, pitch: number): void;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  addXp(n: number): void;
  event(name: string): void;
}

interface Npc {
  def: NpcDef;
  rig: CharacterRig;
  anim: Animator;
  pos: THREE.Vector3;
  marker: THREE.Sprite;
  markerKind: string;
}

/**
 * Quest-givers: named locals on the islands with side jobs. Talk with F:
 * accept a job, check progress, or hand it in for Ink and XP.
 */
export class QuestGivers {
  private npcs: Npc[] = [];

  constructor(private h: QuestHost) {
    for (const def of NPCS) {
      const base = def.island === 'hub' ? new THREE.Vector3(6, 0.2, 26) : h.islandSpawn(def.island);
      if (!base) continue;
      const look: Appearance = structuredClone(def.id === 'keeper' ? AGENT_APPEARANCE : DEFAULT_APPEARANCE);
      look.colors.top = def.look.top ?? look.colors.top;
      if (def.look.hat) look.hat = def.look.hat;
      look.print = '';
      const rig = new CharacterRig(look);
      const pos = base.clone().add(new THREE.Vector3(def.offset[0], 0, def.offset[1]));
      rig.root.position.copy(pos);
      h.scene.add(rig.root);
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture('#ffd27a', '!'), depthTest: false }));
      marker.scale.set(0.9, 0.9, 1);
      marker.renderOrder = 11;
      marker.position.copy(pos).add(new THREE.Vector3(0, 2.8, 0));
      h.scene.add(marker);
      this.npcs.push({ def, rig, anim: new Animator(rig), pos, marker, markerKind: '!' });
    }
  }

  private state(id: string): { stage: number; base: number; active: boolean } {
    const q = this.h.profile.data.quests;
    return (q[id] ??= { stage: 0, base: 0, active: false });
  }

  private count(counter: string): number {
    return this.h.profile.data.counters[counter] ?? 0;
  }

  nearest(p: THREE.Vector3, r = 2.6): Npc | null {
    let best: Npc | null = null;
    let bd = r;
    for (const n of this.npcs) {
      const d = n.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  prompt(p: THREE.Vector3): string | null {
    const n = this.nearest(p);
    return n ? `F · Talk to ${n.def.name}` : null;
  }

  /** F near a quest-giver. */
  talk(p: THREE.Vector3): boolean {
    const n = this.nearest(p);
    if (!n) return false;
    const d = n.def;
    if (this.h.storyTalk(d.id)) {
      this.h.say(d.name, 'So you’re the Blank everyone whispers about. The Warden fears you. Good. Run the ramparts and cut his signal.', d.pitch);
      return true;
    }
    const st = this.state(d.id);
    const q = d.quests[st.stage];
    if (!q) {
      this.h.say(d.name, d.greet + ' Nothing more for now — thank you, Blank.', d.pitch);
      return true;
    }
    if (!st.active) {
      st.active = true;
      st.base = this.count(q.counter);
      this.h.profile.save();
      this.h.say(d.name, `${d.greet} ${q.ask}`, d.pitch);
      this.h.toast(`QUEST · ${d.name}: ${q.ask}`, 'info');
      return true;
    }
    const prog = this.count(q.counter) - st.base;
    if (prog >= q.goal) {
      st.active = false;
      st.stage++;
      this.h.profile.addInk(q.reward);
      this.h.addXp(q.reward);
      this.h.event('quests');
      this.h.say(d.name, q.thanks, d.pitch);
      this.h.toast(`QUEST COMPLETE · ${d.name} · +${q.reward} Ink`, 'power');
    } else {
      this.h.say(d.name, `${q.ask} (${prog}/${q.goal})`, d.pitch);
    }
    return true;
  }

  /** Active quests for the HUD / journal. */
  active(): Array<{ npc: string; text: string; progress: string }> {
    const out: Array<{ npc: string; text: string; progress: string }> = [];
    for (const n of this.npcs) {
      const st = this.state(n.def.id);
      const q = n.def.quests[st.stage];
      if (!q || !st.active) continue;
      const prog = Math.min(q.goal, this.count(q.counter) - st.base);
      out.push({ npc: n.def.name, text: q.ask, progress: `${prog}/${q.goal}${prog >= q.goal ? ' · return to ' + n.def.name : ''}` });
    }
    return out;
  }

  /** Map markers for quest-givers. */
  markers(): Array<{ x: number; z: number; label: string }> {
    return this.npcs.map((n) => ({ x: n.pos.x, z: n.pos.z, label: n.def.name }));
  }

  update(dt: number, player: THREE.Vector3) {
    for (const n of this.npcs) {
      const d = n.pos.distanceTo(player);
      n.rig.root.visible = d < 120;
      n.marker.visible = d < 120;
      if (d > 120) continue;
      // face the player when they come close
      if (d < 8) n.rig.root.rotation.y += Math.atan2(Math.sin(Math.atan2(player.x - n.pos.x, player.z - n.pos.z) - n.rig.root.rotation.y), Math.cos(Math.atan2(player.x - n.pos.x, player.z - n.pos.z) - n.rig.root.rotation.y)) * Math.min(1, dt * 4);
      n.anim.update(dt, { state: d < 4 ? AnimState.Emote : AnimState.Idle, param: 1, speed: 0, vy: 0, grounded: true });
      // ! = new job, ? = something to hand in, … = in progress, nothing when done
      const st = this.state(n.def.id);
      const q = n.def.quests[st.stage];
      const kind = !q ? '' : !st.active ? '!' : this.count(q.counter) - st.base >= q.goal ? '?' : '…';
      if (kind !== n.markerKind) {
        n.markerKind = kind;
        n.marker.visible = !!kind;
        if (kind) n.marker.material = new THREE.SpriteMaterial({ map: markerTexture(kind === '?' ? '#17a9a3' : '#ffd27a', kind), depthTest: false });
      }
      if (!kind) n.marker.visible = false;
      n.marker.position.y = n.pos.y + 2.8 + Math.sin(performance.now() * 0.003) * 0.1;
    }
  }
}
