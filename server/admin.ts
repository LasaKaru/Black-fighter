/**
 * Admin panel: GET /admin serves a single page; /admin/api/* is a small JSON
 * API protected by the ADMIN_TOKEN bearer token. Disabled (404) when no token
 * is configured.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface AdminHost {
  status(): unknown;
  kick(id: number, ban: boolean, reason: string): boolean;
  closeRoom(name: string): boolean;
  broadcast(text: string, room?: string): number;
  setMaintenance(on: boolean): void;
  setMotd(text: string): void;
  unban(ip: string): boolean;
  board(): Record<string, Array<{ name: string; time: number; at: number }>>;
  deleteScore(mission: string, name: string): boolean;
}

const PAGE_URL = new URL('./admin.html', import.meta.url);
let page: Buffer | null = null;

const failures = new Map<string, { n: number; t: number }>();

function digest(s: string) {
  return createHash('sha256').update(s).digest();
}

function authorised(req: IncomingMessage, token: string, ip: string): boolean | 'locked' {
  const now = Date.now();
  const f = failures.get(ip);
  if (f && now - f.t > 10 * 60_000) failures.delete(ip);
  if ((failures.get(ip)?.n ?? 0) >= 10) return 'locked';
  const got = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const ok = got.length > 0 && timingSafeEqual(digest(got), digest(token));
  if (!ok) failures.set(ip, { n: (failures.get(ip)?.n ?? 0) + 1, t: f?.t ?? now });
  return ok;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4000) throw new Error('too big');
  }
  const o = raw ? (JSON.parse(raw) as unknown) : {};
  return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
}

function json(res: ServerResponse, code: number, o: unknown): true {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(o));
  return true;
}

/** Returns true when the request was an admin request (handled here). */
export async function handleAdmin(req: IncomingMessage, res: ServerResponse, host: AdminHost, token: string, ip: string): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return false;
  if (!token) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Admin panel disabled: set ADMIN_TOKEN to enable it.');
    return true;
  }
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    page ??= await readFile(PAGE_URL);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    });
    res.end(page);
    return true;
  }
  const auth = authorised(req, token, ip);
  if (auth === 'locked') return json(res, 429, { error: 'too many failed logins, wait 10 minutes' });
  if (!auth) return json(res, 401, { error: 'bad token' });
  try {
    const route = `${req.method} ${url.pathname.slice('/admin/api'.length)}`;
    const b = req.method === 'POST' ? await body(req) : {};
    const str = (k: string, max = 200) => (typeof b[k] === 'string' ? (b[k] as string).slice(0, max) : '');
    switch (route) {
      case 'GET /status':
        return json(res, 200, host.status());
      case 'POST /kick':
        return json(res, 200, { ok: host.kick(Number(b.id) | 0, b.ban === true, str('reason') || 'Removed by an admin.') });
      case 'POST /close':
        return json(res, 200, { ok: host.closeRoom(str('room', 40)) });
      case 'POST /broadcast':
        return json(res, 200, { sent: host.broadcast(str('text', 200), str('room', 40) || undefined) });
      case 'POST /maintenance':
        host.setMaintenance(b.on === true);
        return json(res, 200, { ok: true });
      case 'POST /motd':
        host.setMotd(str('text', 200));
        return json(res, 200, { ok: true });
      case 'POST /unban':
        return json(res, 200, { ok: host.unban(str('ip', 64)) });
      case 'GET /leaderboard':
        return json(res, 200, host.board());
      case 'POST /leaderboard/delete':
        return json(res, 200, { ok: host.deleteScore(str('mission', 32), str('name', 32)) });
      default:
        return json(res, 404, { error: 'unknown route' });
    }
  } catch (e) {
    return json(res, 400, { error: String((e as Error).message ?? e) });
  }
}
