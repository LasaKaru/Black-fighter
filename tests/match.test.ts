import { describe, expect, it } from 'vitest';
import { MatchLogic, RVA_TIME, TURF_TIME, Vec3 } from '../shared/match';

const setup = { eyes: [[0, 0, 0], [10, 0, 0]] as Vec3[], exit: [50, 0, 0] as Vec3, runnerSpawn: [0, 0, 0] as Vec3, agentSpawn: [0, 0, 20] as Vec3 };

describe('Runners vs Agents', () => {
  it('splits teams (a third agents) and swaps sides next round', () => {
    const m = new MatchLogic();
    m.startRva([1, 2, 3, 4, 5, 6], setup);
    const agents1 = Object.entries(m.state.teams).filter(([, t]) => t === 'agent').map(([id]) => +id);
    expect(agents1.length).toBe(2);
    m.startRva([1, 2, 3, 4, 5, 6], setup);
    const agents2 = Object.entries(m.state.teams).filter(([, t]) => t === 'agent').map(([id]) => +id);
    expect(agents2.some((id) => agents1.includes(id))).toBe(false);
  });

  it('tags only in range, rescues, and agents win when every runner is tagged', () => {
    const m = new MatchLogic();
    m.startRva([1, 2, 3], setup);
    const agent = +Object.entries(m.state.teams).find(([, t]) => t === 'agent')![0];
    const runners = Object.entries(m.state.teams).filter(([, t]) => t === 'runner').map(([id]) => +id);
    const pos = new Map<number, Vec3>([[agent, [0, 0, 0]], [runners[0], [5, 0, 0]], [runners[1], [1, 0, 0]]]);
    expect(m.tag(agent, runners[0], pos)).toBe(false); // too far
    expect(m.tag(agent, runners[1], pos)).toBe(true);
    pos.set(runners[0], [1.5, 0, 0]);
    expect(m.rescue(runners[0], runners[1], pos)).toBe(true);
    expect(m.state.tagged).toEqual([]);
    m.tag(agent, runners[0], pos);
    m.tag(agent, runners[1], pos);
    expect(m.tick(0.1, pos)).toBe(true);
    expect(m.state.winner).toBe('agent');
  });

  it('runners open the exit with every eye and win by reaching it', () => {
    const m = new MatchLogic();
    m.startRva([1, 2, 3], setup);
    const runner = +Object.entries(m.state.teams).find(([, t]) => t === 'runner')![0];
    const pos = new Map<number, Vec3>([[runner, [0, 0, 0]]]);
    expect(m.eye(runner, 0, pos)).toBe(true);
    expect(m.eye(runner, 1, pos)).toBe(false); // 10 m away
    pos.set(runner, [10, 0, 1]);
    expect(m.eye(runner, 1, pos)).toBe(true);
    expect(m.state.exitOpen).toBe(true);
    pos.set(runner, [49, 0, 0]);
    m.tick(0.1, pos);
    expect(m.state.winner).toBe('runner');
  });

  it('agents win on time', () => {
    const m = new MatchLogic();
    m.startRva([1, 2, 3], setup);
    m.tick(RVA_TIME + 1, new Map());
    expect(m.state.winner).toBe('agent');
  });
});

describe('Ink Turf', () => {
  it('paints cells near the painter and scores the team with more', () => {
    const m = new MatchLogic();
    m.startTurf([1, 2], { x0: 0, z0: 0, cell: 2, w: 10, h: 10, tealSpawn: [0, 0, 0], purpleSpawn: [20, 0, 20] });
    const pos = new Map<number, Vec3>([[1, [1, 0, 1]], [2, [19, 0, 19]]]);
    expect(m.paint(1, [0, 1, 2], pos).length).toBe(6);
    expect(m.paint(1, [99], pos).length).toBe(0); // out of reach
    m.paint(2, [99], pos);
    expect(m.state.score).toEqual({ teal: 3, purple: 1 });
    m.tick(TURF_TIME + 1, pos);
    expect(m.state.winner).toBe('teal');
  });
});
