/**
 * BLACKEYE dedicated relay server (prototype).
 *
 * - Rooms by name, up to MAX_PLAYERS_PER_ROOM players.
 * - The first player in a room is the "host" and simulates the Agents; if the
 *   host leaves, the next player is promoted.
 * - Clients send their own state at CLIENT_SEND_HZ; the server validates it
 *   (speed sanity check) and broadcasts room snapshots at SERVER_TICK_HZ.
 * - Hits and FX are relayed with basic validation.
 *
 * In production the same server also serves the built client from ./dist,
 * and an admin panel at /admin (when ADMIN_TOKEN is set).
 *
 * Configuration (environment variables, see deploy/blackeye.env.example):
 *   PORT, HOST, REGION, DATA_DIR, ADMIN_TOKEN, TRUST_PROXY, MAX_CLIENTS,
 *   MAX_ROOMS, MAX_CONN_PER_IP, MOTD
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { handleAdmin, AdminHost } from './admin';
import { AnalyticsStore } from './analytics';
import { BrandStore } from './brand';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ClientMsg,
  ServerMsg,
  NetCharState,
  NetAgentState,
  NetAppearance,
  PROTOCOL_VERSION,
  SERVER_TICK_HZ,
  MAX_PLAYERS_PER_ROOM,
  sanitizeName,
  sanitizeRoom,
  isVec3,
  VOICE_LINES,
} from '../shared/protocol';
import { MatchLogic, Vec3 } from '../shared/match';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const REGION = process.env.REGION ?? 'local';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
/** Behind nginx: take the client IP from X-Forwarded-For. */
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS ?? 1000);
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 300);
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP ?? 6);
let motd = process.env.MOTD ?? '';
let maintenance = false;
const startedAt = Date.now();
let peakPlayers = 0;
let totalConnections = 0;
const DIST = join(process.cwd(), 'dist');
const MAX_SPEED = 40; // m/s, generous: dash + super-jump + falling

interface Client {
  id: number;
  ws: WebSocket;
  ip: string;
  connectedAt: number;
  name: string;
  look: NetAppearance;
  room: Room | null;
  state: NetCharState | null;
  lastStateAt: number;
  msgCount: number;
  msgWindow: number;
  /** Movement authority: a declared teleport lets the next state jump. */
  teleportOk: number;
  lastCorrect: number;
  lastTeleport: number;
}

interface Room {
  name: string;
  seed: number;
  clients: Map<number, Client>;
  hostId: number;
  agents: NetAgentState[];
  /** Optional room password (set by whoever creates the room). */
  pass: string;
  match: MatchLogic;
  matchBroadcastT: number;
  createdAt: number;
}

const rooms = new Map<string, Room>();
/** Every open connection (in a room or not). */
const clients = new Map<number, Client>();
let nextId = 1;

function playerCount(): number {
  let n = 0;
  for (const r of rooms.values()) n += r.clients.size;
  return n;
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  const raw = (TRUST_PROXY && first) || req.socket.remoteAddress || '?';
  return raw.replace(/^::ffff:/, '');
}

/** Per-IP budget for HTTP POSTs a minute: leaderboard + cloud saves 30, analytics 120 (shared networks). */
const postBudget = new Map<string, { n: number; t: number }>();
function allowPost(ip: string, kind: 'data' | 'stats' = 'data'): boolean {
  const now = Date.now();
  const key = kind + ':' + ip;
  const b = postBudget.get(key);
  if (!b || now - b.t > 60_000) {
    postBudget.set(key, { n: 1, t: now });
    if (postBudget.size > 10000) for (const [k, v] of postBudget) if (now - v.t > 60_000) postBudget.delete(k);
    return true;
  }
  return ++b.n <= (kind === 'stats' ? 120 : 30);
}

function send(c: Client, m: ServerMsg) {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m));
}

