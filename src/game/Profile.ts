import { ROSTER, STYLE_OPTIONS } from '../character/Appearance';

export type Consumable = 'inkBomb' | 'healInk' | 'smoke';

export const CONSUMABLES: Record<Consumable, { name: string; desc: string; price: number; key: string }> = {
  inkBomb: { name: 'Ink Bomb', desc: 'Throw (R): bursts into ink, knocks down Agents in 4.5 m', price: 40, key: 'R' },
  healInk: { name: 'Fresh Ink', desc: 'Use (H): redraw 50 health instantly', price: 30, key: 'H' },
  smoke: { name: 'Smudge Cloud', desc: 'Use (X): Agents lose sight of you for 6 s', price: 35, key: 'X' },
};

export type WeaponId = 'boomerang' | 'pistol' | 'roller' | 'sticky';
export const WEAPON_ORDER: WeaponId[] = ['boomerang', 'pistol', 'roller', 'sticky'];

/** Weapons (T to use, Z to switch). Ammo packs are bought in the Inventory and found in crates. */
export const WEAPONS: Record<WeaponId, { name: string; desc: string; pack: number; price: number; unit: string }> = {
  boomerang: { name: 'Boomerang Cap', desc: 'Throw your cap: it curves out and comes back, hitting everything on the way', pack: 0, price: 0, unit: '∞' },
  pistol: { name: 'Ink Pistol', desc: 'Rapid ink pellets with aim assist. Hold T to keep firing', pack: 24, price: 35, unit: 'pellets' },
  roller: { name: 'Paint Roller', desc: 'A wide two-handed sweep that paints the street and knocks Agents flat', pack: 6, price: 45, unit: 'swings' },
  sticky: { name: 'Sticky Grenade', desc: 'Sticks to Agents and walls, then bursts after 1.5 s', pack: 2, price: 50, unit: 'grenades' },
};

/** Shard cost of each upgrade tier. */
export const UPGRADE_COST = [2, 4, 8];

/** Three upgrades per Eye power, bought in order. */
export const UPGRADES: Record<string, { name: string; tiers: [string, string, string] }> = {
  fire: { name: 'Fire Eye · dash', tiers: ['Longer dash (+35% distance)', 'Hotter dash (+50% damage)', 'Dash ends in a fire burst'] },
  sky: { name: 'Sky Eye · super-jump', tiers: ['Higher launch (+20%)', 'Landing slam after a super-jump', 'One free mid-air re-launch'] },
  void: { name: 'Void Eye · blink', tiers: ['Longer blink (+40%)', 'Void pull: drags nearby Agents to you', 'Void bursts at both ends'] },
  iron: { name: 'Iron Eye · charge', tiers: ['Wider slam (+30% radius)', 'Heavier charge and slam (+40%)', 'Longer charge (+40% time)'] },
  tide: { name: 'Tide Eye · paint path', tiers: ['Lasts longer (10 s)', 'Agents in the paint crawl (stronger slow)', 'Mends you while you run (+3 HP/s)'] },
  watcher: { name: 'Watcher Eye · reveal', tiers: ['Lasts longer (13 s)', 'Agents lose you when it starts', 'Revealed Agents take +25% damage'] },
  storm: { name: 'BLACKEYE · ink storm', tiers: ['Lasts longer (12 s)', 'Storm pulses knock back Agents', 'Catching Eyes gives +1 charge'] },
};

/** Clothing that is free from the start; everything else is bought with Ink. */
const FREE = new Set<string>([
  'hat:beanie', 'hat:cap', 'hat:none', 'hair:none', 'top:jacket', 'top:tee', 'bottom:cargo', 'shoes:chunky',
  'gloves:mitts', 'gloves:bare', 'acc:chain', 'acc:earring', 'char:blank', 'char:ella', 'veh:tuktuk', 'veh:inkbox',
]);

const ITEM_PRICES: Record<string, number> = {
  'gear:wings': 400,
  'veh:moto': 500, 'veh:board': 350, 'veh:skiff': 700, 'veh:glider': 900,
  'hat:bucket': 150, 'hat:hood': 100, 'hat:headphones': 300,
  'hair:tuft': 80, 'hair:curls': 120, 'hair:buns': 120,
  'top:hoodie': 150, 'top:bomber': 200,
  'bottom:joggers': 100, 'bottom:shorts': 100,
  'shoes:hightop': 150, 'shoes:slides': 80,
  'gloves:fingerless': 120,
  'acc:backpack': 200, 'acc:glasses': 150, 'acc:scarf': 120, 'acc:mask': 400,
  'veh:buggy': 400, 'veh:blotter': 600,
};

export function itemPrice(id: string): number {
  if (FREE.has(id)) return 0;
  if (id.startsWith('char:')) return ROSTER.find((r) => 'char:' + r.id === id)?.price ?? 0;
  return ITEM_PRICES[id] ?? 0;
}

