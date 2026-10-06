import type * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import type { Effects } from '../vfx/Effects';
import type { AudioEngine } from '../audio/Audio';
import type { CameraRig } from '../camera/CameraRig';
import type { Renderer } from '../render/Renderer';
import type { City } from '../world/City';
import type { World } from '../world/World';
import type { Input } from './Input';
import type { SettingsData } from './Settings';
import type { Hittable } from '../player/Combat';
import type { FxKind } from '../../shared/protocol';

/** Services shared by gameplay objects. Implemented by Game. */
export interface GameContext {
  physics: Physics;
  effects: Effects;
  audio: AudioEngine;
  cameraRig: CameraRig;
  renderer: Renderer;
  city: City;
  world: World;
  input: Input;
  settings: SettingsData;
  readonly multiplayer: boolean;
  /** Everything the local player can hit (agents + remote players). */
  playerTargets(): Iterable<Hittable>;
  /** Freeze the simulation briefly to sell an impact. */
  hitstop(seconds: number): void;
  /** Local slow motion (clamped in multiplayer). */
  slowmo(scale: number, seconds: number): void;
  /** Relay a visual effect to other players. */
  broadcastFx(kind: FxKind, p: THREE.Vector3, d?: THREE.Vector3): void;
  /** Gameplay events used by objectives, flow and UI. */
  emit(event: GameEvent, data?: unknown): void;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
}

export type GameEvent =
  | 'jump' | 'land' | 'vault' | 'mantle' | 'wallrun' | 'wallkick' | 'slide' | 'smash'
  | 'hit' | 'defeat' | 'hurt' | 'ko' | 'catch' | 'absorb' | 'dash' | 'superjump' | 'blink'
  | 'checkpoint' | 'respawn' | 'emote';
