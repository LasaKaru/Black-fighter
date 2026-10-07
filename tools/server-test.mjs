/** Server integration test: rooms + passwords, Runners vs Agents, Ink Turf, relays, movement correction, leaderboard. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
const PORT = 8300 + Math.floor(Math.random() * 90);
const server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: process.env.DATA_DIR ?? (await import('node:os')).tmpdir() + '/blackeye-test-data' }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('listening') && r()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bot = (name, pass) => new Promise((res) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const b = { ws, msgs: [], id: 0, match: null, err: null, send: (m) => ws.send(JSON.stringify(m)) };
  ws.on('message', (d) => { const m = JSON.parse(String(d)); b.msgs.push(m); if (m.t === 'welcome') { b.id = m.id; res(b); } if (m.t === 'match') b.match = m.m; if (m.t === 'error') { b.err = m.message; res(b); } });
  ws.on('open', () => b.send({ t: 'hello', v: 2, name, room: 'arena', look: {}, pass }));
});
const at = (b, p) => b.send({ t: 'state', s: { p, v: [0, 0, 0], yaw: 0, a: 0, ap: 0, hp: 100, fx: 0 } });
try {
  const A = await bot('Alice', 'pw');
  const B = await bot('Bob', 'pw');
  const C = await bot('Mallory', 'nope');
  const D = await bot('Dan', 'pw');
  assert.equal(C.err, 'Wrong room password.');
  at(A, [0, 0, 0]); at(B, [0, 0, 0]); at(D, [0, 0, 0]);
  await sleep(200);
  A.send({ t: 'startMatch', mode: 'rva', rva: { eyes: [[5, 0, 0], [10, 0, 0]], exit: [30, 0, 0], runnerSpawn: [0, 0, 0], agentSpawn: [0, 0, 20] } });
  await sleep(300);
  const teams = A.match.teams;
  const agent = [A, B, D].find((b) => teams[b.id] === 'agent');
  const runners = [A, B, D].filter((b) => teams[b.id] === 'runner');
  assert.ok(agent && runners.length === 2, 'one agent, two runners');
  // runner 0 grabs both eyes
  at(runners[0], [5, 0, 0.5]); await sleep(100); runners[0].send({ t: 'eye', idx: 0 });
  await sleep(100); at(runners[0], [10, 0, 0.5]); await sleep(100); runners[0].send({ t: 'eye', idx: 1 });
  await sleep(200);
  assert.deepEqual(A.match.eyes, [true, true]);
  assert.equal(A.match.exitOpen, true);
  // agent tags runner 1, runner 0 frees them
  at(agent, [50, 0, 50]); await sleep(50);
  at(runners[1], [50, 0, 51]); await sleep(100); agent.send({ t: 'tag', target: runners[1].id }); await sleep(200);
  assert.deepEqual(A.match.tagged, [runners[1].id]);
  // runner 0 is 40 m away: teleport declared then rescue
  runners[0].send({ t: 'teleport' }); at(runners[0], [50, 0, 52]); await sleep(150); runners[0].send({ t: 'rescue', target: runners[1].id }); await sleep(200);
  assert.deepEqual(A.match.tagged, []);
  // movement authority: a cheat jump without teleport gets corrected
  at(runners[1], [900, 0, 900]); await sleep(300);
  assert.ok(runners[1].msgs.some((m) => m.t === 'correct'), 'cheat jump corrected');
  // runners escape through the exit
  runners[0].send({ t: 'teleport' }); at(runners[0], [30, 0, 1]); await sleep(400);
  assert.equal(A.match.winner, 'runner');
  // turf
  A.send({ t: 'startMatch', mode: 'turf', turf: { x0: 0, z0: 0, cell: 2, w: 10, h: 10, tealSpawn: [0, 0, 0], purpleSpawn: [20, 0, 20] } });
  await sleep(300);
  const teal = [A, B, D].find((b) => A.match.teams[b.id] === 'teal');
  teal.send({ t: 'teleport' }); at(teal, [1, 0, 1]); await sleep(100);
  teal.send({ t: 'paint', cells: [0, 1, 10, 11] }); await sleep(300);
  assert.equal(A.match.score.teal, 4);
  // social relays
  B.send({ t: 'mark', p: [1, 2, 3], kind: 'danger' }); B.send({ t: 'voice', id: 2 }); B.send({ t: 'mission', id: 'lotus_leap', ev: 'start' });
  await sleep(200);
  assert.deepEqual(A.msgs.filter((m) => ['mark', 'voice', 'mission'].includes(m.t)).map((m) => m.t), ['mark', 'voice', 'mission']);
  // leaderboard
  const post = await fetch(`http://localhost:${PORT}/leaderboard`, { method: 'POST', body: JSON.stringify({ mission: 'lotus_leap', name: 'Alice', time: 42.5 }) }).then((r) => r.json());
  await fetch(`http://localhost:${PORT}/leaderboard`, { method: 'POST', body: JSON.stringify({ mission: 'lotus_leap', name: 'Bob', time: 39.1 }) });
  const bad = await fetch(`http://localhost:${PORT}/leaderboard`, { method: 'POST', body: JSON.stringify({ mission: 'lotus_leap', name: 'X', time: 1 }) }).then((r) => r.status);
  const get = await fetch(`http://localhost:${PORT}/leaderboard?mission=lotus_leap`).then((r) => r.json());
  assert.equal(bad, 400);
  assert.deepEqual(get.map((e) => e.name).slice(0, 2), ['Bob', 'Alice']);
  void post;
  console.log('server test: all checks passed');
  for (const b of [A, B, D, C]) b.ws.close();
} finally { try { process.kill(-server.pid); } catch {} }
