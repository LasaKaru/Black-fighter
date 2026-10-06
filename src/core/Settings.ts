import { Appearance, DEFAULT_APPEARANCE } from '../character/Appearance';

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface SettingsData {
  name: string;
  room: string;
  serverUrl: string;
  appearance: Appearance;
  graphics: GraphicsPreset;
  resolutionScale: number;
  fov: number;
  fpFov: number;
  sensitivity: number;
  invertY: boolean;
  cameraShake: number;
  headBob: number;
  cinematicEvents: boolean;
  motionBlur: boolean;
  bloom: boolean;
  ao: boolean;
  shadows: boolean;
  firstPerson: boolean;
  shoulderRight: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  showFps: boolean;
  simpleParkour: boolean;
  reduceFlashes: boolean;
  difficulty: 'chill' | 'normal' | 'hard';
}

export const GRAPHICS_PRESETS: Record<GraphicsPreset, Partial<SettingsData>> = {
  low: { resolutionScale: 0.75, bloom: false, ao: false, shadows: false, motionBlur: false },
  medium: { resolutionScale: 1, bloom: true, ao: false, shadows: true, motionBlur: true },
  high: { resolutionScale: 1, bloom: true, ao: true, shadows: true, motionBlur: true },
  ultra: { resolutionScale: 1.5, bloom: true, ao: true, shadows: true, motionBlur: true },
};

const DEFAULTS: SettingsData = {
  name: '',
  room: 'plaza',
  serverUrl: '',
  appearance: DEFAULT_APPEARANCE,
  graphics: 'medium',
  resolutionScale: 1,
  fov: 70,
  fpFov: 90,
  sensitivity: 1,
  invertY: false,
  cameraShake: 1,
  headBob: 0.4,
  cinematicEvents: true,
  motionBlur: true,
  bloom: true,
  ao: false,
  shadows: true,
  firstPerson: false,
  shoulderRight: true,
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.9,
  showFps: false,
  simpleParkour: false,
  reduceFlashes: false,
  difficulty: 'normal',
};

const KEY = 'blackeye.settings.v1';

export class Settings {
  data: SettingsData;
  private listeners: Array<(s: SettingsData) => void> = [];

  constructor() {
    this.data = structuredClone(DEFAULTS);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = { ...this.data, ...parsed, appearance: { ...DEFAULT_APPEARANCE, ...(parsed.appearance ?? {}) } };
        this.data.appearance.colors = { ...DEFAULT_APPEARANCE.colors, ...(parsed.appearance?.colors ?? {}) };
      }
    } catch {
      /* ignore */
    }
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]) {
    this.data[key] = value;
    this.save();
  }

  applyPreset(p: GraphicsPreset) {
    this.data = { ...this.data, ...GRAPHICS_PRESETS[p], graphics: p };
    this.save();
  }

  onChange(fn: (s: SettingsData) => void) {
    this.listeners.push(fn);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l(this.data);
  }
}
