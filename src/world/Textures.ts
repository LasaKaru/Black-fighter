import * as THREE from 'three';
import { makeRng } from '../core/math';

/**
 * Every texture in the prototype is drawn procedurally on a canvas. This keeps
 * the download tiny and lets players recolour and re-text everything.
 */

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

// ---------------------------------------------------------------- faces

export type Expression = 'neutral' | 'halfLid' | 'focus' | 'wince' | 'wide' | 'smirk' | 'blink' | 'ko';

/** Cartoon face drawn as a transparent decal over the faceted head. */
export function faceTexture(style: string, expr: Expression, skin: string): THREE.Texture {
  return cached(`face:${style}:${expr}:${skin}`, () => {
    const [c, g] = canvas(512, 256);
    g.clearRect(0, 0, 512, 256);
    if (style === 'none') return toTexture(c);
    const ink = '#111114';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const eyeY = 118;
    const eyes: Array<[number, number]> = [
      [185, eyeY],
      [327, eyeY],
    ];
    const r = style === 'cheeky' ? 34 : 40;
    const lookX = expr === 'halfLid' ? 12 : style === 'sleepy' ? 8 : 0;
    for (const [i, [x, y]] of eyes.entries()) {
      if (expr === 'blink' || expr === 'ko') {
        g.strokeStyle = ink;
        g.lineWidth = 9;
        g.beginPath();
        if (expr === 'ko') {
          g.moveTo(x - 22, y - 22); g.lineTo(x + 22, y + 22);
          g.moveTo(x + 22, y - 22); g.lineTo(x - 22, y + 22);
        } else {
          g.moveTo(x - r, y + 4);
          g.quadraticCurveTo(x, y + 18, x + r, y + 4);
        }
        g.stroke();
        continue;
      }
      const er = expr === 'wide' ? r * 1.12 : expr === 'focus' ? r * 0.9 : r;
      // sclera
      g.fillStyle = '#fbfbf8';
      g.beginPath();
      g.ellipse(x, y, er, er * (expr === 'focus' ? 0.75 : 1), 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = ink;
      g.lineWidth = 8;
      g.stroke();
      // pupil
      g.fillStyle = ink;
      g.beginPath();
      const pr = expr === 'wide' ? 11 : 15;
      g.arc(x + lookX, y + (expr === 'halfLid' || style === 'sleepy' ? 10 : 4), pr, 0, Math.PI * 2);
      g.fill();
      // eyelid
      let lid = 0;
      if (expr === 'halfLid' || (style === 'sleepy' && expr === 'neutral')) lid = 0.5;
      if (style === 'deadpan' && expr === 'neutral') lid = 0.3;
      if (expr === 'focus') lid = 0.35;
      if (expr === 'smirk') lid = 0.4;
      if (expr === 'wince') lid = 0.7;
      if (lid > 0) {
        const ly = y - er + er * 2 * lid;
        g.save();
        g.beginPath();
        g.ellipse(x, y, er + 5, er + 5, 0, 0, Math.PI * 2);
        g.clip();
        g.fillStyle = skin;
        g.fillRect(x - er - 8, y - er - 8, er * 2 + 16, ly - (y - er - 8));
        g.restore();
        g.strokeStyle = ink;
        g.lineWidth = 9;
        g.beginPath();
        const tilt = expr === 'focus' || expr === 'wince' ? (i === 0 ? 8 : -8) : 0;
        g.moveTo(x - er - 3, ly + tilt);
        g.lineTo(x + er + 3, ly - tilt);
        g.stroke();
      }
    }
    // mouth
    g.strokeStyle = ink;
    g.lineWidth = 8;
    g.beginPath();
    const mx = 256;
    const my = 200;
    if (expr === 'wide' || expr === 'wince') {
      g.ellipse(mx, my, 12, 9, 0, 0, Math.PI * 2);
    } else if (expr === 'smirk' || style === 'cheeky') {
      g.moveTo(mx - 22, my);
      g.quadraticCurveTo(mx + 4, my + 10, mx + 24, my - 8);
    } else {
      g.moveTo(mx - 16, my);
      g.lineTo(mx + 14, my - 1);
    }
    g.stroke();
    return toTexture(c);
  });
}

// ---------------------------------------------------------------- clothing

export function knitTexture(color: string): THREE.Texture {
  return cached(`knit:${color}`, () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 8) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x, 0, 3, 128);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x + 4, 0, 2, 128);
    }
    const t = toTexture(c, true, true);
    t.repeat.set(4, 1);
    return t;
  });
}

