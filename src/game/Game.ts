import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import { Renderer } from '../render/Renderer';
import { World } from '../world/World';
import type { City } from '../world/City';
import { Effects } from '../vfx/Effects';
import { AudioEngine } from '../audio/Audio';
import { CameraRig } from '../camera/CameraRig';
import { Director, Shot } from '../camera/Director';
import { Input } from '../core/Input';
import { Settings, SettingsData } from '../core/Settings';
import type { GameContext, GameEvent } from '../core/GameContext';
import { Player, PState } from '../player/Player';
import { Agent, AgentManager, AgentTarget } from '../ai/Agents';
import { Pedestrians } from '../ai/Pedestrians';
import { EyeOrbs } from '../world/EyeOrbs';
import { UI, ScreenName } from '../ui/UI';
import { Objectives } from './Objectives';
import { Profile, Consumable } from './Profile';
import { Pursuit } from './Pursuit';
import { Progression, TRAILS, xpToNext } from './Progression';
import { Loot } from './Loot';
import { Props } from '../world/Props';
import { Weapons } from './Weapons';
import { Takedowns } from './Takedowns';
import { Garage } from './Garage';
import { PhotoMode } from './PhotoMode';
import { Ghosts, medalFor, MEDAL_ICON, timed } from './Ghosts';
import { Social } from './Social';
import { CHAPTERS, Story, type Line, type StepKind } from './Story';
import { QuestGivers } from './QuestGivers';
import { Creator } from './Creator';
import { Hideout, LOFT_PAD, savePhotoThumb, type HideoutAction } from '../world/Hideout';
import { ACHIEVEMENTS } from './Progression';
import { isHandheld, TouchControls } from '../ui/Touch';
import { applyColorblind, colorblindFilter } from '../render/Colorblind';
import { MatchClient } from './MatchClient';
import { HUB_CENTER as HUB } from '../world/World';
import { Ambience } from '../world/Ambience';
import { CONSUMABLES } from './Profile';
import type { LootSpot, PropSpot } from '../world/islands/types';
import { InkDrops, MissionManager, MISSIONS } from './Missions';
import { dataBase, apiBase, wsUrl } from '../net/Endpoints';
import { NetClient } from '../net/NetClient';
import { RemotePlayer } from '../net/RemotePlayer';
import { fromNet, toNet, Appearance } from '../character/Appearance';
import type { Hittable, HitInfo } from '../player/Combat';
import { queryHits } from '../player/Combat';
import { CLIENT_SEND_HZ, FxKind, INTERP_DELAY_MS, PROTOCOL_VERSION, ServerMsg, round2 } from '../../shared/protocol';
import { PALETTE } from '../world/Materials';
import { VehicleManager, VEHICLE_TYPES } from '../vehicles/VehicleManager';
import { Traffic } from '../vehicles/Traffic';
import type { VehicleType } from '../vehicles/VehicleModels';
import type { ParkingSpot } from '../world/islands/types';
import { wrapAngle } from '../core/math';
import { bakeTopDown, MapImage } from '../render/MapBake';
import { Atmosphere } from '../render/Atmosphere';
import { Realism } from '../render/Realism';
import { Soundscape, type FootSurface } from '../audio/Soundscape';
import { Checkpoints } from './Checkpoints';
import { Secrets } from './Secrets';
import type { Surface } from '../physics/Physics';
import type { MapMarker } from '../ui/Minimap';
import type { ScreenMarker } from '../ui/HudFx';
import { HUB_CENTER } from '../world/World';

const COMBO_WINDOW = 2.6;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** Hand-placed hub props (the islands generate theirs). */
const HUB_PROPS: PropSpot[] = [
  { kind: 'crate', pos: V(-20, 0, 32), yaw: 0.3, variant: 3 },
  { kind: 'xbarrel', pos: V(15, 0, 26), yaw: 1.1, variant: 3 },
  { kind: 'barrel', pos: V(-36, 0, -4), yaw: 0.4, variant: 2 },
  { kind: 'glass', pos: V(30, 0, 36), yaw: 0.2 },
  { kind: 'vending', pos: V(-40.5, 0, 14), yaw: Math.PI / 2 },
  { kind: 'pad', pos: V(-29, 0, -14.6), variant: 5 },
  { kind: 'pad', pos: V(12, 0, -10), variant: 4 },
  { kind: 'boost', pos: V(0, 0, 25), yaw: Math.PI },
  { kind: 'rail', pos: V(-32, 0, 38), to: V(-8, 0, 38) },
  { kind: 'junk', pos: V(5, 0, 31), variant: 0 },
  { kind: 'junk', pos: V(6.2, 0, 31.5), variant: 0 },
  { kind: 'junk', pos: V(-4, 0, 34), variant: 1 },
  { kind: 'junk', pos: V(-24, 0, 26), variant: 2 },
  { kind: 'junk', pos: V(-23, 0, 27.2), variant: 2 },
  { kind: 'junk', pos: V(26, 0, 30), variant: 1 },
];

/** Hand-placed hub loot (the islands generate theirs). */
const HUB_LOOT: LootSpot[] = [
  { kind: 'crate', pos: new THREE.Vector3(-8, 6, -47), rarity: 1 },
  { kind: 'crate', pos: new THREE.Vector3(24.5, 16, -62), rarity: 2 },
  { kind: 'crate', pos: new THREE.Vector3(-42.5, 0, -32), rarity: 0 },
  { kind: 'sticker', pos: new THREE.Vector3(-12.46, 11, -58.5), normal: new THREE.Vector3(1, 0, 0) },
  { kind: 'sticker', pos: new THREE.Vector3(4, 2.4, -27.96), normal: new THREE.Vector3(0, 0, 1) },
  { kind: 'sticker', pos: new THREE.Vector3(10.04, 3.5, -49), normal: new THREE.Vector3(1, 0, 0) },
  { kind: 'sticker', pos: new THREE.Vector3(17.96, 12, -63), normal: new THREE.Vector3(-1, 0, 0) },
  { kind: 'tag', pos: new THREE.Vector3(28, 1.7, -7.95), normal: new THREE.Vector3(0, 0, 1) },
  { kind: 'tag', pos: new THREE.Vector3(-46.95, 1.7, 36), normal: new THREE.Vector3(1, 0, 0) },
  { kind: 'log', pos: new THREE.Vector3(8, 4, -37.5) },
];

type Mode = 'menu' | 'intro' | 'story' | 'free' | 'online';

const STEP = 1 / 60;

interface Bomb {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

const HUB_PARKING: ParkingSpot[] = [
  { pos: new THREE.Vector3(10, 0.6, 38), yaw: 0, type: 'tuktuk' },
  { pos: new THREE.Vector3(-11, 0.6, 38), yaw: 0, type: 'inkbox' },
  { pos: new THREE.Vector3(36, 0.6, 24), yaw: Math.PI / 2, type: 'buggy' },
];

export class Game implements GameContext {
  physics: Physics;
  renderer: Renderer;
  world: World;
  effects: Effects;
  audio = new AudioEngine();
  cameraRig: CameraRig;
  director: Director;
  input: Input;
  settingsStore: Settings;
  profile = new Profile();
  player: Player;
  agents: AgentManager;
  orbs: EyeOrbs;
  vehicles: VehicleManager;
  traffic: Traffic;
  peds: Pedestrians;
  missions: MissionManager;
  drops: InkDrops;
  ui: UI;
  objectives = new Objectives();
  net = new NetClient();
  remotes = new Map<number, RemotePlayer>();
  pursuit!: Pursuit;
  progress!: Progression;
  loot!: Loot;
  props!: Props;
  weapons!: Weapons;
  takedowns!: Takedowns;
  garage!: Garage;
  photo!: PhotoMode;
  ghosts!: Ghosts;
  social!: Social;
  story!: Story;
  quests!: QuestGivers;
  hideout!: Hideout;
  creator!: Creator;
  private creatorHud: { text: string; hint: string; progress: string; time?: number } | null = null;
  private dialogTimers: number[] = [];
  touch: TouchControls | null = null;
  match!: MatchClient;
  /** Set while starting a mission because a teammate did (don't echo it back). */
  private relayingMission = false;
  ambience!: Ambience;
  atmosphere!: Atmosphere;
  realism!: Realism;
  soundscape!: Soundscape;
  checkpoints!: Checkpoints;
  secrets!: Secrets;
  private calmT = 0;
  private wasBoosting = false;
  private wasHunted = false;
  private reached = new Set<string>();
  /** Distance accumulators, flushed into the progression counters every few seconds. */
  private dist = { runM: 0, glideM: 0, driveM: 0, t: 0 };
  mapImage!: MapImage;
  /** Map pin (world map click / island card). */
  waypoint: THREE.Vector3 | null = null;
  private waypointBeacon!: THREE.Mesh;
  private guide!: THREE.InstancedMesh;
  mode: Mode = 'menu';
  paused = false;
  summonType: VehicleType = 'tuktuk';
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
  private currentIsland = '';
  private bombs: Bomb[] = [];
  private bombGeo = new THREE.IcosahedronGeometry(0.22, 1);
  private bombMat = new THREE.MeshStandardMaterial({ color: '#111114', roughness: 0.1, metalness: 0.5, emissive: '#6b2bff', emissiveIntensity: 0.5 });
  /** Total fixed simulation steps (diagnostics). */
  simSteps = 0;
  /** Debug/test hook: keep simulating but skip drawing (frees the CPU for a second headless client). */
  renderPaused = false;

  get wet(): number {
    return this.atmosphere?.wet ?? 0;
  }

  get settings(): SettingsData {
    return this.settingsStore.data;
  }

  get city(): City {
    return this.world.city;
  }

  get multiplayer(): boolean {
    return this.mode === 'online';
  }

