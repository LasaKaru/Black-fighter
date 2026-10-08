/** Server integration test: rooms + passwords, Runners vs Agents, Ink Turf, relays, movement correction, leaderboard. */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
const PORT = 8300 + Math.floor(Math.random() * 90);
const TOKEN = 'test-admin-token';
const dataDir = process.env.DATA_DIR ?? (await import('node:fs')).mkdtempSync((await import('node:os')).tmpdir() + '/blackeye-test-');
const server = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_TOKEN: TOKEN, MOTD: 'Welcome to the test server' }, stdio: ['ignore', 'pipe', 'inherit'], detached: true });
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
  // health + MOTD
  const health = await fetch(`http://localhost:${PORT}/health`).then((r) => r.json());
  assert.equal(health.players, 3);
  assert.ok(A.msgs.some((m) => m.t === 'chat' && m.name === 'SERVER' && m.text === 'Welcome to the test server'), 'motd on join');
  // admin panel: page, auth, status, broadcast, kick + ban, maintenance, unban
  const adm = (path, body, token = TOKEN) => fetch(`http://localhost:${PORT}/admin/api${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await fetch(`http://localhost:${PORT}/admin`)).status, 200);
  assert.equal((await adm('/status', null, 'wrong')).status, 401);
  const st = await adm('/status').then((r) => r.json());
  assert.equal(st.rooms[0].name, 'arena');
  assert.equal(st.clients.filter((c) => c.room === 'arena').length, 3);
  assert.equal((await adm('/broadcast', { text: 'hello all' }).then((r) => r.json())).sent >= 3, true);
  await sleep(100);
  assert.ok(B.msgs.some((m) => m.t === 'chat' && m.text === 'hello all'));
  const closed = new Promise((r) => D.ws.on('close', r));
  await adm('/kick', { id: D.id, ban: true });
  await closed;
  const banned = await bot('Dan2', 'pw');
  assert.equal(banned.err, 'You are banned from this server.');
  assert.ok((await adm('/unban', { ip: st.clients.find((c) => c.id === D.id).ip }).then((r) => r.json())).ok);
  await adm('/maintenance', { on: true });
  const blocked = await bot('Eve', 'pw');
  assert.match(blocked.err, /maintenance/);
  await adm('/maintenance', { on: false });
  assert.ok((await adm('/leaderboard/delete', { mission: 'lotus_leap', name: 'Bob' }).then((r) => r.json())).ok);
  const after = await fetch(`http://localhost:${PORT}/leaderboard?mission=lotus_leap`).then((r) => r.json());
  assert.equal(after[0].name, 'Alice');
  for (const b of [banned, blocked]) b.ws.close();
  // owner panel: sign-in (server-side check), analytics, branding, uploads, features, account
  const base = `http://localhost:${PORT}`;
  const pan = (path, body, token, raw) => fetch(`${base}/panel/api${path}`, { method: body !== undefined || raw ? 'POST' : 'GET', headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': raw ? 'image/png' : 'application/json' }, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  assert.equal((await pan('/me')).status, 401, 'panel needs a session');
  assert.equal((await pan('/login', { email: 'lasantha@helao2.com', password: 'nope' })).status, 401, 'wrong password refused');
  const login = await pan('/login', { email: 'Lasantha@HelaO2.com ', password: 'www111' }).then((r) => r.json());
  assert.ok(login.token && login.email === 'lasantha@helao2.com', 'owner signs in with the seeded account');
  const tok = login.token;
  const stored = (await import('node:fs')).readFileSync(dataDir + '/panel/account.json', 'utf8');
  assert.ok(!stored.includes('www111') && stored.includes('hash'), 'password stored only as a hash');
  // analytics: a batch in, the summary out
  const anon = 'abcdef0123456789abcdef01';
  const now = Date.now();
  const batch = { anon, session: 's1', events: [
    { e: 'session_start', t: now, d: { platform: 'desktop', os: 'win32', version: '0.4.0', lang: 'si-LK', region: 'LK' } },
    { e: 'mission_start', t: now, d: { id: 'spire_climb' } }, { e: 'mission_end', t: now, d: { id: 'spire_climb', ok: true } },
    { e: 'heartbeat', t: now, d: { fps: 60 } }, { e: 'link', t: now, d: { id: 'sponsor:acme' } },
  ] };
  assert.equal((await fetch(`${base}/analytics`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(batch) })).status, 200);
  const sum = await pan('/analytics?days=7', undefined, tok).then((r) => r.json());
  assert.equal(sum.totals.today, 1);
  assert.deepEqual(sum.platforms[0], ['desktop', 1]);
  assert.equal(sum.missions.find((m) => m.id === 'spire_climb').rate, 100);
  assert.ok((await pan('/live', undefined, tok).then((r) => r.json())).rooms.length >= 1);
  // a 1x1 PNG upload, a sponsor using it, public config + file
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  assert.equal((await pan('/upload?name=acme', undefined, tok, Buffer.from('<svg onload=alert(1)>'))).status, 400, 'non-images refused');
  const up = await pan('/upload?name=acme', undefined, tok, png).then((r) => r.json());
  assert.match(up.url, /^\/brand\/files\/acme-[a-f0-9]{8}\.png$/);
  const saved = await pan('/brand', { company: 'HelaO2 Studios', sponsors: [{ id: 'acme', name: 'Acme', url: 'https://acme.example', logo: up.url, tier: 'gold', menu: true, world: true }], links: [{ id: 'bmc', label: 'Buy Me a Coffee', url: 'javascript:alert(1)', kind: 'donate' }], features: { multiplayer: false } }, tok).then((r) => r.json());
  assert.equal(saved.config.links[0].url, '', 'unsafe link dropped');
  const pub = await fetch(`${base}/brand/config.json`).then((r) => r.json());
  assert.equal(pub.company, 'HelaO2 Studios');
  assert.equal(pub.sponsors[0].logo, up.url);
  assert.equal(pub.features.multiplayer, false);
  const img = await fetch(base + up.url);
  assert.equal(img.headers.get('content-type'), 'image/png');
  // privacy: forget an install id
  assert.equal((await pan('/forget', { id: anon }, tok).then((r) => r.json())).ok, true);
  assert.equal((await pan('/analytics?days=7', undefined, tok).then((r) => r.json())).totals.today, 0);
  // game status: maintenance with a comeback time, tester code, joins refused, back to live by itself
  assert.equal((await fetch(`${base}/status`).then((r) => r.json())).mode, 'live');
  const closed2 = await pan('/status', { mode: 'maintenance', title: 'Back soon', until: Date.now() + 3000, blockWeb: true, tester: 'Ink-Test-1' }, tok).then((r) => r.json());
  assert.equal(closed2.active, true);
  const pubSt = await fetch(`${base}/status`).then((r) => r.json());
  assert.equal(pubSt.mode, 'maintenance');
  assert.equal(pubSt.testers, true);
  assert.ok(!('testerHash' in pubSt), 'tester code never public');
  assert.equal((await fetch(`${base}/status/tester`, { method: 'POST', body: JSON.stringify({ code: 'ink-test-1' }) })).status, 200, 'tester code ok (case-insensitive)');
  assert.equal((await fetch(`${base}/status/tester`, { method: 'POST', body: JSON.stringify({ code: 'nope' }) })).status, 403);
  const refused = await bot('Late', '');
  assert.match(refused.err, /maintenance/);
  refused.ws.close();
  await sleep(6500);
  assert.equal((await fetch(`${base}/status`).then((r) => r.json())).mode, 'live', 'back to live at the promised time');
  // scheduled: not active yet
  const sched = await pan('/status', { mode: 'development', startsAt: Date.now() + 3600_000, until: Date.now() + 7200_000 }, tok).then((r) => r.json());
  assert.equal(sched.active, false);
  await pan('/status', { mode: 'live' }, tok);
  // moderation: blocked words (with letter swaps), names, mute, spam
  await pan('/moderation/words', { words: ['badword', 'inkhater'] }, tok);
  const M1 = await bot('InkHater99', 'pw');
  const W = await bot('Watcher', 'pw');
  const joined = (await pan('/live', undefined, tok).then((r) => r.json())).clients.find((c) => c.id === M1.id);
  assert.ok(joined && !/inkhater/i.test(joined.name), 'blocked name cleaned: ' + joined?.name);
  M1.send({ t: 'chat', text: 'you are a b4dw0rd ok' });
  await sleep(200);
  const seen = W.msgs.filter((m) => m.t === 'chat' && m.from === M1.id).map((m) => m.text);
  assert.ok(seen.length && !/b4dw0rd/i.test(seen.at(-1)) && seen.at(-1).includes('★'), 'blocked word starred: ' + seen.at(-1));
  let mod = await pan('/moderation', undefined, tok).then((r) => r.json());
  assert.equal(mod.log[0].flag, 'filtered');
  await pan('/moderation/mute', { id: M1.id, minutes: 10 }, tok);
  const before = W.msgs.length;
  M1.send({ t: 'chat', text: 'hello?' });
  await sleep(200);
  assert.ok(!W.msgs.slice(before).some((m) => m.t === 'chat' && m.from === M1.id), 'muted chat dropped');
  assert.ok(M1.msgs.some((m) => m.t === 'chat' && /muted/.test(m.text)), 'muted player told');
  mod = await pan('/moderation', undefined, tok).then((r) => r.json());
  assert.equal(mod.muted.length, 1);
  await pan('/moderation/unmute', { ip: mod.muted[0].ip }, tok);
  for (let i = 0; i < 8; i++) M1.send({ t: 'chat', text: 'spam ' + i });
  await sleep(300);
  assert.ok(M1.msgs.some((m) => m.t === 'chat' && /Slow down/.test(m.text)), 'spam limited');
  M1.ws.close();
  W.ws.close();
  // events and the minimum version travel in the public config
  await pan('/brand', { event: { name: 'Double Ink Weekend', ink: 2, xp: 9, until: Date.now() + 3600_000 }, minVersion: '0.6.0' }, tok);
  const cfgEv = await fetch(`${base}/brand/config.json`).then((r) => r.json());
  assert.equal(cfgEv.event.ink, 2);
  assert.equal(cfgEv.event.xp, 5, 'multiplier capped at 5');
  assert.equal(cfgEv.minVersion, '0.6.0');
  // crash reports: grouped by cause, resolve, regression
  const crash = (msg, line) => ({ kind: 'loop', msg, stack: `TypeError: ${msg}\n    at Player.update (Player.ts:${line}:9)`, version: '0.5.1', platform: 'desktop', os: 'win32', gpu: 'Intel Iris Xe', anon, session: 's' + line, context: { mode: 'free', island: 'metro' }, crumbs: ['screen none', 'island {"id":"metro"}'] });
  assert.equal((await fetch(`${base}/crash`, { method: 'POST', body: JSON.stringify({ reports: [crash('x is undefined', 10), crash('x is undefined', 99)] }) }).then((r) => r.json())).accepted, 2);
  let cr = await pan('/crashes', undefined, tok).then((r) => r.json());
  assert.equal(cr.groups.length, 1, 'same crash, different line → one group');
  assert.equal(cr.groups[0].count, 2);
  assert.equal(cr.groups[0].samples[0].crumbs.length, 2);
  await pan('/crashes/status', { id: cr.groups[0].id, status: 'resolved' }, tok);
  await fetch(`${base}/crash`, { method: 'POST', body: JSON.stringify({ reports: [crash('x is undefined', 12)] }) });
  cr = await pan('/crashes', undefined, tok).then((r) => r.json());
  assert.equal(cr.groups[0].status, 'open');
  assert.equal(cr.groups[0].regressed, true, 'a fixed crash that returns is flagged');
  // account: wrong current password refused, change works and signs everyone out
  assert.equal((await pan('/account', { password: 'bad', newPassword: 'longer-password-1' }, tok)).status, 403);
  assert.equal((await pan('/account', { password: 'www111', newPassword: 'longer-password-1' }, tok)).status, 200);
  assert.equal((await pan('/me', undefined, tok)).status, 401, 'sessions cleared after a password change');
  assert.equal((await pan('/login', { email: 'lasantha@helao2.com', password: 'longer-password-1' })).status, 200);
  console.log('server test: all checks passed');
  for (const b of [A, B, D, C]) b.ws.close();
} finally { try { process.kill(-server.pid); } catch {} }
