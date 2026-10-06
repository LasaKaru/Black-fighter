// Boots the production build headless and prints boot time + frame rate.
//   npm run build && node tools/perf.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = Number(process.env.TEST_PORT ?? 8700 + Math.floor(Math.random() * 200));
const exe = process.env.CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => existsSync(p));
const server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  server.stdout.destroy();
  server.unref();
};
await new Promise((r, j) => {
  server.stdout.on('data', (d) => String(d).includes('listening') && r());
  server.on('exit', (c) => j(new Error('server exited with code ' + c)));
});
console.log('server up on', PORT);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.blackeye !== undefined, null, { timeout: 120000 });
  console.log('boot ms', Date.now() - t0);
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(3000);
    console.log('fps', await page.evaluate(() => window.blackeye.fps.toFixed(2)));
  }
  const info = await page.evaluate(() => {
    const r = window.blackeye.renderer.renderer.info;
    return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures };
  });
  console.log('render info', JSON.stringify(info));
} finally {
  await browser.close();
  stopServer();
}
