/**
 * Branding store: the brand config (company, links, sponsors, pages, feature
 * switches) and uploaded images (company / sponsor logos).
 *
 *   GET /brand/config.json        public, read by every game client
 *   GET /brand/files/<name>        uploaded images
 *
 * Writes go through the owner panel API (server/panel.ts). Uploads are
 * restricted to PNG, JPEG, WebP and GIF, checked by their magic bytes (no
 * SVG: it can carry scripts), max 2 MB.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_BRAND, type BrandConfig } from '../shared/brand';
import { readJson, writeJson } from './fsutil';

const IMAGE_TYPES: Array<{ ext: string; mime: string; magic: number[] }> = [
  { ext: 'png', mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'jpg', mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  { ext: 'gif', mime: 'image/gif', magic: [0x47, 0x49, 0x46, 0x38] },
  { ext: 'webp', mime: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
];

const MAX_FILE = 2 * 1024 * 1024;

const url = (v: unknown) => (typeof v === 'string' && /^(https?:\/\/|mailto:|\/brand\/files\/)[^\s"'<>]{0,300}$/.test(v) ? v : '');
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, max) : '');
const id = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) : '');

export class BrandStore {
  config: BrandConfig = structuredClone(DEFAULT_BRAND);
  private dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'brand');
  }

  async load() {
    try {
      const raw = await readJson<Partial<BrandConfig>>(join(this.dir, 'config.json'));
      this.config = this.clean({ ...structuredClone(DEFAULT_BRAND), ...raw });
    } catch {
      /* defaults */
    }
  }

  /** Validate and normalise a whole config (everything the panel can send). */
  clean(c: Partial<BrandConfig>): BrandConfig {
    const d = DEFAULT_BRAND;
    const pages: BrandConfig['pages'] = {};
    for (const [k, p] of Object.entries(c.pages ?? {})) {
      const key = id(k);
      if (!key || !p || typeof p !== 'object') continue;
      pages[key] = { title: text(p.title, 80), body: text(p.body, 20000), enabled: p.enabled !== false };
      if (Object.keys(pages).length >= 30) break;
    }
    const features: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(c.features ?? {})) if (id(k) && typeof v === 'boolean') features[id(k)] = v;
    return {
      company: text(c.company, 60) || d.company,
      presents: text(c.presents, 30),
      website: url(c.website),
      supportEmail: text(c.supportEmail, 80),
      logo: url(c.logo),
      links: (Array.isArray(c.links) ? c.links : d.links).slice(0, 12).map((l) => ({
        id: id(l?.id) || 'link',
        label: text(l?.label, 40),
        url: url(l?.url),
        kind: (['donate', 'social', 'site', 'store'] as const).includes(l?.kind) ? l.kind : 'site',
      })),
      sponsors: (Array.isArray(c.sponsors) ? c.sponsors : []).slice(0, 24).map((s) => ({
        id: id(s?.id) || 'sponsor',
        name: text(s?.name, 60),
        url: url(s?.url),
        logo: url(s?.logo),
        tier: (['gold', 'silver', 'partner'] as const).includes(s?.tier) ? s.tier : 'partner',
        menu: s?.menu !== false,
        world: s?.world !== false,
      })),
      advertise: { enabled: c.advertise?.enabled !== false, text: text(c.advertise?.text, 120) || d.advertise.text },
      graffiti: c.graffiti !== false,
      donationsOnDesktop: c.donationsOnDesktop === true,
      pages,
      features,
      news: text(c.news, 280),
      event: {
        name: text(c.event?.name, 60),
        ink: Math.min(5, Math.max(1, Number(c.event?.ink) || 1)),
        xp: Math.min(5, Math.max(1, Number(c.event?.xp) || 1)),
        startsAt: Math.max(0, Math.round(Number(c.event?.startsAt) || 0)),
        until: Math.max(0, Math.round(Number(c.event?.until) || 0)),
      },
      minVersion: typeof c.minVersion === 'string' && /^\d{1,3}(\.\d{1,4}){0,2}$/.test(c.minVersion) ? c.minVersion : '',
      updatedAt: Date.now(),
    };
  }

  async save(c: Partial<BrandConfig>) {
    this.config = this.clean({ ...this.config, ...c });
    await mkdir(this.dir, { recursive: true });
    await writeJson(join(this.dir, 'config.json'), this.config, true);
    return this.config;
  }

  /** Store an uploaded image; returns its public URL. */
  async saveFile(name: string, data: Buffer): Promise<string> {
    if (data.length > MAX_FILE) throw new Error('image too big (max 2 MB)');
    const type = IMAGE_TYPES.find((t) => t.magic.every((b, i) => data[i] === b) && (t.ext !== 'webp' || data.subarray(8, 12).toString('latin1') === 'WEBP'));
    if (!type) throw new Error('only PNG, JPEG, WebP or GIF images');
    const base = id(name) || 'logo';
    const hash = createHash('sha1').update(data).digest('hex').slice(0, 8);
    const file = `${base}-${hash}.${type.ext}`;
    await mkdir(join(this.dir, 'files'), { recursive: true });
    await writeFile(join(this.dir, 'files', file), data);
    return `/brand/files/${file}`;
  }

  async listFiles(): Promise<string[]> {
    try {
      return (await readdir(join(this.dir, 'files'))).map((f) => `/brand/files/${f}`);
    } catch {
      return [];
    }
  }

  async deleteFile(path: string): Promise<boolean> {
    const f = path.replace(/^\/brand\/files\//, '');
    if (!/^[a-z0-9_-]+-[a-f0-9]{8}\.(png|jpg|gif|webp)$/.test(f)) return false;
    return unlink(join(this.dir, 'files', f)).then(
      () => true,
      () => false,
    );
  }

  /** Public routes. Returns true when handled. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const u = new URL(req.url ?? '/', 'http://localhost');
    if (u.pathname === '/brand/config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(this.config));
      return true;
    }
    const m = /^\/brand\/files\/([a-z0-9_-]+-[a-f0-9]{8}\.(png|jpg|gif|webp))$/.exec(u.pathname);
    if (m) {
      const data = await readFile(join(this.dir, 'files', m[1])).catch(() => null);
      if (!data) {
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
        res.end();
        return true;
      }
      const type = IMAGE_TYPES.find((t) => t.ext === m[2])!;
      res.writeHead(200, {
        'Content-Type': type.mime,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      res.end(data);
      return true;
    }
    return false;
  }
}
