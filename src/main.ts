import './ui/style.css';
import { initPhysics } from './physics/Physics';
import { Game } from './game/Game';
import { restoreDesktopSaves } from './core/DesktopSaves';
import { cachedBrand, logoForDark } from './game/Branding';
import { usesBundledLogo } from '../shared/brand';
import { bootBegin, bootOk, crashGuard } from './core/CrashGuard';
import { Settings } from './core/Settings';

/** The game could not start: say why and offer a way forward (never a blank screen). */
function bootFailed(err: unknown, loading: HTMLElement) {
  console.error(err);
  crashGuard.report('boot', err);
  try {
    crashGuard.flushTo(new Settings().data.serverUrl);
  } catch {
    /* offline */
  }
  const noGl = !document.createElement('canvas').getContext('webgl2');
  const box = document.createElement('div');
  box.className = 'boot-fail';
  const h = document.createElement('h2');
  h.textContent = noGl ? 'Your graphics do not support WebGL 2' : 'The game could not start';
  const p = document.createElement('p');
  p.textContent = noGl
    ? 'BLACKEYE needs WebGL 2. Update your graphics driver, or try Chrome, Edge or Firefox with hardware acceleration turned on.'
    : `Something went wrong while loading (${err instanceof Error ? err.message : String(err)}). It has been reported. Starting in safe mode (low graphics) usually fixes it.`;
  const row = document.createElement('div');
  row.className = 'actions';
  const btn = (label: string, fn: () => void, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    row.append(b);
  };
  btn('Start in safe mode', () => {
    try {
      const st = new Settings();
      st.applyPreset('low');
      st.set('resolutionScale', 0.6);
    } catch {
      /* storage blocked */
    }
    location.reload();
  }, 'primary');
  btn('Try again', () => location.reload());
  btn('Get help', () => window.open(`mailto:${cachedBrand().supportEmail || 'support@helao2.com'}?subject=${encodeURIComponent('BLACKEYE could not start')}&body=${encodeURIComponent(String(err))}`, '_blank'), 'ghost');
  box.append(h, p, row);
  loading.innerHTML = '';
  loading.append(box);
}

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const loading = document.getElementById('loading') as HTMLElement;
  const text = document.getElementById('loading-text') as HTMLElement;
  const shownAt = performance.now();
  // did the last start fail? then come up in safe mode (low graphics)
  const bootInfo = bootBegin();
  if (bootInfo.safeMode) {
    try {
      const st = new Settings();
      st.applyPreset('low');
      if (bootInfo.fails >= 2) st.set('resolutionScale', 0.6);
    } catch {
      /* storage blocked */
    }
  }
  try {
    // desktop: pull in newer save files (Steam Cloud) before anything loads
    restoreDesktopSaves();
    // "HelaO2 presents" from the last brand config (or the defaults)
    const brand = cachedBrand();
    const name = document.getElementById('presents-name')!;
    const card = document.getElementById('presents-card')!;
    const img = document.getElementById('presents-img') as HTMLImageElement;
    name.textContent = brand.company;
    document.getElementById('presents-word')!.textContent = brand.presents;
    if (!brand.presents) document.getElementById('presents-word')!.remove();
    // the company logo in its real colours on a light card; the name as text if there is none
    const showName = () => {
      card.remove();
      name.hidden = false;
    };
    img.alt = brand.company;
    if (brand.logo) {
      const url = logoForDark(brand).url;
      if (url) img.src = url;
      else showName();
    } else if (!usesBundledLogo(brand)) showName();
    img.addEventListener('error', showName);
    text.textContent = 'WAKING THE PHYSICS…';
    await initPhysics();
    text.textContent = 'DRAWING INK CITY…';
    // let the loading text paint before the heavy synchronous build
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const game = new Game(canvas, ui);
    (window as unknown as { blackeye: Game }).blackeye = game;
    // shader warm-up: compile every material up front (in parallel where the
    // driver supports it) so the first seconds of play don't hitch
    text.textContent = 'MIXING THE INK…';
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await game.warmUp();
    game.branding.render();
    game.run();
    // keep "<company> presents" up long enough to read
    const left = 2600 - (performance.now() - shownAt);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
    game.analytics.start({ art: game.settings.artStyle, gfx: game.settings.graphics });
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 800);
    // photosensitivity warning (owner switch; any key / A continues), then the intro
    const status = game.statusScreen.check();
    await game.ui.healthWarning();
    // maintenance / development: the status screen covers the title until the game is back
    await status;
    game.statusScreen.arm();
    if (!game.statusScreen.blocking) game.begin();
    else game.ui.show('main');
    // reached the title screen: this start counts as good
    bootOk();
    if (bootInfo.safeMode) game.toast('Started in safe mode (low graphics) after a problem last time. You can raise graphics in Settings.', 'warn');
  } catch (err) {
    text.textContent = '';
    bootFailed(err, loading);
  }
}

void boot();
