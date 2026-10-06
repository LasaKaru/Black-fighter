import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import { Renderer } from '../render/Renderer';
import { City } from '../world/City';
import { Effects } from '../vfx/Effects';
import { AudioEngine } from '../audio/Audio';
import { CameraRig } from '../camera/CameraRig';
import { Input } from '../core/Input';
import { Settings, SettingsData } from '../core/Settings';
import type { GameContext, GameEvent } from '../core/GameContext';
import { Player, PState } from '../player/Player';
import { AgentManager, AgentTarget } from '../ai/Agents';
import { EyeOrbs } from '../world/EyeOrbs';
import { UI, ScreenName } from '../ui/UI';
import { Objectives } from './Objectives';
import { NetClient } from '../net/NetClient';
import { RemotePlayer } from '../net/RemotePlayer';
import { fromNet, toNet, Appearance } from '../character/Appearance';
import type { Hittable, HitInfo } from '../player/Combat';
import { CLIENT_SEND_HZ, FxKind, INTERP_DELAY_MS, PROTOCOL_VERSION, ServerMsg, round2 } from '../../shared/protocol';
import { PALETTE } from '../world/Materials';

type Mode = 'menu' | 'story' | 'free' | 'online';

const STEP = 1 / 60;

export class Game implements GameContext {
  physics: Physics;
  renderer: Renderer;
  city: City;
  effects: Effects;
  audio = new AudioEngine();
  cameraRig: CameraRig;
  input: Input;
  settingsStore: Settings;
  player: Player;
  agents: AgentManager;
  orbs: EyeOrbs;
  ui: UI;
  objectives = new Objectives();
  net = new NetClient();
  remotes = new Map<number, RemotePlayer>();
  mode: Mode = 'menu';
  paused = false;
  private myId = 0;
  private hostId = 0;
  private serverOffset: number | null = null;
  private sendTimer = 0;
  private acc = 0;
  private last = performance.now();
  private time = 0;
  private hitstopT = 0;
  private slowT = 0;
  private slowScale = 1;
  fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  private hadPointerLock = false;
  private lastCombat = -10;
  private prevFeet = new THREE.Vector3();
  /** Total fixed simulation steps (diagnostics). */
  simSteps = 0;

  get settings(): SettingsData {
    return this.settingsStore.data;
  }

  get multiplayer(): boolean {
    return this.mode === 'online';
  }

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.settingsStore = new Settings();
    this.renderer = new Renderer(canvas);
    this.physics = new Physics();
    this.city = new City(this.renderer.scene, this.physics);
    this.effects = new Effects(this.renderer.scene, this.physics);
    this.input = new Input(canvas);
    this.cameraRig = new CameraRig(this.renderer.camera, this.physics);
    this.player = new Player(this, this.settings.appearance, this.city.spawn, this.city.spawnYaw);
    this.agents = new AgentManager(this);
    this.agents.enabled = false;
    this.orbs = new EyeOrbs(this, this.city.eyeNests);
    // let static colliders settle into the query pipeline
    this.physics.step(STEP);

    this.ui = new UI(uiRoot, this.settingsStore, this.input, {
      play: (m) => this.start(m),
      connect: (name, room, url) => this.connect(name, room, url),
      disconnect: () => this.net.disconnect(),
      resume: () => this.resume(),
      quit: () => this.quitToMenu(),
      appearanceChanged: (a) => this.setAppearance(a),
      settingsChanged: (s) => this.applySettings(s),
      uiSound: (back) => {
        this.audio.unlock();
        this.audio.play(back ? 'uiBack' : 'ui');
      },
      screenChanged: (s) => this.onScreen(s),
      chat: (text) => this.net.send({ t: 'chat', text }),
    });

