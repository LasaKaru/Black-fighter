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
  // v2 boots into the cinematic intro; any key skips to the live attract menu
  await page.waitForTimeout(2500);
  if ((await page.evaluate(() => window.blackeye.mode)) !== 'intro') errors.push('intro did not play at boot');
  await page.screenshot({ path: `${OUT}/00-intro.png` });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.blackeye.mode === 'menu', null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-menu.png` });

  await page.click('#screen-main button:has-text("Wardrobe")');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/02-wardrobe.png` });
  await page.click('#screen-customize button.back');
  await page.click('#screen-main button:has-text("Inventory")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/02b-inventory.png` });
  await page.click('#screen-inventory button.back');

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

  // vehicles: summon a car on the speedway, drive it forward and steer left
  await page.evaluate(() => {
    const g = window.blackeye;
    g.fastTravel('speedway');
    const isl = g.world.island('speedway');
    const v = g.vehicles.summon('blotter', isl.center.clone().add({ x: -40, y: 0.6, z: 34, isVector3: true }), Math.PI / 2, 0);
    g.player.enterVehicle(v);
    g.cameraRig.yaw = Math.PI / 2;
  });
  await waitSteps(page, 20);
  await page.keyboard.down('KeyW');
  await waitSteps(page, 120);
  const d1 = await page.evaluate(() => ({ speed: window.blackeye.player.vehicle?.speed ?? 0, yaw: window.blackeye.player.vehicle?.yaw ?? 0 }));
  await page.keyboard.down('KeyA');
  await waitSteps(page, 30);
  const d2 = await page.evaluate(() => ({ speed: window.blackeye.player.vehicle?.speed ?? 0, yaw: window.blackeye.player.vehicle?.yaw ?? 0 }));
  await page.screenshot({ path: `${OUT}/10c-drive.png` });
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyW');
  console.log('drive:', JSON.stringify({ d1, d2 }));
  if (!(d1.speed > 5)) errors.push('vehicle did not accelerate forward: ' + JSON.stringify(d1));
  if (!(d2.yaw > d1.yaw)) errors.push('left steer did not turn left: ' + JSON.stringify({ d1, d2 }));

  // missions: start one, check it is tracked, then abandon it
  const ms = await page.evaluate(() => {
    const g = window.blackeye;
    if (g.player.vehicle) g.player.exitVehicle();
    g.startMission('lotus_leap');
    return { active: g.missions.active?.def.id ?? null, targets: g.missions.active?.targets.length ?? 0 };
  });
  await waitSteps(page, 30);
  await page.screenshot({ path: `${OUT}/10d-mission.png` });
  console.log('mission:', JSON.stringify(ms));
  if (ms.active !== 'lotus_leap') errors.push('mission did not start: ' + JSON.stringify(ms));

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
  const page2 = await openPage('p2', { width: 960, height: 540 }, { playIntro: false, graphics: 'low', resolutionScale: 0.6, bloom: false, ao: false, shadows: false, motionBlur: false });
  await page2.bringToFront();
  // Two software-rendered clients starve rAF, which Playwright's locator polling
  // relies on, so the guest drives its menu through the DOM directly.
  await page2.evaluate(() => {
    const btn = (scr, text) => [...document.querySelectorAll(`#screen-${scr} button`)].find((b) => b.textContent.includes(text));
    const fill = (ph, v) => {
      const i = document.querySelector(`#screen-online input[placeholder="${ph}"]`);
      i.value = v;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
    };
    btn('main', 'Multiplayer').click();
    fill('Your name', 'Guest');
    fill('plaza', 'smoke');
    btn('online', 'Connect').click();
  });
  await page2.waitForFunction(() => window.blackeye.mode === 'online', null, { timeout: 180000, polling: 250 }).catch(async (e) => {
    const dbg = await page2.evaluate(() => ({ mode: window.blackeye.mode, net: window.blackeye.net.status, status: document.querySelector('#screen-online .status')?.textContent, screen: [...document.querySelectorAll('.screen.show')].map((x) => x.id) }));
    throw new Error(e.message + ' guest=' + JSON.stringify(dbg));
  });
  await page2.waitForFunction(() => window.blackeye.remotes.size === 1 && window.blackeye.agents.agents.size > 0, null, { timeout: 180000, polling: 250 }).catch(() => {});
  const mp = await page2.evaluate(() => ({ remotes: window.blackeye.remotes.size, agents: window.blackeye.agents.agents.size, host: window.blackeye.agents.authoritative }));
  const mp1 = await page.evaluate(() => ({ remotes: window.blackeye.remotes.size, agents: window.blackeye.agents.agents.size, host: window.blackeye.agents.authoritative }));
  console.log('multiplayer host:', JSON.stringify(mp1), 'guest:', JSON.stringify(mp));
  if (mp.remotes !== 1 || mp1.remotes !== 1) errors.push('players did not see each other');
  if (mp.host || !mp1.host) errors.push('host authority not assigned correctly');
  await page2.screenshot({ path: `${OUT}/11-multiplayer.png`, timeout: 120000 }).catch((e) => console.warn('guest screenshot skipped (slow software rendering):', e.message.split('\n')[0]));
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
