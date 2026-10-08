import type { NetAppearance } from '../../shared/protocol';

export type ColorSlot = 'skin' | 'hat' | 'hair' | 'top' | 'shirt' | 'pants' | 'shoes' | 'sole' | 'gloves' | 'patchA' | 'patchB' | 'accent';
export type HatStyle = 'beanie' | 'cap' | 'bucket' | 'hood' | 'headphones' | 'helmet' | 'cowboy' | 'bandana' | 'crown' | 'halo' | 'none';
export type HairStyle = 'none' | 'tuft' | 'curls' | 'buns';
export type TopStyle = 'jacket' | 'hoodie' | 'bomber' | 'tee';
export type BottomStyle = 'cargo' | 'shorts' | 'joggers';
export type ShoeStyle = 'chunky' | 'hightop' | 'slides';
export type GloveStyle = 'mitts' | 'fingerless' | 'bare';
export type Accessory = 'chain' | 'earring' | 'backpack' | 'glasses' | 'scarf' | 'mask' | 'cape' | 'horns';
export type FaceStyle = 'deadpan' | 'sleepy' | 'cheeky' | 'none';
export type BodyType = 'slim' | 'standard' | 'bulky';

export interface Appearance {
  colors: Record<ColorSlot, string>;
  hat: HatStyle;
  hair: HairStyle;
  top: TopStyle;
  bottom: BottomStyle;
  shoes: ShoeStyle;
  gloves: GloveStyle;
  acc: Accessory[];
  face: FaceStyle;
  body: BodyType;
  /** Text on the back print. */
  print: string;
  /** Text on the chest patch. */
  chest: string;
  /** Eye patches on the top. */
  patches: boolean;
}

export const COLOR_SLOT_LABELS: Record<ColorSlot, string> = {
  skin: 'Head', hat: 'Hat', hair: 'Hair', top: 'Jacket / top', shirt: 'T-shirt', pants: 'Pants',
  shoes: 'Sneakers', sole: 'Soles', gloves: 'Gloves', patchA: 'Patch (fire)', patchB: 'Patch (void)', accent: 'Accent',
};

export const STYLE_OPTIONS = {
  hat: ['beanie', 'cap', 'bucket', 'hood', 'headphones', 'helmet', 'cowboy', 'bandana', 'crown', 'halo', 'none'] as HatStyle[],
  hair: ['none', 'tuft', 'curls', 'buns'] as HairStyle[],
  top: ['jacket', 'hoodie', 'bomber', 'tee'] as TopStyle[],
  bottom: ['cargo', 'joggers', 'shorts'] as BottomStyle[],
  shoes: ['chunky', 'hightop', 'slides'] as ShoeStyle[],
  gloves: ['mitts', 'fingerless', 'bare'] as GloveStyle[],
  acc: ['chain', 'earring', 'backpack', 'glasses', 'scarf', 'mask', 'cape', 'horns'] as Accessory[],
  face: ['sleepy', 'deadpan', 'cheeky', 'none'] as FaceStyle[],
  body: ['slim', 'standard', 'bulky'] as BodyType[],
};

/** The reference look: black beanie, white faceted head, black eye-patch jacket, teal tee. */
export const DEFAULT_APPEARANCE: Appearance = {
  colors: {
    skin: '#eceae6',
    hat: '#17171b',
    hair: '#1b1b20',
    top: '#1a1a1f',
    shirt: '#17a9a3',
    pants: '#151519',
    shoes: '#f3f1ed',
    sole: '#d9d6d0',
    gloves: '#f6f4f0',
    patchA: '#ff7a1a',
    patchB: '#6b2bff',
    accent: '#17a9a3',
  },
  hat: 'beanie',
  hair: 'none',
  top: 'jacket',
  bottom: 'cargo',
  shoes: 'chunky',
  gloves: 'mitts',
  acc: ['chain', 'earring'],
  face: 'sleepy',
  body: 'standard',
  print: 'EYE MADE',
  chest: 'EYE DIFFRNT',
  patches: true,
};

