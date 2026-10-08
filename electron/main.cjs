/**
 * BLACKEYE desktop shell (Electron).
 *
 * Serves the built web client (dist/) from a private app:// scheme so ES
 * modules, fetch and localStorage behave exactly like on the web. Saves live in
 * Electron's userData folder. Online play talks to the server baked in at build
 * time (VITE_SERVER_URL) or typed into Multiplayer → Server URL.
 *
 *   --windowed       start in a window instead of fullscreen
 *   ELECTRON_DEV_URL load a dev server instead (e.g. http://localhost:5173)
 *
 * Steam: when launched by Steam (SteamAppId is set) the overlay-friendly GPU
 * switches are applied, and if the optional `steamworks.js` package is
 * installed, in-game achievements are mirrored to Steam. See docs/STEAM_RELEASE.md.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.ELECTRON_DEV_URL || '';
const STEAM_APP_ID = Number(process.env.STEAM_APP_ID || process.env.SteamAppId || 0);

// fixed save folder (Steam Auto-Cloud points here): %APPDATA%/BLACKEYE Ink City, ~/.config/BLACKEYE Ink City
app.setName('BLACKEYE Ink City');
app.setPath('userData', path.join(app.getPath('appData'), 'BLACKEYE Ink City'));

// one copy of the game at a time
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// games want the GPU even on blocklisted drivers, and no background throttling
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// ---------------------------------------------------------------- optional Steamworks
let steam = null;
if (STEAM_APP_ID) {
  try {
    const steamworks = require('steamworks.js');
    steam = steamworks.init(STEAM_APP_ID);
    steamworks.electronEnableSteamOverlay();
  } catch (e) {
    // steamworks.js not installed, or Steam not running: the game works without it
    console.warn('Steamworks unavailable:', e && e.message);
    app.commandLine.appendSwitch('in-process-gpu');
    app.commandLine.appendSwitch('disable-direct-composition');
  }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;

function createWindow() {
  const windowed = process.argv.includes('--windowed');
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    fullscreen: !windowed,
    backgroundColor: '#0b0b0e',
    title: 'BLACKEYE: Ink City',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  // F11 / Alt+Enter toggle fullscreen; Ctrl+Shift+I opens devtools (handy for bug reports)
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      win.webContents.toggleDevTools();
    }
  });

  // external links open in the browser; the game never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:\/\/|mailto:)/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const ok = url.startsWith('app://') || (DEV_URL && url.startsWith(DEV_URL));
    if (!ok) e.preventDefault();
  });

  // ---- crash recovery: the game window never just disappears or hangs forever
  const recent = [];
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`renderer gone: ${details.reason} (exit ${details.exitCode})`);
    if (details.reason === 'clean-exit') return;
    const now = Date.now();
    recent.push(now);
    while (recent.length && now - recent[0] > 5 * 60_000) recent.shift();
    if (recent.length <= 3) {
      // reload: the game offers Continue from the last checkpoint (saves are on disk)
      win.webContents.reload();
      return;
    }
    const choice = dialog.showMessageBoxSync(win, {
      type: 'error',
      title: 'BLACKEYE: Ink City',
      message: 'The game keeps closing unexpectedly.',
      detail: 'Your progress is saved. Restarting in safe mode (low graphics) usually helps. If it keeps happening, update your graphics driver.',
      buttons: ['Restart in safe mode', 'Quit'],
      defaultId: 0,
    });
    if (choice === 0) {
      recent.length = 0;
      win.webContents.executeJavaScript("localStorage.setItem('blackeye.boot', JSON.stringify({ ok: false, fails: 2 }))").catch(() => {});
      win.webContents.reload();
    } else app.quit();
  });
  win.on('unresponsive', () => {
    log('window unresponsive');
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: 'BLACKEYE: Ink City',
      message: 'The game is not responding.',
      detail: 'Wait a little longer, or restart the game (your progress is saved at the last checkpoint).',
      buttons: ['Wait', 'Restart'],
      defaultId: 0,
    });
    if (choice === 1) win.webContents.forcefullyCrashRenderer();
  });

  void win.loadURL(DEV_URL || 'app://game/index.html');
}

/** Append a line to <userData>/logs/main.log (attach it to support emails). */
function log(line) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'main.log');
    try {
      if (fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.old');
    } catch {
      /* new file */
    }
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* no disk */
  }
}

process.on('uncaughtException', (err) => log('main uncaught: ' + (err && err.stack ? err.stack : err)));
app.on('child-process-gone', (_e, details) => {
  log(`child process gone: ${details.type} ${details.reason}`);
  // the GPU process restarts by itself; the game handles the lost WebGL context
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // app://game/<path> → dist/<path> (index.html for anything unknown)
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
    if (res && res.ok) return res;
    return net.fetch(pathToFileURL(path.join(DIST, 'index.html')).toString());
  });

  // ---- save files (Steam Auto-Cloud syncs <userData>/saves/*.json)
  const SAVES = path.join(app.getPath('userData'), 'saves');
  const KEY = /^blackeye\.[a-z0-9.]{1,40}$/;
  ipcMain.on('saves:write', (_e, key, data) => {
    if (typeof key !== 'string' || !KEY.test(key) || typeof data !== 'string' || data.length > 2_000_000) return;
    try {
      fs.mkdirSync(SAVES, { recursive: true });
      const file = path.join(SAVES, key + '.json');
      fs.writeFileSync(file + '.tmp', data);
      fs.renameSync(file + '.tmp', file);
    } catch (err) {
      console.warn('save failed', key, err && err.message);
    }
  });
  ipcMain.on('saves:load', (e) => {
    const out = {};
    try {
      for (const f of fs.readdirSync(SAVES)) {
        const key = f.replace(/\.json$/, '');
        if (f.endsWith('.json') && KEY.test(key)) out[key] = fs.readFileSync(path.join(SAVES, f), 'utf8');
      }
    } catch {
      /* no saves yet */
    }
    e.returnValue = out;
  });

  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('app:fullscreen', () => win && win.setFullScreen(!win.isFullScreen()));
  ipcMain.on('steam:achievement', (_e, id) => {
    try {
      if (steam && typeof id === 'string' && /^[A-Z0-9_]{1,64}$/.test(id)) steam.achievement.activate(id);
    } catch (err) {
      console.warn('achievement failed', id, err && err.message);
    }
  });

  createWindow();
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on('window-all-closed', () => app.quit());
