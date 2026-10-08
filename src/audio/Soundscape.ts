import * as THREE from 'three';
import type { AudioEngine } from './Audio';
import type { VehicleType } from '../vehicles/VehicleModels';

/**
 * The living soundscape (all synthesised, no audio files):
 *
 * - Nature: songbirds, pigeons and seagulls by day; crickets, frogs and owls
 *   at night; leaves and wind gusts that grow with height and speed.
 * - Weather: rain hiss with drips, thunder rumbles in storms.
 * - Water: waves near the shore, waterfalls and fountains as positioned
 *   emitters, lapping near pools.
 * - City: a distant traffic hum near dense districts.
 * - Footsteps per surface (stone, grass, sand, wood, metal, glass, wet ink,
 *   goo, gravel), softer when walking, heavier with a scuff when running.
 * - Vehicles: an engine per type that follows RPM through the gears, turbine
 *   whine for hover craft, tyre squeal while drifting.
 */

export type FootSurface = 'stone' | 'grass' | 'sand' | 'wood' | 'metal' | 'glass' | 'wet' | 'goo' | 'gravel';

export type EmitterKind = 'waterfall' | 'fountain' | 'pool' | 'city' | 'forest';

export interface Emitter {
  pos: THREE.Vector3;
  kind: EmitterKind;
  /** Audible radius in metres. */
  radius: number;
}

export interface SoundState {
  listener: THREE.Vector3;
  /** Camera yaw (for stereo panning). */
  yaw: number;
  /** Player height above the ground below (for wind). */
  height: number;
  speed: number;
  /** 0 day .. 1 night */
  night: number;
  rain: number;
  /** 0..1 how close to open water / the island edge. */
  shore: number;
  /** 0..1 dense city around the player. */
  urban: number;
  /** 0..1 trees and gardens around the player. */
  green: number;
  vehicle: { type: VehicleType; speed: number; topSpeed: number; throttle: number; slip: number; boosting: boolean } | null;
  /** In a menu / paused: nature keeps playing softly, engines stop. */
  paused: boolean;
}

interface EngineProfile {
  base: number;
  range: number;
  gears: number;
  wave: OscillatorType;
  cutoff: number;
  /** Hover / jet craft: turbine instead of pistons. */
  turbine?: boolean;
  /** Two-stroke rattle (tuk-tuk, scooter). */
  rattle?: number;
}

const ENGINES: Partial<Record<VehicleType, EngineProfile>> & { default: EngineProfile } = {
  default: { base: 42, range: 95, gears: 4, wave: 'sawtooth', cutoff: 900 },
  tuktuk: { base: 58, range: 120, gears: 3, wave: 'square', cutoff: 1300, rattle: 0.5 },
  inkbox: { base: 40, range: 90, gears: 4, wave: 'sawtooth', cutoff: 850 },
  blotter: { base: 46, range: 150, gears: 5, wave: 'sawtooth', cutoff: 1400 },
  buggy: { base: 36, range: 100, gears: 4, wave: 'sawtooth', cutoff: 1000, rattle: 0.2 },
  moto: { base: 70, range: 190, gears: 5, wave: 'sawtooth', cutoff: 1800, rattle: 0.25 },
  board: { base: 220, range: 420, gears: 1, wave: 'sine', cutoff: 3000, turbine: true },
  skiff: { base: 140, range: 300, gears: 1, wave: 'triangle', cutoff: 2200, turbine: true },
  glider: { base: 90, range: 160, gears: 1, wave: 'triangle', cutoff: 1600, turbine: true },
};

const _d = new THREE.Vector3();

