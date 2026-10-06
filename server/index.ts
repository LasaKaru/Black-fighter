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
 * In production the same server also serves the built client from ./dist.
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
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
} from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = join(process.cwd(), 'dist');
const MAX_SPEED = 40; // m/s, generous: dash + super-jump + falling

interface Client {
  id: number;
  ws: WebSocket;
  name: string;
  look: NetAppearance;
  room: Room | null;
  state: NetCharState | null;
  lastStateAt: number;
  msgCount: number;
  msgWindow: number;
}

interface Room {
  name: string;
  seed: number;
  clients: Map<number, Client>;
  hostId: number;
  agents: NetAgentState[];
}

const rooms = new Map<string, Room>();
let nextId = 1;

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

function leave(c: Client) {
  const room = c.room;
  if (!room) return;
  room.clients.delete(c.id);
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
        send(c, { t: 'error', message: `Protocol mismatch (server ${PROTOCOL_VERSION}, client ${msg.v}). Refresh the page.` });
        return;
      }
      if (c.room) return;
      c.name = sanitizeName(msg.name);
      c.look = validLook(msg.look);
      const name = sanitizeRoom(msg.room);
      let room = rooms.get(name);
      if (!room) {
        room = { name, seed: 1337, clients: new Map(), hostId: c.id, agents: [] };
        rooms.set(name, room);
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
      console.log(`[room ${room.name}] ${c.name} (#${c.id}) joined — ${room.clients.size} player(s)`);
      return;
    }
    case 'state': {
      const now = Date.now();
      const s = validState(msg.s, c.state, now - c.lastStateAt);
      if (s) {
        c.state = s;
        c.lastStateAt = now;
      }
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
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.clients.size, 0) }));
    return;
  }
  void serveStatic(req, res);
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  const c: Client = { id: nextId++, ws, name: 'Blank', look: validLook(null), room: null, state: null, lastStateAt: 0, msgCount: 0, msgWindow: Date.now() };
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
  ws.on('close', () => leave(c));
  ws.on('error', () => leave(c));
});

// snapshot broadcast
setInterval(() => {
  const ts = Date.now();
  for (const room of rooms.values()) {
    const players: Array<{ id: number; s: NetCharState }> = [];
    for (const c of room.clients.values()) if (c.state) players.push({ id: c.id, s: c.state });
    broadcast(room, { t: 'snap', ts, players, agents: room.agents });
  }
}, 1000 / SERVER_TICK_HZ);

http.listen(PORT, () => {
  console.log(`BLACKEYE server listening on http://localhost:${PORT} (ws path /ws)`);
});
