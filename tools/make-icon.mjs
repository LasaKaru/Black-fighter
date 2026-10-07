/**
 * Draws the placeholder app icon (build/icon.png, 512×512) with no
 * dependencies: an ink-outlined eye on a teal tile. Replace build/icon.png
 * with real art any time; electron-builder turns it into .ico / .icns.
 *   node tools/make-icon.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 512;
const SS = 4; // supersampling per axis
const BG = [23, 169, 163];
const PAPER = [236, 234, 230];
const INK = [17, 17, 20];
const IRIS = [255, 122, 26];

/** Colour at a point in [0,1]² (null = transparent). */
function shade(x, y) {
  const cx = x - 0.5;
  const cy = y - 0.5;
  // rounded-square tile
  const q = 0.47 - 0.11;
  if (Math.hypot(Math.max(Math.abs(cx) - q, 0), Math.max(Math.abs(cy) - q, 0)) > 0.11) return null;
  // ink drip under the eye
  const drip = Math.abs(cx - 0.11) < 0.035 && cy > 0.1 && cy < 0.36;
  const dripEnd = Math.hypot(cx - 0.11, cy - 0.36) < 0.045;
  // almond eye shape: intersection of two circles
  const up = Math.hypot(cx, cy + 0.33) < 0.5;
  const down = Math.hypot(cx, cy - 0.33) < 0.5;
  if (up && down) {
    const ir = Math.hypot(cx + 0.02, cy);
    if (ir < 0.075) return [250, 250, 250].map((v, i) => (Math.hypot(cx + 0.06, cy + 0.04) < 0.035 ? v : INK[i]));
    if (ir < 0.12) return INK;
    if (ir < 0.16) return IRIS;
    return PAPER;
  }
  // thick ink outline around the eye
  const upO = Math.hypot(cx, cy + 0.33) < 0.55;
  const downO = Math.hypot(cx, cy - 0.33) < 0.55;
  if ((upO && downO) || drip || dripEnd) return INK;
  return BG;
}

const raw = Buffer.alloc((N * 4 + 1) * N);
for (let py = 0; py < N; py++) {
  raw[py * (N * 4 + 1)] = 0; // filter: none
  for (let px = 0; px < N; px++) {
    let rr = 0, gg = 0, bb = 0, aa = 0;
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const c = shade((px + (sx + 0.5) / SS) / N, (py + (sy + 0.5) / SS) / N);
        if (!c) continue;
        rr += c[0]; gg += c[1]; bb += c[2]; aa++;
      }
    const o = py * (N * 4 + 1) + 1 + px * 4;
    raw[o] = aa ? rr / aa : 0;
    raw[o + 1] = aa ? gg / aa : 0;
    raw[o + 2] = aa ? bb / aa : 0;
    raw[o + 3] = Math.round((aa / (SS * SS)) * 255);
  }
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
console.log(`build/icon.png written (${png.length} bytes)`);