export const AGENT_APPEARANCE: Appearance = {
  colors: {
    skin: '#e9e7e3',
    hat: '#111114',
    hair: '#111114',
    top: '#141417',
    shirt: '#141417',
    pants: '#111114',
    shoes: '#ecebe7',
    sole: '#cfcac4',
    gloves: '#efede9',
    patchA: '#111114',
    patchB: '#111114',
    accent: '#2a2a30',
  },
  hat: 'none',
  hair: 'none',
  top: 'bomber',
  bottom: 'joggers',
  shoes: 'chunky',
  gloves: 'mitts',
  acc: [],
  face: 'none',
  body: 'standard',
  print: '',
  chest: '',
  patches: false,
};

export interface CharacterProfile {
  id: string;
  name: string;
  bio: string;
  look: Appearance;
  price: number;
}

const withColors = (base: Appearance, c: Partial<Record<ColorSlot, string>>, rest: Partial<Appearance> = {}): Appearance => ({
  ...structuredClone(base),
  ...rest,
  colors: { ...base.colors, ...c },
});

/** Playable roster (README §16): each is a starting look players can tweak. */
export const ROSTER: CharacterProfile[] = [
  { id: 'blank', name: 'Blank', bio: 'Drew their own face. The city has been watching ever since.', look: DEFAULT_APPEARANCE, price: 0 },
  {
    id: 'ella',
    name: 'Ella',
    bio: 'Tea-hill runner from the misty highlands. Never misses the 9:15 over the Nine Arch.',
    look: withColors(DEFAULT_APPEARANCE, { hat: '#e7d9b8', top: '#2f5a3c', shirt: '#f0eee9', pants: '#3b3226', accent: '#e0b44c', patchA: '#e0b44c', patchB: '#2f5a3c' }, { hat: 'bucket', top: 'bomber', bottom: 'joggers', acc: ['backpack', 'earring'], face: 'cheeky', print: 'ELLA', chest: 'TEA HILLS' }),
    price: 0,
  },
  {
    id: 'sigi',
    name: 'Sigi',
    bio: "Climbed the Lion's Rock at dawn. Wears the lion's paws like a promise.",
    look: withColors(DEFAULT_APPEARANCE, { hat: '#c8641e', top: '#c8641e', shirt: '#2b1a10', pants: '#3a2a1c', gloves: '#f5e3c8', patchA: '#ffd27a', patchB: '#2b1a10', accent: '#ffd27a' }, { hat: 'hood', top: 'hoodie', hair: 'tuft', face: 'deadpan', print: 'SIGIRIYA', chest: 'LION ROCK' }),
    price: 250,
  },
  {
    id: 'lotus',
    name: 'Lotus',
    bio: 'Tower-top acrobat from Colombo. Super-jumps for fun, lands for style.',
    look: withColors(DEFAULT_APPEARANCE, { skin: '#f2ecf7', top: '#6b2bff', shirt: '#ff8cc6', pants: '#251845', hat: '#ff8cc6', patchA: '#ff8cc6', patchB: '#9ff0c8', accent: '#9ff0c8' }, { hat: 'headphones', hair: 'buns', top: 'jacket', bottom: 'shorts', shoes: 'hightop', acc: ['glasses', 'earring'], print: 'LOTUS', chest: 'SKY HIGH' }),
    price: 400,
  },
  {
    id: 'rio',
    name: 'Rio',
    bio: 'Summit chaser. Has high-fived the Redeemer. Twice.',
    look: withColors(DEFAULT_APPEARANCE, { hat: '#1f7a3d', top: '#f6d33c', shirt: '#1f7a3d', pants: '#1d3a8a', accent: '#1f7a3d', patchA: '#1d3a8a', patchB: '#1f7a3d' }, { hat: 'cap', top: 'tee', bottom: 'shorts', shoes: 'slides', gloves: 'fingerless', acc: ['chain'], face: 'cheeky', print: 'RIO', chest: 'SUMMIT' }),
    price: 400,
  },
  {
    id: 'null',
    name: 'Null',
    bio: 'An Agent who drew a face on their mask. The others want it back.',
    look: withColors(AGENT_APPEARANCE, { patchA: '#ff7a1a', patchB: '#6b2bff', accent: '#ff7a1a' }, { face: 'deadpan', acc: ['mask', 'scarf'], patches: true, print: 'NULL', chest: 'OFF MODEL' }),
    price: 800,
  },
  {
    id: 'petra',
    name: 'Petra',
    bio: 'Relic hunter from the rose-red canyon. Reads stone like comics.',
    look: withColors(DEFAULT_APPEARANCE, { skin: '#f3e4dc', hat: '#b9654f', top: '#e2a07f', shirt: '#5a2d22', pants: '#5a2d22', shoes: '#f1d9c7', patchA: '#5a2d22', patchB: '#b9654f', accent: '#f1d9c7' }, { hat: 'bucket', top: 'bomber', bottom: 'cargo', acc: ['scarf', 'backpack'], print: 'PETRA', chest: 'ROSE CITY' }),
    price: 600,
  },
];

