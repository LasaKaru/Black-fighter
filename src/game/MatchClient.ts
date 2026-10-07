import * as THREE from 'three';
import type { ClientMsg } from '../../shared/protocol';
import type { MatchState, RvaSetup, Team, TurfSetup, Vec3 } from '../../shared/match';
import { EYE_RANGE, RESCUE_RANGE, TAG_RANGE } from '../../shared/match';
import type { Player } from '../player/Player';
import { markerTexture } from '../world/Textures';

export interface MatchHost {
  scene: THREE.Scene;
  player: Player;
  myId(): number;
  isHost(): boolean;
  send(m: ClientMsg): void;
  remotes(): Iterable<{ id: number; name: string; feet: THREE.Vector3 }>;
  teleport(p: THREE.Vector3): void;
  toast(text: string, kind?: 'info' | 'power' | 'warn'): void;
  audio(name: 'catch' | 'absorb' | 'hurt' | 'ui' | 'spot'): void;
  /** Candidate points for eyes and the exit (checkpoints around the hub). */
  hubPoints(): THREE.Vector3[];
}

const TEAM_COLOR: Record<Team, string> = { runner: '#17a9a3', agent: '#ff2a4a', teal: '#17a9a3', purple: '#6b2bff' };
const TEAM_NAME: Record<Team, string> = { runner: 'RUNNER', agent: 'AGENT', teal: 'TEAL', purple: 'PURPLE' };

/**
 * Client side of the refereed matches: shows the eyes, exit portal, team
 * markers, cages and the turf paint, sends pickups/tags/paint to the server
 * and freezes you while tagged.
 */
export class MatchClient {
  state: MatchState | null = null;
  private round = 0;
  private eyes: THREE.Group[] = [];
  private exit: THREE.Group | null = null;
  private markers = new Map<number, THREE.Sprite>();
  private cages = new Map<number, THREE.Mesh>();
  private eyeCd = 0;
  private paintT = 0;
  private turfMesh: THREE.Mesh | null = null;
  private turfTex: THREE.DataTexture | null = null;
  private cells = new Uint8Array(0);
  private lastWinner: string | null = null;

  constructor(private h: MatchHost) {}

  get active(): boolean {
    return !!this.state?.mode;
  }

  team(id = this.h.myId()): Team | null {
    return this.state?.teams[id] ?? null;
  }

  // ------------------------------------------------------------ host setup

