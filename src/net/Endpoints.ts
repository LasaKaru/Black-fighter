/**
 * Where the game server lives.
 *
 * - The web build served by the game server talks to its own host.
 * - The desktop build (Electron, loaded from app://) has no web host, so the
 *   server address is baked in at build time with VITE_SERVER_URL
 *   (e.g. https://play.example.com), or typed into Multiplayer → Server URL.
 * - VITE_SERVERS lists regions for the picker: "Asia=https://asia.example.com,EU=https://eu.example.com".
 * - VITE_API_URL (optional) pins leaderboards and cloud saves to one main
 *   server, so they stay global whichever region a player plays in.
 */

export interface Region {
  name: string;
  url: string;
}

/** Bridge exposed by the Electron preload (absent in the browser). */
export interface DesktopBridge {
  desktop: true;
  platform: string;
  quit(): void;
  toggleFullscreen(): void;
  achievement(id: string): void;
}

declare global {
  interface Window {
    blackeyeDesktop?: DesktopBridge;
  }
}

const env = import.meta.env as Record<string, string | undefined>;
const BUILT_IN = (env.VITE_SERVER_URL ?? '').trim();
const DATA_SERVER = toHttpBase(env.VITE_API_URL ?? '');

export const desktop: DesktopBridge | null = typeof window !== 'undefined' ? (window.blackeyeDesktop ?? null) : null;

/** True when the page itself is served over http(s) by a game server (or the Vite dev proxy). */
function sameHost(): boolean {
  return typeof location !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:');
}

/** Normalise "play.example.com", "https://host", "wss://host/ws" to an http(s) origin. */
export function toHttpBase(url: string): string {
  const raw = url.trim();
  if (!raw) return '';
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    const proto = u.protocol === 'ws:' || u.protocol === 'http:' ? 'http:' : 'https:';
    return `${proto}//${u.host}`;
  } catch {
    return '';
  }
}

/** HTTP base for /rooms, /leaderboard, /cloud. An override (settings) wins, then the built-in server, then the page's own host. */
export function apiBase(override = ''): string {
  const o = toHttpBase(override);
  if (o) return o;
  if (BUILT_IN) return toHttpBase(BUILT_IN);
  if (sameHost()) return '';
  return 'http://localhost:8787';
}

/** HTTP base for global data (leaderboards, cloud saves). */
export function dataBase(override = ''): string {
  return DATA_SERVER || apiBase(override);
}

/** WebSocket URL for the game connection. */
export function wsUrl(override = ''): string {
  const base = apiBase(override);
  if (base) return base.replace(/^http/, 'ws') + '/ws';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** Public web address for invite links (the server also hosts the web build). */
export function webBase(override = ''): string {
  const base = apiBase(override);
  return base || `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
}

/** Regions from VITE_SERVERS (empty when only one server is configured). */
export function regions(): Region[] {
  return (env.VITE_SERVERS ?? '')
    .split(',')
    .map((s) => s.split('='))
    .filter((p) => p.length === 2 && p[0].trim() && toHttpBase(p[1]))
    .map(([name, url]) => ({ name: name.trim(), url: toHttpBase(url) }));
}

/** Round-trip time to a server's /health in ms (null when unreachable). */
export async function measurePing(base: string, timeoutMs = 2500): Promise<number | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const t0 = performance.now();
    const r = await fetch(`${toHttpBase(base) || apiBase()}/health`, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return null;
    return Math.round(performance.now() - t0);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
