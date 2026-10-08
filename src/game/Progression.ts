import type { Profile } from './Profile';
import { makeRng } from '../core/math';

/**
 * Player progression: XP and levels with unlocks, ~50 achievements and
 * rotating daily / weekly challenges. Everything is driven by named
 * counters ("defeats", "glideM", "crates"…) bumped through `event()`.
 * Achievement ids are stable so they can map 1:1 to Steam achievements.
 */

export const MAX_LEVEL = 50;
export const xpToNext = (level: number) => 120 + level * 60;

/** What a level grants besides Ink. */
export const LEVEL_UNLOCKS: Record<number, { id: string; name: string }> = {
  2: { id: 'hair:tuft', name: 'Tuft hair' },
  3: { id: 'hat:bucket', name: 'Bucket hat' },
  4: { id: 'trail:teal', name: 'Teal dash trail' },
  5: { id: 'top:hoodie', name: 'Hoodie' },
  6: { id: 'emote:wave', name: 'Wave emote' },
  7: { id: 'shoes:hightop', name: 'High-tops' },
  8: { id: 'trail:void', name: 'Void dash trail' },
  10: { id: 'top:bomber', name: 'Bomber jacket' },
  11: { id: 'emote:flex', name: 'Flex emote' },
  12: { id: 'acc:glasses', name: 'Glasses' },
  14: { id: 'trail:gold', name: 'Gold dash trail' },
  15: { id: 'hat:headphones', name: 'Headphones' },
  18: { id: 'emote:salute', name: 'Salute emote' },
  20: { id: 'acc:backpack', name: 'Backpack' },
  22: { id: 'trail:ink', name: 'Ink dash trail' },
  25: { id: 'acc:scarf', name: 'Scarf' },
  28: { id: 'emote:sit', name: 'Sit emote' },
  30: { id: 'acc:mask', name: 'Agent mask' },
  35: { id: 'trail:rainbow', name: 'Prism dash trail' },
  40: { id: 'veh:blotter', name: 'The Blotter' },
  50: { id: 'trail:blackeye', name: 'BLACKEYE trail' },
};

export const TRAILS: Record<string, { name: string; color: string }> = {
  fire: { name: 'Fire', color: '#ff7a1a' },
  teal: { name: 'Teal', color: '#17a9a3' },
  void: { name: 'Void', color: '#6b2bff' },
  gold: { name: 'Gold', color: '#ffd27a' },
  ink: { name: 'Ink', color: '#e8e6e2' },
  rainbow: { name: 'Prism', color: 'rainbow' },
  blackeye: { name: 'BLACKEYE', color: '#ff2a6d' },
};

/** XP for each counter step (per unit). */
const XP: Record<string, number> = {
  defeats: 15, bosses: 150, missions: 100, crates: 25, crateRare: 40, crateLegendary: 120, collectibles: 40, tags: 40, logs: 60,
  islands: 80, pursuitsWon: 60, escapes: 40, eyes: 25, zips: 10, superjumps: 3, wallruns: 2, smashes: 8, takedowns: 20, glideM: 0.05, runM: 0.01, driveM: 0.004,
};

interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  counter: string;
  goal: number;
}

const A = (id: string, name: string, desc: string, counter: string, goal: number): AchievementDef => ({ id, name, desc, counter, goal });

