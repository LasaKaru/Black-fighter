import { mirrorSave } from './DesktopSaves';
import { Appearance, DEFAULT_APPEARANCE, normalizeAppearance } from '../character/Appearance';

export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';
export type ArtStyle = 'ink' | 'realistic';
export type AntiAliasing = 'off' | 'fxaa' | 'smaa';
export type ShadowQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface SettingsData {
  name: string;
  room: string;
  serverUrl: string;
  /** Optional room password. */
  roomPass: string;
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
  viewDistance: number;
  playIntro: boolean;
  freeRoamAgents: boolean;
  minimap: boolean;
  minimapRotate: boolean;
  objectiveMarkers: boolean;
  timeOfDay: 'cycle' | 'morning' | 'noon' | 'dusk' | 'night';
  weather: 'dynamic' | 'clear' | 'rain' | 'fog';
  // accessibility
  colorblind: 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  uiScale: number;
  subtitles: boolean;
  /** 0 = off .. 1 = strong: weapon aim cone and melee soft-lock. */
  aimAssist: number;
  /** Sprint latches on a tap instead of needing to be held. */
  sprintToggle: boolean;
  highContrast: boolean;
  /** Spoken voice lines (speech synthesis). */
  voice: boolean;
  // ---- picture
  /** Ink = the stylised black/white look; Realistic = natural colours, blue skies, soft shadows. */
  artStyle: ArtStyle;
  antiAliasing: AntiAliasing;
  shadowQuality: ShadowQuality;
  softShadows: boolean;
  /** Frame-rate limit (0 = unlimited / display refresh). */
  fpsCap: number;
  /** Lower the resolution automatically when the frame rate drops. */
  dynamicResolution: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  filmGrain: number;
  vignette: number;
  // ---- controls
  padSensitivity: number;
  invertX: boolean;
  /** Stick dead zone 0..0.4. */
  deadzone: number;
  /** Controller rumble strength 0..1. */
  vibration: number;
  /** Third-person camera distance multiplier. */
  cameraDistance: number;
  /** 0 = raw look input .. 1 = very smooth. */
  cameraSmoothing: number;
  /** Camera drifts behind you while you move. */
  autoCamera: boolean;
  // ---- audio
  ambienceVolume: number;
  voiceVolume: number;
  /** Play recorded tracks from /music when present (procedural score otherwise). */
  recordedMusic: boolean;
  // ---- privacy
  /** Send anonymous play statistics to the game server. */
  analytics: boolean;
}

export const GRAPHICS_PRESETS: Record<GraphicsPreset, Partial<SettingsData>> = {
  low: { resolutionScale: 0.75, bloom: false, ao: false, shadows: false, motionBlur: false, antiAliasing: 'fxaa', shadowQuality: 'low', softShadows: false, dynamicResolution: true },
  medium: { resolutionScale: 1, bloom: true, ao: false, shadows: true, motionBlur: true, antiAliasing: 'fxaa', shadowQuality: 'medium', softShadows: false, dynamicResolution: true },
  high: { resolutionScale: 1, bloom: true, ao: true, shadows: true, motionBlur: true, antiAliasing: 'smaa', shadowQuality: 'high', softShadows: true, dynamicResolution: false },
  ultra: { resolutionScale: 1.5, bloom: true, ao: true, shadows: true, motionBlur: true, antiAliasing: 'smaa', shadowQuality: 'ultra', softShadows: true, dynamicResolution: false },
};

/** Map a shadow quality to a shadow-map size. */
export const SHADOW_SIZE: Record<ShadowQuality, number> = { low: 1024, medium: 2048, high: 3072, ultra: 4096 };

const DEFAULTS: SettingsData = {
  name: '',
  room: 'plaza',
  serverUrl: '',
  roomPass: '',
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
  viewDistance: 1,
  playIntro: true,
  freeRoamAgents: true,
  minimap: true,
  minimapRotate: true,
  objectiveMarkers: true,
  timeOfDay: 'cycle',
  weather: 'dynamic',
  colorblind: 'off',
  uiScale: 1,
  subtitles: true,
  aimAssist: 0.6,
  sprintToggle: false,
  highContrast: false,
  voice: true,
  artStyle: 'ink',
  antiAliasing: 'fxaa',
  shadowQuality: 'medium',
  softShadows: false,
  fpsCap: 0,
  dynamicResolution: true,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  filmGrain: 1,
  vignette: 1,
  padSensitivity: 1,
  invertX: false,
  deadzone: 0.15,
  vibration: 0.7,
  cameraDistance: 1,
  cameraSmoothing: 0.2,
  autoCamera: true,
  ambienceVolume: 0.8,
  voiceVolume: 0.9,
  recordedMusic: true,
  analytics: true,
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
        this.data = { ...this.data, ...parsed, appearance: normalizeAppearance(parsed.appearance) };
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
      const raw = JSON.stringify({ ...this.data, savedAt: Date.now() });
      localStorage.setItem(KEY, raw);
      mirrorSave(KEY, raw);
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l(this.data);
  }
}