  get playing(): boolean {
    return this.mode === 'story' || this.mode === 'free' || this.mode === 'online';
  }

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.settingsStore = new Settings();
    this.renderer = new Renderer(canvas);
    this.physics = new Physics();
    this.world = new World(this.renderer.scene, this.physics);
    this.effects = new Effects(this.renderer.scene, this.physics);
    this.input = new Input(canvas);
    this.cameraRig = new CameraRig(this.renderer.camera, this.physics);
    this.cameraRig.onShake = (a) => this.input.rumble(Math.min(1, a * 1.6), 110 + Math.min(1, a) * 260);
    this.director = new Director(this.renderer.camera, this.world);
    this.player = new Player(this, this.settings.appearance, this.city.spawn, this.city.spawnYaw);
    this.agents = new AgentManager(this);
    this.agents.enabled = false;
    this.orbs = new EyeOrbs(this, this.world.eyeNests);
    this.vehicles = new VehicleManager(this.physics, this.renderer.scene, this.world.parking, HUB_PARKING);
    this.traffic = new Traffic(this.physics, this.renderer.scene, this.world.roads);
    const zones = this.world.islands.flatMap((i) => i.wander.map((w) => ({ island: i.def.id, c: w.c, r: w.r })));
    zones.push({ island: 'hub', c: new THREE.Vector3(0, 0, 20), r: 18 }, { island: 'hub', c: new THREE.Vector3(-20, 0, -8), r: 10 });
    this.peds = new Pedestrians(this.renderer.scene, this.physics, zones);
    // Cable Rush runs on whichever island generated the most zip-lines (deterministic)
    const zipIsland = [...this.world.islands].sort((a, b) => b.ziplines.length - a.ziplines.length)[0];
    const cable = MISSIONS.find((m) => m.id === 'cable_rush');
    if (cable && zipIsland) cable.island = zipIsland.def.id;
    this.missions = new MissionManager({
      world: this.world,
      profile: this.profile,
      effects: this.effects,
      audio: this.audio,
      scene: this.renderer.scene,
      playerPos: () => this.player.feet,
      inVehicle: () => this.player.vehicle !== null,
      toast: (t, k) => this.toast(t, k),
      spawnMissionAgent: (p, boss, kind) => {
        const a = this.agents.spawnAt(p, boss, kind);
        if (a.isBoss) {
          // boss intro: name card + a spoken line
          this.ui.subtitle(`${a.bossName.toUpperCase()} AWAKENS`, 3);
          this.audio.speak(`${a.bossName} awakens`, { pitch: 0.5, rate: 0.85 });
          this.cameraRig.addShake(0.4);
        }
        return a;
      },
      onHordeOver: (wave) => {
        const ink = wave * 40;
        this.profile.addInk(ink);
        this.progress.event('hordeWave', wave, { max: true });
        const best = this.profile.data.counters.hordeWave ?? wave;
        this.toast(`HORDE OVER · reached wave ${wave} · +${ink} Ink${wave >= best ? ' · NEW BEST' : ` · best wave ${best}`}`, 'power');
      },
      clearMissionAgents: () => this.agents.clearMission(),
      onComplete: () => this.progress.event('missions'),
      onStart: (def) => {
        this.ghosts.begin(def);
        if (this.mode === 'online' && !this.relayingMission) this.net.send({ t: 'mission', id: def.id, ev: 'start' });
      },
      mirror: () => this.mode === 'online' && this.myId !== this.hostId,
      flowTier: () => this.player.flowTier,
      onEnd: (def, success, time, prev) => {
        const saved = this.ghosts.finish(def, success, time, prev);
        this.audio.stinger(success ? 'victory' : 'fail');
        if (success && this.mode !== 'online') setTimeout(() => this.checkpoints.clear(`${def.name} complete`), 1800);
        if (this.mode === 'online' && !this.relayingMission && def.type !== 'horde') this.net.send({ t: 'mission', id: def.id, ev: success ? 'done' : 'fail' });
        if (!success) return '';
        if (timed(def)) this.submitScore(def.id, time);
        let line = saved ? ' · ghost saved' : '';
        const medal = medalFor(def, time);
        const before = medalFor(def, prev);
        if (medal) {
          line += ` · ${MEDAL_ICON[medal]} ${medal.toUpperCase()}`;
          const rank = { gold: 3, silver: 2, bronze: 1 };
          if (!before || rank[medal] > rank[before]) this.progress.event(medal === 'gold' ? 'golds' : 'medals');
        }
        // Flow bonus: finish while the Flow meter burns
        if (this.player.flowTier >= 3) {
          const bonus = Math.round(def.reward * 0.25);
          this.profile.addInk(bonus);
          line += ` · FLOW BONUS +${bonus}`;
        }
        return line;
      },
    });
    this.pursuit = new Pursuit({
      agents: this.agents,
      physics: this.physics,
      world: this.world,
      profile: this.profile,
      toast: (t, k) => this.toast(t, k),
      player: () => ({ feet: this.player.feet, ko: this.player.state === PState.KO, free: !this.player.vehicle && !this.player.busy }),
      onReward: (_ink, outcome) => {
        this.player.addFlow(25);
        this.audio.play('catch', { vol: 0.6 });
        if (outcome === 'won') this.progress.event('pursuitsWon');
        if (outcome === 'escaped') this.progress.event('escapes');
      },
    });
    this.progress = new Progression(this.profile, {
      toast: (t, k) => this.toast(t, k),
      pop: (t, k) => this.ui.fx.floatText(t, this.player.feet.clone().add(new THREE.Vector3(0, 2.4, 0)), k),
      sound: (n) => this.audio.play(n === 'levelup' ? 'absorb' : 'catch', { vol: 0.6, pitch: n === 'achievement' ? 1.5 : n === 'challenge' ? 1.25 : 0.9 }),
    });
    this.loot = new Loot(
      {
        scene: this.renderer.scene,
        physics: this.physics,
        effects: this.effects,
        audio: this.audio,
        world: this.world,
        profile: this.profile,
        progress: this.progress,
        toast: (t, k) => this.toast(t, k),
        pop: (t, p, k) => this.ui.fx.floatText(t, p, k),
        subtitle: (t, s) => this.ui.subtitle(t, s),
      },
      HUB_LOOT,
    );
    this.props = new Props(
      {
        scene: this.renderer.scene,
        physics: this.physics,
        effects: this.effects,
        audio: this.audio,
        explode: (p, r, d, c, hurt) => this.explode(p, r, d, c, hurt),
        dropInk: (p, n) => this.loot.dropInk(p, n),
        vend: () => {
          if (this.profile.data.ink < 25) return null;
          this.profile.addInk(-25);
          const k = (Object.keys(CONSUMABLES) as Consumable[])[Math.floor(Math.random() * 3)];
          this.profile.data.consumables[k]++;
          this.profile.save();
          return `Vending machine: ${CONSUMABLES[k].name}!`;
        },
        toast: (t, k) => this.toast(t, k),
      },
      [...HUB_PROPS, ...this.world.islands.flatMap((i) => i.props)],
    );
    this.weapons = new Weapons({
      scene: this.renderer.scene,
      physics: this.physics,
      effects: this.effects,
      audio: this.audio,
      profile: this.profile,
      player: this.player,
      camera: this.renderer.camera,
      targets: () => this.playerTargets(),
      explode: (p, r, d, c, hurt) => this.explode(p, r, d, c, hurt),
      toast: (t, k) => this.toast(t, k),
      hitstop: (t) => this.hitstop(t),
      event: (n) => this.progress.event(n),
    });
    this.garage = new Garage(
      {
        profile: this.profile,
        effects: this.effects,
        audio: this.audio,
        cameraRig: this.cameraRig,
        agents: this.agents,
        targets: () => this.playerTargets(),
        toast: (t, k) => this.toast(t, k),
        event: (n) => this.progress.event(n),
      },
      this.renderer.scene,
    );
    const syncGear = () => {
      this.player.hasWings = this.profile.owns('gear:wings');
    };
    syncGear();
    this.profile.onChange(syncGear);
    this.takedowns = new Takedowns({
      player: this.player,
      agents: this.agents,
      input: this.input,
      effects: this.effects,
      audio: this.audio,
      cameraRig: this.cameraRig,
      slowmo: (sc, t) => this.slowmo(sc, t),
      hitstop: (t) => this.hitstop(t),
      toast: (t, k) => this.toast(t, k),
      pop: (t, p) => this.ui.fx.floatText(t, p, 'kill'),
      event: (n) => this.progress.event(n),
    });
    this.atmosphere = new Atmosphere(this.renderer, this.world.mats);
    this.realism = new Realism(this.world.mats);
    this.realism.collect(this.renderer.scene);
    this.secrets = new Secrets({
      scene: this.renderer.scene,
      world: this.world,
      profile: this.profile,
      effects: this.effects,
      audio: this.audio,
      toast: (t, k) => this.toast(t, k),
      count: (c) => this.progress.event(c),
    });
    this.soundscape = new Soundscape(this.audio);
    this.registerSoundEmitters();
    this.realism.set(this.settings.artStyle, true);
    this.ambience = new Ambience(this.renderer.scene, this.effects, this.audio, this.world.islands, HUB_CENTER);
    for (const p of HUB_PROPS) if (p.kind === 'rail' && p.to) this.world.rails.push({ a: p.pos.clone().setY(p.pos.y + 0.9), b: p.to.clone().setY(p.to.y + 0.9) });
    this.drops = new InkDrops(this.renderer.scene, this.world, (n) => {
      this.profile.data.stats.drops++;
      this.profile.addInk(n);
      this.audio.play('ui', { pitch: 1.6 });
    });
    // let static colliders settle into the query pipeline
    this.physics.step(STEP);
    this.drops.settle((p) => this.physics.raycast(p.clone().setY(p.y + 30), new THREE.Vector3(0, -1, 0), 60)?.point.y ?? 0);
    const owned = VEHICLE_TYPES.filter((t) => this.profile.owns('veh:' + t));
    this.summonType = owned[0] ?? 'tuktuk';

    this.ui = new UI(
      uiRoot,
      this.settingsStore,
      this.input,
      {
        profile: this.profile,
        islands: () => this.world.islands.map((i) => ({ id: i.def.id, name: i.def.name, country: i.def.country, blurb: i.def.blurb, x: i.center.x, z: i.center.z, r: i.def.radius, biome: i.def.biome, outer: i.def.ring === 'outer' })),
        bridges: () => this.world.roads.map((r) => ({ ax: r.a.x, az: r.a.z, bx: r.b.x, bz: r.b.z })),
        player: () => ({ x: this.player.feet.x, z: this.player.feet.z, yaw: this.player.yaw }),
        missions: () => this.missions.markerPositions().map((m) => ({ def: m.def, x: m.pos.x, z: m.pos.z })),
        appearance: () => this.settings.appearance,
        summonType: () => this.summonType,
        mapImage: () => this.mapImage,
        waypoint: () => (this.waypoint ? { x: this.waypoint.x, z: this.waypoint.z } : null),
        discovered: (id) => this.profile.data.discovered.includes(id),
        completion: (id) => this.islandCompletion(id),
        progression: () => this.progress,
        collection: () => [{ id: 'hub', name: 'Ink City' }, ...this.world.islands.map((i) => ({ id: i.def.id, name: i.def.name }))].map((r) => ({ name: r.name, ...this.loot.summary(r.id) })),
      },
      {
        play: (m) => this.start(m),
        connect: (name, room, url) => this.connect(name, room, url),
        disconnect: () => this.net.disconnect(),
        resume: () => this.resume(),
        photo: () => this.enterPhoto(),
        hideout: () => {
          this.resume();
          this.hideoutAction('enter');
        },
        startMatch: (mode) => {
          if (this.mode !== 'online' || this.myId !== this.hostId) return;
          this.net.send(mode === 'rva' ? { t: 'startMatch', mode, rva: this.match.rvaSetup() } : { t: 'startMatch', mode, turf: this.match.turfSetup() });
        },
        stopMatch: () => this.net.send({ t: 'stopMatch' }),
        isHost: () => this.myId === this.hostId,
        quit: () => this.quitToMenu(),
        appearanceChanged: (a) => this.setAppearance(a),
        settingsChanged: (s) => this.applySettings(s),
        uiSound: (back) => {
          this.audio.unlock();
          this.audio.play(back ? 'uiBack' : 'ui');
        },
        screenChanged: (s) => this.onScreen(s),
        chat: (text) => this.net.send({ t: 'chat', text }),
        fastTravel: (id) => this.fastTravel(id),
        startMission: (id) => this.startMission(id),
        setSummon: (t) => (this.summonType = t),
        skipIntro: () => this.endIntro(),
        setWaypoint: (p) => this.setWaypoint(p),
        setTrail: (id) => {
          this.profile.data.trail = id;
          this.profile.save();
          this.effects.setTrailColor(TRAILS[id]?.color ?? '#ff7a1a');
        },
        listRooms: (url) => this.listRooms(url),
        openPage: (id) => this.ui.openPage(id),
        continueGame: () => this.continueGame(),
        playCampaign: () => {
          const c = this.checkpoints.last;
          this.start('story', c?.mode === 'story' ? (this.checkpoints.spot() ?? undefined) : undefined);
        },
        restartCampaign: () => {
          this.profile.data.story = { chapter: 0, step: 0 };
          if (this.profile.data.checkpoint?.mode === 'story') this.profile.data.checkpoint = null;
          this.profile.save();
        },
        restoreCheckpoint: () => this.restoreCheckpoint(),
      },
    );

