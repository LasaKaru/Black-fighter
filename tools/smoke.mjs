// Headless smoke test: boots the production build, starts the game, plays a
// few seconds of scripted input and saves screenshots. Fails on page errors.
//
//   npm run build && npm run smoke
//
// Requires a Chromium binary (set CHROMIUM_PATH, defaults to Playwright's).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const PORT = Number(process.env.TEST_PORT ?? 8700 + Math.floor(Math.random() * 200));
const OUT = process.env.SHOT_DIR ?? 'screenshots';
mkdirSync(OUT, { recursive: true });

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

const errors = [];
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

async function openPage(name, viewport = { width: 1280, height: 720 }, settings = null) {
  const context = await browser.newContext({ viewport });
  if (settings) await context.addInitScript((s) => localStorage.setItem('blackeye.settings.v1', s), JSON.stringify(settings));
  const page = await context.newPage();
  // offline-friendly: skip external requests (web fonts)
  await page.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) errors.push(`[${name}] console: ${m.text()}`);
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => window.blackeye !== undefined, null, { timeout: 60000 });
  return page;
}

// Software rendering in CI can run at a few fps, so input is held for a number
// of *simulation* steps instead of wall-clock time.
const waitSteps = (page, n) =>
  page.evaluate((n) => new Promise((resolve) => {
    const g = window.blackeye;
    const target = g.simSteps + n;
    const poll = () => (g.simSteps >= target ? resolve(g.simSteps) : setTimeout(poll, 20));
    poll();
  }), n);
const hold = async (page, key, steps) => {
  await page.keyboard.down(key);
  await waitSteps(page, 2);
  await waitSteps(page, steps);
  await page.keyboard.up(key);
};

try {
  const page = await openPage('p1');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/01-menu.png` });

  await page.click('#screen-main button:has-text("Customize")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/02-customize.png` });
  await page.click('#screen-customize button.back');

  await page.click('#screen-main button:has-text("Ink Run")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/03-start.png` });

  // run towards the stairs, sprinting
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await waitSteps(page, 3);
  const before = await page.evaluate(() => ({ z: window.blackeye.player.feet.z, steps: window.blackeye.simSteps }));
  await hold(page, 'KeyW', 150);
  await page.keyboard.up('ShiftLeft');
  await page.screenshot({ path: `${OUT}/04-run.png` });

  const state = await page.evaluate(() => {
    const g = window.blackeye;
    return { feet: g.player.feet.toArray().map((n) => +n.toFixed(2)), state: g.player.state, agents: g.agents.agents.size, fps: +g.fps.toFixed(1), steps: g.simSteps };
  });
  // headless software rendering is slow, so compare against simulated time, not wall time
  const simSeconds = (state.steps - before.steps) / 60;
  const moved = before.z - state.feet[2];
  console.log('after run:', JSON.stringify(state), `moved ${moved.toFixed(2)} m in ${simSeconds.toFixed(2)} sim-s`);
  if (moved < simSeconds * 4) errors.push(`player moved too little: ${moved.toFixed(2)} m in ${simSeconds.toFixed(2)} s`);

  // jump + attack + give powers and use them
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g = window.blackeye;
    g.player.eyes.fire = 3;
    g.player.eyes.sky = 2;
  });
  await page.keyboard.down('KeyW');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/05-dash.png` });
  await page.keyboard.up('KeyW');
  await waitSteps(page, 45);
  await page.keyboard.press('Digit2');
  await hold(page, 'KeyE', 40);
  await waitSteps(page, 12);
  await page.screenshot({ path: `${OUT}/06-superjump.png` });
  const sj = await page.evaluate(() => ({ y: window.blackeye.player.feet.y, sky: window.blackeye.player.eyes.sky }));
  console.log('super-jump:', JSON.stringify(sj));
  if (sj.sky !== 1 || sj.y < 1) errors.push('super-jump did not trigger: ' + JSON.stringify(sj));
  await page.waitForTimeout(1500);

  // teleport near an Eye nest to trigger the catch cinematic
  await page.evaluate(() => {
    const g = window.blackeye;
    const nest = g.city.eyeNests.find((n) => n.type === 'fire');
    const p = nest.pos.clone();
    p.y -= 1.6;
    p.z += 3;
    g.player.respawn(p);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/07-catch.png` });
  await page.waitForTimeout(1200);

  // combat: spawn an agent in front and punch it
  await page.evaluate(() => {
    const g = window.blackeye;
    g.settings.difficulty = 'normal';
  });
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/08-first-person.png` });
  await page.keyboard.press('KeyV');
  await page.waitForTimeout(400);
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(640, 360);
    await page.waitForTimeout(160);
  }
  await page.screenshot({ path: `${OUT}/09-combat.png` });

  // wide shot of the stacks
  await page.evaluate(() => {
    const g = window.blackeye;
    g.player.respawn(new g.player.feet.constructor(-8, 6, -47));
    g.cameraRig.yaw = Math.PI;
    g.cameraRig.pitch = 0.05;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/10-stacks.png` });

  // multiplayer: a second client joins the same room (low preset to spare the CPU)
  await page.evaluate(() => {
    const g = window.blackeye;
    g.quitToMenu();
    g.settingsStore.applyPreset('low');
    g.applySettings(g.settings);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/10b-back-to-menu.png` });
  await page.click('#screen-main button:has-text("Multiplayer")');
  await page.fill('#screen-online input[placeholder="Your name"]', 'Host');
  await page.fill('#screen-online input[placeholder="plaza"]', 'smoke');
  await page.click('#screen-online button:has-text("Connect")');
  await page.waitForFunction(() => window.blackeye.mode === 'online', null, { timeout: 60000 });
  const page2 = await openPage('p2', { width: 960, height: 540 }, { graphics: 'low', resolutionScale: 0.6, bloom: false, ao: false, shadows: false, motionBlur: false });
  await page2.bringToFront();
  await page2.click('#screen-main button:has-text("Multiplayer")', { timeout: 90000 });
  await page2.fill('#screen-online input[placeholder="Your name"]', 'Guest');
  await page2.fill('#screen-online input[placeholder="plaza"]', 'smoke');
  await page2.click('#screen-online button:has-text("Connect")');
  await page2.waitForFunction(() => window.blackeye.mode === 'online', null, { timeout: 60000 });
  await page2.waitForFunction(() => window.blackeye.remotes.size === 1 && window.blackeye.agents.agents.size > 0, null, { timeout: 60000 }).catch(() => {});
  const mp = await page2.evaluate(() => ({ remotes: window.blackeye.remotes.size, agents: window.blackeye.agents.agents.size, host: window.blackeye.agents.authoritative }));
  const mp1 = await page.evaluate(() => ({ remotes: window.blackeye.remotes.size, agents: window.blackeye.agents.agents.size, host: window.blackeye.agents.authoritative }));
  console.log('multiplayer host:', JSON.stringify(mp1), 'guest:', JSON.stringify(mp));
  if (mp.remotes !== 1 || mp1.remotes !== 1) errors.push('players did not see each other');
  if (mp.host || !mp1.host) errors.push('host authority not assigned correctly');
  await page2.screenshot({ path: `${OUT}/11-multiplayer.png` });
} catch (e) {
  errors.push('script: ' + (e?.stack ?? e));
} finally {
  await browser.close();
  stopServer();
}

if (errors.length) {
  console.error('SMOKE FAILED:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('SMOKE OK — screenshots in ' + OUT);