function broadcast(room: Room, m: ServerMsg, except?: number) {
  const data = JSON.stringify(m);
  for (const c of room.clients.values()) {
    if (c.id !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

function validLook(l: unknown): NetAppearance {
  const fallback: NetAppearance = { c: {}, hat: 'beanie', face: 'sleepy', body: 'standard', print: '' };
  if (!l || typeof l !== 'object') return fallback;
  const o = l as Record<string, unknown>;
  const c: Record<string, string> = {};
  if (o.c && typeof o.c === 'object') {
    for (const [k, v] of Object.entries(o.c as Record<string, unknown>)) {
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) && k.length < 12) c[k] = v;
    }
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return { c, hat: str(o.hat, 12), face: str(o.face, 12), body: str(o.body, 12), print: str(o.print, 30), i: str(o.i, 120) };
}

function validState(s: unknown, prev: NetCharState | null, dtMs: number): NetCharState | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as NetCharState;
  if (!isVec3(o.p) || !isVec3(o.v) || typeof o.yaw !== 'number' || typeof o.a !== 'number' || typeof o.ap !== 'number') return null;
  if (o.p.some((n) => Math.abs(n) > 5000)) return null;
  // movement sanity: reject impossible speeds (teleports such as respawn are allowed when far below or to checkpoints)
  if (prev && dtMs > 0) {
    const d = Math.hypot(o.p[0] - prev.p[0], o.p[1] - prev.p[1], o.p[2] - prev.p[2]);
    const maxD = (MAX_SPEED * Math.max(dtMs, 50)) / 1000 + 10;
    if (d > maxD && d > 80) return null;
  }
  const veh = Array.isArray(o.veh) && o.veh.length === 11 && o.veh.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6) ? o.veh : undefined;
  return { p: o.p, v: o.v, yaw: o.yaw, a: o.a | 0, ap: o.ap, hp: Math.max(0, Math.min(100, Number(o.hp) || 0)), fx: Number(o.fx) | 0, veh };
}

function positions(room: Room): Map<number, Vec3> {
  const m = new Map<number, Vec3>();
  for (const c of room.clients.values()) if (c.state) m.set(c.id, c.state.p);
  return m;
}

function sendMatch(room: Room) {
  broadcast(room, { t: 'match', m: room.match.state });
}

function turfFull(room: Room): number[] {
  const out: number[] = [];
  room.match.cells.forEach((v, i) => {
    if (v) out.push(i, v);
  });
  return out;
}

function leave(c: Client) {
  const room = c.room;
  if (!room) return;
  room.clients.delete(c.id);
  if (room.match.active) {
    room.match.leave(c.id);
    sendMatch(room);
  }
  c.room = null;
  broadcast(room, { t: 'leave', id: c.id });
  if (room.clients.size === 0) {
    rooms.delete(room.name);
    return;
  }
  if (room.hostId === c.id) {
    room.hostId = room.clients.values().next().value!.id;
    room.agents = [];
    broadcast(room, { t: 'host', id: room.hostId });
  }
}