export const ACHIEVEMENTS: AchievementDef[] = [
  A('first_ink', 'First Ink', 'Ink your first Agent', 'defeats', 1),
  A('ink_slinger', 'Ink Slinger', 'Ink 50 Agents', 'defeats', 50),
  A('agent_eraser', 'Agent Eraser', 'Ink 250 Agents', 'defeats', 250),
  A('blackout', 'Blackout', 'Ink 1,000 Agents', 'defeats', 1000),
  A('giant_slayer', 'Giant Slayer', 'Defeat a boss', 'bosses', 1),
  A('boss_rush', 'Boss Rush', 'Defeat 5 bosses', 'bosses', 5),
  A('on_the_job', 'On the Job', 'Complete a mission', 'missions', 1),
  A('professional', 'Professional', 'Complete 5 missions', 'missions', 5),
  A('fixer', 'Fixer', 'Complete 10 missions', 'missions', 10),
  A('legend_of_ink', 'Legend of Ink', 'Complete 25 missions', 'missions', 25),
  A('tourist', 'Tourist', 'Discover 3 islands', 'islands', 3),
  A('explorer', 'Explorer', 'Discover 6 islands', 'islands', 6),
  A('cartographer', 'Cartographer', 'Discover every island', 'islands', 17),
  A('looter', 'Looter', 'Open a crate', 'crates', 1),
  A('scavenger', 'Scavenger', 'Open 15 crates', 'crates', 15),
  A('treasure_hunter', 'Treasure Hunter', 'Open 5 legendary crates', 'crateLegendary', 5),
  A('sticker_fan', 'Sticker Fan', 'Find 10 Watching-Eye stickers', 'collectibles', 10),
  A('sticker_book', 'Sticker Book', 'Find 40 Watching-Eye stickers', 'collectibles', 40),
  A('tagger', 'Tagger', 'Spray 5 graffiti tags', 'tags', 5),
  A('street_artist', 'Street Artist', 'Spray 20 graffiti tags', 'tags', 20),
  A('archivist', 'Archivist', 'Find 6 audio logs', 'logs', 6),
  A('whole_story', 'The Whole Story', 'Find 13 audio logs', 'logs', 13),
  A('frequent_flyer', 'Frequent Flyer', 'Glide 1 km in total', 'glideM', 1000),
  A('sky_rider', 'Sky Rider', 'Glide 10 km in total', 'glideM', 10000),
  A('cable_guy', 'Cable Guy', 'Ride a zip-line', 'zips', 1),
  A('line_master', 'Line Master', 'Ride 25 zip-lines', 'zips', 25),
  A('liftoff', 'Liftoff', 'Super-jump 10 times', 'superjumps', 10),
  A('orbit', 'Orbit', 'Super-jump 100 times', 'superjumps', 100),
  A('wall_walker', 'Wall Walker', 'Wall-run 25 times', 'wallruns', 25),
  A('parkour_pro', 'Parkour Pro', 'Wall-run 250 times', 'wallruns', 250),
  A('jogger', 'Jogger', 'Run 10 km', 'runM', 10000),
  A('marathon', 'Marathon', 'Run 42 km', 'runM', 42000),
  A('road_trip', 'Road Trip', 'Drive 5 km', 'driveM', 5000),
  A('long_haul', 'Long Haul', 'Drive 50 km', 'driveM', 50000),
  A('combo_10', 'Good Rhythm', 'Reach a x10 combo', 'bestCombo', 10),
  A('combo_20', 'Unstoppable', 'Reach a x20 combo', 'bestCombo', 20),
  A('combo_30', 'Inkredible', 'Reach a x30 combo', 'bestCombo', 30),
  A('survivor', 'Survivor', 'Win a pursuit', 'pursuitsWon', 1),
  A('most_wanted', 'Most Wanted', 'Win 10 pursuits', 'pursuitsWon', 10),
  A('ghost', 'Ghost', 'Escape 5 pursuits', 'escapes', 5),
  A('eye_catcher', 'Eye Catcher', 'Catch an Eye', 'eyes', 1),
  A('collector_of_eyes', 'All Eyes', 'Catch 25 Eyes', 'eyes', 25),
  A('hundred_eyes', 'Hundred Eyes', 'Catch 100 Eyes', 'eyes', 100),
  A('wanted_3', 'Person of Interest', 'Reach 3 wanted stars', 'maxWanted', 3),
  A('wanted_5', 'Five Stars', 'Reach 5 wanted stars', 'maxWanted', 5),
  A('bossbane', 'Island Legend', 'Defeat 4 island bosses', 'bosses', 4),
  A('road_rage', 'Road Rage', 'Ram 25 Agents with a vehicle', 'rams', 25),
  A('medalist', 'Medalist', 'Earn 10 time-trial medals', 'medals', 10),
  A('golden', 'Golden Ink', 'Earn 5 gold medals', 'golds', 5),
  A('horde_10', 'Night Shift', 'Reach wave 10 in Horde Night', 'hordeWave', 10),
  A('chapter_3', 'Halfway Drawn', 'Finish story chapter 3', 'chapters', 3),
  A('drawn_out', 'Drawn Out', 'Finish the story', 'chapters', 7),
  A('helping_hand', 'Helping Hand', 'Complete 5 quests for the locals', 'quests', 5),
  A('shutterbug', 'Shutterbug', 'Take 10 photos', 'photos', 10),
  A('armed', 'Armed with Ink', 'Use weapons 50 times', 'weaponUses', 50),
  A('arsenal', 'Walking Arsenal', 'Use weapons 500 times', 'weaponUses', 500),
  A('wrecker', 'Wrecker', 'Smash 10 cracked walls', 'smashes', 10),
  A('demolition', 'Demolition', 'Smash 100 cracked walls', 'smashes', 100),
  A('silent_ink', 'Silent Ink', 'Perform 10 takedowns', 'takedowns', 10),
  A('level_5', 'Getting Drawn', 'Reach level 5', 'level', 5),
  A('level_10', 'Fully Inked', 'Reach level 10', 'level', 10),
  A('level_25', 'Master Artist', 'Reach level 25', 'level', 25),
  A('level_50', 'BLACKEYE', 'Reach level 50', 'level', 50),
  A('redrawn', 'Redrawn', 'Get inked and come back', 'kos', 1),
  A('rich', 'Ink Rich', 'Earn 10,000 Ink in total', 'inkEarned', 10000),
  A('snapshot', 'Snapshot', 'Take a photo in photo mode', 'photos', 1),
  // ---- the Metropolis, secrets and checkpoints
  A('big_city', 'Big City', 'Reach the Ink Metropolis', 'metroVisit', 1),
  A('top_of_spire', 'Top of the Spire', 'Complete The Ink Spire', 'spire', 1),
  A('flow_state', 'Flow State', 'Complete a flow run', 'flowRuns', 1),
  A('unbroken', 'Unbroken', 'Complete 3 flow runs', 'flowRuns', 3),
  A('downtown_rising', 'Downtown Rising', 'Finish story chapter 6', 'chapters', 6),
  A('roll_credits', 'Roll Credits', 'Watch the end credits', 'credits', 1),
  A('golden_nib', 'Golden Nib', 'Find a Golden Pen', 'pens', 1),
  A('half_the_set', 'Half the Set', 'Find 6 Golden Pens', 'pens', 6),
  A('golden_hand', 'Golden Hand', 'Find all 12 Golden Pens', 'pens', 12),
  A('off_the_map', 'Off the Map', 'Find a secret place', 'secrets', 1),
  A('urban_legend', 'Urban Legend', 'Find every secret place', 'secrets', 3),
  A('saved_by_ink', 'Saved by the Ink', 'Clear 10 checkpoints', 'checkpoints', 10),
  A('persistent', 'Persistent', 'Clear 50 checkpoints', 'checkpoints', 50),
  A('hydro_jump', 'Hydro Jump', 'Ride a hydrant geyser', 'geysers', 1),
  A('fountain_hopper', 'Fountain Hopper', 'Ride 10 hydrant geysers', 'geysers', 10),
  // ---- the long haul
  A('graveyard_shift', 'Graveyard Shift', 'Reach wave 20 in Horde Night', 'hordeWave', 20),
  A('ink_symphony', 'Ink Symphony', 'Reach a x50 combo', 'bestCombo', 50),
  A('ink_apocalypse', 'Ink Apocalypse', 'Ink 2,500 Agents', 'defeats', 2500),
  A('mission_master', 'Mission Master', 'Complete 40 missions', 'missions', 40),
  A('gilded', 'Gilded', 'Earn 15 gold medals', 'golds', 15),
  A('podium_regular', 'Podium Regular', 'Earn 25 time-trial medals', 'medals', 25),
  A('cable_rider', 'Cable Rider', 'Ride 100 zip-lines', 'zips', 100),
  A('albatross', 'Albatross', 'Glide 50 km in total', 'glideM', 50000),
  A('odometer', 'Odometer', 'Drive 200 km', 'driveM', 200000),
  A('ultra', 'Ultra', 'Run 100 km', 'runM', 100000),
  A('gallery', 'Gallery', 'Take 50 photos', 'photos', 50),
  A('neighbourhood_hero', 'Neighbourhood Hero', 'Complete 10 quests for the locals', 'quests', 10),
  A('shadow', 'Shadow', 'Perform 50 takedowns', 'takedowns', 50),
  A('demolition_derby', 'Demolition Derby', 'Ram 100 Agents with a vehicle', 'rams', 100),
  A('hoarder', 'Hoarder', 'Open 50 crates', 'crates', 50),
  A('lucky_streak', 'Lucky Streak', 'Open 10 rare crates', 'crateRare', 10),
  A('ink_tycoon', 'Ink Tycoon', 'Earn 100,000 Ink in total', 'inkEarned', 100000),
  A('watcher_of_watchers', 'Watcher of Watchers', 'Catch 250 Eyes', 'eyes', 250),
  A('public_enemy', 'Public Enemy', 'Win 25 pursuits', 'pursuitsWon', 25),
];

