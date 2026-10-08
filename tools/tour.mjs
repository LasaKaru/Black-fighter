// Visual tour for art review: intro, menu, every island, driving, the train.
//   npm run build && node tools/tour.mjs [islandIds...]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR ?? 'screenshots/tour';
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const PORT = 8600 + Math.floor(Math.random() * 90);
const exe = process.env.CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => existsSync(p));
const server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('listening') && r()));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.blackeye !== undefined, null, { timeout: 120000 });
  // launch warning: dismiss it
  await page.waitForSelector('.notice', { timeout: 240000 });
  await page.evaluate(() => document.querySelector('.notice .btn')?.click());
  const frames = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const shot = async (name) => {
    await frames(3);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name);
  };
  if (!only.length) {
    await frames(4);
    await shot('00-intro');
    await page.evaluate(() => window.blackeye.endIntro());
    await frames(6);
    await shot('01-menu-attract');
    await page.evaluate(() => window.blackeye.ui.show('characters', 'main'));
    await frames(6);
    await shot('02-roster');
  }
  await page.evaluate(() => {
    const g = window.blackeye;
    g.start('free');
    g.agents.enabled = false;
    g.cameraRig.mode = 'custom';
    g.ui.showHud(false);
  });
  const views = {
    hub: [[-30, 22, 70], [0, 6, -30]],
    colombo: [[120, 55, 110], [0, 45, -8]],
    ella: [[40, 45, 150], [0, 10, 40]],
    sigiriya: [[0, 30, 125], [0, 26, -10]],
    taj: [[0, 18, 115], [0, 22, -22]],
    chichen: [[60, 24, 70], [0, 10, 0]],
    machu: [[50, 40, 140], [0, 20, -10]],
    colosseum: [[0, 35, 110], [0, 8, 0]],
    petra: [[0, 14, 40], [0, 18, -46]],
    greatwall: [[60, 50, 140], [0, 15, 0]],
    rio: [[50, 50, 120], [6, 70, -18]],
    speedway: [[0, 60, 140], [0, 0, 0]],
    agenthq: [[0, 40, 120], [0, 30, -50]],
  };
  for (const [id, [from, to]] of Object.entries(views)) {
    if (only.length && !only.includes(id)) continue;
    await page.evaluate(({ id, from, to }) => {
      const g = window.blackeye;
      const c = id === 'hub' ? { x: 0, y: 0, z: 0 } : g.world.island(id).center;
      const cam = g.renderer.camera;
      g.player.respawn(new cam.position.constructor(c.x, 0.5, c.z));
      cam.position.set(c.x + from[0], from[1], c.z + from[2]);
      cam.lookAt(c.x + to[0], to[1], c.z + to[2]);
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }, { id, from, to });
    await frames(8);
    await shot(`10-${id}`);
  }
  if (!only.length || only.includes('drive')) {
    await page.evaluate(() => {
      const g = window.blackeye;
      g.cameraRig.mode = 'tp';
      g.ui.showHud(true);
      g.fastTravel('speedway');
      const isl = g.world.island('speedway');
      const v = g.vehicles.summon('blotter', isl.center.clone().add({ x: -40, y: 0.6, z: 34, isVector3: true }), Math.PI / 2, 0);
      g.player.enterVehicle(v);
      g.cameraRig.yaw = Math.PI / 2;
    });
    const steps = (n) => page.evaluate((n) => new Promise((res) => { const g = window.blackeye; const s = g.simSteps + n; const f = () => (g.simSteps >= s ? res() : setTimeout(f, 30)); f(); }), n);
    const state = (label) =>
      page.evaluate(() => {
        const v = window.blackeye.player.vehicle;
        return v ? { speed: +v.speed.toFixed(2), yaw: +v.yaw.toFixed(2), pos: v.position.toArray().map((n) => +n.toFixed(1)) } : null;
      }).then((st) => (console.log('drive', label, JSON.stringify(st)), st));
    await steps(30);
    const s0 = await state('rest');
    await page.keyboard.down('KeyW');
    await steps(120);
    const s1 = await state('throttle');
    await page.keyboard.down('KeyA');
    await steps(40);
    const s2 = await state('throttle+left');
    if (process.env.ASSERT_DRIVE) {
      if (!(s1.speed > 3)) errors.push(`vehicle did not accelerate forward: ${JSON.stringify(s1)}`);
      if (!(s2.yaw > s1.yaw)) errors.push(`left steer did not turn left: ${s1.yaw} -> ${s2.yaw}`);
      void s0;
    }
    await shot('20-drive');
    await page.keyboard.up('KeyA');
    await page.keyboard.up('KeyW');
  }
  if (!only.length || only.includes('train')) {
    await page.evaluate(() => {
      const g = window.blackeye;
      if (g.player.vehicle) g.player.exitVehicle();
      g.cameraRig.mode = 'custom';
      g.ui.showHud(false);
      const f = g.world.train.front;
      const cam = g.renderer.camera;
      g.player.respawn(f.clone().setY(0.5));
      cam.position.set(f.x + 22, f.y + 10, f.z + 24);
      cam.lookAt(f.x, f.y + 2, f.z);
    });
    await frames(6);
    await shot('21-train');
  }
  if (!only.length || only.includes('hero')) {
    await page.evaluate(() => {
      const g = window.blackeye;
      g.fastTravel('colombo');
      g.cameraRig.mode = 'custom';
      g.ui.showHud(false);
      const p = g.player.feet;
      g.player.yaw = 0;
      const cam = g.renderer.camera;
      cam.fov = 35;
      cam.updateProjectionMatrix();
      cam.position.set(p.x + 0.8, p.y + 1.5, p.z + 4.2);
      cam.lookAt(p.x, p.y + 1.0, p.z);
    });
    await frames(10);
    await shot('22-hero');
  }
} catch (e) {
  errors.push(String(e?.stack ?? e));
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {}
  server.stdout.destroy();
  server.unref();
}
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('tour done');