function handle(c: Client, msg: ClientMsg) {
  switch (msg.t) {
    case 'hello': {
      if (msg.v !== PROTOCOL_VERSION) {
        send(c, { t: 'error', message: `Game version mismatch (server ${PROTOCOL_VERSION}, game ${msg.v}). Update the game (Steam does this automatically) or refresh the page.` });
        return;
      }
      if (c.room) return;
      if (maintenance) {
        send(c, { t: 'error', message: 'The server is in maintenance. Try again in a few minutes.' });
        return;
      }
      c.name = sanitizeName(msg.name);
      c.look = validLook(msg.look);
      const name = sanitizeRoom(msg.room);
      const pass = typeof msg.pass === 'string' ? msg.pass.slice(0, 32) : '';
      let room = rooms.get(name);
      if (!room) {
        if (rooms.size >= MAX_ROOMS) {
          send(c, { t: 'error', message: 'Too many rooms open right now — join an existing one.' });
          return;
        }
        room = { name, seed: 1337, clients: new Map(), hostId: c.id, agents: [], pass, match: new MatchLogic(), matchBroadcastT: 0, createdAt: Date.now() };
        rooms.set(name, room);
      } else if (room.pass && room.pass !== pass) {
        send(c, { t: 'error', message: 'Wrong room password.' });
        return;
      }
      if (room.clients.size >= MAX_PLAYERS_PER_ROOM) {
        send(c, { t: 'error', message: 'Room is full.' });
        return;
      }
      room.clients.set(c.id, c);
      c.room = room;
      send(c, {
        t: 'welcome',
        id: c.id,
        host: room.hostId,
        seed: room.seed,
        room: room.name,
        players: [...room.clients.values()].filter((o) => o.id !== c.id).map((o) => ({ id: o.id, name: o.name, look: o.look })),
      });
      broadcast(room, { t: 'join', player: { id: c.id, name: c.name, look: c.look } }, c.id);
      if (room.match.active) {
        room.match.join(c.id);
        sendMatch(room);
        if (room.match.state.mode === 'turf') send(c, { t: 'turf', d: turfFull(room), full: true });
      }
      if (motd) send(c, { t: 'chat', from: 0, name: 'SERVER', text: motd });
      peakPlayers = Math.max(peakPlayers, playerCount());
      console.log(`[room ${room.name}] ${c.name} (#${c.id}) joined — ${room.clients.size} player(s)`);
      return;
    }
    case 'state': {
      const now = Date.now();
      const teleport = c.teleportOk > now;
      const s = validState(msg.s, teleport ? null : c.state, now - c.lastStateAt);
      if (s) {
        c.state = s;
        c.lastStateAt = now;
        if (teleport) c.teleportOk = 0;
      } else if (c.state && now - c.lastCorrect > 1000) {
        // movement authority: snap the client back to its last valid position
        c.lastCorrect = now;
        send(c, { t: 'correct', p: c.state.p });
      }
      return;
    }
    case 'teleport': {
      const now = Date.now();
      // at most one declared teleport every 2 s
      if (now - c.lastTeleport > 2000) {
        c.lastTeleport = now;
        c.teleportOk = now + 1500;
      }
      return;
    }
    case 'startMatch': {
      const room = c.room;
      if (!room || room.hostId !== c.id) return;
      const ids = [...room.clients.keys()];
      if (msg.mode === 'rva' && msg.rva && Array.isArray(msg.rva.eyes) && msg.rva.eyes.length >= 1 && msg.rva.eyes.length <= 8 && msg.rva.eyes.every(isVec3) && isVec3(msg.rva.exit) && isVec3(msg.rva.runnerSpawn) && isVec3(msg.rva.agentSpawn)) {
        room.match.startRva(ids, msg.rva);
      } else if (msg.mode === 'turf' && msg.turf && [msg.turf.x0, msg.turf.z0, msg.turf.cell, msg.turf.w, msg.turf.h].every((n) => typeof n === 'number' && Number.isFinite(n)) && msg.turf.w * msg.turf.h <= 4096 && isVec3(msg.turf.tealSpawn) && isVec3(msg.turf.purpleSpawn)) {
        room.match.startTurf(ids, msg.turf);
        broadcast(room, { t: 'turf', d: [], full: true });
      } else return;
      sendMatch(room);
      console.log(`[room ${room.name}] match ${msg.mode} started with ${ids.length} player(s)`);
      return;
    }
    case 'stopMatch': {
      const room = c.room;
      if (!room || room.hostId !== c.id) return;
      room.match.stop();
      sendMatch(room);
      return;
    }
    case 'tag':
    case 'rescue':
    case 'eye': {
      const room = c.room;
      if (!room) return;
      const pos = positions(room);
      const ok = msg.t === 'tag' ? room.match.tag(c.id, msg.target | 0, pos) : msg.t === 'rescue' ? room.match.rescue(c.id, msg.target | 0, pos) : room.match.eye(c.id, msg.idx | 0, pos);
      if (ok) sendMatch(room);
      return;
    }
    case 'paint': {
      const room = c.room;
      if (!room || !Array.isArray(msg.cells)) return;
      const d = room.match.paint(c.id, msg.cells, positions(room));
      if (d.length) broadcast(room, { t: 'turf', d });
      return;
    }
    case 'mark': {
      const room = c.room;
      if (!room || !isVec3(msg.p) || !['look', 'go', 'danger'].includes(msg.kind)) return;
      broadcast(room, { t: 'mark', from: c.id, p: msg.p, kind: msg.kind }, c.id);
      return;
    }
    case 'voice': {
      const room = c.room;
      const id = msg.id | 0;
      if (!room || id < 0 || id >= VOICE_LINES.length) return;
      broadcast(room, { t: 'voice', from: c.id, id }, c.id);
      return;
    }
    case 'mission': {
      const room = c.room;
      if (!room || typeof msg.id !== 'string' || !['start', 'done', 'fail'].includes(msg.ev)) return;
      broadcast(room, { t: 'mission', from: c.id, name: c.name, id: msg.id.slice(0, 32), ev: msg.ev }, c.id);
      return;
    }
    case 'agents': {
      const room = c.room;
      if (!room || room.hostId !== c.id || !Array.isArray(msg.list)) return;
      room.agents = msg.list.slice(0, 40).filter((a) => a && typeof a.id === 'number' && isVec3(a.p));
      return;
    }
    case 'hit': {
      const room = c.room;
      if (!room || !isVec3(msg.dir)) return;
      const target = room.clients.get(msg.target);
      if (!target) return;
      // range check: attacker must be near the target (agent hits come from the host, who simulates agents anywhere)
      const fromHostAgent = msg.agent === true && room.hostId === c.id;
      if (!fromHostAgent && c.state && target.state) {
        const d = Math.hypot(c.state.p[0] - target.state.p[0], c.state.p[1] - target.state.p[1], c.state.p[2] - target.state.p[2]);
        if (d > 6) return;
      }
      send(target, { t: 'hit', from: c.id, dir: msg.dir, power: Math.max(0, Math.min(40, Number(msg.power) || 0)) });
      return;
    }
    case 'hitAgent': {
      const room = c.room;
      if (!room || !isVec3(msg.dir)) return;
      const host = room.clients.get(room.hostId);
      if (host) send(host, { t: 'hitAgent', from: c.id, id: msg.id | 0, dir: msg.dir, power: Math.max(0, Math.min(40, Number(msg.power) || 0)) });
      return;
    }
    case 'fx': {
      const room = c.room;
      if (!room || !isVec3(msg.p)) return;
      if (!['ink', 'shock', 'smash', 'absorb', 'blink', 'dash'].includes(msg.kind)) return;
      broadcast(room, { t: 'fx', from: c.id, kind: msg.kind, p: msg.p, d: isVec3(msg.d) ? msg.d : undefined }, c.id);
      return;
    }
    case 'look': {
      const room = c.room;
      if (!room) return;
      c.look = validLook(msg.look);
      broadcast(room, { t: 'look', id: c.id, look: c.look }, c.id);
      return;
    }
    case 'chat': {
      const room = c.room;
      if (!room || typeof msg.text !== 'string') return;
      const text = msg.text.replace(/[\u0000-\u001f]/g, '').slice(0, 140).trim();
      if (text) broadcast(room, { t: 'chat', from: c.id, name: c.name, text });
      return;
    }
    case 'ping':
      send(c, { t: 'pong', ts: msg.ts });
      return;
  }
}

