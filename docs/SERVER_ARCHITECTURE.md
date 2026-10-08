# How the game server works (and how to grow it worldwide)

## The short version

- **One small Node.js program** (`server/index.ts`) is the whole backend. It runs on one Linux VPS.
- **Single-player needs no server at all.** Story, free roam, missions and horde run entirely on the player's PC, and saves live on the PC.
- The server is only needed for **multiplayer rooms, global leaderboards and cloud saves**.
- **One VPS handles a few hundred players at once.** For players worldwide, add a server in each region and let players pick the closest one. The game already has a region picker for this.
- **The admin panel is built in** at `https://your-domain/admin`.

## What runs where

```
 Steam player's PC (Electron .exe)              Your Contabo VPS
 ┌─────────────────────────────┐                ┌──────────────────────────────────────────┐
 │ Whole game: physics, AI,    │   WebSocket    │ nginx (HTTPS, port 443)                  │
 │ rendering, story, saves     │◀──────────────▶│   └─▶ Node: server/index.ts (port 8787)  │
 │ (localStorage in the        │   wss://…/ws   │        • rooms (in memory)               │
 │  user's AppData folder)     │                │        • match referee (RvA, Ink Turf)   │
 └─────────────────────────────┘   HTTPS        │        • movement sanity + corrections   │
                                  ─────────────▶│        • /leaderboard  /cloud  /rooms    │
 Browser player (optional)                      │        • /health  /admin                 │
  https://your-domain  ───────────────────────▶ │        • serves the web build (dist/)    │
                                                │   data: /opt/blackeye/data/*.json        │
                                                └──────────────────────────────────────────┘
```

### Inside a multiplayer room

- **Rooms** are created by name the first time someone joins, with an optional password. They are deleted when the last player leaves. Up to 16 players per room.
- **Each player simulates their own character** and sends its state 20 times a second. The server checks every update: impossible speeds and teleports are refused, and the player is snapped back to their last valid position.
- **The first player in a room is the "host".** The host's PC runs the Agents (enemy AI) and sends their positions. If the host leaves, the next player takes over.
- **The server sends a snapshot of the room** (all players and Agents) to everyone 20 times a second. It relays hits, effects, chat, pings and voice lines after checking them.
- **Runners vs Agents and Ink Turf are refereed on the server:** tags, rescues, Eyes, painting, scores and the clock all run there, so clients cannot fake a win.

### Data the server stores

Everything lives in `DATA_DIR` (`/opt/blackeye/data`). **Back this folder up.**

| File | What |
|---|---|
| `leaderboard.json` | Top 20 times per time-trial mission |
| `cloud/XXXXXXXX.json` | Cloud saves (8-letter code plus a private key to overwrite) |
| `bans.json` | Banned IP addresses |
| `analytics/` | Anonymous play statistics: daily totals and install records, deleted after 120 days |
| `brand/config.json`, `brand/files/` | Branding, sponsors, links, pages and feature switches; uploaded logos |
| `panel/account.json` | The owner panel account (email and scrypt password hash) |
| `status.json` | Game status: live / maintenance / development, schedule, tester code hash |
| `crashes.json` | Crash reports grouped by cause (latest 5 per problem, at most 500) |
| `moderation.json` | Blocked words and mutes |

Every file is written atomically (temp file + rename) with a `.bak` copy that loads if the main file is ever unreadable.

## Admin panel

Set `ADMIN_TOKEN` in `/etc/blackeye.env`; `setup-server.sh` generates a random one. Then open `https://your-domain/admin` and sign in with the token.

| Feature | What it does |
|---|---|
| Live stats | Players online, peak, rooms, total connections, uptime, memory, limits |
| Rooms | Every room with players, host, match mode and password status. **Close room** disconnects everyone in it. |
| Players | Name, room, IP and time online. **Kick**, or **Ban IP** (the ban persists across restarts). |
| Announce | Sends a SERVER chat message to every room or to one room |
| Message of the day | Shown to every player when they join |
| Maintenance mode | Refuses new joins while players already in rooms keep playing. Turn it on before an update. |
| Leaderboards | View any mission's board and remove cheated or offensive entries |
| Bans | List and unban |

Protection:

- The token is compared in constant time.
- After 10 wrong tries from one IP, sign-in is locked for 10 minutes.
- For extra safety, allow `/admin` only from your own IP. There is a commented block for this in `deploy/nginx-blackeye.conf`.

## Owner panel

The game also has a hidden **owner panel** for the business side: player
statistics, branding, sponsors, donation links, legal pages and feature
switches, plus the same live controls as `/admin`. Open it by typing `kumara`
on the title screen. It signs in with an email and password checked by the
server (`/panel/api`), seeded from `PANEL_EMAIL` / `PANEL_PASSWORD` on first
start. Full guide: [OWNER_PANEL.md](OWNER_PANEL.md).

Public routes it feeds: `GET /brand/config.json` (read by every game at start),
`GET /brand/files/<image>` and `GET /status` (maintenance / development, read at
start and every minute). Games send statistics to `POST /analytics` and crash
reports to `POST /crash`.