export const PRESETS: Record<string, Appearance> = Object.fromEntries(ROSTER.map((r) => [r.name, r.look]));

const isHex = (s: unknown) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

function pick<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return options.includes(v as T) ? (v as T) : fallback;
}

/** Repair/migrate any stored or received appearance (older saves used `beanie`/`jacket` colour keys). */
export function normalizeAppearance(raw: unknown): Appearance {
  const a: Appearance = structuredClone(DEFAULT_APPEARANCE);
  if (!raw || typeof raw !== 'object') return a;
  const o = raw as Record<string, unknown> & { colors?: Record<string, unknown> };
  const colors = o.colors ?? {};
  if (isHex(colors.beanie)) a.colors.hat = colors.beanie as string;
  if (isHex(colors.jacket)) a.colors.top = colors.jacket as string;
  for (const k of Object.keys(a.colors) as ColorSlot[]) if (isHex(colors[k])) a.colors[k] = colors[k] as string;
  a.hat = pick(o.hat, STYLE_OPTIONS.hat, a.hat);
  a.hair = pick(o.hair, STYLE_OPTIONS.hair, a.hair);
  a.top = pick(o.top, STYLE_OPTIONS.top, a.top);
  a.bottom = pick(o.bottom, STYLE_OPTIONS.bottom, a.bottom);
  a.shoes = pick(o.shoes, STYLE_OPTIONS.shoes, a.shoes);
  a.gloves = pick(o.gloves, STYLE_OPTIONS.gloves, a.gloves);
  a.face = pick(o.face, STYLE_OPTIONS.face, a.face);
  a.body = pick(o.body, STYLE_OPTIONS.body, a.body);
  if (Array.isArray(o.acc)) a.acc = (o.acc as unknown[]).filter((x): x is Accessory => STYLE_OPTIONS.acc.includes(x as Accessory));
  else if (typeof o.chain === 'boolean') a.acc = o.chain ? ['chain', 'earring'] : ['earring'];
  if (typeof o.print === 'string') a.print = o.print.slice(0, 12);
  if (typeof o.chest === 'string') a.chest = o.chest.slice(0, 12);
  if (typeof o.patches === 'boolean') a.patches = o.patches;
  return a;
}

export function toNet(a: Appearance): NetAppearance {
  return {
    c: { ...a.colors },
    hat: a.hat,
    face: a.face,
    body: a.body,
    print: a.print.slice(0, 12) + '|' + a.chest.slice(0, 12) + '|' + (a.patches ? 1 : 0),
    i: [a.hair, a.top, a.bottom, a.shoes, a.gloves, a.acc.join('+')].join('|'),
  };
}

export function fromNet(n: NetAppearance | undefined): Appearance {
  if (!n) return structuredClone(DEFAULT_APPEARANCE);
  const [print = '', chest = '', patches = '1'] = String(n.print ?? '').split('|');
  const [hair, top, bottom, shoes, gloves, acc = ''] = String(n.i ?? '').split('|');
  return normalizeAppearance({
    colors: n.c,
    hat: n.hat,
    face: n.face,
    body: n.body,
    hair,
    top,
    bottom,
    shoes,
    gloves,
    acc: acc ? acc.split('+') : ['chain', 'earring'],
    print,
    chest,
    patches: patches.startsWith('1'),
  });
}