// ---------------------------------------------------------------- static files (production)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (path.includes('..')) throw new Error('bad path');
    let file = join(DIST, path || 'index.html');
    const st = await stat(file).catch(() => null);
    if (!st || st.isDirectory()) file = join(DIST, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found. Build the client first with `npm run build`, or use `npm run dev` for development.');
  }
}

const http = createServer((req, res) => {
  if (req.url === '/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify([...rooms.values()].map((r) => ({ name: r.name, players: r.clients.size }))));
    return;
  }
  if (req.method === 'POST' && !allowPost(clientIp(req), req.url === '/analytics' ? 'stats' : 'data')) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end('{"error":"slow down"}');
    return;
  }
  if (req.url?.startsWith('/brand/')) {
    void brand.handle(req, res).then((done) => {
      if (!done) {
        res.writeHead(404);
        res.end();
      }
    });
    return;
  }
  if (req.url === '/analytics') {
    void analyticsRoute(req, res);
    return;
  }
  if (req.url?.startsWith('/cloud')) {
    void cloud(req, res);
    return;
  }
  if (req.url?.startsWith('/leaderboard')) {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (d) => {
        body += d;
        if (body.length > 2000) req.destroy();
      });
      req.on('end', () => {
        try {
          const o = JSON.parse(body) as { mission?: unknown; name?: unknown; time?: unknown };
          const list = submitScore(o.mission, o.name, o.time);
          res.writeHead(list ? 200 : 400, headers);
          res.end(JSON.stringify(list ? list.slice(0, 10) : { error: 'bad score' }));
        } catch {
          res.writeHead(400, headers);
          res.end('{}');
        }
      });
      return;
    }
    const m = new URL(req.url, 'http://localhost').searchParams.get('mission');
    res.writeHead(200, headers);
    res.end(JSON.stringify(m ? (board[m] ?? []).slice(0, 10) : Object.fromEntries(Object.entries(board).map(([k, v]) => [k, v.slice(0, 3)]))));
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, region: REGION, protocol: PROTOCOL_VERSION, maintenance, rooms: rooms.size, players: playerCount() }));
    return;
  }
  if (req.url === '/admin' || req.url?.startsWith('/admin/')) {
    void handleAdmin(req, res, admin, ADMIN_TOKEN, clientIp(req));
    return;
  }
  void serveStatic(req, res);
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  const reject = (message: string) => {
    ws.send(JSON.stringify({ t: 'error', message } satisfies ServerMsg));
    ws.close(4000, message.slice(0, 100));
  };
  if (bans.has(ip)) return reject('You are banned from this server.');
  if (clients.size >= MAX_CLIENTS) return reject('The server is full. Try another region or come back soon.');
  if ([...clients.values()].filter((o) => o.ip === ip).length >= MAX_CONN_PER_IP) return reject('Too many connections from your network.');
  totalConnections++;
  const c: Client = { id: nextId++, ws, ip, connectedAt: Date.now(), name: 'Blank', look: validLook(null), room: null, state: null, lastStateAt: 0, msgCount: 0, msgWindow: Date.now(), teleportOk: 0, lastCorrect: 0, lastTeleport: 0 };
  ws.on('message', (data) => {
    // simple flood protection
    const now = Date.now();
    if (now - c.msgWindow > 1000) {
      c.msgWindow = now;
      c.msgCount = 0;
    }
    if (++c.msgCount > 120) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }
    if (msg && typeof msg === 'object' && typeof msg.t === 'string') handle(c, msg);
  });
  clients.set(c.id, c);
  const drop = () => {
    clients.delete(c.id);
    leave(c);
  };
  ws.on('close', drop);
  ws.on('error', drop);
});

