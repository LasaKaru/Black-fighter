// Renders close-up "portrait" shots of the hero (front/back) and an Agent for art review.
//   npm run build && node tools/portrait.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
const OUT = process.env.SHOT_DIR ?? 'screenshots';
mkdirSync(OUT, { recursive: true });
const PORT = 8600 + Math.floor(Math.random() * 90);
const exe = process.env.CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => existsSync(p));
const server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('listening') && r()));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.blackeye !== undefined, null, { timeout: 60000 });
  const shoot = async (name, setup) => {
    await page.evaluate(setup);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  await page.evaluate(() => {
    const g = window.blackeye;
    g.ui.show('none');
    g.cameraRig.mode = 'custom';
  });
  const place = (dist, height, angle, look) => `(() => {
    const g = window.blackeye, cam = g.renderer.camera, p = g.player.feet;
    g.player.yaw = 0;
    cam.fov = 35; cam.updateProjectionMatrix();
    cam.position.set(p.x + Math.sin(${angle}) * ${dist}, p.y + ${height}, p.z + Math.cos(${angle}) * ${dist});
    cam.lookAt(p.x, p.y + ${look}, p.z);
  })()`;
  await shoot('portrait-front', place(4.2, 1.2, 0, 1.0));
  await shoot('portrait-face', place(1.6, 1.65, 0.35, 1.55));
  await shoot('portrait-back', place(4.2, 1.3, Math.PI, 1.0));
  await shoot('portrait-agent', `(() => {
    const g = window.blackeye;
    g.agents.enabled = true;
    g.agents.update(0.016, []);
    for (let i = 0; i < 200 && g.agents.agents.size === 0; i++) g.agents.update(0.1, [{ key: 'x', feet: g.player.feet.clone().add({ x: 0, y: 0, z: -60, isVector3: true }), hittable: g.player, canBeTargeted: false }]);
    const a = [...g.agents.agents.values()][0];
    a.feet.copy(g.player.feet).add({ x: 1.6, y: 0, z: 0, isVector3: true });
    a.yaw = 0;
    a.render(0.016);
    const cam = g.renderer.camera, p = g.player.feet;
    cam.position.set(p.x + 0.8, p.y + 1.2, p.z + 5);
    cam.lookAt(p.x + 0.8, p.y + 1.0, p.z);
  })()`);
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch {}
  server.stdout.destroy();
  server.unref();
}