    this.ghosts = new Ghosts(this.renderer.scene, this.player);
    this.hideout = new Hideout(this.renderer.scene, this.physics, this.world.mats);
    this.creator = new Creator({
      scene: this.renderer.scene,
      camera: this.renderer.camera,
      physics: this.physics,
      player: this.player,
      toast: (t, k) => this.toast(t, k),
      audio: (n) => this.audio.play(n),
      setHud: (hud) => (this.creatorHud = hud),
    });
    this.quests = new QuestGivers({
      scene: this.renderer.scene,
      profile: this.profile,
      islandSpawn: (id) => this.world.island(id)?.spawn.clone() ?? null,
      storyTalk: (npc) => this.mode === 'story' && this.story.talked(npc),
      say: (who, text, pitch) => this.playLines([{ who, text, pitch }]),
      toast: (t, k) => this.toast(t, k),
      addXp: (n) => this.progress.addXp(n),
      event: (n) => this.progress.event(n),
    });
    this.story = new Story({
      profile: this.profile,
      player: this.player,
      islandAt: (p) => this.world.islandAt(new THREE.Vector3(p.x, 0, p.z))?.def.id ?? null,
      say: (lines) => this.playLines(lines),
      toast: (t, k) => this.toast(t, k),
      guide: (step) => this.storyGuide(step),
      onChapter: (n) => {
        this.progress.event('chapters', n, { max: true });
        // the Final is done: let the outro play, then roll the credits
        if (n >= CHAPTERS.length) setTimeout(() => this.finale(), 9000);
      },
      onCheckpoint: (cleared) => this.checkpoints.clear(cleared),
      legacy: this.objectives,
    });
    this.checkpoints = new Checkpoints({
      profile: this.profile,
      player: this.player,
      mode: () => (this.playing ? this.mode : ''),
      placeName: (p) => {
        const isl = this.world.islandAt(p);
        return isl ? `${isl.def.name}, ${isl.def.country}` : 'Ink City';
      },
      nextGoal: () => (this.missions.active ? this.missions.active.def.name : this.mode === 'story' ? (this.story.current?.text ?? '') : ''),
      busy: () => !!this.missions.active || this.pursuit.active || this.player.busy,
      banner: (label, detail) => {
        this.ui.checkpointBanner(label, detail);
        this.audio.stinger('checkpoint');
      },
      celebrate: (at) => {
        this.effects.smokeRing(at.clone().add(new THREE.Vector3(0, 0.3, 0)), 3.5, 1);
        this.effects.inkBurst(at.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, 1, 0), '#ff7a1a', 28);
      },
      saving: () => this.ui.savingBlip(),
    });
    this.social = new Social({
      root: uiRoot,
      scene: this.renderer.scene,
      camera: this.renderer.camera,
      physics: this.physics,
      player: this.player,
      unlocked: (id) => this.profile.data.unlocks.includes(id),
      send: (m) => this.net.send(m),
      online: () => this.mode === 'online',
      remoteHead: (id) => {
        const r = this.remotes.get(id);
        return r ? r.feet.clone().add(new THREE.Vector3(0, 2.4, 0)) : null;
      },
      remoteName: (id) => this.remotes.get(id)?.name ?? 'Player',
      chatLine: (n, t) => this.ui.chatLine(n, t),
      speak: (t, pitch) => this.audio.speak(t, { pitch }),
      isAgentAt: (p) => [...this.agents.agents.values()].some((a) => a.alive && a.feet.distanceTo(p) < 2.5),
      audio: (n) => this.audio.play(n, { vol: 0.5 }),
    });
    this.social.onSubtitle = (t) => this.ui.subtitle(t, 3);
    // phones / tablets get on-screen controls; handhelds a bigger UI
    if (TouchControls.wanted()) {
      this.touch = new TouchControls(uiRoot, this.input);
      document.body.classList.add('touch-ui');
    }
    if (isHandheld()) {
      document.body.classList.add('deck');
      if (this.settings.uiScale === 1) this.settingsStore.set('uiScale', 1.15);
    }
    this.match = new MatchClient({
      scene: this.renderer.scene,
      player: this.player,
      myId: () => this.myId,
      isHost: () => this.myId === this.hostId,
      send: (m) => this.net.send(m),
      remotes: () => this.remotes.values(),
      teleport: (p) => {
        this.net.send({ t: 'teleport' });
        if (this.player.vehicle) this.player.exitVehicle();
        this.player.respawn(p);
      },
      toast: (t, k) => this.toast(t, k),
      audio: (n) => this.audio.play(n),
      hubPoints: () => this.world.checkpoints.filter((c) => c.distanceTo(HUB) < 95 && c.y < 30),
    });
    this.photo = new PhotoMode({
      camera: this.renderer.camera,
      canvas: this.renderer.renderer.domElement,
      root: uiRoot,
      player: this.player,
      renderNow: () => this.renderer.render(0, this.time),
      onExit: () => this.resume(),
      baseFilter: () => colorblindFilter(this.settings.colorblind),
      onSnap: (img) => {
        savePhotoThumb(img);
        this.progress.event('photos');
      },
      toast: (t, k) => this.toast(t, k),
    });
    this.wireInput(canvas);
    this.wireNet();
    this.city.destructibles.onBreak = (id, p, d) => this.broadcastFx('smash', p, new THREE.Vector3(id, d.x, d.z));
    this.objectives.onAdvance = (text, finished) => {
      this.toast(finished ? text : 'New objective: ' + text, finished ? 'power' : 'info');
      this.audio.play('catch', { vol: 0.4 });
      if (finished) this.profile.addInk(300);
    };
    this.director.onShot = (shot: Shot) => {
      if (this.mode === 'intro') this.ui.introCaption(shot.caption, !!shot.title);
      else if (shot.caption) this.ui.setAttractCaption(shot.caption);
    };
    this.director.onDone = () => this.endIntro();
    // bake the top-down map once (mini-map + world map)
    this.mapImage = bakeTopDown(this.renderer.renderer, this.renderer.scene, { minX: HUB_CENTER.x - 1250, minZ: HUB_CENTER.z - 1250, size: 2500 }, 2560, (o) => (o as THREE.Mesh).material === this.world.mats.floatRock || (o as THREE.Mesh).material === this.world.mats.cloud);
    this.ui.minimap.setImage(this.mapImage);
    this.buildWaypointVisuals();
    this.effects.setTrailColor(TRAILS[this.profile.data.trail]?.color ?? '#ff7a1a');
    this.applySettings(this.settings);
    this.cameraRig.menuCenter.copy(this.city.spawn);
    if (this.settings.playIntro) this.startIntro();
    else this.director.playAttract();
  }

  // ------------------------------------------------------------ GameContext

  playerTargets(): Iterable<Hittable> {
    const out: Hittable[] = [];
    for (const a of this.agents.agents.values()) if (a.alive) out.push(a);
    if (this.mode === 'online') for (const r of this.remotes.values()) if (r.alive && !r.vehicle) out.push(r);
    if (this.props) out.push(...this.props.targets(this.player.feet, 28));
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

  emit(event: GameEvent, data?: unknown) {
    if (event === 'respawn' && this.mode === 'online') this.net.send({ t: 'teleport' });
    if (this.mode === 'story') {
      this.objectives.event(event);
      this.story.event(event);
    }
    if (event === 'hit' || event === 'hurt') this.lastCombat = this.time;
    if (event === 'hurt' || event === 'ko') this.combo = 0;
    if (event === 'checkpoint') {
      const c = this.player.checkpoint;
      this.checkpoints.clear('Checkpoint reached', { key: `w:${Math.round(c.x)}:${Math.round(c.z)}` });
    }
    if (event === 'ko') {
      this.toast('Inked! Redrawing at the last checkpoint…', 'warn');
      this.missions.onPlayerKO();
    }
    if (event === 'defeat') {
      const agent = data as Agent;
      this.profile.data.stats.defeats++;
      this.profile.addInk(agent?.isBoss ? 200 : 10);
      if (agent) {
        this.missions.onDefeat(agent);
        this.loot.spawnDrops(agent.feet, agent.isBoss);
        this.progress.event(agent.isBoss ? 'bosses' : 'defeats');
        if (this.mode === 'free' && !this.missions.active) this.pursuit.addHeat(0.15);
        if (agent.isBoss) this.progress.event('defeats');
      }
    }
    if (event === 'smash' && this.mode === 'free') this.pursuit.addHeat(0.1);
    const counters: Partial<Record<GameEvent, string>> = { wallrun: 'wallruns', superjump: 'superjumps', smash: 'smashes', catch: 'eyes', zip: 'zips', ko: 'kos', grapple: 'grapples' };
    const ctr = counters[event];
    if (ctr) this.progress.event(ctr);
  }

  toast(text: string, kind: 'info' | 'power' | 'warn' = 'info') {
    this.ui.toast(text, kind);
  }

  // ------------------------------------------------------------ combat feedback

  /** Hits in a row (resets after COMBO_WINDOW without landing one, or when hurt). */
  combo = 0;
  private comboT = 0;
  bestCombo = 0;

  onDamage(pos: THREE.Vector3, amount: number, heavy: boolean, killed: boolean, label?: string) {
    if (label) {
      this.ui.fx.floatText(label, pos, 'heavy');
      return;
    }
    const n = Math.max(1, Math.round(amount));
    this.ui.fx.floatText(killed ? 'INKED!' : String(n), pos, killed ? 'kill' : heavy ? 'heavy' : 'normal');
    this.ui.fx.hitMarker(killed);
    this.combo++;
    this.comboT = COMBO_WINDOW;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (this.combo >= 5) this.progress.event('bestCombo', this.combo, { max: true });
    if (this.combo === 10 || this.combo === 20 || this.combo === 30) {
      const bonus = this.combo * 2;
      this.profile.addInk(bonus);
      this.ui.fx.floatText(`+${bonus} INK`, pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 'ink');
      this.audio.play('catch', { vol: 0.35, pitch: 1.4 });
      this.player.addFlow(15);
    }
  }

  upgrade(type: string): number {
    return this.profile.upgradeLevel(type);
  }

  blindAgents(seconds: number) {
    this.agents.blindTime = Math.max(this.agents.blindTime, seconds);
  }

  /** The nearest living boss within 70 m, for the HUD bar. */
  private bossHud(): { name: string; frac: number } | null {
    let best: Agent | null = null;
    let bd = 70;
    for (const a of this.agents.agents.values()) {
      if (!a.alive || !a.isBoss) continue;
      const d = a.feet.distanceTo(this.player.feet);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best ? { name: best.bossName, frac: best.hp / (best.maxHp || 420) } : null;
  }

  private updateCombo(dt: number) {
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    this.ui.fx.setCombo(this.combo, this.comboT / COMBO_WINDOW);
  }

  // ------------------------------------------------------------ flow control

  private wireInput(canvas: HTMLCanvasElement) {
    this.input.onAction((a) => {
      if (!this.playing || this.ui.chatOpen) return;
      if (a === 'pause') {
        // Start / P inside a submenu steps back to the pause menu first
        if (this.paused && this.ui.current !== 'pause' && this.ui.current !== 'none') this.ui.goBack();
        else if (this.paused) this.resume();
        else this.pause();
        return;
      }
      if (this.paused) return;
      if (a === 'toggleView') {
        this.settingsStore.set('firstPerson', !this.settings.firstPerson);
        this.applySettings(this.settings);
      }
      if (a === 'chat' && this.multiplayer) this.ui.openChat();
      if (a === 'map') this.pause('map');
      if (a === 'inventory') this.pause('inventory');
      if (a === 'grab') this.interact();
      if (a === 'mapZoom') this.ui.minimap.cycleZoom();
      if (a === 'nextWeapon') this.weapons.cycle();
      if (a === 'photo') this.enterPhoto();
      if (a === 'mark') this.social.ping();
      if (a === 'creator') {
        if (this.mode === 'free' && !this.creator.active) this.creator.toggle();
        else if (this.mode !== 'free') this.toast('Creator mode is in Free Roam', 'info');
      }
      if (a === 'emote' && !this.player.vehicle) this.social.toggleWheel();
      if (a === 'summon') this.summon();
      if (a === 'throwBomb') this.useConsumable('inkBomb');
      if (a === 'heal') this.useConsumable('healInk');
      if (a === 'smoke') this.useConsumable('smoke');
      if (a === 'emote' && this.player.vehicle) {
        const t = this.player.vehicle.type;
        this.audio.play(t === 'tuktuk' ? 'hornTuk' : t === 'moto' || t === 'board' ? 'hornMoto' : 'hornCar');
      }
    });
    window.addEventListener('keydown', (e) => {
      if (this.mode === 'intro') {
        this.endIntro();
        return;
      }
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
      if (this.playing && !this.paused) this.input.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (locked) this.hadPointerLock = true;
      if (!locked && this.hadPointerLock && this.playing && !this.paused && !this.ui.chatOpen) this.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.playing && !this.paused && !this.multiplayer) this.pause();
    });
  }

  private startIntro() {
    this.mode = 'intro';
    this.ui.show('none');
    this.ui.showIntro(true);
    this.cameraRig.mode = 'custom';
    this.director.playIntro(() => this.player.feet);
  }

  endIntro() {
    if (this.mode !== 'intro') return;
    this.audio.unlock();
    this.mode = 'menu';
    this.ui.showIntro(false);
    this.ui.show('main');
    this.director.playAttract();
  }

  start(mode: 'story' | 'free' | 'online', at?: { pos: THREE.Vector3; yaw: number }) {
    this.audio.unlock();
    if (mode !== 'online' && this.net.status !== 'offline') this.net.disconnect();
    this.director.stop();
    this.ui.showIntro(false);
    this.mode = mode;
    this.paused = false;
    this.ui.inGame = true;
    this.ui.online = mode === 'online';
    this.ui.show('none');
    this.ui.showHud(true);
    this.input.enabled = true;
    this.input.clearBuffers();
    this.cameraRig.mode = this.settings.firstPerson ? 'fp' : 'tp';
    this.player.respawn(at?.pos ?? this.city.spawn);
    this.player.yaw = at?.yaw ?? this.city.spawnYaw;
    this.player.checkpoint.copy(at?.pos ?? this.city.spawn);
    const charged = mode !== 'story';
    this.player.eyes = { fire: charged ? 3 : 0, sky: charged ? 2 : 0, void: charged ? 2 : 0, iron: charged ? 1 : 0, tide: charged ? 1 : 0, watcher: charged ? 1 : 0, storm: 0 };
    this.cameraRig.yaw = at?.yaw ?? this.city.spawnYaw;
    this.cameraRig.pitch = -0.08;
    this.objectives.reset();
    this.orbs.reset();
    this.missions.end(false, true);
    this.pursuit.reset(mode === 'free' ? 40 : 60);
    if (mode !== 'online') {
      this.agents.setAuthoritative(true);
      this.agents.clear();
    }
    this.agents.enabled = mode === 'story' || mode === 'online' || this.settings.freeRoamAgents;
    this.currentIsland = '';
    this.input.requestPointerLock();
    if (mode === 'story') this.story.begin();
    if (mode === 'free' && !at) this.toast('Free Roam — bridges lead to every island. M: map · F: drive · B: summon', 'power');
  }

  /** After the Final: credits, then the free city. */
  private finale() {
    if (!this.playing) return;
    this.pause('none' as ScreenName);
    this.ui.showHud(false);
    this.audio.stinger('victory');
    this.ui.rollCredits(() => {
      this.ui.showHud(true);
      this.resume();
      this.mode = 'free';
      this.toast('The city is yours. Free run: replay any mission from the Campaign map, find every secret.', 'power');
    });
  }

  /** Title screen → Continue: back to the last checkpoint in the mode you were playing. */
  continueGame() {
    const spot = this.checkpoints.spot();
    const c = this.checkpoints.last;
    if (!spot || !c) {
      this.start('story');
      return;
    }
    this.start(c.mode === 'story' && !this.story.finished ? 'story' : 'free', spot);
    this.toast(`Continue · ${c.detail}`, 'power');
  }

  /** Pause → Restore last checkpoint (abandons a running mission). */
  restoreCheckpoint() {
    const spot = this.checkpoints.spot();
    if (!spot) {
      this.toast('No checkpoint yet', 'warn');
      return;
    }
    if (this.missions.active) this.missions.end(false, true);
    this.resume();
    if (this.mode === 'online') this.net.send({ t: 'teleport' });
    this.player.respawn(spot.pos);
    this.player.yaw = spot.yaw;
    this.cameraRig.yaw = spot.yaw;
    this.toast(`Restored · ${this.checkpoints.last?.detail ?? ''}`, 'info');
  }

  pause(screen: ScreenName = 'pause') {
    if (!this.playing) return;
    if (this.paused) {
      this.ui.show(screen, 'pause');
      return;
    }
    this.paused = true;
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.hadPointerLock = false;
    this.ui.show(screen, 'pause');
  }

  resume() {
    this.paused = false;
    this.ui.show('none');
    this.input.enabled = true;
    this.input.clearBuffers();
    this.input.requestPointerLock();
  }

  /** Time trials: post to the server's global leaderboard (best-effort). */
  private submitScore(mission: string, time: number) {
    fetch(dataBase(this.settings.serverUrl) + '/leaderboard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mission, name: this.settings.name || 'Blank', time }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((list: Array<{ name: string; time: number }> | null) => {
        if (!list) return;
        const rank = list.findIndex((e) => e.name === (this.settings.name || 'Blank')) + 1;
        if (rank > 0 && rank <= 10) this.toast(`World leaderboard: #${rank}`, 'power');
      })
      .catch(() => {});
  }

  /** Cutscene dialogue: subtitles (and speech) one line after another. */
  playLines(lines: Line[]) {
    for (const t of this.dialogTimers) clearTimeout(t);
    this.dialogTimers = [];
    let at = 0;
    for (const l of lines) {
      const dur = 1.4 + l.text.length * 0.055;
      this.dialogTimers.push(
        window.setTimeout(() => {
          this.ui.subtitle(`${l.who.toUpperCase()}: ${l.text}`, dur);
          this.audio.speak(l.text, { pitch: l.pitch ?? 1 });
        }, at * 1000),
      );
      at += dur;
    }
  }

  /** Point the waypoint at whatever the story wants next. */
  private storyGuide(step: StepKind) {
    let p: THREE.Vector3 | null = null;
    if (step.kind === 'travel') p = this.world.island(step.island)?.spawn ?? null;
    else if (step.kind === 'mission') p = this.missions.markerPositions().find((m) => m.def.id === step.id)?.pos ?? null;
    else if (step.kind === 'talk') {
      const n = this.quests.markers().find((m) => m.label.toLowerCase().includes(step.npc === 'keeper' ? 'lighthouse' : step.npc));
      if (n) p = new THREE.Vector3(n.x, 0, n.z);
    }
    if (p) this.setWaypoint({ x: p.x, z: p.z });
  }

  /** Compile all shaders before the first frame (falls back silently). */
  async warmUp() {
    const r = this.renderer.renderer;
    try {
      const t0 = performance.now();
      await Promise.race([r.compileAsync(this.renderer.scene, this.renderer.camera), new Promise((res) => setTimeout(res, 15000))]);
      this.warmupMs = performance.now() - t0;
    } catch {
      /* older drivers: compile lazily as before */
    }
  }

  /** How long the shader warm-up took (perf diagnostics). */
  warmupMs = 0;

  /** Freeze the world and hand the camera to photo mode. */
  enterPhoto() {
    if (!this.playing || this.multiplayer) {
      if (this.multiplayer) this.toast('Photo mode is single-player only (the world keeps moving online)', 'warn');
      return;
    }
    this.paused = true;
    this.input.enabled = false;
    this.input.exitPointerLock();
    this.ui.show('none');
    this.photo.enter();
  }

  quitToMenu() {
    this.input.exitPointerLock();
    this.hadPointerLock = false;
    this.net.disconnect();
    this.clearRemotes();
    if (this.player.vehicle) this.player.exitVehicle();
    this.missions.end(false, true);
    this.pursuit.reset();
    this.mode = 'menu';
    this.paused = false;
    this.ui.inGame = false;
    this.ui.online = false;
    this.ui.showHud(false);
    this.input.enabled = false;
    this.agents.setAuthoritative(true);
    this.agents.clear();
    this.agents.enabled = false;
    this.player.respawn(this.city.spawn);
    this.player.yaw = this.city.spawnYaw;
    this.audio.intensity = 0;
    this.ui.show('main');
    this.director.playAttract();
  }

  private onScreen(s: ScreenName) {
    if (this.mode !== 'menu' && !this.paused) return;
    const turntable = s === 'customize' || s === 'characters';
    if (turntable) {
      this.director.stop();
      this.cameraRig.mode = 'menu';
      this.cameraRig.menuCenter.copy(this.player.feet);
      this.cameraRig.menuDistance = 3.3;
      this.cameraRig.menuHeight = 1.25;
      this.cameraRig.menuLook = 1.05;
      this.cameraRig.menuShift = s === 'characters' ? -1.6 : 1.1;
    } else if (this.mode === 'menu') {
      if (!this.director.mode) this.director.playAttract();
      this.cameraRig.mode = 'custom';
    } else if (this.paused) {
      this.cameraRig.mode = this.settings.firstPerson ? 'fp' : 'tp';
    }
  }

  setAppearance(a: Appearance) {
    const v = this.player.vehicle;
    if (v) this.player.exitVehicle();
    this.player.setAppearance(a);
    if (v) this.player.enterVehicle(v);
    if (this.multiplayer) this.net.send({ t: 'look', look: toNet(a) });
  }

  /** World sound sources: water surfaces, city blocks, gardens and forests. */
  private registerSoundEmitters() {
    const water = this.world.mats.water;
    const box = new THREE.Box3();
    this.renderer.scene.updateMatrixWorld(true);
    this.renderer.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.material !== water) return;
      box.setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const tall = size.y > 4;
      this.soundscape.addEmitter({ pos: c, kind: tall ? 'waterfall' : size.x * size.z < 120 ? 'fountain' : 'pool', radius: tall ? 70 : Math.max(18, Math.hypot(size.x, size.z) * 0.8) });
    });
    this.soundscape.addEmitter({ pos: new THREE.Vector3(0, 0, -15), kind: 'city', radius: 160 });
    for (const isl of this.world.islands) {
      const b = isl.def.biome;
      const r = isl.def.radius;
      if (b === 'ink' || b === 'temperate') this.soundscape.addEmitter({ pos: isl.center, kind: 'city', radius: r * 1.3 });
      if (b === 'tropical' || b === 'jungle' || b === 'garden' || b === 'highland') this.soundscape.addEmitter({ pos: isl.center, kind: 'forest', radius: r * 1.4 });
    }
  }

  /** Physics surface + island biome → footstep sound. */
  footstep(surface: Surface, speed: number, at: THREE.Vector3) {
    let f: FootSurface = 'stone';
    if (surface === 'wood') f = 'wood';
    else if (surface === 'glass') f = 'glass';
    else if (surface === 'goo') f = 'goo';
    else if (surface === 'ink') f = 'wet';
    else if (surface === 'debris') f = 'gravel';
    else if (surface === 'concrete' && at.y < 2.5) {
      const b = this.world.islandAt(at)?.def.biome;
      if (b === 'desert') f = 'sand';
      else if (b === 'tropical' || b === 'jungle' || b === 'garden' || b === 'highland') f = 'grass';
      else if (b === 'mountain') f = 'gravel';
    }
    if (f === 'stone' && this.atmosphere.rain > 0.5) f = 'wet';
    this.soundscape.footstep(f, speed);
  }

  /** Per-frame soundscape: listener, weather, shore / city / green amounts, the vehicle. */
  private updateSound(realDt: number) {
    const pl = this.player;
    const cam = this.renderer.camera.position;
    const isl = this.world.islandAt(pl.feet);
    const hubD = Math.hypot(pl.feet.x, pl.feet.z + 15);
    let shore = 1;
    if (isl) {
      const d = Math.hypot(pl.feet.x - isl.center.x, pl.feet.z - isl.center.z);
      shore = THREE.MathUtils.clamp((d - isl.def.radius * 0.7) / (isl.def.radius * 0.35), 0, 1);
    } else if (hubD < 110) shore = THREE.MathUtils.clamp((hubD - 70) / 40, 0, 1);
    const biome = isl?.def.biome;
    const urban = Math.max(hubD < 160 ? 1 - hubD / 160 : 0, biome === 'ink' || biome === 'temperate' ? 0.6 : 0);
    const green = biome === 'tropical' || biome === 'jungle' || biome === 'garden' || biome === 'highland' ? 0.85 : biome === 'desert' ? 0.05 : 0.3;
    const v = pl.vehicle;
    const speed = v ? Math.abs(v.speed) : Math.hypot(pl.vel.x, pl.vel.y, pl.vel.z);
    if (v?.boosting && !this.wasBoosting) this.audio.play('boost', { vol: 0.8 });
    this.wasBoosting = !!v?.boosting;
    // musical cues: a manhunt starts, or you stand on a high point for the first time
    if (this.pursuit.active && !this.wasHunted) this.audio.stinger('danger');
    this.wasHunted = this.pursuit.active;
    const spot = (isl?.def.id ?? 'hub') + ':' + Math.floor(pl.feet.y / 25);
    if (this.playing && pl.grounded && pl.feet.y > 40 && !v && !this.reached.has(spot)) {
      this.reached.add(spot);
      this.audio.stinger('reach');
    }
    // calm: nobody hunting you, no mission, unhurried → the score steps back for nature
    const threat = this.audio.intensity > 0 || this.missions.active || this.pursuit.active;
    this.calmT = threat || speed > 11 ? 0 : this.calmT + realDt;
    this.audio.musicDuck = !this.playing ? 1 : this.calmT > 14 ? 0.45 : 1;
    this.audio.setMenu(!this.playing);
    this.audio.update(realDt);
    this.soundscape.update(realDt, {
      listener: cam,
      yaw: this.cameraRig.yaw,
      height: Math.max(0, pl.feet.y - (isl ? 0 : -2)),
      speed,
      night: this.atmosphere.night,
      rain: this.atmosphere.rain,
      shore,
      urban,
      green,
      vehicle: v && v.driver === 'local' ? { type: v.type, speed: v.speed, topSpeed: v.spec.topSpeed || 20, throttle: v.driveInput.throttle, slip: v.slip, boosting: v.boosting } : null,
      paused: this.paused || !this.playing,
    });
  }

  applySettings(s: SettingsData) {
    this.renderer.applySettings(s);
    // accessibility
    applyColorblind(this.renderer.renderer.domElement, s.colorblind);
    this.input.toggleSprint = s.sprintToggle;
    document.body.classList.toggle('hc', s.highContrast);
    const uiEl = document.getElementById('ui');
    if (uiEl) uiEl.style.setProperty('zoom', String(s.uiScale));
    if (this.weapons) this.weapons.assist = s.aimAssist;
    if (this.social) this.social.subtitles = s.subtitles;
    this.audio.voiceOn = s.voice;
    if (this.atmosphere) this.atmosphere.setting = { time: s.timeOfDay, weather: s.weather };
    if (this.ui) {
      this.ui.minimap.rotate = s.minimapRotate;
      this.ui.minimap.el.classList.toggle('off', !s.minimap);
    }
    const r = this.cameraRig;
    r.baseFov = s.fov;
    r.fpFov = s.fpFov;
    r.sensitivity = s.sensitivity;
    r.padSensitivity = s.padSensitivity;
    r.invertY = s.invertY;
    r.invertX = s.invertX;
    r.distanceScale = s.cameraDistance;
    r.smoothing = s.cameraSmoothing;
    r.autoFollow = s.autoCamera;
    this.input.deadzone = s.deadzone;
    this.input.vibration = s.vibration;
    this.realism?.set(s.artStyle);
    r.shakeScale = s.cameraShake;
    r.headBob = s.headBob;
    r.cinematicEnabled = s.cinematicEvents;
    if (this.playing) r.mode = s.firstPerson ? 'fp' : 'tp';
    this.player.firstPerson = s.firstPerson;
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume, s.ambienceVolume, s.voiceVolume);
    this.audio.recordedOn = s.recordedMusic;
    this.effects.particleScale = s.graphics === 'low' ? 0.4 : s.graphics === 'medium' ? 0.75 : 1;
    this.peds.max = s.graphics === 'low' ? 6 : s.graphics === 'medium' ? 12 : 18;
  }

  // ------------------------------------------------------------ world actions

  /** F: exit/enter vehicle › start mission › talk to a local. */
  /** Loft pads, mirror, bed and trophies. */
  private hideoutAction(a: HideoutAction) {
    const pl = this.player;
    if (a === 'enter') {
      if (pl.vehicle) pl.exitVehicle();
      if (this.mode === 'online') this.net.send({ t: 'teleport' });
      pl.respawn(this.hideout.arrival);
      const done = this.profile.data.done;
      this.hideout.refresh(['lion_guardian', 'kukulkan', 'gladiator_king', 'warden'].map((id) => done.includes(id)), this.profile.data.achievements.length, ACHIEVEMENTS.length, this.profile.data.level);
      this.effects.smokeRing(pl.feet.clone().add(new THREE.Vector3(0, 1, 0)), 2.5, 0.9);
      this.audio.play('blink');
      this.toast("Blank's Loft · mirror = wardrobe · bed = skip time · pad = back down", 'info');
    } else if (a === 'exit') {
      if (this.mode === 'online') this.net.send({ t: 'teleport' });
      pl.respawn(LOFT_PAD.clone().add(new THREE.Vector3(0, 0.3, 2.5)));
      this.audio.play('blink');
    } else if (a === 'wardrobe') {
      this.pause('customize');
    } else if (a === 'rest') {
      const night = this.atmosphere.night > 0.5;
      this.atmosphere.setting = { ...this.atmosphere.setting, time: 'cycle' };
      this.atmosphere.tod = night ? 0.3 : 0.95;
      this.ui.subtitle(night ? 'You sleep until morning…' : 'You sleep until the neon comes on…', 3);
      pl.heal(100);
    } else if (a === 'trophies') {
      const names: Record<string, string> = { lion_guardian: 'Lion Guardian', kukulkan: 'Kukulkan', gladiator_king: 'Gladiator King', warden: 'The Warden' };
      const got = Object.keys(names).filter((id) => this.profile.data.done.includes(id)).map((id) => names[id]);
      this.toast(got.length ? `Trophies: ${got.join(' · ')}` : 'No trophies yet — beat the island bosses', 'info');
    }
  }

  private interact() {
    if (this.match.interact()) return;
    const hs = this.hideout.spotAt(this.player.feet);
    if (hs && !this.player.vehicle) {
      this.hideoutAction(hs.action);
      return;
    }
    const p = this.player;
    if (p.vehicle) {
      p.exitVehicle();
      return;
    }
    if (p.busy || p.state === PState.KO) return;
    const v = this.vehicles.nearest(p.feet, 3.4);
    if (!v && this.loot.interact(p.feet)) return;
    if (!v && this.props.interact(p.feet)) return;
    if (!v && p.tryZip()) return;
    if (v) {
      p.enterVehicle(v);
      this.toast(`${v.spec.name} · W/S drive · Space drift · Shift nitro · F exit`, 'info');
      return;
    }
    if (this.missions.nearby) {
      this.missions.start(this.missions.nearby);
      return;
    }
    if (this.quests.talk(p.feet)) return;
    const ped = this.peds.nearest(p.feet, 2.6);
    if (ped) this.peds.talk(ped, p.feet);
  }

  private summon() {
    const p = this.player;
    if (p.vehicle || p.busy) return;
    if (!this.profile.owns('veh:' + this.summonType)) this.summonType = 'tuktuk';
    const f = p.facing(new THREE.Vector3());
    const pos = p.feet.clone().addScaledVector(f, 5);
    const hit = this.physics.raycast(pos.clone().add(new THREE.Vector3(0, 6, 0)), new THREE.Vector3(0, -1, 0), 14);
    if (!hit) {
      this.toast('No room to summon here', 'warn');
      return;
    }
    pos.y = hit.point.y + 0.4;
    const car = this.vehicles.summon(this.summonType, pos, p.yaw, this.myId, this.garage.style(this.summonType).paint);
    this.garage.dress(car);
    this.effects.inkBurst(pos.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, 1, 0), '#111114', 24);
    this.audio.play('blink');
    this.toast('Vehicle drawn · F to drive', 'power');
  }

  private useConsumable(c: Consumable) {
    const p = this.player;
    if (p.busy && !p.vehicle) return;
    if (c === 'inkBomb' && p.vehicle) {
      // driving: R drops an ink oil slick instead
      if (!this.profile.use(c)) {
        this.toast('No Ink Bombs left for an oil slick', 'warn');
        return;
      }
      this.garage.dropSlick(p.vehicle);
      return;
    }
    if (!this.profile.use(c)) {
      this.toast('None left — buy more in the Inventory (I)', 'warn');
      return;
    }
    if (c === 'healInk') {
      p.heal(50);
      this.audio.play('absorb', { vol: 0.5 });
    } else if (c === 'smoke') {
      this.agents.blindTime = 6;
      for (let i = 0; i < 4; i++) this.effects.dust(p.feet.clone().add(new THREE.Vector3(0, 1, 0)), 14, '#9a9aa3', 1.6, 5);
      this.audio.play('whoosh', { pitch: 0.5 });
      this.toast('Smudged — the Agents lost you', 'power');
    } else {
      const dir = this.cameraRig.forward(new THREE.Vector3());
      const mesh = new THREE.Mesh(this.bombGeo, this.bombMat);
      mesh.position.copy(p.feet).add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(dir, 0.6);
      this.renderer.scene.add(mesh);
      this.bombs.push({ mesh, vel: dir.multiplyScalar(14).add(new THREE.Vector3(0, 6, 0)).add(p.vel.clone().multiplyScalar(0.5)), life: 2.2 });
      this.audio.play('whoosh');
    }
  }

  private explodeBomb(b: Bomb) {
    b.mesh.removeFromParent();
    this.explode(b.mesh.position.clone(), 4.5, 40, '#111114', false);
  }

  /** Ink explosion: knocks back everything hittable (and the player, if `hurtPlayer`). */
  explode(pos: THREE.Vector3, radius: number, damage: number, color: string, hurtPlayer: boolean) {
    this.effects.inkBurst(pos, new THREE.Vector3(0, 1, 0), color, 50);
    this.effects.shockwave(pos, color === '#111114' ? '#2a2a30' : color, radius);
    this.audio.play('ink');
    this.audio.play('heavyHit', { vol: 0.6 });
    this.cameraRig.addShake(0.3);
    const hits = queryHits(pos, new THREE.Vector3(0, 0, 1), radius, -1, this.playerTargets(), new Set());
    for (const t of hits) {
      const dir = t.center(new THREE.Vector3()).sub(pos).setY(0).normalize();
      t.receiveHit({ dir, damage, knock: 11, lift: 7, kind: 'shock' });
    }
    if (hurtPlayer && this.player.feet.distanceTo(pos) < radius) {
      const dir = this.player.feet.clone().sub(pos).setY(0).normalize();
      this.player.receiveHit({ dir, damage: damage * 0.5, knock: 9, lift: 6, kind: 'shock' });
    }
    const id = this.city.destructibles.findNear(pos, 2.5);
    if (id !== null) this.city.destructibles.smash(id, pos, new THREE.Vector3(0, 0, -1));
    this.broadcastFx('ink', pos);
  }

  // ------------------------------------------------------------ waypoints & discovery

  private buildWaypointVisuals() {
    this.waypointBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 90, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ff7a1a', transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.waypointBeacon.visible = false;
    this.renderer.scene.add(this.waypointBeacon);
    // flat chevrons on the ground pointing the way
    const chev = new THREE.Shape();
    chev.moveTo(0, 0.75);
    chev.lineTo(0.62, -0.32);
    chev.lineTo(0, -0.02);
    chev.lineTo(-0.62, -0.32);
    chev.closePath();
    const g = new THREE.ShapeGeometry(chev);
    g.scale(2.2, 2.2, 1);
    g.rotateX(-Math.PI / 2);
    this.guide = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: '#ff8a2a', transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }), 10);
    this.guide.frustumCulled = false;
    this.guide.count = 0;
    this.renderer.scene.add(this.guide);
  }

  setWaypoint(p: { x: number; z: number } | null) {
    if (!p) {
      this.waypoint = null;
      return;
    }
    const hit = this.physics.raycast(new THREE.Vector3(p.x, 220, p.z), new THREE.Vector3(0, -1, 0), 300);
    this.waypoint = new THREE.Vector3(p.x, hit ? hit.point.y : 0, p.z);
    this.toast('Waypoint set', 'info');
  }

  private updateWaypoint() {
    const wp = this.waypoint;
    this.waypointBeacon.visible = !!wp && this.playing;
    this.guide.count = 0;
    if (!wp || !this.playing) return;
    this.waypointBeacon.position.set(wp.x, wp.y + 45, wp.z);
    const pl = this.player.feet;
    const flat = new THREE.Vector3(wp.x - pl.x, 0, wp.z - pl.z);
    const dist = flat.length();
    if (dist < 6) {
      this.waypoint = null;
      this.toast('Waypoint reached', 'power');
      this.audio.play('ui', { pitch: 1.4 });
      return;
    }
    if (this.player.vehicle || this.player.state === PState.Glide) return;
    // chevrons every 3 m for the next 30 m, snapped to the ground, scrolling forward
    flat.normalize();
    const yaw = Math.atan2(flat.x, flat.z);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI);
    const phase = (this.time * 2) % 1;
    let n = 0;
    for (let i = 1; i <= 10; i++) {
      const d = (i + phase) * 3;
      if (d > dist - 2) break;
      const p = pl.clone().addScaledVector(flat, d);
      const hit = this.physics.raycast(p.clone().setY(pl.y + 3), new THREE.Vector3(0, -1, 0), 8);
      if (!hit) continue;
      const fade = 1 - i / 11;
      m.compose(hit.point.clone().setY(hit.point.y + 0.08), q, new THREE.Vector3(fade + 0.4, 1, fade + 0.4));
      this.guide.setMatrixAt(n++, m);
    }
    this.guide.count = n;
    this.guide.instanceMatrix.needsUpdate = true;
  }

  /** 0..1: discovered + missions done + finds on the island. */
  islandCompletion(id: string): number {
    const ms = MISSIONS.filter((m) => m.island === id);
    const finds = this.world.finds.get(id) ?? [];
    const total = 1 + ms.length + finds.length;
    const got = (this.profile.data.discovered.includes(id) ? 1 : 0) + ms.filter((m) => this.profile.data.done.includes(m.id)).length + finds.filter((f) => this.profile.data.found.includes(f)).length;
    return got / total;
  }

  fastTravel(id: string) {
    if (!this.playing) this.start('free');
    if (this.player.vehicle) this.player.exitVehicle();
    let pos: THREE.Vector3;
    if (id === 'hub') pos = this.city.spawn.clone();
    else {
      const isl = this.world.island(id);
      if (!isl) return;
      pos = isl.spawn.clone();
    }
    this.player.respawn(pos);
    this.player.checkpoint.copy(pos);
    this.effects.shockwave(pos.clone().add(new THREE.Vector3(0, 0.2, 0)), '#ffffff', 5);
    this.audio.play('blink');
    if (this.paused) this.resume();
  }

  startMission(id: string) {
    const def = MISSIONS.find((m) => m.id === id);
    if (!def) return;
    this.fastTravel(def.island);
    const startAt = def.startAnchor ? this.world.island(def.island)?.anchors[def.startAnchor]?.[0] : undefined;
    if (startAt) {
      this.player.respawn(startAt.clone().add(new THREE.Vector3(0, 0.3, 0)));
      this.player.checkpoint.copy(startAt);
      this.player.stamina = 100;
    }
    if (def.needVehicle) {
      const isl = this.world.island(def.island)!;
      const pos = isl.spawn.clone().add(new THREE.Vector3(4, 0.6, 0));
      const type: VehicleType = def.id === 'tuktuk_rush' ? 'tuktuk' : this.profile.owns('veh:blotter') ? 'blotter' : 'inkbox';
      const v = this.vehicles.summon(type, pos, 0, this.myId);
      this.player.enterVehicle(v);
    }
    this.missions.start(def);
  }

  private listRooms(url: string): Promise<Array<{ name: string; players: number }>> {
    return fetch(apiBase(url) + '/rooms').then((r) => (r.ok ? r.json() : []));
  }

  // ------------------------------------------------------------ networking

  private connect(name: string, room: string, url: string) {
    this.audio.unlock();
    const target = wsUrl(url);
    this.ui.setOnlineStatus(`Connecting to ${target}…`);
    this.net.connect(target, { t: 'hello', v: PROTOCOL_VERSION, name: name || 'Blank', room: room || 'plaza', look: toNet(this.settings.appearance), pass: this.settings.roomPass || undefined });
  }

  private clearRemotes() {
    for (const r of this.remotes.values()) {
      this.releaseRemoteVehicle(r);
      r.dispose();
    }
    this.remotes.clear();
  }

  private releaseRemoteVehicle(r: RemotePlayer) {
    const v = r.vehicle;
    if (!v) return;
    r.setVehicle(null);
    v.driver = 'none';
    v.setKinematic(false);
  }

  private addRemote(id: number, name: string, look: ReturnType<typeof toNet>) {
    if (this.remotes.has(id) || id === this.myId) return;
    const r = new RemotePlayer(id, name, fromNet(look), this.renderer.scene);
    r.onHit = (p, h) => this.sendHit(p.id, h);
    this.remotes.set(id, r);
  }

  private sendHit(target: number, h: HitInfo) {
    // Runners vs Agents: an Agent's punch on a Runner is a tag (the server checks range)
    if (this.match.state?.mode === 'rva' && this.match.team() === 'agent' && this.match.team(target) === 'runner') this.net.send({ t: 'tag', target });
    this.net.send({ t: 'hit', target, dir: [round2(h.dir.x), round2(h.dir.y), round2(h.dir.z)], power: h.damage, agent: h.kind === 'agent' });
  }

  private wireNet() {
    this.agents.onPuppetHit = (id, h) => this.net.send({ t: 'hitAgent', id, dir: [round2(h.dir.x), round2(h.dir.y), round2(h.dir.z)], power: h.damage });
    this.net.onStatus((s, info) => {
      if (s === 'error') this.ui.setOnlineStatus(info ?? 'Connection error');
      if (s === 'offline' && this.mode === 'online') {
        this.toast('Disconnected from server', 'warn');
        this.clearRemotes();
        if (this.match.active) this.match.onMatch({ mode: null, phase: 'play', t: 0, teams: {}, tagged: [], eyes: [], exitOpen: false, score: {}, winner: null, round: 0 });
        this.mode = 'free';
        this.ui.online = false;
        this.agents.setAuthoritative(true);
        this.agents.enabled = this.settings.freeRoamAgents;
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
            this.releaseRemoteVehicle(r);
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
            const r = this.remotes.get(p.id);
            if (!r) continue;
            r.push(m.ts, p.s);
            this.applyRemoteVehicle(r, p.s.veh);
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
        case 'match':
          this.match.onMatch(m.m);
          break;
        case 'turf':
          this.match.onTurf(m.d, m.full);
          break;
        case 'mark':
          this.social.addMark(new THREE.Vector3(...m.p), m.kind, this.remotes.get(m.from)?.name ?? 'Player');
          break;
        case 'voice':
          this.social.heard(m.from, m.id);
          break;
        case 'correct':
          // movement authority: the server rejected our last move
          if (!this.player.vehicle) this.player.respawn(new THREE.Vector3(...m.p));
          break;
        case 'mission': {
          const def = MISSIONS.find((d) => d.id === m.id);
          if (!def) break;
          if (m.ev === 'start' && !this.missions.active) {
            this.toast(`${m.name} started ${def.name} — co-op, joining in!`, 'power');
            this.relayingMission = true;
            this.startMission(def.id);
            this.relayingMission = false;
          } else if (this.missions.active?.def.id === def.id && m.ev !== 'start') {
            this.relayingMission = true;
            this.missions.end(m.ev === 'done');
            this.relayingMission = false;
          }
          break;
        }
        case 'error':
          this.ui.setOnlineStatus(m.message);
          this.toast(m.message, 'warn');
          break;
        default:
          break;
      }
    });
  }

  private applyRemoteVehicle(r: RemotePlayer, veh: number[] | undefined) {
    if (!veh) {
      this.releaseRemoteVehicle(r);
      return;
    }
    const [ti, id, x, y, z, qx, qy, qz, qw, steer, speed] = veh;
    const type = VEHICLE_TYPES[ti] ?? 'tuktuk';
    const pos = new THREE.Vector3(x, y, z);
    const v = this.vehicles.ensure(id, type, pos, 0);
    if (v === this.player.vehicle) return; // we got there first
    if (r.vehicle !== v) {
      this.releaseRemoteVehicle(r);
      v.driver = 'remote';
      v.setKinematic(true);
      v.reset(pos, 0);
      r.setVehicle(v);
    }
    v.netPos.copy(pos);
    v.netQuat.set(qx, qy, qz, qw);
    v.netSteer = steer;
    v.netSpeed = speed;
  }

  private volumeAt(p: THREE.Vector3): number {
    return Math.max(0.05, 1 - p.distanceTo(this.player.feet) / 50);
  }

  private agentTargets(): AgentTarget[] {
    const list: AgentTarget[] = [];
    if (this.playing) {
      list.push({ key: this.player.key, feet: this.player.feet, hittable: this.player, vel: this.player.vel, canBeTargeted: this.player.state !== PState.KO && !this.player.vehicle });
    }
    if (this.multiplayer) {
      for (const r of this.remotes.values()) list.push({ key: r.key, feet: r.feet, hittable: r, canBeTargeted: r.alive && !r.vehicle });
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
    let veh: number[] | undefined;
    if (p.vehicle) {
      const v = p.vehicle;
      const t = v.body.translation();
      const q = v.body.rotation();
      const ti = Math.max(0, VEHICLE_TYPES.indexOf(v.type));
      veh = [ti, v.id, round2(t.x), round2(t.y), round2(t.z), round2(q.x), round2(q.y), round2(q.z), round2(q.w), round2(this.input.moveVector().x * -v.spec.maxSteer), round2(v.speed)];
    }
    this.net.send({
      t: 'state',
      s: { p: [round2(p.feet.x), round2(p.feet.y), round2(p.feet.z)], v: [round2(p.vel.x), round2(p.vel.y), round2(p.vel.z)], yaw: round2(p.yaw), a: s.a, ap: round2(s.ap), hp: Math.round(p.health), fx: 0, veh },
    });
    if (this.myId === this.hostId) this.net.send({ t: 'agents', list: this.agents.netStates() });
  }

  // ------------------------------------------------------------ loop

  run() {
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      // frame-rate limit: skip display refreshes until the next frame is due
      const cap = this.settings.fpsCap;
      if (cap > 0 && now - this.last < 1000 / cap - 1.5) return;
      const realDt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.tick(realDt);
    };
    requestAnimationFrame(frame);
  }

  /** Advance one rendered frame (exposed for automated tests). */
  tick(realDt: number) {
    this.fpsFrames++;
    this.fpsTime += realDt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (this.playing && !this.paused) this.renderer.adaptResolution(this.fps, this.settings.fpsCap || 60);
    }
    this.time += realDt;
    this.input.update(realDt);
    this.ui.nav.update(realDt);
    const playing = this.playing && !this.paused;

    const md = this.input.takeMouseDelta();
    if (playing && this.input.enabled) this.cameraRig.look(md.dx, md.dy, this.input.padLookX, this.input.padLookY, realDt);

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

    // power side effects that live outside the player
    const pl = this.player;
    this.agents.revealed = pl.watcherT > 0;
    this.agents.slowZones.length = 0;
    if (pl.tideT > 0) this.agents.slowZones.push({ c: pl.feet, r: 12, f: this.upgrade('tide') >= 2 ? 0.28 : 0.5 });
    if (pl.stormT > 0) this.agents.slowZones.push({ c: pl.feet, r: 16, f: 0.45 });

    this.acc += realDt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.acc -= STEP;
      steps++;
      if (scale > 0) this.fixedUpdate(STEP * scale);
    }
    if (steps === 5) this.acc = 0;

    const dt = realDt * scale;
    if (this.multiplayer && this.serverOffset !== null) {
      const renderTime = performance.now() + this.serverOffset - INTERP_DELAY_MS;
      for (const r of this.remotes.values()) r.update(realDt, renderTime);
    }
    const cam = this.renderer.camera;
    const focus = this.playing ? pl.feet : this.director.mode ? this.director.focus() : pl.feet;
    this.agents.render(dt);
    this.vehicles.sync(dt, cam.position);
    this.traffic.update(dt, [pl.feet, ...[...this.remotes.values()].map((r) => r.feet)], cam.position);
    const threats = [...this.agents.agents.values()].filter((a) => a.alerted).map((a) => a.feet);
    this.peds.update(dt, focus, threats);
    this.world.update(dt, this.time, pl.center(new THREE.Vector3()));
    this.world.cull(this.renderer.camera.position, (this.renderer.scene.fog as THREE.Fog | null)?.far ?? 800);
    this.effects.update(dt, cam, this.time);
    if (this.playing) this.missions.update(dt);
    this.ghosts.update(dt);
    this.match.update(realDt, this.time);
    this.social.update(realDt, window.innerWidth, window.innerHeight);
    this.drops.update(dt, this.playing ? pl.feet : new THREE.Vector3(0, -999, 0));
    this.updateBombs(dt);
    this.updateWaypoint();
    this.updateCombo(dt);
    this.loot.update(dt, this.playing ? pl.feet : new THREE.Vector3(0, -999, 0), pl.watcherT > 0);
    this.props.update(dt, this.playing ? pl : null);
    this.ambience.update(dt, focus, Math.hypot(pl.vel.x, pl.vel.z));
    this.realism.update(realDt);
    this.atmosphere.realism = this.renderer.realism = this.realism.amount;
    this.atmosphere.update(dt, this.renderer.camera);
    this.updateSound(realDt);
    if (this.playing && !this.paused) {
      this.checkpoints.update(realDt);
      this.secrets.update(realDt, this.player.feet);
    }
    this.garage.frame(this.player.vehicle);
    this.ambience.wind = 1 + this.atmosphere.rain * 1.5;
    this.ui.fx.update(dt, this.renderer.camera, window.innerWidth, window.innerHeight);

    // camera
    if (this.photo.active) {
      this.photo.update(realDt);
    } else if (this.mode === 'intro' || (this.mode === 'menu' && this.director.mode)) {
      this.director.update(realDt);
    } else if (!this.playing) {
      this.cameraRig.menuCenter.lerp(pl.feet, 0.1);
      this.cameraRig.update(realDt, null);
    } else {
      const t = pl.cameraTarget();
      if (pl.vehicle) {
        t.feet = pl.vehicle.group.position.clone().setY(pl.vehicle.group.position.y - 0.4);
        t.vel = pl.vehicle.velocity;
      }
      this.cameraRig.vehicleDist = pl.vehicle ? pl.vehicle.spec.camDist : 0;
      this.cameraRig.update(realDt, t);
    }
    const hs = pl.vehicle ? Math.abs(pl.vehicle.speed) : Math.hypot(pl.vel.x, pl.vel.z);
    this.renderer.speedFx = pl.state === PState.Dash ? 1 : pl.vel.y > 12 ? 0.8 : Math.max(0, hs - (pl.vehicle ? 22 : 9)) * 0.12;
    if (!this.settings.motionBlur || !this.playing) this.renderer.speedFx = 0;
    this.renderer.damageFx = Math.max(0, this.renderer.damageFx - realDt * 0.8, (1 - pl.health / 100) * 0.45);
    this.renderer.followShadows(this.playing ? pl.feet : this.director.mode ? this.director.focus() : pl.feet);
    if (!this.renderPaused) this.renderer.render(realDt, this.time);

    const alerted = this.agents.alertedCount;
    const fight = this.time - this.lastCombat < 4;
    // soundtrack theme from what's happening
    const bossNear = this.bossHud() !== null;
    this.audio.theme = bossNear ? 'boss' : this.pursuit.active || alerted >= 3 || this.match.state?.mode === 'rva' ? 'chase' : this.atmosphere.night > 0.6 ? 'night' : 'city';
    this.audio.intensity = !this.playing ? (this.mode === 'intro' ? 2 : 0) : alerted >= 4 || pl.flowTier >= 4 || pl.stormT > 0 ? 3 : fight || pl.flowTier >= 3 || this.missions.active ? 2 : alerted > 0 || pl.flowTier >= 1 || pl.vehicle ? 1 : 0;

    this.sendState(realDt);
    if (this.mode === 'story') {
      this.objectives.update(pl);
      this.story.update();
    }
    this.quests.update(dt, pl.feet);
    this.hideout.update(this.time);
    if (this.playing) this.creator.update(dt);
    if (this.playing) {
      this.updateIslandBanner();
      this.updateHud();
    }
  }

  private updateIslandBanner() {
    const isl = this.world.islandAt(this.player.feet);
    const id = isl ? isl.def.id : Math.hypot(this.player.feet.x, this.player.feet.z + 15) < 70 ? 'hub' : '';
    if (id && id !== this.currentIsland) {
      if (isl && this.profile.discover(isl.def.id)) {
        this.toast(`Discovered ${isl.def.name}! It is now on your map for fast travel.`, 'power');
        this.progress.event('islands');
        this.audio.stinger('discover');
        this.checkpoints.clear(`Reached ${isl.def.name}`, { key: 'isl:' + isl.def.id });
      }
      if (isl) this.ui.islandBanner(isl.def.name, `${isl.def.country} · ${isl.def.blurb}`);
      else this.ui.islandBanner('Ink City', 'The plaza · the city is watching');
    }
    if (id) this.currentIsland = id;
  }

  private updateHud() {
    const pl = this.player;
    const mission = this.missions.hud();
    const story = this.mode === 'story' && !mission ? this.story.hud() : null;
    let objective: { text: string; hint?: string; progress: string; time?: number } | null = null;
    const mh = this.match.hud() ?? this.creatorHud;
    if (mh) objective = mh;
    else if (mission) objective = { text: mission.name, hint: mission.objective, progress: 'MISSION ' + mission.progress, time: mission.time };
    else if (story) objective = { text: story.text, hint: story.hint, progress: story.progress };
    else if (this.pursuit.active) objective = this.pursuit.hud();
    else if (this.mode === 'online') objective = { text: `Room · ${this.remotes.size + 1} player(s)`, hint: this.myId === this.hostId ? 'You are host: Agents run on your machine' : 'Co-op & PvP · Enter to chat · Tab for players', progress: '' };
    // interact prompt
    let prompt: string | null = null;
    if (!pl.vehicle && !pl.busy) {
      const v = this.vehicles.nearest(pl.feet, 3.4);
      if (v) prompt = `F · Drive ${v.spec.name}`;
      else if (this.missions.nearby) prompt = `F · Start mission: ${this.missions.nearby.name}`;
      else if (this.loot.prompt(pl.feet)) prompt = this.loot.prompt(pl.feet);
      else if (this.props.prompt(pl.feet)) prompt = this.props.prompt(pl.feet);
      else if (this.hideout.spotAt(pl.feet)) prompt = this.hideout.spotAt(pl.feet)!.label;
      else if (this.quests.prompt(pl.feet)) prompt = this.quests.prompt(pl.feet);
      else if (this.peds.nearest(pl.feet, 2.6)) prompt = 'F · Talk';
      else if (pl.zipNearby()) prompt = 'F · Grab zip-line';
      else if (pl.state === PState.Air && pl.vel.y < 2 && pl.feet.y > 4) prompt = 'Space · Glide';
    }
    if (this.takedowns.prompt) prompt = this.takedowns.prompt;
    const mp = this.match.prompt();
    if (mp) prompt = mp;
    if (pl.state === PState.Glide) prompt = 'Hold Space glide · Shift boost · C dive';
    if (pl.state === PState.Zip) prompt = 'Space · Jump off';
    // compass towards the mission target, relative to the camera
    let compass: { angle: number; dist: number } | null = null;
    const target = mission?.target ?? (this.pursuit.active ? this.pursuit.target(pl.feet) : null) ?? this.waypoint;
    if (target) {
      const dx = target.x - pl.feet.x;
      const dz = target.z - pl.feet.z;
      const cy = this.cameraRig.yaw;
      const x = dx * -Math.cos(cy) + dz * Math.sin(cy);
      const y = dx * Math.sin(cy) + dz * Math.cos(cy);
      compass = { angle: wrapAngle(Math.atan2(x, y)), dist: Math.hypot(dx, dz, target.y - pl.feet.y) };
    }
    this.ui.updateHud({
      health: pl.health,
      stamina: pl.stamina,
      flow: pl.flow,
      flowTier: pl.flowTier,
      eyes: pl.eyes,
      selected: pl.selectedPower,
      buffs: { tide: pl.tideT, watcher: pl.watcherT, storm: pl.stormT },
      objective,
      fps: this.fps,
      showFps: this.settings.showFps,
      net: this.multiplayer ? `${Math.round(this.net.ping)} ms` : '',
      firstPerson: this.settings.firstPerson,
      ko: pl.state === PState.KO,
      pointerHint: !this.paused && !this.input.pointerLocked && !this.ui.chatOpen && !this.input.padActive,
      ink: this.profile.data.ink,
      consumables: this.profile.data.consumables,
      weapon: this.weapons.hud(),
      boss: this.bossHud(),
      wanted: this.mode === 'free' ? this.pursuit.stars : 0,
      grappleAim: this.player.canGrappleAim(),
      pad: this.input.padActive,
      prompt,
      vehicle: pl.vehicle ? { speed: pl.vehicle.speed, nitro: pl.vehicle.nitro, name: pl.vehicle.spec.name } : null,
      compass,
      level: this.profile.data.level,
      xpFrac: this.profile.data.xp / xpToNext(this.profile.data.level),
    });
    if (this.settings.minimap) this.ui.minimap.draw(this.time, { x: pl.feet.x, z: pl.feet.z, yaw: pl.yaw, camYaw: this.cameraRig.yaw }, this.mapMarkers());
    this.ui.fx.setMarkers(this.settings.objectiveMarkers ? this.screenMarkers() : [], this.renderer.camera, window.innerWidth, window.innerHeight);
  }

  /** On-screen markers: the active target, the waypoint, nearby mission starts, bosses. */
  private screenMarkers(): ScreenMarker[] {
    const out: ScreenMarker[] = [];
    const head = this.player.feet;
    const add = (pos: THREE.Vector3, kind: ScreenMarker['kind'], label?: string) => out.push({ pos, kind, label, dist: pos.distanceTo(head) });
    const mh = this.missions.hud();
    if (mh?.target) add(mh.target.clone().add(new THREE.Vector3(0, 2.2, 0)), 'target', mh.name);
    if (this.waypoint) add(this.waypoint.clone().add(new THREE.Vector3(0, 3, 0)), 'waypoint', 'Waypoint');
    if (!this.missions.active) {
      for (const m of this.missions.markerPositions()) {
        const d = m.pos.distanceTo(head);
        if (d < 120 && d > 4 && !this.profile.data.done.includes(m.def.id)) add(m.pos.clone().add(new THREE.Vector3(0, 4.2, 0)), 'mission', m.def.name);
      }
    }
    for (const a of this.agents.agents.values()) if (a.alive && a.isBoss) add(a.center(new THREE.Vector3()).add(new THREE.Vector3(0, 3.5, 0)), 'boss', 'BOSS');
    for (const m of this.social.marks) add(m.sprite.position.clone(), m.kind === 'danger' ? 'boss' : 'waypoint', m.label);
    return out.slice(0, 8);
  }

  /** Everything the maps show, gathered once per frame. */
  mapMarkers(): MapMarker[] {
    const out: MapMarker[] = [];
    const pl = this.player.feet;
    const near = (x: number, z: number, r: number) => Math.abs(x - pl.x) < r && Math.abs(z - pl.z) < r;
    const done = this.profile.data.done;
    for (const m of this.missions.markerPositions()) out.push({ kind: done.includes(m.def.id) ? 'missionDone' : 'mission', x: m.pos.x, z: m.pos.z, label: m.def.name });
    for (const mm of this.match.mapMarkers()) out.push(mm);
    for (const q of this.quests.markers()) out.push({ kind: 'quest', x: q.x, z: q.z, label: q.label });
    for (const m of this.social.marks) out.push({ kind: m.kind === 'danger' ? 'agentAlert' : 'waypoint', x: m.sprite.position.x, z: m.sprite.position.z });
    const mt = this.missions.hud()?.target;
    if (mt) out.push({ kind: 'target', x: mt.x, z: mt.z, y: mt.y });
    if (this.waypoint) out.push({ kind: 'waypoint', x: this.waypoint.x, z: this.waypoint.z, y: this.waypoint.y });
    for (const n of this.orbs.mapMarkers()) if (near(n.x, n.z, 260)) out.push({ kind: 'nest', x: n.x, z: n.z, y: n.y, color: n.color });
    for (const v of this.vehicles.vehicles.values()) {
      if (v === this.player.vehicle) continue;
      const p = v.group.position;
      if (near(p.x, p.z, 260)) out.push({ kind: 'vehicle', x: p.x, z: p.z });
    }
    for (const a of this.agents.agents.values()) {
      if (!a.alive || !near(a.feet.x, a.feet.z, 260)) continue;
      out.push({ kind: a.isBoss ? 'boss' : a.alerted ? 'agentAlert' : 'agent', x: a.feet.x, z: a.feet.z });
    }
    out.push(...this.loot.mapMarkers(pl, this.player.watcherT > 0));
    for (const r of this.remotes.values()) out.push({ kind: 'player', x: r.feet.x, z: r.feet.z, yaw: r.yaw, color: '#17a9a3', label: r.name });
    return out;
  }

  private updateBombs(dt: number) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.life -= dt;
      b.vel.y -= 22 * dt;
      const step = b.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const hit = len > 0 ? this.physics.raycast(b.mesh.position, step.clone().divideScalar(len), len + 0.25, true) : null;
      b.mesh.position.add(step);
      b.mesh.rotation.x += dt * 10;
      if (Math.random() < 0.5) this.effects.sparks3(b.mesh.position, PALETTE.voidPurple, 1, 1, 0.2, 0);
      const nearAgent = [...this.agents.agents.values()].some((a) => a.alive && a.center(new THREE.Vector3()).distanceTo(b.mesh.position) < 1.2);
      if (hit || b.life <= 0 || nearAgent) {
        this.explodeBomb(b);
        this.bombs.splice(i, 1);
      }
    }
  }

  private fixedUpdate(dt: number) {
    this.simSteps++;
    const pl = this.player;
    // movers first: riders then add exactly this step's platform movement
    this.world.fixedUpdate(dt);
    if (this.playing && !this.paused) this.takedowns.update(dt);
    if (this.pursuit.stars > (this.profile.data.counters.maxWanted ?? 0)) this.progress.event('maxWanted', this.pursuit.stars, { max: true });
    pl.update(dt);
    if (this.playing && !this.paused) this.weapons.update(dt, this.input.down('weapon'), this.input.consume('weapon'));
    this.agents.update(dt, this.agentTargets());
    this.pursuit.update(dt, this.playing && (this.mode === 'free' || (this.mode === 'online' && this.agents.authoritative)) && this.agents.enabled && !this.missions.active);
    if (this.playing) this.orbs.update(dt, pl);
    this.vehicles.fixedUpdate(dt, pl.feet);
    this.garage.fixedUpdate(dt, pl.vehicle);
    // vehicles knock Agents flying
    const v = pl.vehicle;
    if (v && Math.abs(v.speed) > 6) {
      const sgn = Math.sign(v.speed);
      const front = v.position.addScaledVector(v.forward(), v.spec.half[2] * sgn);
      for (const a of this.agents.agents.values()) {
        if (!a.alive || a.center(new THREE.Vector3()).distanceTo(front) > 2.4) continue;
        const dir = v.forward().multiplyScalar(sgn);
        a.receiveHit({ dir, damage: Math.abs(v.speed) * 2.5, knock: Math.abs(v.speed) * 0.9, lift: 6, kind: 'dash' });
        this.audio.play('heavyHit');
        this.cameraRig.addShake(0.2);
      }
    }
    this.physics.step(dt);
    this.profile.data.stats.distance += Math.hypot(pl.vel.x, pl.vel.z) * dt;
    if (this.playing) {
      const hs = Math.hypot(pl.vel.x, pl.vel.z) * dt;
      if (pl.vehicle) this.dist.driveM += Math.abs(pl.vehicle.speed) * dt;
      else if (pl.state === PState.Glide) this.dist.glideM += hs;
      else if (pl.grounded) this.dist.runM += hs;
      this.dist.t += dt;
      if (this.dist.t > 3) {
        for (const k of ['runM', 'glideM', 'driveM'] as const) {
          if (this.dist[k] > 0.5) this.progress.event(k, Math.round(this.dist[k]));
          this.dist[k] = 0;
        }
        this.dist.t = 0;
      }
    }
  }
}
