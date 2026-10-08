import * as THREE from 'three';
import type { World } from '../world/World';
import { dataBase, desktop } from '../net/Endpoints';
import { makeRng } from '../core/math';
import { BUNDLED_LOGO, DEFAULT_BRAND, featureOn, usesBundledLogo, type BrandConfig } from '../../shared/brand';
export { DEFAULT_BRAND, type BrandConfig };

/**
 * Company branding, sponsors and support links, all editable from the owner
 * panel (server: /brand/config.json + /brand/files/*). The last config is
 * cached so offline play still shows it; built-in defaults cover a fresh
 * install with no server.
 *
 * Where it shows:
 * - the loading screen ("HelaO2 presents")
 * - the company logo as spray-painted ink graffiti on walls across the islands
 * - sponsor logos on billboards in their real colours (ink-splash frame),
 *   with an "your brand here" board while there are no sponsors
 * - the title-screen footer: website, support / donation links, sponsor strip
 */

const CACHE_KEY = 'blackeye.brand';
const LOGO_KEY = 'blackeye.brand.logo';

/**
 * The logo to show on dark screens (loading, footer, credits), as an <img>
 * URL: the uploaded logo (absolute, cached at the last refresh), the light
 * version of the bundled HelaO2 logo, or '' for the text name.
 */
export function logoForDark(c: BrandConfig): { url: string; plate: boolean } {
  if (usesBundledLogo(c)) return { url: BUNDLED_LOGO.light, plate: false };
  if (!c.logo) return { url: '', plate: false };
  let url = '';
  try {
    url = localStorage.getItem(LOGO_KEY) ?? '';
  } catch {
    /* none */
  }
  // uploaded logos keep their real colours on a light plate
  return { url, plate: true };
}

/** A same-origin image (bundled with the game) as a texture source. */
function loadLocal(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

/** The cached (or default) config, synchronously — for the loading screen. */
export function cachedBrand(): BrandConfig {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return { ...DEFAULT_BRAND, ...(JSON.parse(raw) as Partial<BrandConfig>) };
  } catch {
    /* none */
  }
  return { ...DEFAULT_BRAND };
}