export class Soundscape {
  private built = false;
  private wind!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private rain!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private waves!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private water!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode };
  private city!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private engine: { a: OscillatorNode; b: OscillatorNode; filter: BiquadFilterNode; gain: GainNode; noise: AudioBufferSourceNode; noiseGain: GainNode; type: VehicleType | null } | null = null;
  private skid!: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private emitters: Emitter[] = [];
  private time = 0;
  private birdT = 2;
  private nightT = 3;
  private dripT = 0;
  private thunderT = 30;
  private gustPhase = 0;

  constructor(private audio: AudioEngine) {}

  addEmitter(e: Emitter) {
    this.emitters.push(e);
  }

  private loop(filterType: BiquadFilterType, freq: number, q = 1): { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } {
    const ctx = this.audio.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.audio.ambBus);
    src.start(0, Math.random());
    return { src, filter, gain };
  }

  private build() {
    const ctx = this.audio.ctx!;
    this.wind = this.loop('bandpass', 500, 0.8);
    this.rain = this.loop('highpass', 2600, 0.5);
    this.waves = this.loop('lowpass', 520, 0.7);
    this.city = this.loop('lowpass', 180, 0.6);
    const w = this.loop('bandpass', 1200, 0.5);
    const pan = ctx.createStereoPanner();
    w.gain.disconnect();
    w.gain.connect(pan).connect(this.audio.ambBus);
    this.water = { ...w, pan };
    this.skid = this.loop('bandpass', 1500, 6);
    this.skid.gain.disconnect();
    this.skid.gain.connect(this.audio.sfxBus);
    this.built = true;
  }

  private set(g: GainNode, v: number, tc = 0.4) {
    g.gain.setTargetAtTime(Math.max(0, v), this.audio.ctx!.currentTime, tc);
  }

  /** Stereo position of a world point for the current listener (-1..1) and distance. */
  private panOf(p: THREE.Vector3, st: SoundState): { pan: number; dist: number } {
    _d.copy(p).sub(st.listener);
    const dist = Math.hypot(_d.x, _d.z);
    const ang = Math.atan2(_d.x, _d.z) - st.yaw;
    return { pan: Math.max(-1, Math.min(1, -Math.sin(ang))), dist };
  }

  update(dt: number, st: SoundState) {
    const ctx = this.audio.ctx;
    if (!ctx) return;
    if (!this.built) this.build();
    this.time += dt;
    const day = 1 - st.night;
    const dry = 1 - st.rain;

    // ---- wind: rises with height and speed, gusts every few seconds
    this.gustPhase += dt * (0.25 + Math.sin(this.time * 0.13) * 0.1);
    const gust = 0.55 + 0.45 * Math.sin(this.gustPhase) * Math.sin(this.gustPhase * 0.37 + 1);
    const high = Math.min(1, Math.max(0, st.height - 6) / 40);
    const fast = Math.min(1, Math.max(0, st.speed - 8) / 25);
    this.set(this.wind.gain, (0.025 + high * 0.16 + fast * 0.2 + st.rain * 0.05) * gust);
    this.wind.filter.frequency.setTargetAtTime(380 + gust * 420 + fast * 700, ctx.currentTime, 0.5);

    // ---- rain + drips + distant thunder
    this.set(this.rain.gain, st.rain * 0.16, 1);
    if (st.rain > 0.3) {
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = 0.05 + Math.random() * 0.25;
        const f = 1800 + Math.random() * 2400;
        this.audio.tone('sine', f, f * 1.5, ctx.currentTime, 0.03, 0.02 * st.rain, this.audio.ambBus);
      }
      this.thunderT -= dt;
      if (this.thunderT <= 0 && st.rain > 0.7) {
        this.thunderT = 25 + Math.random() * 40;
        const t = ctx.currentTime;
        this.audio.noise(t, 3.5, 0.35, 'lowpass', 180, this.audio.ambBus, 0.7, 60);
        this.audio.noise(t + 0.2, 1.2, 0.2, 'lowpass', 600, this.audio.ambBus, 0.7, 120);
      }
    }

    // ---- shore waves: slow swell
    const swell = 0.5 + 0.5 * Math.sin(this.time * 0.7) * Math.sin(this.time * 0.23 + 2);
    this.set(this.waves.gain, st.shore * (0.04 + swell * 0.09));
    this.waves.filter.frequency.setTargetAtTime(300 + swell * 500, ctx.currentTime, 0.6);

    // ---- positioned water: the loudest nearby waterfall / fountain / pool
    let wBest = 0;
    let wPan = 0;
    let wKind: EmitterKind = 'pool';
    let urbanE = 0;
    let greenE = 0;
    for (const e of this.emitters) {
      const { pan, dist } = this.panOf(e.pos, st);
      if (dist > e.radius) continue;
      const k = 1 - dist / e.radius;
      if (e.kind === 'city') urbanE = Math.max(urbanE, k);
      else if (e.kind === 'forest') greenE = Math.max(greenE, k);
      else {
        const loud = (e.kind === 'waterfall' ? 0.32 : e.kind === 'fountain' ? 0.12 : 0.06) * k * k;
        if (loud > wBest) {
          wBest = loud;
          wPan = pan * Math.min(1, dist / 6);
          wKind = e.kind;
        }
      }
    }
    this.set(this.water.gain, wBest, 0.3);
    this.water.pan.pan.setTargetAtTime(wPan, ctx.currentTime, 0.2);
    this.water.filter.frequency.setTargetAtTime(wKind === 'waterfall' ? 900 : wKind === 'fountain' ? 2200 : 700, ctx.currentTime, 0.5);
    this.water.filter.Q.value = wKind === 'waterfall' ? 0.35 : 1.2;

    // ---- city hum
    const urban = Math.max(st.urban, urbanE);
    this.set(this.city.gain, urban * (0.05 + day * 0.04), 1);

    // ---- birds by day, insects and owls by night
    const green = Math.max(st.green, greenE);
    const birdAmt = day * dry * (0.35 + green * 0.65) * (st.paused ? 0.6 : 1);
    this.birdT -= dt * (0.4 + birdAmt * 1.6);
    if (this.birdT <= 0 && birdAmt > 0.08) {
      this.birdT = 1 + Math.random() * 2.5;
      const pan = Math.random() * 2 - 1;
      const r = Math.random();
      if (st.shore > 0.4 && r < 0.3) this.seagull(pan, birdAmt);
      else if (urban > 0.5 && r < 0.35) this.pigeon(pan, birdAmt);
      else if (r < 0.75) this.songbird(pan, birdAmt);
      else this.warbler(pan, birdAmt);
    }
    const nightAmt = st.night * (1 - st.rain * 0.7);
    if (nightAmt > 0.3) {
      this.nightT -= dt;
      if (this.nightT <= 0) {
        this.nightT = 0.25 + Math.random() * 0.6;
        const r = Math.random();
        if (r < 0.04) this.owl(Math.random() * 2 - 1, nightAmt);
        else if (r < 0.14 && (st.shore > 0.2 || wBest > 0)) this.frog(Math.random() * 2 - 1, nightAmt);
        else this.cricket(Math.random() * 2 - 1, nightAmt);
      }
    }

    // ---- vehicle engine + tyres
    this.updateEngine(dt, st);
  }

  // ------------------------------------------------------------ creatures

  private voice(pan: number): GainNode {
    const ctx = this.audio.ctx!;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.audio.ambBus);
    return g;
  }

  /** A quick FM chirp (the building block of every bird). */
  private chirp(bus: GainNode, t: number, f0: number, f1: number, dur: number, vol: number, vib = 0) {
    const ctx = this.audio.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (vib > 0) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 30 + Math.random() * 25;
      lg.gain.value = vib;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private songbird(pan: number, amt: number) {
    const t = this.audio.ctx!.currentTime + 0.01;
    const bus = this.voice(pan);
    const n = 3 + Math.floor(Math.random() * 5);
    const base = 2600 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const f = base * (0.85 + Math.random() * 0.4);
      this.chirp(bus, t + i * (0.07 + Math.random() * 0.05), f, f * (Math.random() < 0.5 ? 1.35 : 0.7), 0.05 + Math.random() * 0.04, 0.03 * amt);
    }
  }

  private warbler(pan: number, amt: number) {
    const t = this.audio.ctx!.currentTime + 0.01;
    const bus = this.voice(pan);
    const f = 2000 + Math.random() * 1200;
    this.chirp(bus, t, f, f * 1.6, 0.35, 0.025 * amt, 300);
    this.chirp(bus, t + 0.42, f * 1.4, f * 0.9, 0.25, 0.02 * amt, 200);
  }

  private pigeon(pan: number, amt: number) {
    const t = this.audio.ctx!.currentTime + 0.01;
    const bus = this.voice(pan);
    // "coo-roo-coo"
    for (const [k, f] of [[0, 420], [0.28, 380], [0.5, 440]] as const) this.chirp(bus, t + k, f, f * 0.92, 0.22, 0.05 * amt, 12);
  }

  private seagull(pan: number, amt: number) {
    const t = this.audio.ctx!.currentTime + 0.01;
    const bus = this.voice(pan);
    for (let i = 0; i < 3; i++) this.chirp(bus, t + i * 0.22, 1700, 950, 0.2, 0.03 * amt, 60);
  }

  private cricket(pan: number, amt: number) {
    const t = this.audio.ctx!.currentTime + 0.01;
    const bus = this.voice(pan);
    const f = 4200 + Math.random() * 600;
    for (let i = 0; i < 3; i++) this.chirp(bus, t + i * 0.045, f, f, 0.03, 0.012 * amt);
  }

  private frog(pan: number, amt: number) {
    const t = this.audio.ctx!.currentTime + 0.01;
    const bus = this.voice(pan);
    this.chirp(bus, t, 180, 140, 0.18, 0.06 * amt, 40);
    this.chirp(bus, t + 0.25, 200, 150, 0.14, 0.05 * amt, 40);
  }

  private owl(pan: number, amt: number) {
    const t = this.audio.ctx!.currentTime + 0.01;
    const bus = this.voice(pan);
    this.chirp(bus, t, 380, 340, 0.35, 0.04 * amt, 4);
    this.chirp(bus, t + 0.6, 400, 330, 0.55, 0.04 * amt, 4);
  }

  // ------------------------------------------------------------ footsteps

  /** One footfall. `speed` in m/s decides walk / run / sprint weight. */
  footstep(surface: FootSurface, speed: number) {
    const a = this.audio;
    const ctx = a.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.001;
    const run = Math.min(1, Math.max(0, (speed - 3) / 6));
    const v = 0.35 + run * 0.55;
    const bus = a.sfxBus;
    const p = 0.92 + Math.random() * 0.16;
    switch (surface) {
      case 'grass':
        a.noise(t, 0.09, 0.13 * v, 'lowpass', 2400 * p, bus, 0.7);
        a.noise(t + 0.02, 0.06, 0.05 * v, 'highpass', 5000, bus);
        break;
      case 'sand':
        for (let i = 0; i < 3; i++) a.noise(t + i * 0.015, 0.04, 0.07 * v, 'bandpass', 2800 * p, bus, 1.5);
        break;
      case 'wood':
        a.tone('triangle', 190 * p, 120, t, 0.09, 0.22 * v, bus);
        a.noise(t, 0.05, 0.1 * v, 'bandpass', 700 * p, bus, 2);
        break;
      case 'metal':
        a.tone('sine', 820 * p, 780, t, 0.18, 0.05 * v, bus);
        a.tone('sine', 1330 * p, 1300, t, 0.12, 0.03 * v, bus);
        a.noise(t, 0.04, 0.12 * v, 'highpass', 3000, bus);
        break;
      case 'glass':
        a.tone('sine', 2400 * p, 2300, t, 0.06, 0.03 * v, bus);
        a.noise(t, 0.03, 0.1 * v, 'highpass', 4000, bus);
        break;
      case 'wet':
        a.noise(t, 0.12, 0.16 * v, 'lowpass', 1600 * p, bus, 1, 400);
        a.tone('sine', 900 * p, 1500, t + 0.03, 0.04, 0.03 * v, bus);
        break;
      case 'goo':
        a.noise(t, 0.16, 0.16 * v, 'bandpass', 900 * p, bus, 3, 250);
        a.tone('sine', 140, 70, t, 0.12, 0.12 * v, bus);
        break;
      case 'gravel':
        for (let i = 0; i < 4; i++) a.noise(t + i * 0.012, 0.03, 0.08 * v, 'bandpass', 1600 + Math.random() * 2400, bus, 2);
        break;
      default:
        a.noise(t, 0.05, 0.12 * v, 'bandpass', 1050 * p, bus, 1.5);
        a.tone('sine', 115 * p, 60, t, 0.05, 0.09 * v, bus);
    }
    // running adds a shoe scuff
    if (run > 0.6 && surface !== 'grass' && surface !== 'sand') a.noise(t + 0.03, 0.05, 0.04 * run, 'highpass', 3500, bus);
  }

  // ------------------------------------------------------------ engines

  private updateEngine(dt: number, st: SoundState) {
    const ctx = this.audio.ctx!;
    const v = st.paused ? null : st.vehicle;
    const now = ctx.currentTime;
    // tyre squeal
    const squeal = v && !ENGINES[v.type]?.turbine ? Math.min(1, Math.max(0, (v.slip - 3.5) / 6)) : 0;
    this.set(this.skid.gain, squeal * 0.12, 0.08);
    if (!v) {
      if (this.engine) {
        this.set(this.engine.gain, 0, 0.15);
        this.set(this.engine.noiseGain, 0, 0.15);
      }
      return;
    }
    if (!this.engine || this.engine.type !== v.type) this.makeEngine(v.type);
    const e = this.engine!;
    const prof = ENGINES[v.type] ?? ENGINES.default;
    const frac = Math.min(1.2, Math.abs(v.speed) / Math.max(1, v.topSpeed));
    // pistons climb through the gears and drop at each shift; turbines just spool up
    let rpm: number;
    if (prof.turbine || prof.gears <= 1) rpm = 0.15 + frac * 0.85 + Math.max(0, v.throttle) * 0.1;
    else {
      const g = Math.min(prof.gears - 1, Math.floor(frac * prof.gears));
      rpm = 0.22 + ((frac * prof.gears - g) * 0.7 + g * 0.04) + Math.max(0, v.throttle) * 0.06;
    }
    if (v.boosting) rpm += 0.15;
    const f = prof.base + prof.range * rpm;
    e.a.frequency.setTargetAtTime(f, now, 0.05);
    e.b.frequency.setTargetAtTime(f * (prof.turbine ? 1.5 : 0.5), now, 0.05);
    const load = 0.35 + Math.abs(v.throttle) * 0.65;
    e.filter.frequency.setTargetAtTime(prof.cutoff * (0.5 + load * 0.8 + rpm * 0.4), now, 0.08);
    this.set(e.gain, (prof.turbine ? 0.05 : 0.07) * (0.6 + load * 0.5), 0.08);
    this.set(e.noiseGain, (prof.rattle ?? 0) * 0.05 * load + (prof.turbine ? 0.03 + frac * 0.05 : 0), 0.1);
    void dt;
  }

  private makeEngine(type: VehicleType) {
    const ctx = this.audio.ctx!;
    if (this.engine) {
      const old = this.engine;
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      old.noiseGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      setTimeout(() => {
        old.a.stop();
        old.b.stop();
        old.noise.stop();
      }, 600);
    }
    const prof = ENGINES[type] ?? ENGINES.default;
    const a = ctx.createOscillator();
    a.type = prof.wave;
    const b = ctx.createOscillator();
    b.type = prof.turbine ? 'sine' : 'square';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const bg = ctx.createGain();
    bg.gain.value = 0.6;
    a.connect(filter);
    b.connect(bg).connect(filter);
    filter.connect(gain).connect(this.audio.ambBus);
    const noise = ctx.createBufferSource();
    noise.buffer = this.audio.noiseBuf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = prof.turbine ? 1800 : 600;
    nf.Q.value = prof.turbine ? 0.8 : 3;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(nf).connect(noiseGain).connect(this.audio.ambBus);
    a.start();
    b.start();
    noise.start();
    this.engine = { a, b, filter, gain, noise, noiseGain, type };
  }
}