export interface ProfileData {
  ink: number;
  owned: string[];
  consumables: Record<Consumable, number>;
  /** Ammo per weapon (the cap is unlimited). */
  ammo: Record<WeaponId, number>;
  weapon: WeaponId;
  /** Garage: paint / rims / nitro per vehicle type. */
  garage: Record<string, { paint?: string; rims?: string; nitro?: string }>;
  /** Eye power upgrade tiers (0..3), bought with Eye shards. */
  upgrades: Record<string, number>;
  best: Record<string, number>;
  done: string[];
  stats: { defeats: number; missions: number; drops: number; distance: number };
  /** Islands you have set foot on (world map fog). */
  discovered: string[];
  /** Loot, collectibles and other one-off finds ('island:kind:n'). */
  found: string[];
  /** Progression (see Progression.ts). */
  xp: number;
  level: number;
  counters: Record<string, number>;
  achievements: string[];
  challenges: { day: string; week: string; daily: string[]; weekly: string[]; base: Record<string, number>; done: string[] };
  /** Eye shards (power upgrades) and Agent mask fragments (cosmetics). */
  shards: number;
  masks: number;
  /** Unlocked extras: trails, emotes ('trail:teal', 'emote:wave'). */
  unlocks: string[];
  trail: string;
}

const KEY = 'blackeye.profile.v1';

export class Profile {
  data: ProfileData;
  private listeners: Array<() => void> = [];

  constructor() {
    this.data = { ink: 150, owned: [], consumables: { inkBomb: 2, healInk: 1, smoke: 1 }, ammo: { boomerang: 0, pistol: 24, roller: 4, sticky: 1 }, weapon: 'boomerang', upgrades: {}, garage: {}, best: {}, done: [], stats: { defeats: 0, missions: 0, drops: 0, distance: 0 }, discovered: ['hub'], found: [], xp: 0, level: 1, counters: {}, achievements: [], challenges: { day: '', week: '', daily: [], weekly: [], base: {}, done: [] }, shards: 0, masks: 0, unlocks: [], trail: 'fire' };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        this.data = { ...this.data, ...p, consumables: { ...this.data.consumables, ...(p.consumables ?? {}) }, ammo: { ...this.data.ammo, ...(p.ammo ?? {}) }, upgrades: { ...(p.upgrades ?? {}) }, garage: { ...(p.garage ?? {}) }, stats: { ...this.data.stats, ...(p.stats ?? {}) }, counters: { ...(p.counters ?? {}) }, challenges: { ...this.data.challenges, ...(p.challenges ?? {}) } };
      }
    } catch {
      /* fresh profile */
    }
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l();
  }

  owns(id: string): boolean {
    return itemPrice(id) === 0 || this.data.owned.includes(id);
  }

  /** Buy an item or consumable; returns false if you can't afford it. */
  buy(id: string): boolean {
    if (id.startsWith('ammo:')) {
      const w = WEAPONS[id.slice(5) as WeaponId];
      if (!w || !w.price || this.data.ink < w.price) return false;
      this.data.ink -= w.price;
      this.data.ammo[id.slice(5) as WeaponId] += w.pack;
      this.save();
      return true;
    }
    if (id.startsWith('use:')) {
      const c = id.slice(4) as Consumable;
      const price = CONSUMABLES[c].price;
      if (this.data.ink < price) return false;
      this.data.ink -= price;
      this.data.consumables[c]++;
      this.save();
      return true;
    }
    if (this.owns(id)) return true;
    const price = itemPrice(id);
    if (this.data.ink < price) return false;
    this.data.ink -= price;
    this.data.owned.push(id);
    this.save();
    return true;
  }

  addInk(n: number) {
    this.data.ink = Math.max(0, Math.round(this.data.ink + n));
    if (n > 0) this.data.counters.inkEarned = (this.data.counters.inkEarned ?? 0) + Math.round(n);
    this.save();
  }

  use(c: Consumable): boolean {
    if (this.data.consumables[c] <= 0) return false;
    this.data.consumables[c]--;
    this.save();
    return true;
  }

  upgradeLevel(type: string): number {
    return this.data.upgrades[type] ?? 0;
  }

  /** Spend shards on the next tier of an Eye power; false if maxed or unaffordable. */
  buyUpgrade(type: string): boolean {
    const lv = this.upgradeLevel(type);
    if (lv >= 3 || this.data.shards < UPGRADE_COST[lv]) return false;
    this.data.shards -= UPGRADE_COST[lv];
    this.data.upgrades[type] = lv + 1;
    this.save();
    return true;
  }

  /** Mark an island discovered; true the first time. */
  discover(id: string): boolean {
    if (this.data.discovered.includes(id)) return false;
    this.data.discovered.push(id);
    this.save();
    return true;
  }

  /** Record a one-off find; true the first time. */
  markFound(id: string): boolean {
    if (this.data.found.includes(id)) return false;
    this.data.found.push(id);
    this.save();
    return true;
  }

  completeMission(id: string, time: number, reward: number) {
    if (!this.data.done.includes(id)) this.data.done.push(id);
    const prev = this.data.best[id];
    if (prev === undefined || time < prev) this.data.best[id] = time;
    this.data.stats.missions++;
    this.addInk(reward);
  }

  /** Every purchasable id, grouped for the wardrobe UI. */
  static catalog(): Record<string, string[]> {
    return {
      hat: STYLE_OPTIONS.hat.map((x) => 'hat:' + x),
      hair: STYLE_OPTIONS.hair.map((x) => 'hair:' + x),
      top: STYLE_OPTIONS.top.map((x) => 'top:' + x),
      bottom: STYLE_OPTIONS.bottom.map((x) => 'bottom:' + x),
      shoes: STYLE_OPTIONS.shoes.map((x) => 'shoes:' + x),
      gloves: STYLE_OPTIONS.gloves.map((x) => 'gloves:' + x),
      acc: STYLE_OPTIONS.acc.map((x) => 'acc:' + x),
    };
  }
}
