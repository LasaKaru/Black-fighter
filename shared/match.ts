/**
 * Server-authoritative match rules for the multiplayer modes (pure logic, no
 * I/O, so it is unit-tested and shared with the client for types):
 *
 * - Runners vs Agents: Runners grab 5 Watcher Eyes, then reach the exit
 *   portal. Agents tag Runners (tagged Runners freeze until a teammate frees
 *   them). Runners win on escape; Agents win when every Runner is tagged or
 *   the clock runs out. Sides swap every round.
 * - Ink Turf: two teams paint a grid by moving over it; most cells at the
 *   end wins.
 */

export type Vec3 = [number, number, number];
export type MatchMode = 'rva' | 'turf';
export type Team = 'runner' | 'agent' | 'teal' | 'purple';

export interface RvaSetup {
  eyes: Vec3[];
  exit: Vec3;
  runnerSpawn: Vec3;
  agentSpawn: Vec3;
}

export interface TurfSetup {
  /** World x/z of cell (0,0)'s corner. */
  x0: number;
  z0: number;
  cell: number;
  w: number;
  h: number;
  tealSpawn: Vec3;
  purpleSpawn: Vec3;
}

export interface MatchState {
  mode: MatchMode | null;
  phase: 'play' | 'end';
  /** Seconds left in the phase. */
  t: number;
  teams: Record<number, Team>;
  tagged: number[];
  eyes: boolean[];
  exitOpen: boolean;
  score: Record<string, number>;
  winner: string | null;
  rva?: RvaSetup;
  turf?: TurfSetup;
  round: number;
}

