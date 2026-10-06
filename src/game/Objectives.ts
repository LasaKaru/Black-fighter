import type { GameEvent } from '../core/GameContext';
import type { Player } from '../player/Player';

interface Step {
  text: string;
  hint?: string;
  /** Completed by an event... */
  event?: GameEvent;
  /** ...or by a predicate checked each frame. */
  check?: (p: Player, s: ObjectiveState) => boolean;
}

export interface ObjectiveState {
  defeats: number;
}

const inBox = (p: Player, x0: number, x1: number, z0: number, z1: number, yMin: number) =>
  p.feet.x >= x0 && p.feet.x <= x1 && p.feet.z >= z0 && p.feet.z <= z1 && p.feet.y >= yMin && p.grounded;

/**
 * The "Ink Run" story route: it recreates every beat of the reference video
 * (README §40.2) as a guided chase through the level.
 */
export const STORY: Step[] = [
  { text: 'Run up the grand stairs to the terrace', hint: 'WASD to move · Shift to sprint · Mouse to look', check: (p) => p.feet.y > 3.5 && p.feet.z < -27 },
  { text: 'Smash a cracked wall', hint: 'Sprint into it and press Heavy (RMB) to tackle', event: 'smash' },
  { text: 'Catch the burning Fire Eye', hint: 'Walk up to the orange Eye nest — it flies into your hand', event: 'absorb' },
  { text: 'Fire Dash', hint: 'Press E (Use Eye power) while moving', event: 'dash' },
  { text: 'Jump to the towers and wall-run the gap', hint: 'Sprint and jump beside the black wall — Space again to wall-kick', check: (p) => inBox(p, -12.5, -3.5, -66.5, -57.5, 5) },
  { text: 'Cross the rope bridge to the dark tower', check: (p) => inBox(p, 7.5, 16.5, -68.5, -55.5, 5) },
  { text: 'Catch the Sky Eye and super-jump onto the high tower', hint: 'Hold E to charge, release to launch · or climb the stepping blocks', check: (p) => p.feet.y > 15.5 && inBox(p, 17.5, 32, -71, -59, 15) },
  { text: 'Grab the Void Eye, then surf the goo ramp down', hint: 'Press C while running to slide — goo is fast', check: (p) => inBox(p, 24, 40, -24, -8, 3) },
  { text: 'Ink 8 Agents', hint: 'LMB combo · RMB tackle while sprinting · RMB in the air = stomp', check: (_p, s) => s.defeats >= 8 },
];

export class Objectives {
  index = 0;
  done = false;
  state: ObjectiveState = { defeats: 0 };
  onAdvance: ((text: string, finished: boolean) => void) | null = null;

  constructor(private steps: Step[] = STORY) {}

  get current(): Step | null {
    return this.done ? null : this.steps[this.index] ?? null;
  }

  get progress(): string {
    return `${Math.min(this.index + 1, this.steps.length)}/${this.steps.length}`;
  }

  reset() {
    this.index = 0;
    this.done = false;
    this.state.defeats = 0;
  }

  event(e: GameEvent) {
    if (e === 'defeat') this.state.defeats++;
    const s = this.current;
    if (s?.event === e) this.advance();
  }

  update(p: Player) {
    const s = this.current;
    if (s?.check && s.check(p, this.state)) this.advance();
  }

  private advance() {
    this.index++;
    if (this.index >= this.steps.length) {
      this.done = true;
      this.onAdvance?.('Ink Run complete. Free run — the city is watching.', true);
    } else {
      this.onAdvance?.(this.steps[this.index].text, false);
    }
  }
}
