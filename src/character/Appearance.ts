import type { NetAppearance } from '../../shared/protocol';

export type ColorSlot = 'skin' | 'beanie' | 'jacket' | 'shirt' | 'pants' | 'shoes' | 'gloves' | 'patchA' | 'patchB' | 'sole';
export type HatStyle = 'beanie' | 'cap' | 'none';
export type FaceStyle = 'deadpan' | 'sleepy' | 'cheeky' | 'none';
export type BodyType = 'slim' | 'standard' | 'bulky';

export interface Appearance {
  colors: Record<ColorSlot, string>;
  hat: HatStyle;
  face: FaceStyle;
  body: BodyType;
  /** Text on the jacket back print. */
  print: string;
  /** Text on the chest patch. */
  chest: string;
  /** Show eye patches on jacket. */
  patches: boolean;
  /** Chain necklace. */
  chain: boolean;
}

export const COLOR_SLOT_LABELS: Record<ColorSlot, string> = {
  skin: 'Head', beanie: 'Hat', jacket: 'Jacket', shirt: 'T-shirt', pants: 'Pants',
  shoes: 'Sneakers', sole: 'Soles', gloves: 'Gloves', patchA: 'Patch (fire)', patchB: 'Patch (void)',
};

/** The reference look: black beanie, white faceted head, black eye-patch jacket, teal tee. */
export const DEFAULT_APPEARANCE: Appearance = {
  colors: {
    skin: '#eceae6',
    beanie: '#17171b',
    jacket: '#1a1a1f',
    shirt: '#17a9a3',
    pants: '#151519',
    shoes: '#f3f1ed',
    sole: '#d9d6d0',
    gloves: '#f6f4f0',
    patchA: '#ff7a1a',
    patchB: '#6b2bff',
  },
  hat: 'beanie',
  face: 'sleepy',
  body: 'standard',
  print: 'EYE MADE',
  chest: 'EYE DIFFRNT',
  patches: true,
  chain: true,
};

export const AGENT_APPEARANCE: Appearance = {
  colors: {
    skin: '#e9e7e3',
    beanie: '#111114',
    jacket: '#141417',
    shirt: '#141417',
    pants: '#111114',
    shoes: '#ecebe7',
    sole: '#cfcac4',
    gloves: '#efede9',
    patchA: '#111114',
    patchB: '#111114',
  },
  hat: 'none',
  face: 'none',
  body: 'standard',
  print: '',
  chest: '',
  patches: false,
  chain: false,
};

export const PRESETS: Record<string, Appearance> = {
  'Original Blank': DEFAULT_APPEARANCE,
  'Teal Runner': {
    ...DEFAULT_APPEARANCE,
    colors: { ...DEFAULT_APPEARANCE.colors, beanie: '#17a9a3', jacket: '#f0eee9', shirt: '#17171b', pants: '#2a2a31', patchA: '#17a9a3', patchB: '#17171b' },
    hat: 'cap',
    face: 'cheeky',
    print: 'RUN IT',
  },
  'Void Walker': {
    ...DEFAULT_APPEARANCE,
    colors: { ...DEFAULT_APPEARANCE.colors, skin: '#d9d2ff', beanie: '#6b2bff', jacket: '#24123f', shirt: '#ff7a1a', pants: '#120a20', shoes: '#6b2bff', gloves: '#efe9ff' },
    face: 'deadpan',
    print: 'VOID',
  },
  'Fire Eye': {
    ...DEFAULT_APPEARANCE,
    colors: { ...DEFAULT_APPEARANCE.colors, beanie: '#ff7a1a', shirt: '#ffd27a', jacket: '#2b1408', patchA: '#ffd27a', patchB: '#ff7a1a' },
    print: 'BLACKEYE',
  },
  'Mono Agent': { ...AGENT_APPEARANCE, hat: 'beanie', face: 'deadpan', print: 'AGENT', chest: '', body: 'slim' },
};

const isHex = (s: unknown) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

export function toNet(a: Appearance): NetAppearance {
  return { c: { ...a.colors }, hat: a.hat, face: a.face, body: a.body, print: a.print.slice(0, 12) + '|' + a.chest.slice(0, 12) + '|' + (a.patches ? 1 : 0) + (a.chain ? 1 : 0) };
}

export function fromNet(n: NetAppearance | undefined): Appearance {
  const a: Appearance = structuredClone(DEFAULT_APPEARANCE);
  if (!n) return a;
  for (const k of Object.keys(a.colors) as ColorSlot[]) {
    if (isHex(n.c?.[k])) a.colors[k] = n.c[k];
  }
  if (['beanie', 'cap', 'none'].includes(n.hat)) a.hat = n.hat as HatStyle;
  if (['deadpan', 'sleepy', 'cheeky', 'none'].includes(n.face)) a.face = n.face as FaceStyle;
  if (['slim', 'standard', 'bulky'].includes(n.body)) a.body = n.body as BodyType;
  const [print = '', chest = '', flags = '11'] = String(n.print ?? '').split('|');
  a.print = print.slice(0, 12);
  a.chest = chest.slice(0, 12);
  a.patches = flags[0] === '1';
  a.chain = flags[1] === '1';
  return a;
}
