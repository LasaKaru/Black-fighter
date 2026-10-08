/**
 * Owner panel API (/panel/api/*), used by the hidden in-game owner panel
 * (type "kumara" on a menu to open its sign-in).
 *
 * - Credentials live only on the server, as a salted scrypt hash in
 *   DATA_DIR/panel/account.json. First run seeds them from PANEL_EMAIL /
 *   PANEL_PASSWORD, or the defaults below — change the password in the panel
 *   (Account tab) or set PANEL_PASSWORD before going live.
 * - Sign-in returns a random session token (12 h), sent as a Bearer header.
 * - 8 failed sign-ins from one IP lock it out for 15 minutes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AnalyticsStore } from './analytics';
import type { BrandStore } from './brand';
import type { AdminHost } from './admin';
import type { StatusStore } from './status';
import type { CrashStore } from './crashes';
import { readJson, writeJson } from './fsutil';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** Seed owner account (used only when no account file exists yet). */
const DEFAULT_OWNER = { email: 'lasantha@helao2.com', password: 'www111' };
const SESSION_MS = 12 * 3600_000;

interface Account {
  email: string;
  salt: string;
  hash: string;
  changedAt: number;
}

export class Panel {
  private account: Account | null = null;
  private sessions = new Map<string, { email: string; exp: number }>();
  private fails = new Map<string, { n: number; t: number }>();
  private file: string;

  constructor(
    dataDir: string,
    private stats: AnalyticsStore,
    private brand: BrandStore,
    private admin: AdminHost,
    private status: StatusStore,
    private crashes: CrashStore,
  ) {
    this.file = join(dataDir, 'panel', 'account.json');
  }

  async load() {
    try {
      this.account = await readJson<Account>(this.file);
    } catch {
      await this.setCredentials(process.env.PANEL_EMAIL || DEFAULT_OWNER.email, process.env.PANEL_PASSWORD || DEFAULT_OWNER.password);
    }
  }