interface ChallengeTemplate {
  key: string;
  text: (n: number) => string;
  counter: string;
  /** Daily goal range; weekly goals are 5x. */
  goal: [number, number];
  max?: boolean;
}

const CHALLENGES: ChallengeTemplate[] = [
  { key: 'defeat', text: (n) => `Ink ${n} Agents`, counter: 'defeats', goal: [15, 30] },
  { key: 'glide', text: (n) => `Glide ${n} m`, counter: 'glideM', goal: [400, 900] },
  { key: 'zip', text: (n) => `Ride ${n} zip-lines`, counter: 'zips', goal: [2, 5] },
  { key: 'crate', text: (n) => `Open ${n} crates`, counter: 'crates', goal: [1, 3] },
  { key: 'pursuit', text: (n) => `Win ${n} pursuit${n > 1 ? 's' : ''}`, counter: 'pursuitsWon', goal: [1, 2] },
  { key: 'eyes', text: (n) => `Catch ${n} Eyes`, counter: 'eyes', goal: [3, 6] },
  { key: 'mission', text: (n) => `Complete ${n} mission${n > 1 ? 's' : ''}`, counter: 'missions', goal: [1, 2] },
  { key: 'drive', text: (n) => `Drive ${(n / 1000).toFixed(1)} km`, counter: 'driveM', goal: [1500, 3000] },
  { key: 'wallrun', text: (n) => `Wall-run ${n} times`, counter: 'wallruns', goal: [10, 25] },
  { key: 'smash', text: (n) => `Smash ${n} cracked walls`, counter: 'smashes', goal: [3, 8] },
  { key: 'superjump', text: (n) => `Super-jump ${n} times`, counter: 'superjumps', goal: [5, 12] },
  { key: 'collect', text: (n) => `Find ${n} collectibles`, counter: 'collectibles', goal: [2, 5] },
];