## Built-in protection

| Limit | Default | Setting |
|---|---|---|
| Players per server | 1000 | `MAX_CLIENTS` |
| Rooms per server | 300 | `MAX_ROOMS` |
| Connections per IP | 6 | `MAX_CONN_PER_IP` |
| Messages per connection | 120 per second | (code) |
| Leaderboard/cloud POSTs per IP | 30 per minute | (code) |
| Message size | 64 KB | (code) |

Other safeguards:

- **Mismatched game versions are refused** with an "update your game" message (`PROTOCOL_VERSION` in `shared/protocol.ts`).
- **Restarts are graceful.** On `systemctl restart`, players get a "server restarting" message and the leaderboards are saved first.

## How many players can one VPS take?

Bandwidth runs out before CPU. A busy room sends each player roughly 50–90 KB/s: 16 players plus up to 40 Agents, 20 times a second, as JSON.

| VPS | Rough concurrent players |
|---|---|
| Contabo Cloud VPS 10 (4 vCPU, 8 GB, 200 Mbit/s) | 250–400 |
| Contabo Cloud VPS 20/30 (more cores, 400–600 Mbit/s) | 500–1000 |

These are estimates; load-test before launch. Most Steam buyers play solo most of the time, so even 10,000 owners rarely means more than a few hundred online at once.

**When you outgrow it** (in this order):

1. **Turn on WebSocket compression** (`perMessageDeflate` in `server/index.ts`). JSON compresses 3–4×, at some CPU cost.
2. **Switch snapshots to a binary format**, which is about 5× smaller than JSON.
3. **Add regions** (below).

## Going worldwide: regions

Players far from the server get high ping: Sri Lanka ↔ Germany is about 150 ms, Sri Lanka ↔ US West about 250 ms. Co-op is fine at 150 ms; PvP feels better under 100 ms. Contabo has data centres in Europe (Germany, UK), the US (East, Central, West), Asia (Singapore, Japan, India) and Australia.

**Step 1: one server.** Start with one server, ideally Singapore (good for Asia) or Germany (good for Europe and okay for Asia).

**Step 2: more regions.** Rent a second (and third) VPS in another region and run the same `setup-server.sh` on each with its own subdomain: `asia.example.com`, `eu.example.com`, `us.example.com`. Give each a different `REGION=` in `/etc/blackeye.env`.

**Step 3: tell the game about the regions.** Set these GitHub repository variables (see [CI_RELEASES.md](CI_RELEASES.md)):

- `GAME_SERVERS` = `Asia=https://asia.example.com,EU=https://eu.example.com,US=https://us.example.com`
  - The Multiplayer screen then shows a region list with live ping for each, and players pick one.
- `GAME_SERVER_URL` = your default region.
- `GAME_DATA_URL` = one "main" server for leaderboards and cloud saves.
  - Rooms are local to each region, but the leaderboard and cloud saves stay global this way.

**Step 4: managing several regions.**

- Each region has its own `/admin` panel and its own `ADMIN_TOKEN`.
- Each region is updated by `deploy/update.sh`.
- The deploy workflow handles one host. Copy the job, or loop over hosts, when you have several.

### Alternatives

- **Free DDoS protection:** put the domain behind **Cloudflare** (orange-cloud proxy). WebSockets are supported, Cloudflare hides your server IP, and its network blocks attacks. Then set `TRUST_PROXY=1` (already the default) so bans use the real player IP from `X-Forwarded-For`.
- **Steam login (later):** right now players are anonymous, identified by name only. To tie leaderboards and bans to Steam accounts:
  1. Install `steamworks.js` (see [STEAM_RELEASE.md](STEAM_RELEASE.md)).
  2. Send an auth ticket on `hello`.
  3. Verify it on the server with Steam's `ISteamUserAuth/AuthenticateUserTicket` Web API, using a publisher Web API key.
- **Steam Networking / Steam lobbies** could replace your server for co-op, but the server-refereed modes and the leaderboard would still need a server.

## Monitoring and backups

- **Uptime:** add `https://your-domain/health` to a free monitor (UptimeRobot, Better Stack). It returns region, players, rooms and maintenance status.
- **Logs:** `journalctl -u blackeye -f` shows joins, matches and admin actions.
- **Backups:** a daily cron job such as `tar czf /root/backup-$(date +%F).tgz /opt/blackeye/data`, copied off the server with `rclone` to any cloud drive. Contabo also sells snapshots.
- **Updates:** turn on maintenance mode in `/admin`, wait for rooms to empty (or announce), then push to `main`. The deploy workflow pulls, builds and restarts.

## Releasing client and server together

The Steam client and the server must agree on `PROTOCOL_VERSION`. When you change the network messages:

1. Bump `PROTOCOL_VERSION` in `shared/protocol.ts`.
2. Deploy the server and the Steam build together. Steam updates players automatically. Anyone still on the old version sees "Protocol mismatch… update" instead of a broken game.