  private async setCredentials(email: string, password: string) {
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 32);
    this.account = { email: email.trim().toLowerCase(), salt: salt.toString('hex'), hash: hash.toString('hex'), changedAt: Date.now() };
    await mkdir(join(this.file, '..'), { recursive: true });
    await writeJson(this.file, this.account);
  }

  private async check(email: string, password: string): Promise<boolean> {
    const a = this.account;
    if (!a) return false;
    const got = await scrypt(password, Buffer.from(a.salt, 'hex'), 32);
    const emailOk = email.trim().toLowerCase() === a.email;
    return timingSafeEqual(got, Buffer.from(a.hash, 'hex')) && emailOk;
  }

  private session(req: IncomingMessage): string | null {
    const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const s = t && this.sessions.get(t);
    if (!s) return null;
    if (s.exp < Date.now()) {
      this.sessions.delete(t);
      return null;
    }
    return s.email;
  }

  private locked(ip: string): boolean {
    const f = this.fails.get(ip);
    if (f && Date.now() - f.t > 15 * 60_000) this.fails.delete(ip);
    return (this.fails.get(ip)?.n ?? 0) >= 8;
  }

  private fail(ip: string) {
    const f = this.fails.get(ip);
    this.fails.set(ip, { n: (f?.n ?? 0) + 1, t: f?.t ?? Date.now() });
  }

  /** Returns true when the request was a panel request. */
  async handle(req: IncomingMessage, res: ServerResponse, ip: string): Promise<boolean> {
    const u = new URL(req.url ?? '/', 'http://localhost');
    if (!u.pathname.startsWith('/panel/api/')) return false;
    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    const out = (code: number, o: unknown) => {
      res.writeHead(code, headers);
      res.end(JSON.stringify(o));
      return true;
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return true;
    }
    const route = u.pathname.slice('/panel/api'.length);
    try {
      // uploads carry raw image bytes; everything else is small JSON
      if (route === '/upload') {
        if (!this.session(req)) return out(401, { error: 'sign in first' });
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > 2.2 * 1024 * 1024) return out(413, { error: 'image too big (max 2 MB)' });
          chunks.push(c as Buffer);
        }
        const url = await this.brand.saveFile(u.searchParams.get('name') ?? 'logo', Buffer.concat(chunks));
        return out(200, { url });
      }
      let body: Record<string, unknown> = {};
      if (req.method === 'POST') {
        let raw = '';
        for await (const c of req) {
          raw += c;
          if (raw.length > 200_000) return out(413, { error: 'too big' });
        }
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      }
      const s = (k: string, max = 200) => (typeof body[k] === 'string' ? (body[k] as string).slice(0, max) : '');

      if (route === '/login' && req.method === 'POST') {
        if (this.locked(ip)) return out(429, { error: 'Too many attempts. Try again in 15 minutes.' });
        // a little delay on every attempt slows guessing
        await new Promise((r) => setTimeout(r, 350));
        if (!(await this.check(s('email', 120), s('password', 200)))) {
          this.fail(ip);
          return out(401, { error: 'Wrong email or password.' });
        }
        this.fails.delete(ip);
        const token = randomBytes(32).toString('hex');
        this.sessions.set(token, { email: this.account!.email, exp: Date.now() + SESSION_MS });
        console.log(`[panel] sign-in ${this.account!.email}`);
        return out(200, { token, email: this.account!.email });
      }

      const who = this.session(req);
      if (!who) return out(401, { error: 'sign in first' });

      switch (`${req.method} ${route}`) {
        case 'GET /me':
          return out(200, { email: who, changedAt: this.account?.changedAt });
        case 'POST /logout':
          this.sessions.delete((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
          return out(200, { ok: true });
        case 'GET /analytics':
          return out(200, this.stats.summary(Math.min(120, Math.max(7, Number(u.searchParams.get('days')) || 30))));
        case 'POST /forget':
          return out(200, { ok: this.stats.forget(s('id', 40).replace(/[^a-f0-9]/g, '')) });
        case 'GET /crashes':
          return out(200, this.crashes.summary());
        case 'POST /crashes/status':
          return out(200, { ok: this.crashes.setStatus(s('id', 20), s('status', 10) as never) });
        case 'POST /crashes/delete':
          return out(200, { ok: this.crashes.delete(s('id', 20)) });
        case 'GET /status':
          return out(200, this.status.public());
        case 'POST /status':
          return out(200, this.status.set(body as never));
        case 'GET /live':
          return out(200, this.admin.status());
        case 'POST /kick':
          return out(200, { ok: this.admin.kick(Number(body.id) | 0, body.ban === true, s('reason') || 'Removed by the owner.') });
        case 'POST /broadcast':
          return out(200, { sent: this.admin.broadcast(s('text'), s('room', 40) || undefined) });
        case 'POST /maintenance':
          this.admin.setMaintenance(body.on === true);
          return out(200, { ok: true });
        case 'POST /motd':
          this.admin.setMotd(s('text'));
          return out(200, { ok: true });
        case 'GET /brand':
          return out(200, { config: this.brand.config, files: await this.brand.listFiles() });
        case 'POST /brand':
          return out(200, { config: await this.brand.save(body as never) });
        case 'POST /files/delete':
          return out(200, { ok: await this.brand.deleteFile(s('url', 200)) });
        case 'POST /account': {
          if (!(await this.check(who, s('password')))) return out(403, { error: 'Current password is wrong.' });
          const email = s('email', 120) || who;
          const next = s('newPassword');
          if (next && next.length < 8) return out(400, { error: 'Use at least 8 characters for the new password.' });
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return out(400, { error: 'That email address looks wrong.' });
          await this.setCredentials(email, next || s('password'));
          this.sessions.clear();
          return out(200, { ok: true, signedOut: true });
        }
        default:
          return out(404, { error: 'unknown route' });
      }
    } catch (e) {
      return out(400, { error: String((e as Error).message ?? e) });
    }
  }
}