export interface ChallengeView {
  id: string;
  text: string;
  progress: number;
  goal: number;
  done: boolean;
  weekly: boolean;
}

export interface ProgressHost {
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  /** Visual pop for gains near the player. */
  pop(text: string, kind: 'xp' | 'ink'): void;
  sound(name: 'levelup' | 'achievement' | 'challenge'): void;
  /** Analytics: an achievement unlocked or a level reached. */
  unlocked?(kind: 'achievement' | 'level', id: string): void;
}

export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function weekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y.getTime()) / 86400000 + 1) / 7)}`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Pick `n` challenge ids ("key:goal") for a period. Pure, so every player gets the same set. */
export function pickChallenges(seed: string, n: number, weekly: boolean): string[] {
  const rng = makeRng(hash(seed));
  const pool = [...CHALLENGES];
  const out: string[] = [];
  while (out.length < n && pool.length) {
    const t = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    let goal = Math.round(t.goal[0] + rng.next() * (t.goal[1] - t.goal[0]));
    if (weekly) goal *= 5;
    if (t.counter.endsWith('M')) goal = Math.round(goal / 50) * 50;
    out.push(`${t.key}:${goal}`);
  }
  return out;
}

export class Progression {
  constructor(private profile: Profile, private host: ProgressHost) {
    this.rollChallenges();
  }

  get d() {
    return this.profile.data;
  }

  counter(name: string): number {
    if (name === 'level') return this.d.level;
    return this.d.counters[name] ?? 0;
  }

  /** Bump a counter (or raise a max-counter) and award XP. */
  event(name: string, amount = 1, opts: { max?: boolean; xp?: number } = {}) {
    const c = this.d.counters;
    if (opts.max) {
      if (amount <= (c[name] ?? 0)) return;
      c[name] = amount;
    } else c[name] = (c[name] ?? 0) + amount;
    const xp = opts.xp ?? (XP[name] ?? 0) * (opts.max ? 0 : amount);
    if (xp > 0) this.addXp(xp, false);
    this.checkAchievements();
    this.checkChallenges();
    this.profile.save();
  }

  /** Bonus event multiplier for XP (owner panel → Events). */
  xpMultiplier = 1;

  addXp(n: number, save = true) {
    if (this.d.level >= MAX_LEVEL) return;
    n *= this.xpMultiplier;
    this.d.xp += n;
    if (n >= 10) this.host.pop(`+${Math.round(n)} XP`, 'xp');
    while (this.d.level < MAX_LEVEL && this.d.xp >= xpToNext(this.d.level)) {
      this.d.xp -= xpToNext(this.d.level);
      this.d.level++;
      this.levelUp(this.d.level);
    }
    if (save) this.profile.save();
  }

  private levelUp(level: number) {
    const ink = 40 + level * 10;
    this.d.ink += ink;
    const u = LEVEL_UNLOCKS[level];
    if (u) {
      if (u.id.startsWith('trail:') || u.id.startsWith('emote:')) {
        if (!this.d.unlocks.includes(u.id)) this.d.unlocks.push(u.id);
      } else if (!this.d.owned.includes(u.id)) this.d.owned.push(u.id);
    }
    this.host.toast(`LEVEL ${level}!  +${ink} Ink${u ? ` · Unlocked: ${u.name}` : ''}`, 'power');
    this.host.sound('levelup');
    this.host.unlocked?.('level', String(level));
    this.checkAchievements();
  }

  private checkAchievements() {
    for (const a of ACHIEVEMENTS) {
      if (this.d.achievements.includes(a.id)) continue;
      if (this.counter(a.counter) >= a.goal) {
        this.d.achievements.push(a.id);
        this.host.toast(`🏆 Achievement: ${a.name} — ${a.desc}`, 'power');
        this.host.sound('achievement');
        this.host.unlocked?.('achievement', a.id);
        // desktop build: mirror to Steam achievements (same API names, upper-cased)
        if (typeof window !== 'undefined') window.blackeyeDesktop?.achievement(a.id.toUpperCase());
        this.d.xp += 50;
      }
    }
  }

  // ------------------------------------------------------------ challenges

  /** New day / week: pick fresh challenges and remember the counter baselines. */
  rollChallenges(now = new Date()) {
    const ch = this.d.challenges;
    const day = dayKey(now);
    const week = weekKey(now);
    const base = (ids: string[]) => {
      for (const id of ids) ch.base[id] = this.counter(this.template(id).counter);
    };
    if (ch.day !== day) {
      for (const id of ch.daily) delete ch.base[id];
      ch.day = day;
      ch.daily = pickChallenges('d' + day, 3, false);
      ch.done = ch.done.filter((id) => ch.weekly.includes(id));
      base(ch.daily);
    }
    if (ch.week !== week) {
      for (const id of ch.weekly) delete ch.base[id];
      ch.week = week;
      ch.weekly = pickChallenges('w' + week, 3, true);
      ch.done = ch.done.filter((id) => ch.daily.includes(id));
      base(ch.weekly);
    }
    this.profile.save();
  }

  private template(id: string): ChallengeTemplate {
    return CHALLENGES.find((t) => t.key === id.split(':')[0]) ?? CHALLENGES[0];
  }

  challenges(): ChallengeView[] {
    const ch = this.d.challenges;
    const view = (id: string, weekly: boolean): ChallengeView => {
      const t = this.template(id);
      const goal = Number(id.split(':')[1]);
      const progress = Math.min(goal, Math.max(0, this.counter(t.counter) - (ch.base[id] ?? 0)));
      return { id, text: t.text(goal), progress, goal, done: ch.done.includes(id), weekly };
    };
    return [...ch.daily.map((id) => view(id, false)), ...ch.weekly.map((id) => view(id, true))];
  }

  private checkChallenges() {
    const ch = this.d.challenges;
    for (const c of this.challenges()) {
      if (c.done || c.progress < c.goal) continue;
      ch.done.push(c.id);
      const ink = c.weekly ? 400 : 100;
      const xp = c.weekly ? 600 : 150;
      this.d.ink += ink;
      this.host.toast(`${c.weekly ? 'Weekly' : 'Daily'} challenge done: ${c.text}  +${ink} Ink`, 'power');
      this.host.sound('challenge');
      this.addXp(xp, false);
    }
  }

  achievementView() {
    return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: this.d.achievements.includes(a.id), progress: Math.min(a.goal, this.counter(a.counter)) }));
  }
}
