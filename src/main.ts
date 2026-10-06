import './ui/style.css';
import { initPhysics } from './physics/Physics';
import { Game } from './game/Game';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ui = document.getElementById('ui') as HTMLElement;
  const loading = document.getElementById('loading') as HTMLElement;
  const text = document.getElementById('loading-text') as HTMLElement;
  try {
    text.textContent = 'WAKING THE PHYSICS…';
    await initPhysics();
    text.textContent = 'DRAWING INK CITY…';
    // let the loading text paint before the heavy synchronous build
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const game = new Game(canvas, ui);
    (window as unknown as { blackeye: Game }).blackeye = game;
    game.run();
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 800);
  } catch (err) {
    console.error(err);
    text.textContent = 'COULD NOT START: ' + (err instanceof Error ? err.message : String(err)) + ' — WebGL2 is required.';
  }
}

void boot();
