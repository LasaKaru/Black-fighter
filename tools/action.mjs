// Action-move check: super-jump smoke ring, glide, zip-line, swing platform.
// Asserts the moves trigger and saves screenshots for review.
//   npm run build && node tools/action.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const OUT = process.env.SHOT_DIR ?? 'screenshots/action';
mkdirSync(OUT, { recursive: true });
const PORT = 8500 + Math.floor(Math.random() * 90);
const exe = process.env.CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => existsSync(p));
const server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('listening') && r()));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
// PState indices (src/player/Player.ts)
const S = { Ground: 0, Air: 1, Charge: 9, Glide: 18, Zip: 19 };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.blackeye !== undefined, null, { timeout: 120000 });
  const steps = (n) => page.evaluate((n) => new Promise((res) => { const g = window.blackeye; const s = g.simSteps + n; const f = () => (g.simSteps >= s ? res() : setTimeout(f, 20)); f(); }), n);
  const st = () => page.evaluate(() => { const p = window.blackeye.player; return { state: p.state, y: +p.feet.y.toFixed(2), hs: +Math.hypot(p.vel.x, p.vel.z).toFixed(2), pos: p.feet.toArray().map((n) => +n.toFixed(1)) }; });
  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name);
  };
  await page.evaluate(() => {
    const g = window.blackeye;
    g.endIntro();
    g.start('free');
    g.agents.enabled = false;
    g.fastTravel('ella');
    g.player.eyes.sky = 3;
    g.player.stamina = 100;
  });
  await steps(30);
  // ---- super-jump: hold E with Sky selected, release
  await page.keyboard.press('Digit2');
  await page.keyboard.down('KeyE');
  await steps(50);
  await page.keyboard.up('KeyE');
  await steps(10);
  await shot('01-smoke-ring');
  const sj = await st();
  console.log('super-jump', JSON.stringify(sj));
  if (sj.state !== S.Air) errors.push('super-jump did not launch: ' + JSON.stringify(sj));
  // ---- glide: at the top, press and hold Space, push forward
  await page.evaluate(() => new Promise((res) => { const p = window.blackeye.player; const f = () => (p.vel.y < 1 ? res() : setTimeout(f, 20)); f(); }));
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await steps(50);
  const gl = await st();
  console.log('glide', JSON.stringify(gl));
  await shot('02-glide');
  if (gl.state !== S.Glide) errors.push('glide did not deploy: ' + JSON.stringify(gl));
  else if (gl.hs < 10) errors.push('glide too slow: ' + JSON.stringify(gl));
  await page.keyboard.down('ShiftLeft');
  await steps(40);
  await shot('03-glide-boost');
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');
  await page.evaluate(() => new Promise((res) => { const p = window.blackeye.player; const f = () => (p.grounded ? res() : setTimeout(f, 20)); f(); }));
  // ---- zip-line: stand under the high end of the first island cable and press F
  const zinfo = await page.evaluate(() => {
    const g = window.blackeye;
    const z = g.world.ziplines.find((q) => g.world.islandAt(q.a)?.def.id === 'ella') ?? g.world.ziplines[2];
    const a = z.a.clone().lerp(z.b, 0.12);
    a.y -= Math.sin(0.12 * Math.PI) * z.a.distanceTo(z.b) * 0.025 + 2.0;
    g.player.respawn(a);
    return { n: g.world.ziplines.length, a: z.a.toArray(), b: z.b.toArray() };
  });
  console.log('ziplines', JSON.stringify(zinfo));
  await steps(4);
  await page.keyboard.press('KeyF');
  await steps(40);
  const zp = await st();
  console.log('zip', JSON.stringify(zp));
  await page.evaluate(() => {
    const g = window.blackeye;
    g.cameraRig.yaw = g.player.yaw;
  });
  await steps(4);
  await shot('04-zipline');
  if (zp.state !== S.Zip) errors.push('zip-line grab failed: ' + JSON.stringify(zp));
  await steps(240);
  console.log('after zip', JSON.stringify(await st()));
  // ---- swing platform: put the camera on the first swing
  const sw = await page.evaluate(() => {
    const g = window.blackeye;
    const s = g.world.swings[0];
    if (!s) return null;
    const p = s.group.position.clone();
    g.player.respawn(p.clone().add({ x: 0, y: 0.3, z: 0, isVector3: true }));
    return { n: g.world.swings.length, p: p.toArray() };
  });
  console.log('swings', JSON.stringify(sw));
  await steps(90);
  const ride = await st();
  console.log('ride', JSON.stringify(ride));
  await shot('05-swing');
  // ---- pursuit: an Agent squad drops in; ink them all for the reward
  await page.evaluate(() => {
    const g = window.blackeye;
    g.agents.enabled = true;
    g.fastTravel('chichen');
  });
  await steps(20);
  const started = await page.evaluate(() => window.blackeye.pursuit.trigger());
  await steps(90);
  const ps = await page.evaluate(() => { const g = window.blackeye; return { active: g.pursuit.active, left: g.pursuit.left, alerted: g.agents.alertedCount, ink: g.profile.data.ink }; });
  console.log('pursuit', started, JSON.stringify(ps));
  await shot('06-pursuit');
  if (!started || !ps.active || ps.left < 3) errors.push('pursuit did not start: ' + JSON.stringify(ps));
  await page.evaluate(() => {
    const g = window.blackeye;
    for (const a of g.agents.agents.values()) a.receiveHit({ dir: new g.player.feet.constructor(0, 0, 1), damage: 999, knock: 6, lift: 4, kind: 'shock' });
  });
  await steps(60);
  const pe = await page.evaluate(() => { const g = window.blackeye; return { active: g.pursuit.active, ink: g.profile.data.ink }; });
  console.log('pursuit end', JSON.stringify(pe));
  if (pe.active || pe.ink <= ps.ink) errors.push('pursuit win not rewarded: ' + JSON.stringify(pe));
  // ---- Sky Line: start on top of the Lotus Tower and glide off
  const sky = await page.evaluate(() => {
    const g = window.blackeye;
    g.agents.enabled = false;
    g.startMission('sky_line');
    const r = g.world.island('colombo').anchors.skyLine[0];
    const p = g.player.feet;
    g.cameraRig.yaw = Math.atan2(r.x - p.x, r.z - p.z);
    return { mission: g.missions.active?.def.id, y: +p.y.toFixed(1), rings: g.world.island('colombo').anchors.skyLine.length };
  });
  console.log('sky line', JSON.stringify(sky));
  if (sky.mission !== 'sky_line' || sky.y < 100) errors.push('sky line start failed: ' + JSON.stringify(sky));
  await steps(20);
  await page.keyboard.down('KeyW');
  await page.keyboard.press('Space');
  await steps(14);
  await page.keyboard.down('Space');
  await steps(90);
  await shot('07-sky-line');
  console.log('sky glide', JSON.stringify(await st()));
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyW');
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
  console.error('ACTION FAILED:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('ACTION OK');