/** Load an image as a texture source without tainting (fetch → bitmap). */
async function loadImage(url: string): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  } catch {
    return null;
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Draw an image into a box, keeping its aspect ratio (contain). */
function contain(g: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** The company wordmark when no logo is uploaded: ink lettering with an eye for the O. */
function wordmark(name: string): HTMLCanvasElement {
  const [c, g] = canvas(1024, 400);
  g.font = '900 170px "Archivo Black", "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 26;
  g.strokeStyle = '#111114';
  g.strokeText(name, 512, 200);
  g.fillStyle = '#f6f5f2';
  g.fillText(name, 512, 200);
  g.fillStyle = '#ff7a1a';
  g.fillRect(512 - g.measureText(name).width / 2, 300, g.measureText(name).width, 18);
  return c;
}

/** Spray-paint stencil: the logo in its own colours with overspray, drips and wear. */
export function graffitiCanvas(logo: CanvasImageSource & { width: number; height: number }, seed: number): HTMLCanvasElement {
  const [c, g] = canvas(512, 512);
  const rng = makeRng(seed);
  // soft overspray halo
  const halo = g.createRadialGradient(256, 236, 40, 256, 236, 250);
  halo.addColorStop(0, 'rgba(17,17,20,0.35)');
  halo.addColorStop(1, 'rgba(17,17,20,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 512, 512);
  // a torn paper paste-up behind the logo so its real colours read on any wall
  const s = Math.min(380 / logo.width, 280 / logo.height);
  const lw = logo.width * s;
  const lh = logo.height * s;
  g.fillStyle = '#f4f2ec';
  g.beginPath();
  const pts = 28;
  for (let i = 0; i < pts; i++) {
    const t = (i / pts) * Math.PI * 2;
    const rx = lw / 2 + 26 + rng.range(-8, 10);
    const ry = lh / 2 + 26 + rng.range(-8, 10);
    // squarish blob: superellipse
    const cx = Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.35;
    const cy = Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.35;
    if (i === 0) g.moveTo(256 + cx * rx, 236 + cy * ry);
    else g.lineTo(256 + cx * rx, 236 + cy * ry);
  }
  g.closePath();
  g.fill();
  contain(g, logo, 256 - lw / 2, 236 - lh / 2, lw, lh);
  // speckles of overspray around the edges
  for (let i = 0; i < 260; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(150, 250);
    g.fillStyle = `rgba(17,17,20,${rng.range(0.15, 0.6)})`;
    g.beginPath();
    g.arc(256 + Math.cos(a) * r, 236 + Math.sin(a) * r * 0.8, rng.range(0.6, 3), 0, Math.PI * 2);
    g.fill();
  }
  // drips running down from the paint
  for (let i = 0; i < 7; i++) {
    const x = rng.range(110, 400);
    const len = rng.range(30, 120);
    g.fillStyle = 'rgba(17,17,20,0.75)';
    g.fillRect(x, 380, rng.range(3, 6), len);
    g.beginPath();
    g.arc(x + 2, 380 + len, 5, 0, Math.PI * 2);
    g.fill();
  }
  // wear: knock tiny holes out of the paint
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 140; i++) {
    g.beginPath();
    g.arc(rng.range(60, 452), rng.range(80, 400), rng.range(0.5, 2.2), 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

/** Billboard art: white board, ink-splash frame, the sponsor logo in its real colours. */
export function billboardCanvas(logo: (CanvasImageSource & { width: number; height: number }) | null, title: string, sub: string, seed: number): HTMLCanvasElement {
  const [c, g] = canvas(1024, 576);
  const rng = makeRng(seed);
  g.fillStyle = '#f6f5f2';
  g.fillRect(0, 0, 1024, 576);
  // ink splashes bleeding in from the frame
  g.fillStyle = '#111114';
  for (let i = 0; i < 26; i++) {
    const edge = rng.int(0, 3);
    const x = edge === 0 ? rng.range(0, 1024) : edge === 1 ? 1024 : edge === 2 ? rng.range(0, 1024) : 0;
    const y = edge === 0 ? 0 : edge === 1 ? rng.range(0, 576) : edge === 2 ? 576 : rng.range(0, 576);
    g.beginPath();
    g.arc(x, y, rng.range(14, 46), 0, Math.PI * 2);
    g.fill();
  }
  g.lineWidth = 22;
  g.strokeStyle = '#111114';
  g.strokeRect(11, 11, 1002, 554);
  if (logo) contain(g, logo, 120, 60, 784, 360);
  g.textAlign = 'center';
  g.fillStyle = '#111114';
  g.font = logo ? '800 46px "Archivo Black", "Arial Black", sans-serif' : '900 92px "Archivo Black", "Arial Black", sans-serif';
  g.fillText(title, 512, logo ? 478 : 270);
  g.font = '600 32px Inter, Arial, sans-serif';
  g.fillStyle = '#ff7a1a';
  g.fillText(sub, 512, logo ? 530 : 350);
  return c;
}

export interface BrandingHost {
  scene: THREE.Scene;
  world: World;
  /** The title-screen element the footer goes into. */
  footerRoot(): HTMLElement | null;
  serverUrl(): string;
  track(id: string): void;
  /** Called after every (re)render with the config in force. */
  applied?(c: BrandConfig, darkLogo: { url: string; plate: boolean }): void;
}

export class Branding {
  config: BrandConfig = cachedBrand();
  private boards: Array<{ mat: THREE.MeshStandardMaterial; slot: number; group: THREE.Group }> = [];
  private graffiti: THREE.MeshStandardMaterial[] = [];
  private footer: HTMLElement | null = null;
  private logoImg: (CanvasImageSource & { width: number; height: number }) | null = null;
  /** <img> URL of the logo for dark screens and whether it needs a light plate. */
  darkLogo = { url: '', plate: false };
  private sponsorImgs = new Map<string, ImageBitmap>();

  constructor(private h: BrandingHost) {
    this.placeInWorld();
    this.render();
    void this.refresh();
  }

  /** Fetch the latest config from the server (silently keeps the cache when offline). */
  async refresh() {
    try {
      const r = await fetch(dataBase(this.h.serverUrl()) + '/brand/config.json', { cache: 'no-cache' });
      if (r.ok) {
        const c = (await r.json()) as Partial<BrandConfig>;
        this.config = { ...DEFAULT_BRAND, ...c };
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(this.config));
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* offline: the cached / default config stays */
    }
    await this.loadImages();
    this.render();
  }

  private abs(url: string): string {
    if (!url || /^https?:|^data:/.test(url)) return url;
    return dataBase(this.h.serverUrl()) + (url.startsWith('/') ? url : '/' + url);
  }

  private async loadImages() {
    const cfg = this.config;
    if (cfg.logo) {
      this.logoImg = await loadImage(this.abs(cfg.logo));
      try {
        if (this.logoImg) localStorage.setItem(LOGO_KEY, this.abs(cfg.logo));
      } catch {
        /* ignore */
      }
    } else this.logoImg = usesBundledLogo(cfg) ? await loadLocal(BUNDLED_LOGO.color) : null;
    this.darkLogo = this.logoImg || !cfg.logo ? logoForDark(cfg) : { url: '', plate: false };
    for (const s of this.config.sponsors) {
      if (!s.logo || this.sponsorImgs.has(s.logo)) continue;
      const img = await loadImage(this.abs(s.logo));
      if (img) this.sponsorImgs.set(s.logo, img);
    }
  }

  // ------------------------------------------------------------ world

  /** Billboards near island arrivals and graffiti on tower walls (textures filled in by render()). */
  private placeInWorld() {
    const rng = makeRng(777);
    let slot = 0;
    for (const isl of this.h.world.islands) {
      // a billboard beside the arrival plaza, facing the bridge
      const inward = isl.center.clone().sub(isl.spawn).setY(0).normalize();
      const side = new THREE.Vector3(-inward.z, 0, inward.x);
      const pos = isl.spawn.clone().addScaledVector(inward, 18).addScaledVector(side, (slot % 2 ? 1 : -1) * 15).setY(0);
      this.board(pos, Math.atan2(-inward.x, -inward.z), slot++);
      // two graffiti logos on tower walls
      const towers = [...isl.towers].filter((t) => t.h > 6).sort(() => rng.next() - 0.5).slice(0, 2);
      for (const t of towers) {
        const face = rng.int(0, 3);
        const cx = (t.x0 + t.x1) / 2;
        const cz = (t.z0 + t.z1) / 2;
        const w = face % 2 === 0 ? t.x1 - t.x0 : t.z1 - t.z0;
        const size = Math.min(5, w * 0.7);
        if (size < 2.4) continue;
        const y = Math.min(t.h - size / 2 - 0.5, 2.2 + size / 2);
        const n = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)][face];
        const p = new THREE.Vector3(face === 1 ? t.x1 + 0.05 : face === 3 ? t.x0 - 0.05 : cx, y, face === 0 ? t.z1 + 0.05 : face === 2 ? t.z0 - 0.05 : cz);
        const mat = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, roughness: 0.7 });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
        mesh.position.copy(p);
        mesh.lookAt(p.clone().add(n));
        mesh.renderOrder = 2;
        mesh.userData.noMap = true;
        this.h.scene.add(mesh);
        this.graffiti.push(mat);
      }
    }
  }

  private board(pos: THREE.Vector3, yaw: number, slot: number) {
    const g = new THREE.Group();
    const post = new THREE.MeshStandardMaterial({ color: '#2a2a30', roughness: 0.6, metalness: 0.3 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 5.4, 8), post);
      p.position.set(s * 2.6, 2.7, 0);
      p.castShadow = true;
      g.add(p);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(7.4, 4.3, 0.3), new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.5 }));
    frame.position.y = 6.6;
    frame.castShadow = true;
    g.add(frame);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, emissive: '#ffffff', emissiveIntensity: 0.18 });
    for (const s of [1, -1]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.94), mat);
      face.position.set(0, 6.6, s * 0.16);
      if (s < 0) face.rotation.y = Math.PI;
      g.add(face);
    }
    g.position.copy(pos);
    g.rotation.y = yaw;
    g.traverse((o) => (o.userData.noMap = true));
    this.h.scene.add(g);
    this.boards.push({ mat, slot, group: g });
  }

  private tex(c: HTMLCanvasElement): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  /** (Re)draw every board, graffiti and the footer from the current config. */
  render() {
    const cfg = this.config;
    const logo = this.logoImg ?? wordmark(cfg.company);
    // graffiti: the company logo, a few variations of wear
    const sprays = [0, 1, 2].map((k) => this.tex(graffitiCanvas(logo, 31 + k)));
    this.graffiti.forEach((m, i) => {
      m.map?.dispose();
      m.map = sprays[i % sprays.length];
      m.visible = cfg.graffiti !== false;
      m.needsUpdate = true;
    });
    // billboards: sponsors with a world placement, else company / advertise boards
    const worldSponsors = cfg.sponsors.filter((s) => s.world);
    const cache = new Map<string, THREE.CanvasTexture>();
    const boardsOn = featureOn(cfg, 'billboards');
    for (const b of this.boards) {
      b.group.visible = boardsOn;
      let key: string;
      let make: () => HTMLCanvasElement;
      if (worldSponsors.length) {
        const s = worldSponsors[b.slot % worldSponsors.length];
        const img = this.sponsorImgs.get(s.logo) ?? null;
        key = 's:' + s.id;
        make = () => billboardCanvas(img, img ? s.name : s.name.toUpperCase(), s.tier === 'gold' ? 'OFFICIAL SPONSOR' : 'SPONSOR', b.slot);
      } else if (cfg.advertise.enabled && b.slot % 2 === 1) {
        key = 'ad';
        make = () => billboardCanvas(null, 'YOUR BRAND HERE', cfg.supportEmail, 99);
      } else {
        key = 'co';
        make = () => billboardCanvas(logo, cfg.company, cfg.website.replace(/^https?:\/\//, ''), 7);
      }
      if (!cache.has(key)) cache.set(key, this.tex(make()));
      b.mat.map?.dispose();
      b.mat.map = cache.get(key)!;
      b.mat.emissiveMap = b.mat.map;
      b.mat.needsUpdate = true;
    }
    this.renderFooter();
    this.h.applied?.(cfg, this.darkLogo);
  }

  // ------------------------------------------------------------ title-screen footer

  private open(url: string, id: string) {
    this.h.track(id);
    window.open(url, '_blank', 'noopener');
  }

  private renderFooter() {
    const root = this.h.footerRoot();
    if (!root) return;
    const cfg = this.config;
    this.footer?.remove();
    this.footer = null;
    if (!featureOn(cfg, 'footer')) return;
    const f = document.createElement('div');
    f.className = 'brand-footer';
    const menuSponsors = cfg.sponsors.filter((s) => s.menu);
    if (menuSponsors.length) {
      const row = document.createElement('div');
      row.className = 'bf-sponsors';
      row.append(Object.assign(document.createElement('span'), { className: 'bf-label', textContent: 'Sponsored by' }));
      for (const s of menuSponsors) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bf-sponsor';
        b.title = s.name;
        const img = this.sponsorImgs.get(s.logo);
        if (img) {
          const c = document.createElement('canvas');
          c.width = 160;
          c.height = 64;
          contain(c.getContext('2d')!, img, 0, 0, 160, 64);
          b.append(c);
        } else b.textContent = s.name;
        if (s.url) b.addEventListener('click', () => this.open(s.url, 'sponsor:' + s.id));
        row.append(b);
      }
      f.append(row);
    }
    const showDonate = !desktop || cfg.donationsOnDesktop;
    const links = cfg.links.filter((l) => l.url && (l.kind !== 'donate' || showDonate));
    if (links.length) {
      const row = document.createElement('div');
      row.className = 'bf-links';
      for (const l of links) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bf-link ' + l.kind;
        b.textContent = (l.kind === 'donate' ? '♥ ' : '') + l.label;
        b.addEventListener('click', () => this.open(l.url, 'link:' + l.id));
        row.append(b);
      }
      f.append(row);
    }
    const co = document.createElement('div');
    co.className = 'bf-company';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'bf-co';
    if (this.darkLogo.url) {
      const img = document.createElement('img');
      img.src = this.darkLogo.url;
      img.alt = cfg.company;
      img.className = 'bf-logo' + (this.darkLogo.plate ? ' plate' : '');
      name.append(img);
    }
    name.append(`© ${new Date().getFullYear()} ${cfg.company}`);
    if (cfg.website) name.addEventListener('click', () => this.open(cfg.website, 'link:website'));
    co.append(name);
    if (cfg.advertise.enabled) {
      const ad = document.createElement('button');
      ad.type = 'button';
      ad.className = 'bf-ad';
      ad.textContent = cfg.advertise.text;
      ad.addEventListener('click', () => this.open(`mailto:${cfg.supportEmail}?subject=${encodeURIComponent('Advertising in BLACKEYE: Ink City')}`, 'link:advertise'));
      co.append(ad);
    }
    f.append(co);
    root.append(f);
    this.footer = f;
  }
}