function drawEye(g: CanvasRenderingContext2D, x: number, y: number, r: number, iris: string, ink = '#111114', spikes = 0, spikeColor = iris) {
  if (spikes > 0) {
    g.fillStyle = spikeColor;
    g.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? r * 1.9 : r * 1.25;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#fbfbf8';
  g.beginPath();
  g.ellipse(x, y, r * 1.25, r * 0.8, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = Math.max(2, r * 0.12);
  g.strokeStyle = ink;
  g.stroke();
  g.fillStyle = iris;
  g.beginPath();
  g.arc(x, y, r * 0.55, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ink;
  g.beginPath();
  g.arc(x, y, r * 0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(x - r * 0.15, y - r * 0.15, r * 0.1, 0, Math.PI * 2);
  g.fill();
}

/** Round sun-burst eye patch (orange) or splat eye patch (purple). */
export function patchTexture(kind: 'burst' | 'splat', color: string): THREE.Texture {
  return cached(`patch:${kind}:${color}`, () => {
    const [c, g] = canvas(128, 128);
    g.clearRect(0, 0, 128, 128);
    if (kind === 'burst') {
      drawEye(g, 64, 64, 26, '#111114', '#111114', 12, color);
    } else {
      const rng = makeRng(7);
      g.fillStyle = color;
      g.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const rr = 40 + rng.range(-6, 16) * (i % 3 === 0 ? 1.4 : 0.6);
        g.lineTo(64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      drawEye(g, 64, 64, 20, color);
    }
    return toTexture(c);
  });
}

/** Jacket back print: an eye inside a planet ring with the custom text. */
export function backPrintTexture(text: string, colorA: string, colorB: string, shirt: string): THREE.Texture {
  return cached(`print:${text}:${colorA}:${colorB}:${shirt}`, () => {
    const [c, g] = canvas(512, 512);
    g.clearRect(0, 0, 512, 512);
    // headline text
    if (text) {
      g.fillStyle = '#f3f1ed';
      g.font = '900 76px "Arial Black", Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.save();
      g.translate(256, 92);
      g.scale(1, 1.15);
      g.fillText(text.toUpperCase(), 0, 0, 470);
      g.restore();
    }
    // planet ring
    g.save();
    g.translate(256, 268);
    g.rotate(-0.25);
    g.strokeStyle = colorA;
    g.lineWidth = 12;
    g.beginPath();
    g.ellipse(0, 0, 175, 48, 0, Math.PI, Math.PI * 2);
    g.stroke();
    g.restore();
    // planet with eye
    g.fillStyle = colorB;
    g.beginPath();
    g.arc(256, 268, 100, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.arc(226, 236, 60, 0, Math.PI * 2);
    g.fill();
    drawEye(g, 256, 268, 52, shirt);
    // front half of the ring
    g.save();
    g.translate(256, 268);
    g.rotate(-0.25);
    g.strokeStyle = colorA;
    g.lineWidth = 12;
    g.beginPath();
    g.ellipse(0, 0, 175, 48, 0, 0, Math.PI);
    g.stroke();
    g.restore();
    // small eyes row
    drawEye(g, 150, 430, 18, colorA);
    drawEye(g, 256, 430, 18, shirt);
    drawEye(g, 362, 430, 18, colorB);
    g.fillStyle = '#f3f1ed';
    g.font = '700 22px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('· · ·  INK CITY  · · ·', 256, 486);
    return toTexture(c);
  });
}

export function chestTextTexture(text: string): THREE.Texture {
  return cached(`chest:${text}`, () => {
    const [c, g] = canvas(256, 128);
    g.clearRect(0, 0, 256, 128);
    g.fillStyle = '#f3f1ed';
    g.font = '900 44px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const words = text.toUpperCase().split(' ');
    if (words.length > 1) {
      g.fillText(words[0], 128, 40, 240);
      g.fillText(words.slice(1).join(' '), 128, 92, 240);
    } else {
      g.fillText(text.toUpperCase(), 128, 64, 240);
    }
    return toTexture(c);
  });
}

// ---------------------------------------------------------------- world

/** White ground with black cow-pattern ink blots (reference plaza floor). */
export function inkGroundTexture(): THREE.Texture {
  return cached('inkground', () => {
    const [c, g] = canvas(1024, 1024);
    g.fillStyle = '#d8d6d2';
    g.fillRect(0, 0, 1024, 1024);
    const rng = makeRng(42);
    // subtle concrete noise
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(0,0,0,${rng.range(0.01, 0.05)})`;
      g.fillRect(rng.range(0, 1024), rng.range(0, 1024), rng.range(1, 4), rng.range(1, 4));
    }
    // ink blots that wrap seamlessly
    g.fillStyle = '#121216';
    for (let i = 0; i < 14; i++) {
      const cx = rng.range(0, 1024);
      const cy = rng.range(0, 1024);
      const base = rng.range(30, 120);
      for (const ox of [-1024, 0, 1024]) {
        for (const oy of [-1024, 0, 1024]) {
          blob(g, cx + ox, cy + oy, base, makeRng(i * 31));
        }
      }
    }
    const t = toTexture(c, true, true);
    t.repeat.set(6, 6);
    return t;
  });
}

function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, rng: ReturnType<typeof makeRng>) {
  g.beginPath();
  const n = 18;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * rng.range(0.65, 1.25);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * rng.range(0.6, 1)]);
  }
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % n];
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    if (i === 0) g.moveTo(mx, my);
    g.quadraticCurveTo(bx, by, (bx + pts[(i + 2) % n][0]) / 2, (by + pts[(i + 2) % n][1]) / 2);
  }
  g.closePath();
  g.fill();
  // droplets around
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = r * rng.range(1.3, 1.9);
    g.beginPath();
    g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rng.range(3, r * 0.15), 0, Math.PI * 2);
    g.fill();
  }
}

/** Splat used for decals (white, tinted by material colour). */
export function splatTexture(seed: number): THREE.Texture {
  return cached(`splat:${seed}`, () => {
    const [c, g] = canvas(256, 256);
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#ffffff';
    blob(g, 128, 128, 62, makeRng(seed));
    return toTexture(c);
  });
}

/** Black ink drips running down from the top edge. */
export function dripTexture(seed: number): THREE.Texture {
  return cached(`drip:${seed}`, () => {
    const [c, g] = canvas(256, 512);
    g.clearRect(0, 0, 256, 512);
    const rng = makeRng(seed);
    g.fillStyle = '#111114';
    g.fillRect(0, 0, 256, rng.range(20, 50));
    for (let i = 0; i < 9; i++) {
      const x = rng.range(10, 246);
      const w = rng.range(8, 26);
      const h = rng.range(80, 480);
      g.fillRect(x - w / 2, 0, w, h - w / 2);
      g.beginPath();
      g.arc(x, h - w / 2, w / 2 + 2, 0, Math.PI * 2);
      g.fill();
      if (rng.chance(0.5)) {
        g.beginPath();
        g.arc(x + rng.range(-4, 4), h + rng.range(12, 30), w * 0.3, 0, Math.PI * 2);
        g.fill();
      }
    }
    return toTexture(c);
  });
}

/** A big painted wall eye. */
export function wallEyeTexture(iris: string, glow = false): THREE.Texture {
  return cached(`walleye:${iris}:${glow}`, () => {
    const [c, g] = canvas(256, 256);
    g.clearRect(0, 0, 256, 256);
    if (glow) {
      const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
      grd.addColorStop(0, iris);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 256);
    }
    drawEye(g, 128, 128, 70, iris);
    return toTexture(c);
  });
}

/** Burning eye orb texture (the power-up). */
export function eyeOrbTexture(iris: string): THREE.Texture {
  return cached(`orb:${iris}`, () => {
    const [c, g] = canvas(512, 256);
    // equirectangular: sclera everywhere, iris centred at u=0.25 (+Z on a three.js sphere)
    g.fillStyle = '#fff6ea';
    g.fillRect(0, 0, 512, 256);
    const cx = 128;
    const cy = 128;
    const grd = g.createRadialGradient(cx, cy, 10, cx, cy, 80);
    grd.addColorStop(0, '#2a0d00');
    grd.addColorStop(0.35, iris);
    grd.addColorStop(0.8, '#ffd27a');
    grd.addColorStop(1, '#fff6ea');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(cx, cy, 70, 70, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0b0b0d';
    g.beginPath();
    g.ellipse(cx, cy, 32, 32, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(cx - 10, cy - 10, 8, 8, 0, 0, Math.PI * 2);
    g.fill();
    return toTexture(c);
  });
}

export function hazardTexture(): THREE.Texture {
  return cached('hazard', () => {
    const [c, g] = canvas(256, 64);
    g.fillStyle = '#f0eee9';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#121216';
    for (let x = -64; x < 320; x += 48) {
      g.beginPath();
      g.moveTo(x, 64);
      g.lineTo(x + 24, 64);
      g.lineTo(x + 56, 0);
      g.lineTo(x + 32, 0);
      g.closePath();
      g.fill();
    }
    const t = toTexture(c, true, true);
    return t;
  });
}

/** Animated-looking billboard screen. */
export function billboardTexture(kind: number): THREE.Texture {
  return cached(`billboard:${kind}`, () => {
    const [c, g] = canvas(512, 256);
    g.fillStyle = '#101014';
    g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#f0eee9';
    g.lineWidth = 6;
    g.strokeRect(10, 10, 492, 236);
    if (kind % 3 === 0) {
      drawEye(g, 256, 128, 70, '#ff7a1a');
      g.fillStyle = '#f0eee9';
      g.font = '900 34px "Arial Black", Impact, sans-serif';
      g.textAlign = 'center';
      g.fillText('WE SEE YOU', 256, 236);
    } else if (kind % 3 === 1) {
      g.fillStyle = '#f0eee9';
      g.font = '900 92px "Arial Black", Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('BLACKEYE', 256, 110, 470);
      g.fillStyle = '#17a9a3';
      g.font = '700 30px Arial, sans-serif';
      g.fillText('STAY ON MODEL', 256, 190);
    } else {
      for (let i = 0; i < 5; i++) drawEye(g, 70 + i * 93, 128, 30, i % 2 ? '#6b2bff' : '#17a9a3');
    }
    return toTexture(c);
  });
}

export function cloudSeaTexture(): THREE.Texture {
  return cached('cloudsea', () => {
    const [c, g] = canvas(512, 512);
    g.fillStyle = '#8f8f97';
    g.fillRect(0, 0, 512, 512);
    const rng = makeRng(5);
    for (let i = 0; i < 260; i++) {
      const x = rng.range(0, 512);
      const y = rng.range(0, 512);
      const r = rng.range(10, 60);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(235,235,240,0.55)');
      grd.addColorStop(1, 'rgba(235,235,240,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const t = toTexture(c, true, true);
    t.repeat.set(8, 8);
    return t;
  });
}

/** Soft round sprite for particles. */
export function softDotTexture(): THREE.Texture {
  return cached('softdot', () => {
    const [c, g] = canvas(64, 64);
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return toTexture(c);
  });
}

/** Four-point sparkle (the orange "+" sparks floating in the reference). */
export function sparkleTexture(): THREE.Texture {
  return cached('sparkle', () => {
    const [c, g] = canvas(64, 64);
    g.clearRect(0, 0, 64, 64);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(32, 2);
    g.quadraticCurveTo(35, 29, 62, 32);
    g.quadraticCurveTo(35, 35, 32, 62);
    g.quadraticCurveTo(29, 35, 2, 32);
    g.quadraticCurveTo(29, 29, 32, 2);
    g.fill();
    return toTexture(c);
  });
}

export function nameTagTexture(name: string, color = '#f0eee9'): THREE.Texture {
  const [c, g] = canvas(256, 64);
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = 'rgba(16,16,20,0.75)';
  const w = Math.min(250, 24 + name.length * 18);
  g.beginPath();
  g.roundRect(128 - w / 2, 8, w, 46, 14);
  g.fill();
  g.fillStyle = color;
  g.font = '700 28px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 32, 240);
  return toTexture(c);
}

/** Island name board: big title + subtitle, with an eye mark. */
export function signTexture(title: string, sub: string): THREE.Texture {
  return cached(`sign:${title}:${sub}`, () => {
    const [c, g] = canvas(512, 160);
    g.fillStyle = '#111114';
    g.fillRect(0, 0, 512, 160);
    g.strokeStyle = '#eceae6';
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 144);
    drawEye(g, 70, 80, 26, '#ff7a1a');
    g.fillStyle = '#eceae6';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '900 52px "Arial Black", Impact, sans-serif';
    g.fillText(title.toUpperCase(), 120, 66, 370);
    g.fillStyle = '#17a9a3';
    g.font = '700 24px Arial, sans-serif';
    g.fillText(sub.toUpperCase(), 122, 118, 370);
    return toTexture(c);
  });
}

/** Checkered flag strip for start/finish lines. */
export function checkerTexture(): THREE.Texture {
  return cached('checker', () => {
    const [c, g] = canvas(128, 32);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? '#111114' : '#f2f0ea';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
    const t = toTexture(c, true, true);
    return t;
  });
}

/** Comic speech bubble with wrapped text. */
export function speechTexture(text: string): THREE.Texture {
  return cached(`speech:${text}`, () => {
    const [c, g] = canvas(512, 170);
    g.clearRect(0, 0, 512, 170);
    g.fillStyle = '#f6f5f2';
    g.strokeStyle = '#111114';
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(8, 8, 496, 128, 26);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(230, 134);
    g.lineTo(256, 166);
    g.lineTo(276, 134);
    g.fill();
    g.stroke();
    g.fillStyle = '#111114';
    g.font = '700 30px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > 460 && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    lines.push(line);
    const y0 = 72 - (lines.length - 1) * 18;
    lines.slice(0, 3).forEach((l, i) => g.fillText(l, 256, y0 + i * 36, 470));
    return toTexture(c);
  });
}

/** Round icon marker (missions, reveal pings). */
export function markerTexture(color: string, glyph: string): THREE.Texture {
  return cached(`marker:${color}:${glyph}`, () => {
    const [c, g] = canvas(128, 128);
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = color;
    g.strokeStyle = '#111114';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(64, 60, 46, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#111114';
    g.font = '900 56px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(glyph, 64, 62);
    return toTexture(c);
  });
}