    this.wireInput(canvas);
    this.wireNet();
    this.city.destructibles.onBreak = (id, p, d) => this.broadcastFx('smash', p, new THREE.Vector3(id, d.x, d.z));
    this.objectives.onAdvance = (text, finished) => {
      this.toast(finished ? text : 'New objective: ' + text, finished ? 'power' : 'info');
      this.audio.play('catch', { vol: 0.4 });
    };
    this.applySettings(this.settings);
    this.cameraRig.menuCenter.copy(this.city.spawn);
    this.renderer.camera.position.set(4, 3, 36);
  }

  // ------------------------------------------------------------ GameContext

  playerTargets(): Iterable<Hittable> {
    const out: Hittable[] = [];
    for (const a of this.agents.agents.values()) if (a.alive) out.push(a);
    if (this.mode === 'online') for (const r of this.remotes.values()) if (r.alive) out.push(r);
    return out;
  }

  hitstop(seconds: number) {
    this.hitstopT = Math.max(this.hitstopT, seconds);
    this.lastCombat = this.time;
  }

  slowmo(scale: number, seconds: number) {
    if (!this.settings.cinematicEvents) return;
    this.slowScale = this.multiplayer ? Math.max(0.65, scale) : scale;
    this.slowT = seconds;
  }

  broadcastFx(kind: FxKind, p: THREE.Vector3, d?: THREE.Vector3) {
    if (!this.multiplayer) return;
    this.net.send({ t: 'fx', kind, p: [round2(p.x), round2(p.y), round2(p.z)], d: d ? [round2(d.x), round2(d.y), round2(d.z)] : undefined });
  }

  emit(event: GameEvent, _data?: unknown) {
    if (this.mode === 'story') this.objectives.event(event);
    if (event === 'hit' || event === 'hurt') this.lastCombat = this.time;
    if (event === 'checkpoint') this.toast('Checkpoint', 'info');
    if (event === 'ko') this.toast('Inked! Redrawing at the last checkpoint…', 'warn');
  }

  toast(text: string, kind: 'info' | 'power' | 'warn' = 'info') {
    this.ui.toast(text, kind);
  }

  // ------------------------------------------------------------ flow control

  private wireInput(canvas: HTMLCanvasElement) {
    this.input.onAction((a) => {
      if (this.mode === 'menu' || this.ui.chatOpen) return;
      if (a === 'pause') {
        if (this.paused) this.resume();
        else this.pause();
      }
      if (this.paused) return;
      if (a === 'toggleView') {
        this.settingsStore.set('firstPerson', !this.settings.firstPerson);
        this.applySettings(this.settings);
      }
      if (a === 'chat' && this.multiplayer) this.ui.openChat();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' && this.multiplayer && !this.paused) {
        e.preventDefault();
        this.ui.setPlayers([
          { name: (this.settings.name || 'You') + ' (you)', ping: this.net.ping, host: this.myId === this.hostId },
          ...[...this.remotes.values()].map((r) => ({ name: r.name, host: r.id === this.hostId })),
        ]);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') this.ui.setPlayers(null);
    });
    canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (this.mode !== 'menu' && !this.paused) this.input.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (locked) this.hadPointerLock = true;
      // Esc releases the pointer lock before the page sees the key: treat it as pause
      if (!locked && this.hadPointerLock && this.mode !== 'menu' && !this.paused && !this.ui.chatOpen) this.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode !== 'menu' && !this.paused && !this.multiplayer) this.pause();
    });
  }

  start(mode: 'story' | 'free' | 'online') {
    this.audio.unlock();
    if (mode !== 'online' && this.net.status !== 'offline') this.net.disconnect();
    this.mode = mode;
    this.paused = false;
    this.ui.inGame = true;
    this.ui.online = mode === 'online';
    this.ui.show('none');
    this.ui.showHud(true);
    this.input.enabled = true;
    this.input.clearBuffers();
    this.cameraRig.mode = this.settings.firstPerson ? 'fp' : 'tp';
    this.player.respawn(this.city.spawn);
    this.player.yaw = this.city.spawnYaw;
    this.player.checkpoint.copy(this.city.spawn);
    this.player.eyes = { fire: mode === 'free' ? 3 : 0, sky: mode === 'free' ? 2 : 0, void: mode === 'free' ? 2 : 0 };
    this.cameraRig.yaw = this.city.spawnYaw;
    this.cameraRig.pitch = -0.08;
    this.objectives.reset();
    this.orbs.reset();
    if (mode !== 'online') {
      this.agents.setAuthoritative(true);
      this.agents.clear();
    }
    this.agents.enabled = mode !== 'free';
    this.input.requestPointerLock();
    if (mode === 'story') this.toast('Ink Run: ' + this.objectives.current?.text, 'info');
    if (mode === 'free') this.toast('Free Roam — all Eye powers charged', 'power');
  }

  pause() {
    if (this.paused || this.mode === 'menu') return;
    this.paused = true;
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.hadPointerLock = false;
    this.ui.show('pause');
  }

  resume() {
    this.paused = false;
    this.ui.show('none');
    this.input.enabled = true;
    this.input.clearBuffers();
    this.input.requestPointerLock();
  }

  quitToMenu() {
    this.input.exitPointerLock();
    this.hadPointerLock = false;
    this.net.disconnect();
    this.clearRemotes();
    this.mode = 'menu';
    this.paused = false;
    this.ui.inGame = false;
    this.ui.online = false;
    this.ui.showHud(false);
    this.input.enabled = false;
    this.agents.setAuthoritative(true);
    this.agents.clear();
    this.agents.enabled = false;
    this.cameraRig.mode = 'menu';
    this.player.respawn(this.city.spawn);
    this.player.yaw = this.city.spawnYaw;
    this.audio.intensity = 0;
    this.ui.show('main');
  }

  private onScreen(s: ScreenName) {
    // menu/customize camera framing
    if (this.mode === 'menu' || this.paused) {
      if (s === 'customize') {
        // turntable close-up of the character
        this.cameraRig.mode = 'menu';
        this.cameraRig.menuCenter.copy(this.player.feet);
        this.cameraRig.menuDistance = 3.3;
        this.cameraRig.menuHeight = 1.25;
        this.cameraRig.menuLook = 1.05;
        this.cameraRig.menuShift = 1.1;
      } else if (this.mode === 'menu') {
        this.cameraRig.mode = 'menu';
        this.cameraRig.menuCenter.copy(this.player.feet);
        this.cameraRig.menuDistance = 4.6;
        this.cameraRig.menuHeight = 1.3;
        this.cameraRig.menuLook = 0.9;
        this.cameraRig.menuShift = -1.4;
      } else if (this.paused && s !== 'none') {
        this.cameraRig.mode = this.settings.firstPerson ? 'fp' : 'tp';
      }
    }
  }

  setAppearance(a: Appearance) {
    this.player.setAppearance(a);
    if (this.multiplayer) this.net.send({ t: 'look', look: toNet(a) });
  }

  applySettings(s: SettingsData) {
    this.renderer.applySettings(s);
    const r = this.cameraRig;
    r.baseFov = s.fov;
    r.fpFov = s.fpFov;
    r.sensitivity = s.sensitivity;
    r.invertY = s.invertY;
    r.shakeScale = s.cameraShake;
    r.headBob = s.headBob;
    r.cinematicEnabled = s.cinematicEvents;
    if (this.mode !== 'menu') r.mode = s.firstPerson ? 'fp' : 'tp';
    this.player.firstPerson = s.firstPerson;
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    this.effects.particleScale = s.graphics === 'low' ? 0.4 : s.graphics === 'medium' ? 0.75 : 1;
  }

  // ------------------------------------------------------------ networking

  private connect(name: string, room: string, url: string) {
    this.audio.unlock();
    const target = url.trim() || NetClient.defaultUrl();
    this.ui.setOnlineStatus(`Connecting to ${target}…`);
    this.net.connect(target, { t: 'hello', v: PROTOCOL_VERSION, name: name || 'Blank', room: room || 'plaza', look: toNet(this.settings.appearance) });
  }

  private clearRemotes() {
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
  }

  private addRemote(id: number, name: string, look: ReturnType<typeof toNet>) {
    if (this.remotes.has(id) || id === this.myId) return;
    const r = new RemotePlayer(id, name, fromNet(look), this.renderer.scene);
    r.onHit = (p, h) => this.sendHit(p.id, h);
    this.remotes.set(id, r);
  }

  private sendHit(target: number, h: HitInfo) {
    this.net.send({ t: 'hit', target, dir: [round2(h.dir.x), round2(h.dir.y), round2(h.dir.z)], power: h.damage, agent: h.kind === 'agent' });
  }

  private wireNet() {
    this.agents.onPuppetHit = (id, h) => this.net.send({ t: 'hitAgent', id, dir: [round2(h.dir.x), round2(h.dir.y), round2(h.dir.z)], power: h.damage });
    this.net.onStatus((s, info) => {
      if (s === 'error') this.ui.setOnlineStatus(info ?? 'Connection error');
      if (s === 'offline' && this.mode === 'online') {
        this.toast('Disconnected from server', 'warn');
        this.clearRemotes();
        this.mode = 'free';
        this.ui.online = false;
        this.agents.setAuthoritative(true);
        this.agents.enabled = true;
      }
      if (s === 'offline') this.ui.setOnlineStatus('Offline');
    });
    this.net.onMessage((m: ServerMsg) => {
      switch (m.t) {
        case 'welcome':
          this.myId = m.id;
          this.hostId = m.host;
          this.serverOffset = null;
          this.clearRemotes();
          for (const p of m.players) this.addRemote(p.id, p.name, p.look);
          this.ui.setOnlineStatus(`Connected to room "${m.room}" as player #${m.id}`);
          this.start('online');
          this.agents.setAuthoritative(this.myId === this.hostId);
          this.agents.enabled = true;
          this.toast(`Joined room "${m.room}" · ${m.players.length + 1} player(s)${this.myId === this.hostId ? ' · you are host' : ''}`, 'power');
          break;
        case 'join':
          this.addRemote(m.player.id, m.player.name, m.player.look);
          this.toast(`${m.player.name} joined`, 'info');
          break;
        case 'leave': {
          const r = this.remotes.get(m.id);
          if (r) {
            this.toast(`${r.name} left`, 'info');
            r.dispose();
            this.remotes.delete(m.id);
          }
          break;
        }
        case 'host':
          this.hostId = m.id;
          this.agents.setAuthoritative(this.myId === this.hostId);
          this.agents.enabled = true;
          if (this.myId === this.hostId) this.toast('You are now the host (simulating Agents)', 'info');
          break;
        case 'look':
          this.remotes.get(m.id)?.setLook(fromNet(m.look));
          break;
        case 'snap': {
          const now = performance.now();
          const off = m.ts - now;
          this.serverOffset = this.serverOffset === null ? off : Math.min(this.serverOffset + 0.5, Math.max(off, this.serverOffset - 50) * 0.1 + this.serverOffset * 0.9);
          for (const p of m.players) {
            if (p.id === this.myId) continue;
            this.remotes.get(p.id)?.push(m.ts, p.s);
          }
          if (this.myId !== this.hostId) this.agents.applyNet(m.agents);
          break;
        }
        case 'hit': {
          const dir = new THREE.Vector3(...m.dir);
          this.player.receiveHit({ dir, damage: m.power, knock: Math.min(14, 3 + m.power * 0.3), lift: Math.min(7, 1 + m.power * 0.12), kind: 'light' });
          break;
        }
        case 'hitAgent':
          this.agents.applyRemoteHit(m.id, new THREE.Vector3(...m.dir), m.power);
          break;
        case 'fx': {
          const p = new THREE.Vector3(...m.p);
          const d = m.d ? new THREE.Vector3(...m.d) : new THREE.Vector3(0, 1, 0);
          if (m.kind === 'ink') {
            this.effects.inkBurst(p, d, '#111114', 30);
            this.audio.play('ink', { vol: this.volumeAt(p) });
          } else if (m.kind === 'shock') {
            this.effects.shockwave(p, '#ffffff', 5);
            this.audio.play('shock', { vol: this.volumeAt(p) * 0.7 });
          } else if (m.kind === 'smash' && m.d) {
            this.city.destructibles.smash(Math.round(m.d[0]), p, new THREE.Vector3(m.d[1], 0, m.d[2]), false);
            this.audio.play('smash', { vol: this.volumeAt(p) });
          } else if (m.kind === 'blink') {
            this.effects.sparks3(p.clone().setY(p.y + 1), PALETTE.voidPurple, 30, 6, 0.3, 0);
          } else if (m.kind === 'dash') {
            this.effects.sparks3(p.clone().setY(p.y + 1), PALETTE.eyeFire, 20, 6, 0.3, 0);
            this.audio.play('dash', { vol: this.volumeAt(p) * 0.6 });
          }
          break;
        }
        case 'chat':
          this.ui.chatLine(m.name, m.text);
          break;
        case 'error':
          this.ui.setOnlineStatus(m.message);
          break;
        default:
          break;
      }
    });
  }

  private volumeAt(p: THREE.Vector3): number {
    return Math.max(0.05, 1 - p.distanceTo(this.player.feet) / 50);
  }

  private agentTargets(): AgentTarget[] {
    const list: AgentTarget[] = [];
    if (this.mode !== 'menu') {
      list.push({ key: this.player.key, feet: this.player.feet, hittable: this.player, canBeTargeted: this.player.state !== PState.KO });
    }
    if (this.multiplayer) {
      for (const r of this.remotes.values()) list.push({ key: r.key, feet: r.feet, hittable: r, canBeTargeted: r.alive });
    }
    return list;
  }

  private sendState(dt: number) {
    if (!this.multiplayer || this.net.status !== 'online') return;
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    this.sendTimer = 1 / CLIENT_SEND_HZ;
    const p = this.player;
    const s = p.animState();
    this.net.send({
      t: 'state',
      s: { p: [round2(p.feet.x), round2(p.feet.y), round2(p.feet.z)], v: [round2(p.vel.x), round2(p.vel.y), round2(p.vel.z)], yaw: round2(p.yaw), a: s.a, ap: round2(s.ap), hp: Math.round(p.health), fx: 0 },
    });
    if (this.myId === this.hostId) this.net.send({ t: 'agents', list: this.agents.netStates() });
  }

  // ------------------------------------------------------------ loop

  run() {
    const frame = (now: number) => {
      const realDt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(realDt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Advance one rendered frame (exposed for automated tests). */
  tick(realDt: number) {
    // fps: count real frames over half-second windows
    this.fpsFrames++;
    this.fpsTime += realDt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.time += realDt;
    this.input.update(realDt);
    const playing = this.mode !== 'menu' && !this.paused;

    // camera look (real time)
    const md = this.input.takeMouseDelta();
    if (playing && this.input.enabled) this.cameraRig.look(md.dx, md.dy, this.input.padLookX, this.input.padLookY, realDt);

    // time scale: hit-stop > slow-mo > normal
    let scale = 1;
    if (this.hitstopT > 0) {
      this.hitstopT -= realDt;
      scale = 0.03;
    } else if (this.slowT > 0) {
      this.slowT -= realDt;
      scale = this.slowScale;
    }
    if (this.paused && !this.multiplayer) scale = 0;
    this.renderer.slowmoFx += ((scale < 0.9 && this.hitstopT <= 0 ? 1 : 0) - this.renderer.slowmoFx) * Math.min(1, realDt * 8);

    // fixed-step simulation
    this.acc += realDt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.acc -= STEP;
      steps++;
      if (scale > 0) this.fixedUpdate(STEP * scale);
    }
    if (steps === 5) this.acc = 0;

    const dt = realDt * scale;
    // remote players render in the past for smooth interpolation
    if (this.multiplayer && this.serverOffset !== null) {
      const renderTime = performance.now() + this.serverOffset - INTERP_DELAY_MS;
      for (const r of this.remotes.values()) r.update(realDt, renderTime);
    }
    this.agents.render(dt);
    this.city.update(dt, this.time, this.player.center(new THREE.Vector3()));
    this.effects.update(dt, this.renderer.camera, this.time);
    if (this.mode === 'menu') {
      this.cameraRig.menuCenter.lerp(this.player.feet, 0.1);
      this.cameraRig.update(realDt, null);
    } else this.cameraRig.update(realDt, this.player.cameraTarget());
    this.renderer.speedFx = this.player.state === PState.Dash ? 1 : this.player.vel.y > 12 ? 0.8 : Math.max(0, Math.hypot(this.player.vel.x, this.player.vel.z) - 9) * 0.15;
    if (!this.settings.motionBlur) this.renderer.speedFx = 0;
    this.renderer.damageFx = Math.max(0, this.renderer.damageFx - realDt * 0.8, (1 - this.player.health / 100) * 0.45);
    this.renderer.followShadows(this.player.feet);
    this.renderer.render(realDt, this.time);

    // music intensity
    const alerted = this.agents.alertedCount;
    const fight = this.time - this.lastCombat < 4;
    this.audio.intensity = this.mode === 'menu' ? 0 : alerted >= 4 || this.player.flowTier >= 4 ? 3 : fight || this.player.flowTier >= 3 ? 2 : alerted > 0 || this.player.flowTier >= 1 ? 1 : 0;

    this.sendState(realDt);
    if (this.mode === 'story') this.objectives.update(this.player);
    if (this.mode !== 'menu') {
      const obj = this.mode === 'story' ? this.objectives.current : null;
      this.ui.updateHud({
        health: this.player.health,
        stamina: this.player.stamina,
        flow: this.player.flow,
        flowTier: this.player.flowTier,
        eyes: this.player.eyes,
        selected: this.player.selectedPower,
        objective: obj ? { text: obj.text, hint: obj.hint, progress: this.objectives.progress } : this.mode === 'online' ? { text: `Room · ${this.remotes.size + 1} player(s)`, hint: this.myId === this.hostId ? 'You are host: Agents run on your machine' : 'Co-op & PvP · Enter to chat · Tab for players', progress: '' } : null,
        fps: this.fps,
        showFps: this.settings.showFps,
        net: this.multiplayer ? `${Math.round(this.net.ping)} ms` : '',
        firstPerson: this.settings.firstPerson,
        ko: this.player.state === PState.KO,
        pointerHint: !this.paused && !this.input.pointerLocked && !this.ui.chatOpen && !this.input.padActive,
      });
    }
  }

  private fixedUpdate(dt: number) {
    this.simSteps++;
    this.prevFeet.copy(this.player.feet);
    this.player.update(dt);
    this.agents.update(dt, this.agentTargets());
    if (this.mode !== 'menu') this.orbs.update(dt, this.player);
    this.physics.step(dt);
  }
}