export const RVA_TIME = 360;
export const TURF_TIME = 180;
export const END_TIME = 10;
export const TAG_RANGE = 2.6;
export const RESCUE_RANGE = 2.4;
export const EYE_RANGE = 3;
export const EXIT_RANGE = 4.5;

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export class MatchLogic {
  state: MatchState = { mode: null, phase: 'play', t: 0, teams: {}, tagged: [], eyes: [], exitOpen: false, score: {}, winner: null, round: 0 };
  /** Turf ownership per cell: 0 none, 1 teal, 2 purple. */
  cells = new Uint8Array(0);
  private lastAgents = new Set<number>();

  get active(): boolean {
    return this.state.mode !== null;
  }

  /** Start a round. Agents are about a third of the room (at least one); last round's agents run this time. */
  startRva(players: number[], setup: RvaSetup) {
    const ids = [...players].sort((a, b) => a - b);
    const nAgents = Math.max(1, Math.round(ids.length / 3));
    // swap sides: previous agents become runners first
    const fresh = ids.filter((id) => !this.lastAgents.has(id));
    const agents = fresh.slice(0, nAgents);
    for (const id of ids) if (agents.length < nAgents && !agents.includes(id)) agents.push(id);
    const teams: Record<number, Team> = {};
    for (const id of ids) teams[id] = agents.includes(id) ? 'agent' : 'runner';
    if (ids.length === 1) teams[ids[0]] = 'runner';
    this.lastAgents = new Set(agents);
    this.state = { mode: 'rva', phase: 'play', t: RVA_TIME, teams, tagged: [], eyes: setup.eyes.map(() => false), exitOpen: false, score: { runner: 0, agent: 0 }, winner: null, rva: setup, round: this.state.round + 1 };
  }

  startTurf(players: number[], setup: TurfSetup) {
    const ids = [...players].sort((a, b) => a - b);
    const teams: Record<number, Team> = {};
    ids.forEach((id, i) => (teams[id] = i % 2 === 0 ? 'teal' : 'purple'));
    this.cells = new Uint8Array(setup.w * setup.h);
    this.state = { mode: 'turf', phase: 'play', t: TURF_TIME, teams, tagged: [], eyes: [], exitOpen: false, score: { teal: 0, purple: 0 }, winner: null, turf: setup, round: this.state.round + 1 };
  }

  stop() {
    this.state = { ...this.state, mode: null, phase: 'play', t: 0, teams: {}, tagged: [], eyes: [], exitOpen: false, winner: null };
    this.cells = new Uint8Array(0);
  }

  join(id: number) {
    const s = this.state;
    if (!s.mode || s.teams[id]) return;
    if (s.mode === 'rva') s.teams[id] = 'runner';
    else {
      const teal = Object.values(s.teams).filter((t) => t === 'teal').length;
      const purple = Object.values(s.teams).filter((t) => t === 'purple').length;
      s.teams[id] = teal <= purple ? 'teal' : 'purple';
    }
  }

  leave(id: number) {
    const s = this.state;
    delete s.teams[id];
    s.tagged = s.tagged.filter((t) => t !== id);
  }

  /** An agent tags a runner (range-checked). */
  tag(from: number, target: number, pos: Map<number, Vec3>): boolean {
    const s = this.state;
    if (s.mode !== 'rva' || s.phase !== 'play') return false;
    if (s.teams[from] !== 'agent' || s.teams[target] !== 'runner' || s.tagged.includes(target)) return false;
    const a = pos.get(from);
    const b = pos.get(target);
    if (!a || !b || dist(a, b) > TAG_RANGE) return false;
    s.tagged.push(target);
    s.score.agent = (s.score.agent ?? 0) + 1;
    return true;
  }

  /** A free runner frees a tagged teammate. */
  rescue(from: number, target: number, pos: Map<number, Vec3>): boolean {
    const s = this.state;
    if (s.mode !== 'rva' || s.phase !== 'play') return false;
    if (s.teams[from] !== 'runner' || s.tagged.includes(from) || !s.tagged.includes(target)) return false;
    const a = pos.get(from);
    const b = pos.get(target);
    if (!a || !b || dist(a, b) > RESCUE_RANGE) return false;
    s.tagged = s.tagged.filter((t) => t !== target);
    return true;
  }

  /** A runner grabs a Watcher Eye. */
  eye(from: number, idx: number, pos: Map<number, Vec3>): boolean {
    const s = this.state;
    if (s.mode !== 'rva' || s.phase !== 'play' || !s.rva) return false;
    if (s.teams[from] !== 'runner' || s.tagged.includes(from) || s.eyes[idx] !== false) return false;
    const p = pos.get(from);
    if (!p || dist(p, s.rva.eyes[idx]) > EYE_RANGE) return false;
    s.eyes[idx] = true;
    s.score.runner = (s.score.runner ?? 0) + 1;
    if (s.eyes.every(Boolean)) s.exitOpen = true;
    return true;
  }

  /** Turf: claim cells for the painter's team. Returns changed [idx, owner] pairs. */
  paint(from: number, cells: number[], pos: Map<number, Vec3>): number[] {
    const s = this.state;
    if (s.mode !== 'turf' || s.phase !== 'play' || !s.turf) return [];
    const team = s.teams[from];
    if (team !== 'teal' && team !== 'purple') return [];
    const p = pos.get(from);
    if (!p) return [];
    const T = s.turf;
    const owner = team === 'teal' ? 1 : 2;
    const out: number[] = [];
    for (const c of cells.slice(0, 64)) {
      if (!Number.isInteger(c) || c < 0 || c >= this.cells.length) continue;
      // only cells within reach of the painter (roller sweeps reach ~6 m)
      const cx = T.x0 + ((c % T.w) + 0.5) * T.cell;
      const cz = T.z0 + (Math.floor(c / T.w) + 0.5) * T.cell;
      if (Math.hypot(cx - p[0], cz - p[2]) > 7) continue;
      if (this.cells[c] === owner) continue;
      this.cells[c] = owner;
      out.push(c, owner);
    }
    if (out.length) this.recount();
    return out;
  }

  private recount() {
    let teal = 0;
    let purple = 0;
    for (const v of this.cells) {
      if (v === 1) teal++;
      else if (v === 2) purple++;
    }
    this.state.score = { teal, purple };
  }

  /** Advance the clock and check win conditions. Returns true when the state changed in a way worth broadcasting now. */
  tick(dt: number, pos: Map<number, Vec3>): boolean {
    const s = this.state;
    if (!s.mode) return false;
    s.t = Math.max(0, s.t - dt);
    if (s.phase === 'end') {
      if (s.t <= 0) {
        this.stop();
        return true;
      }
      return false;
    }
    if (s.mode === 'rva') {
      const runners = Object.entries(s.teams).filter(([, t]) => t === 'runner').map(([id]) => Number(id));
      if (s.exitOpen && s.rva) {
        for (const id of runners) {
          const p = pos.get(id);
          if (p && !s.tagged.includes(id) && dist(p, s.rva.exit) < EXIT_RANGE) return this.finish('runner');
        }
      }
      const agents = Object.values(s.teams).filter((t) => t === 'agent').length;
      if (agents > 0 && runners.length > 0 && runners.every((id) => s.tagged.includes(id))) return this.finish('agent');
      if (s.t <= 0) return this.finish('agent');
    } else if (s.t <= 0) {
      return this.finish(s.score.teal === s.score.purple ? 'draw' : s.score.teal > s.score.purple ? 'teal' : 'purple');
    }
    return false;
  }

  private finish(winner: string): boolean {
    this.state.phase = 'end';
    this.state.winner = winner;
    this.state.t = END_TIME;
    return true;
  }
}