// snapshot broadcast
setInterval(() => {
  const ts = Date.now();
  for (const room of rooms.values()) {
    const players: Array<{ id: number; s: NetCharState }> = [];
    for (const c of room.clients.values()) if (c.state) players.push({ id: c.id, s: c.state });
    broadcast(room, { t: 'snap', ts, players, agents: room.agents });
    // referee the match: win checks every tick, clock sync once a second
    if (room.match.active) {
      const changed = room.match.tick(1 / SERVER_TICK_HZ, positions(room));
      room.matchBroadcastT -= 1 / SERVER_TICK_HZ;
      if (changed || room.matchBroadcastT <= 0) {
        room.matchBroadcastT = 1;
        sendMatch(room);
      }
    }
  }
}, 1000 / SERVER_TICK_HZ);

// ---------------------------------------------------------------- cloud saves

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** POST {data, code?, key?} stores a profile (returns {code, key}); GET ?code= returns it. The key is needed to overwrite. */
async function cloud(req: IncomingMessage, res: ServerResponse) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
  const dir = join(DATA, 'cloud');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  if (req.method === 'GET') {
    const code = new URL(req.url ?? '', 'http://localhost').searchParams.get('code') ?? '';
    if (!/^[A-Z2-9]{8}$/.test(code)) {
      res.writeHead(400, headers);
      res.end('{"error":"bad code"}');
      return;
    }
    const raw = await readFile(join(dir, code + '.json'), 'utf8').catch(() => null);
    res.writeHead(raw ? 200 : 404, headers);
    res.end(raw ? JSON.stringify({ data: (JSON.parse(raw) as { data: string }).data }) : '{"error":"not found"}');
    return;
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 300_000) {
      res.writeHead(413, headers);
      res.end('{"error":"too big"}');
      return;
    }
  }
  try {
    const o = JSON.parse(body) as { data?: unknown; code?: unknown; key?: unknown };
    if (typeof o.data !== 'string' || o.data.length > 250_000) throw new Error('bad data');
    JSON.parse(o.data);
    await mkdir(dir, { recursive: true });
    let code = typeof o.code === 'string' && /^[A-Z2-9]{8}$/.test(o.code) ? o.code : '';
    let key = typeof o.key === 'string' ? o.key.slice(0, 40) : '';
    if (code) {
      // overwriting needs the key handed out on first upload
      const prev = await readFile(join(dir, code + '.json'), 'utf8').catch(() => null);
      if (prev && (JSON.parse(prev) as { key: string }).key !== key) throw new Error('wrong key');
    } else {
      const pick = (n: number) => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      code = pick(8);
      key = pick(24);
    }
    await writeFile(join(dir, code + '.json'), JSON.stringify({ key, data: o.data, at: Date.now() }));
    res.writeHead(200, headers);
    res.end(JSON.stringify({ code, key }));
  } catch (e) {
    res.writeHead(400, headers);
    res.end(JSON.stringify({ error: String((e as Error).message ?? e) }));
  }
}

