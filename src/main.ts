import './ui/style.css';
import { initPhysics } from './physics/Physics';
import { Game } from './game/Game';
import { restoreDesktopSaves } from './core/DesktopSaves';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const loading = document.getElementById('loading') as HTMLElement;
  const text = document.getElementById('loading-text') as HTMLElement;
  try {
    // desktop: pull in newer save files (Steam Cloud) before anything loads
    restoreDesktopSaves();
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
    game.run();
    game.analytics.start({ art: game.settings.artStyle, gfx: game.settings.graphics });
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 800);
  } catch (err) {
    console.error(err);
    text.textContent = 'COULD NOT START: ' + (err instanceof Error ? err.message : String(err)) + ' — WebGL2 is required.';
  }
}

void boot();
