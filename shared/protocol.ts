/**
 * Network protocol shared by the browser client and the Node server.
 * JSON over WebSocket for the prototype; the message shapes are kept compact
 * so they can move to a binary encoding later without touching game code.
 */

import type { MatchMode, MatchState, RvaSetup, TurfSetup } from './match';

export const PROTOCOL_VERSION = 2;
export const SERVER_TICK_HZ = 20;
export const CLIENT_SEND_HZ = 20;
export const INTERP_DELAY_MS = 100;
export const MAX_PLAYERS_PER_ROOM = 16;

/** Compact appearance description; mirrors `Appearance` on the client. */
export interface NetAppearance {
  c: Record<string, string>;
  hat: string;
  face: string;
  body: string;
  print: string;
  /** Clothing items: hair|top|bottom|shoes|gloves|acc+acc */
  i?: string;
}

/** Networked character state. Positions are rounded to centimetres. */
export interface NetCharState {
  p: [number, number, number];
  v: [number, number, number];
  yaw: number;
  /** Animation state id (see AnimState on the client). */
  a: number;
  /** Animation parameter (attack progress, wall side, etc.). */
  ap: number;
  hp: number;
  fx: number;
  /** Driving: [typeIndex, vehicleId, x, y, z, qx, qy, qz, qw, steer, speed] */
  veh?: number[];
}

export interface NetAgentState {
  id: number;
  p: [number, number, number];
  yaw: number;
  a: number;
  ap: number;
  /** Agent kind (omitted for plain suits). */
  k?: string;
}

export interface PlayerInfo {
  id: number;
  name: string;
  look: NetAppearance;
}

// ---------- client -> server ----------
export type ClientMsg =
  | { t: 'hello'; v: number; name: string; room: string; look: NetAppearance; pass?: string }
  | { t: 'state'; s: NetCharState }
  | { t: 'agents'; list: NetAgentState[] }
  | { t: 'hit'; target: number; dir: [number, number, number]; power: number; agent?: boolean }
  | { t: 'hitAgent'; id: number; dir: [number, number, number]; power: number }
  | { t: 'fx'; kind: FxKind; p: [number, number, number]; d?: [number, number, number] }
  | { t: 'look'; look: NetAppearance }
  | { t: 'chat'; text: string }
  | { t: 'ping'; ts: number }
  // matches (host starts/stops; the server referees)
  | { t: 'startMatch'; mode: MatchMode; rva?: RvaSetup; turf?: TurfSetup }
  | { t: 'stopMatch' }
  | { t: 'tag'; target: number }
  | { t: 'rescue'; target: number }
  | { t: 'eye'; idx: number }
  | { t: 'paint'; cells: number[] }
  // social
  | { t: 'mark'; p: [number, number, number]; kind: MarkKind }
  | { t: 'voice'; id: number }
  // co-op missions: start / complete / fail shared with the room
  | { t: 'mission'; id: string; ev: 'start' | 'done' | 'fail' }
  /** Declared teleport (respawn, fast travel): the next state may jump. */
  | { t: 'teleport' };

// ---------- server -> client ----------
export type ServerMsg =
  | { t: 'welcome'; id: number; host: number; seed: number; players: PlayerInfo[]; room: string }
  | { t: 'join'; player: PlayerInfo }
  | { t: 'leave'; id: number }
  | { t: 'host'; id: number }
  | { t: 'snap'; ts: number; players: Array<{ id: number; s: NetCharState }>; agents: NetAgentState[] }
  | { t: 'hit'; from: number; dir: [number, number, number]; power: number }
  | { t: 'hitAgent'; from: number; id: number; dir: [number, number, number]; power: number }
  | { t: 'fx'; from: number; kind: FxKind; p: [number, number, number]; d?: [number, number, number] }
  | { t: 'look'; id: number; look: NetAppearance }
  | { t: 'chat'; from: number; name: string; text: string }
  | { t: 'pong'; ts: number }
  | { t: 'error'; message: string }
  | { t: 'match'; m: MatchState }
  | { t: 'turf'; d: number[]; full?: boolean }
  | { t: 'mark'; from: number; p: [number, number, number]; kind: MarkKind }
  | { t: 'voice'; from: number; id: number }
  | { t: 'mission'; from: number; name: string; id: string; ev: 'start' | 'done' | 'fail' }
  /** Movement authority: your last state was rejected; snap back here. */
  | { t: 'correct'; p: [number, number, number] };

export type MarkKind = 'look' | 'go' | 'danger';

/** Canned voice lines (the wheel's bottom half). */
export const VOICE_LINES = ['Over here!', 'Help me!', 'Nice one!', "Let's go!", 'Agents incoming!', 'Thanks!'];

export type FxKind = 'ink' | 'shock' | 'smash' | 'absorb' | 'blink' | 'dash';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sanitizeName(name: unknown): string {
  const s = typeof name === 'string' ? name : '';
  const clean = s.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  return clean || 'Blank';
}

export function sanitizeRoom(room: unknown): string {
  const s = typeof room === 'string' ? room : '';
  const clean = s.toLowerCase().replace(/[^a-z0-9\-]/g, '').slice(0, 24);
  return clean || 'plaza';
}

export function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}