// ---------------------------------------------------------------- analytics

const stats = new AnalyticsStore(process.env.DATA_DIR ?? join(process.cwd(), 'server', 'data'));
void stats.load();
const brand = new BrandStore(process.env.DATA_DIR ?? join(process.cwd(), 'server', 'data'));
void brand.load();

/** POST batches of anonymous play events (text/plain JSON, so no CORS preflight). */
async function analyticsRoute(req: IncomingMessage, res: ServerResponse) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, headers);
    res.end('{}');
    return;
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64_000) {
      res.writeHead(413, headers);
      res.end('{"error":"too big"}');
      return;
    }
  }
  let ok = false;
  try {
    ok = stats.ingest(JSON.parse(body));
  } catch {
    ok = false;
  }
  res.writeHead(ok ? 200 : 400, headers);
  res.end(ok ? '{"ok":true}' : '{"error":"bad batch"}');
}

// ---------------------------------------------------------------- leaderboards (time trials)

interface Entry {
  name: string;
  time: number;
  at: number;
}
const DATA = process.env.DATA_DIR ?? join(process.cwd(), 'server', 'data');
const LB_FILE = join(DATA, 'leaderboard.json');
let board: Record<string, Entry[]> = {};
void readFile(LB_FILE, 'utf8')
  .then((t) => (board = JSON.parse(t) as Record<string, Entry[]>))
  .catch(() => (board = {}));
let saveTimer: NodeJS.Timeout | null = null;
function saveBoard() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void mkdir(DATA, { recursive: true })
      .then(() => writeFile(LB_FILE, JSON.stringify(board)))
      .catch(() => {});
  }, 2000);
}

function submitScore(mission: unknown, name: unknown, time: unknown): Entry[] | null {
  if (typeof mission !== 'string' || !/^[a-z0-9_]{2,32}$/.test(mission)) return null;
  const t = Number(time);
  if (!Number.isFinite(t) || t < 3 || t > 3600) return null;
  const n = sanitizeName(name);
  const list = (board[mission] ??= []);
  const mine = list.find((e) => e.name === n);
  if (mine) {
    if (t >= mine.time) return list;
    mine.time = Math.round(t * 100) / 100;
    mine.at = Date.now();
  } else list.push({ name: n, time: Math.round(t * 100) / 100, at: Date.now() });
  list.sort((a, b) => a.time - b.time);
  board[mission] = list.slice(0, 20);
  saveBoard();
  return board[mission];
}

// ---------------------------------------------------------------- bans + admin

const BANS_FILE = join(DATA, 'bans.json');
const bans = new Set<string>();
void readFile(BANS_FILE, 'utf8')
  .then((t) => (JSON.parse(t) as string[]).forEach((ip) => bans.add(ip)))
  .catch(() => {});