  /** Five eyes spread around the hub, the exit far from the runners' start. */
  rvaSetup(): RvaSetup {
    const pts = this.h.hubPoints();
    const runnerSpawn = new THREE.Vector3(0, 0.3, 20);
    const chosen: THREE.Vector3[] = [];
    // farthest-point sampling for a spread-out course
    let cur = pts.reduce((a, b) => (a.distanceTo(runnerSpawn) < b.distanceTo(runnerSpawn) ? a : b), pts[0] ?? runnerSpawn);
    while (chosen.length < 5 && pts.length) {
      chosen.push(cur);
      cur = pts.reduce((best, p) => (Math.min(...chosen.map((c) => c.distanceTo(p))) > Math.min(...chosen.map((c) => c.distanceTo(best))) ? p : best), pts[0]);
      if (chosen.includes(cur)) break;
    }
    const exit = pts.reduce((a, b) => (a.distanceTo(runnerSpawn) > b.distanceTo(runnerSpawn) ? a : b), pts[0] ?? new THREE.Vector3(0, 0, -60));
    const v = (p: THREE.Vector3): Vec3 => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100];
    return { eyes: chosen.map((p) => v(p.clone().setY(p.y + 0.8))), exit: v(exit), runnerSpawn: v(runnerSpawn), agentSpawn: [0, 0.3, -40] };
  }

  turfSetup(): TurfSetup {
    return { x0: -32, z0: -22, cell: 2, w: 32, h: 32, tealSpawn: [-24, 0.4, 10], purpleSpawn: [24, 0.4, 10] };
  }

  // ------------------------------------------------------------ server messages

  onMatch(m: MatchState) {
    const prev = this.state;
    this.state = m.mode ? m : null;
    const me = this.h.myId();
    if (!m.mode) {
      if (prev?.mode) this.h.toast('Match over — back to free roam', 'info');
      this.clearVisuals();
      this.h.player.frozen = false;
      this.h.player.powersLocked = false;
      return;
    }
    if (m.round !== this.round) {
      // new round: build the arena and go to your side's spawn
      this.round = m.round;
      this.lastWinner = null;
      this.clearVisuals();
      this.buildVisuals(m);
      const t = m.teams[me];
      const sp = m.mode === 'rva' ? (t === 'agent' ? m.rva!.agentSpawn : m.rva!.runnerSpawn) : t === 'teal' ? m.turf!.tealSpawn : m.turf!.purpleSpawn;
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4);
      this.h.teleport(new THREE.Vector3(...sp).add(jitter));
      const intro =
        m.mode === 'rva'
          ? t === 'agent'
            ? 'You are an AGENT: tag every Runner (F when close). No Eye powers.'
            : 'You are a RUNNER: grab the 5 Watcher Eyes, then escape through the portal. F frees tagged teammates.'
          : `INK TURF · team ${t === 'teal' ? 'TEAL' : 'PURPLE'}: paint the plaza by running over it.`;
      this.h.toast(intro, 'power');
      this.h.audio('catch');
    }
    this.h.player.powersLocked = m.mode === 'rva' && m.teams[me] === 'agent';
    const wasTagged = this.h.player.frozen;
    this.h.player.frozen = m.mode === 'rva' && m.tagged.includes(me) && m.phase === 'play';
    if (this.h.player.frozen && !wasTagged) {
      this.h.toast('TAGGED! Wait for a Runner to free you.', 'warn');
      this.h.audio('hurt');
    }
    if (!this.h.player.frozen && wasTagged && m.phase === 'play') this.h.toast('Freed!', 'power');
    m.eyes.forEach((got, i) => {
      const g = this.eyes[i];
      if (g && g.visible === got) {
        g.visible = !got;
        if (got) this.h.audio('catch');
      }
    });
    if (this.exit) this.exit.visible = m.exitOpen;
    if (m.phase === 'end' && m.winner && this.lastWinner !== m.winner) {
      this.lastWinner = m.winner;
      const mine = m.teams[me];
      const won = m.winner === mine || (m.winner === 'runner' && mine === 'runner') || (m.winner === 'agent' && mine === 'agent');
      const label = m.winner === 'draw' ? 'DRAW' : `${(m.winner as string).toUpperCase()}S WIN`;
      this.h.toast(`${label}${m.winner !== 'draw' ? (won ? ' — you won!' : ' — next round, swap sides') : ''}`, won ? 'power' : 'warn');
      this.h.audio(won ? 'absorb' : 'hurt');
    }
  }

  onTurf(d: number[], full?: boolean) {
    if (!this.state?.turf) return;
    if (full) this.cells.fill(0);
    for (let i = 0; i + 1 < d.length; i += 2) {
      if (d[i] >= 0 && d[i] < this.cells.length) this.cells[d[i]] = d[i + 1];
    }
    this.paintTexture();
  }

  // ------------------------------------------------------------ visuals

  private buildVisuals(m: MatchState) {
    const scene = this.h.scene;
    if (m.mode === 'rva' && m.rva) {
      for (const e of m.rva.eyes) {
        const g = new THREE.Group();
        const orb = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture('#ff7a1a', '◉'), depthTest: true }));
        orb.scale.set(1.3, 1.3, 1);
        orb.position.y = 1.2;
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 30, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.y = 15;
        g.add(orb, beam);
        g.position.set(...e);
        g.userData.noMap = true;
        scene.add(g);
        this.eyes.push(g);
      }
      const x = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.25, 10, 40), new THREE.MeshStandardMaterial({ color: '#111114', emissive: '#6b2bff', emissiveIntensity: 2 }));
      ring.position.y = 2.6;
      const fill = new THREE.Mesh(new THREE.CircleGeometry(2.3, 32), new THREE.MeshBasicMaterial({ color: '#6b2bff', transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
      fill.position.y = 2.6;
      x.add(ring, fill);
      x.position.set(...m.rva.exit);
      x.visible = m.exitOpen;
      scene.add(x);
      this.exit = x;
    }
    if (m.mode === 'turf' && m.turf) {
      const T = m.turf;
      this.cells = new Uint8Array(T.w * T.h);
      const data = new Uint8Array(T.w * T.h * 4);
      this.turfTex = new THREE.DataTexture(data, T.w, T.h, THREE.RGBAFormat);
      this.turfTex.magFilter = THREE.NearestFilter;
      this.turfTex.needsUpdate = true;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(T.w * T.cell, T.h * T.cell), new THREE.MeshBasicMaterial({ map: this.turfTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(T.x0 + (T.w * T.cell) / 2, 0.07, T.z0 + (T.h * T.cell) / 2);
      plane.renderOrder = 2;
      scene.add(plane);
      this.turfMesh = plane;
    }
  }

  private paintTexture() {
    const tex = this.turfTex;
    const T = this.state?.turf;
    if (!tex || !T) return;
    const d = tex.image.data as Uint8Array;
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.cells[i];
      // texture rows run bottom-up while cell rows run +z: flip so cell (x, z) lands where it is in the world
      const cx = i % T.w;
      const cz = Math.floor(i / T.w);
      const o = ((T.h - 1 - cz) * T.w + cx) * 4;
      const c = v === 1 ? [23, 169, 163] : v === 2 ? [107, 43, 255] : [0, 0, 0];
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = v ? 200 : 0;
    }
    tex.needsUpdate = true;
  }

  private clearVisuals() {
    for (const g of this.eyes) g.removeFromParent();
    this.eyes = [];
    this.exit?.removeFromParent();
    this.exit = null;
    for (const s of this.markers.values()) s.removeFromParent();
    this.markers.clear();
    for (const c of this.cages.values()) c.removeFromParent();
    this.cages.clear();
    this.turfMesh?.removeFromParent();
    this.turfMesh = null;
    this.turfTex = null;
  }

  // ------------------------------------------------------------ per frame

  update(dt: number, time: number) {
    const m = this.state;
    if (!m) return;
    const me = this.h.myId();
    const pl = this.h.player;
    for (const g of this.eyes) {
      g.children[0].position.y = 1.2 + Math.sin(time * 3) * 0.15;
    }
    if (this.exit) this.exit.rotation.y += dt * 1.5;
    // team markers over everyone else, cages on the tagged
    const seen = new Set<number>();
    for (const r of this.h.remotes()) {
      const t = m.teams[r.id];
      if (!t) continue;
      seen.add(r.id);
      let s = this.markers.get(r.id);
      if (!s || s.userData.team !== t) {
        s?.removeFromParent();
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(TEAM_COLOR[t], t === 'agent' ? '✕' : '●'), depthTest: false }));
        s.scale.set(0.7, 0.7, 1);
        s.renderOrder = 11;
        s.userData.team = t;
        this.h.scene.add(s);
        this.markers.set(r.id, s);
      }
      s.position.copy(r.feet).add(new THREE.Vector3(0, 2.7, 0));
    }
    for (const [id, s] of this.markers) {
      if (!seen.has(id)) {
        s.removeFromParent();
        this.markers.delete(id);
      }
    }
    const tagged = new Set(m.mode === 'rva' ? m.tagged : []);
    for (const [id, c] of this.cages) {
      if (!tagged.has(id)) {
        c.removeFromParent();
        this.cages.delete(id);
      }
    }
    for (const id of tagged) {
      const feet = id === me ? pl.feet : [...this.h.remotes()].find((r) => r.id === id)?.feet;
      if (!feet) continue;
      let c = this.cages.get(id);
      if (!c) {
        c = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.4, 10, 3, true), new THREE.MeshBasicMaterial({ color: '#ff2a4a', wireframe: true, transparent: true, opacity: 0.7 }));
        this.h.scene.add(c);
        this.cages.set(id, c);
      }
      c.position.copy(feet).add(new THREE.Vector3(0, 1.2, 0));
      c.rotation.y += dt;
    }
    if (m.phase !== 'play') return;
    // runners: grab eyes on contact
    this.eyeCd -= dt;
    if (m.mode === 'rva' && m.rva && m.teams[me] === 'runner' && !pl.frozen && this.eyeCd <= 0) {
      m.rva.eyes.forEach((e, i) => {
        if (!m.eyes[i] && pl.feet.distanceTo(new THREE.Vector3(...e)) < EYE_RANGE - 0.3) {
          this.h.send({ t: 'eye', idx: i });
          this.eyeCd = 0.4;
        }
      });
    }
    // turf: paint the cells under you
    if (m.mode === 'turf' && m.turf) {
      this.paintT -= dt;
      if (this.paintT <= 0) {
        this.paintT = 0.15;
        const T = m.turf;
        const mine = m.teams[me] === 'teal' ? 1 : 2;
        const out: number[] = [];
        const r = pl.tideT > 0 ? 2 : 1;
        const cx = Math.floor((pl.feet.x - T.x0) / T.cell);
        const cz = Math.floor((pl.feet.z - T.z0) / T.cell);
        if (pl.feet.y < 6) {
          for (let dz = -r; dz <= r; dz++)
            for (let dx = -r; dx <= r; dx++) {
              const x = cx + dx;
              const z = cz + dz;
              if (x < 0 || z < 0 || x >= T.w || z >= T.h || Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
              const i = z * T.w + x;
              if (this.cells[i] !== mine) out.push(i);
            }
        }
        if (out.length) this.h.send({ t: 'paint', cells: out });
      }
    }
  }

  /** F: agents tag the nearest runner, runners free the nearest tagged teammate. */
  interact(): boolean {
    const m = this.state;
    if (!m || m.mode !== 'rva' || m.phase !== 'play') return false;
    const me = this.h.myId();
    const t = m.teams[me];
    const pl = this.h.player;
    let best: { id: number; d: number } | null = null;
    for (const r of this.h.remotes()) {
      const rt = m.teams[r.id];
      const d = r.feet.distanceTo(pl.feet);
      const ok = t === 'agent' ? rt === 'runner' && !m.tagged.includes(r.id) && d < TAG_RANGE + 0.3 : t === 'runner' && !pl.frozen && rt === 'runner' && m.tagged.includes(r.id) && d < RESCUE_RANGE + 0.3;
      if (ok && (!best || d < best.d)) best = { id: r.id, d };
    }
    if (!best) return false;
    this.h.send(t === 'agent' ? { t: 'tag', target: best.id } : { t: 'rescue', target: best.id });
    this.h.audio('spot');
    return true;
  }

  /** Prompt line for the HUD when F does something. */
  prompt(): string | null {
    const m = this.state;
    if (!m || m.mode !== 'rva' || m.phase !== 'play') return null;
    const me = this.h.myId();
    const t = m.teams[me];
    const pl = this.h.player;
    for (const r of this.h.remotes()) {
      const rt = m.teams[r.id];
      const d = r.feet.distanceTo(pl.feet);
      if (t === 'agent' && rt === 'runner' && !m.tagged.includes(r.id) && d < TAG_RANGE + 0.3) return `F · Tag ${r.name}`;
      if (t === 'runner' && !pl.frozen && rt === 'runner' && m.tagged.includes(r.id) && d < RESCUE_RANGE + 0.3) return `F · Free ${r.name}`;
    }
    return null;
  }

  /** HUD objective panel. */
  hud(): { text: string; hint: string; progress: string; time: number } | null {
    const m = this.state;
    if (!m) return null;
    const me = this.h.myId();
    const t = m.teams[me];
    const role = t ? TEAM_NAME[t] : 'SPECTATOR';
    if (m.phase === 'end') return { text: m.winner === 'draw' ? 'DRAW' : `${String(m.winner).toUpperCase()}S WIN`, hint: 'Next round soon (host restarts)', progress: '', time: m.t };
    if (m.mode === 'rva') {
      const got = m.eyes.filter(Boolean).length;
      const runners = Object.values(m.teams).filter((x) => x === 'runner').length;
      return {
        text: `RUNNERS VS AGENTS · ${role}`,
        hint: m.exitOpen ? 'Exit portal is OPEN — Runners, escape!' : t === 'agent' ? 'Tag every Runner (F when close)' : 'Grab the Watcher Eyes',
        progress: `Eyes ${got}/${m.eyes.length} · ${runners - m.tagged.length}/${runners} Runners free`,
        time: m.t,
      };
    }
    const total = m.turf ? m.turf.w * m.turf.h : 1;
    const pct = (n: number) => Math.round(((n ?? 0) / total) * 100);
    return { text: `INK TURF · ${role}`, hint: 'Run over the plaza to paint it', progress: `Teal ${pct(m.score.teal)}% · Purple ${pct(m.score.purple)}%`, time: m.t };
  }

  /** Radar markers: agents see every runner, everyone sees the eyes and the exit. */
  mapMarkers(): Array<{ kind: 'target' | 'agent' | 'agentAlert' | 'collectible'; x: number; z: number }> {
    const m = this.state;
    if (!m) return [];
    const out: Array<{ kind: 'target' | 'agent' | 'agentAlert' | 'collectible'; x: number; z: number }> = [];
    if (m.mode === 'rva' && m.rva) {
      m.rva.eyes.forEach((e, i) => {
        if (!m.eyes[i]) out.push({ kind: 'collectible', x: e[0], z: e[2] });
      });
      if (m.exitOpen) out.push({ kind: 'target', x: m.rva.exit[0], z: m.rva.exit[2] });
      if (m.teams[this.h.myId()] === 'agent') for (const r of this.h.remotes()) if (m.teams[r.id] === 'runner') out.push({ kind: 'agentAlert', x: r.feet.x, z: r.feet.z });
    }
    return out;
  }
}