function saveBans() {
  void mkdir(DATA, { recursive: true })
    .then(() => writeFile(BANS_FILE, JSON.stringify([...bans])))
    .catch(() => {});
}

function serverChat(text: string, room?: Room) {
  const m: ServerMsg = { t: 'chat', from: 0, name: 'SERVER', text };
  if (room) broadcast(room, m);
  else for (const c of clients.values()) send(c, m);
}

function disconnect(c: Client, reason: string) {
  send(c, { t: 'error', message: reason });
  c.ws.close(4001, reason.slice(0, 100));
}

const admin: AdminHost = {
  status: () => ({
    region: REGION,
    protocol: PROTOCOL_VERSION,
    maintenance,
    motd,
    uptimeMs: Date.now() - startedAt,
    memory: process.memoryUsage().rss,
    players: playerCount(),
    peakPlayers,
    totalConnections,
    limits: { maxClients: MAX_CLIENTS, maxRooms: MAX_ROOMS, maxPerIp: MAX_CONN_PER_IP },
    rooms: [...rooms.values()].map((r) => ({
      name: r.name,
      players: r.clients.size,
      host: r.clients.get(r.hostId)?.name ?? '?',
      match: r.match.active ? r.match.state.mode : '',
      locked: !!r.pass,
      ageMs: Date.now() - r.createdAt,
    })),
    clients: [...clients.values()].map((c) => ({ id: c.id, name: c.name, room: c.room?.name ?? '', ip: c.ip, onlineMs: Date.now() - c.connectedAt })),
    bans: [...bans],
  }),
  kick(id, ban, reason) {
    const c = clients.get(id);
    if (!c) return false;
    if (ban) {
      bans.add(c.ip);
      saveBans();
    }
    console.log(`[admin] ${ban ? 'banned' : 'kicked'} ${c.name} (#${c.id}, ${c.ip})`);
    disconnect(c, reason);
    return true;
  },
  closeRoom(name) {
    const room = rooms.get(name);
    if (!room) return false;
    for (const c of [...room.clients.values()]) disconnect(c, 'This room was closed by an admin.');
    rooms.delete(name);
    console.log(`[admin] closed room ${name}`);
    return true;
  },
  broadcast(text, roomName) {
    const t = text.replace(/[\u0000-\u001f]/g, '').trim();
    if (!t) return 0;
    if (roomName) {
      const room = rooms.get(roomName);
      if (!room) return 0;
      serverChat(t, room);
      return room.clients.size;
    }
    serverChat(t);
    return clients.size;
  },
  setMaintenance(on) {
    maintenance = on;
    console.log(`[admin] maintenance ${on ? 'on' : 'off'}`);
  },
  setMotd(text) {
    motd = text.trim();
  },
  unban(ip) {
    const ok = bans.delete(ip);
    if (ok) saveBans();
    return ok;
  },
  board: () => board,
  deleteScore(mission, name) {
    const list = board[mission];
    if (!list) return false;
    const i = list.findIndex((e) => e.name === name);
    if (i < 0) return false;
    list.splice(i, 1);
    saveBoard();
    return true;
  },
};

// ---------------------------------------------------------------- start + graceful shutdown

http.listen(PORT, HOST, () => {
  console.log(`BLACKEYE server [${REGION}] listening on http://${HOST}:${PORT} (ws path /ws)${ADMIN_TOKEN ? ' · admin panel at /admin' : ''}`);
});

// a closed log pipe (e.g. the parent process exited) must never crash the server
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

let stopping = false;
function shutdown(sig: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${sig}: telling players, saving data, shutting down`);
  serverChat('Server is restarting — you will be reconnected in a moment.');
  void mkdir(DATA, { recursive: true })
    .then(() => writeFile(LB_FILE, JSON.stringify(board)))
    .then(() => stats.save())
    .catch(() => {})
    .finally(() => {
      for (const c of clients.values()) c.ws.close(1012, 'restart');
      http.close();
      setTimeout(() => process.exit(0), 500).unref();
    });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
