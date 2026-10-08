/**
 * Procedural audio: every sound effect is synthesised with the Web Audio API
 * and the music is a small adaptive step sequencer (lo-fi trap with toy
 * percussion) whose layers open up with intensity (README §22).
 */

export type MusicTheme = 'city' | 'night' | 'chase' | 'boss';
export type Stinger = 'checkpoint' | 'discover' | 'victory' | 'danger' | 'reach' | 'secret' | 'fail';
/** Keys in public/music/manifest.json: lists of files per mood. */
type TrackMood = MusicTheme | 'calm' | 'menu';

/** Per-theme tempo, progression (chord tones in Hz) and feel. */
const THEMES: Record<MusicTheme, { bpm: number; chords: number[][]; wave: OscillatorType; lead: OscillatorType; swing: number }> = {
  // Am - F - C - G, dusty lo-fi
  city: { bpm: 88, chords: [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 261.6, 329.6], [196, 246.9, 293.7]], wave: 'sawtooth', lead: 'sine', swing: 0.12 },
  // Dm - Bb - F - A: slower, minor, music box over pads
  night: { bpm: 72, chords: [[146.8, 174.6, 220], [116.5, 146.8, 174.6], [174.6, 220, 261.6], [110, 138.6, 164.8]], wave: 'triangle', lead: 'sine', swing: 0.18 },
  // Em - C - D - B: driving
  chase: { bpm: 112, chords: [[164.8, 196, 246.9], [130.8, 164.8, 196], [146.8, 185, 220], [123.5, 155.6, 185]], wave: 'sawtooth', lead: 'square', swing: 0 },
  // Cm - Ab - Eb - G: heavy
  boss: { bpm: 96, chords: [[130.8, 155.6, 196], [103.8, 130.8, 155.6], [155.6, 196, 233.1], [98, 123.5, 146.8]], wave: 'square', lead: 'sawtooth', swing: 0 },
};

type SfxName =
  | 'step' | 'jump' | 'land' | 'whoosh' | 'hit' | 'heavyHit' | 'ink' | 'smash'
  | 'catch' | 'absorb' | 'dash' | 'shock' | 'blink' | 'hurt' | 'ui' | 'uiBack' | 'spot' | 'wallrun'
  | 'hornCar' | 'hornTuk' | 'hornMoto' | 'boost' | 'crash' | 'splash' | 'door';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  /** Procedural score (muted while a recorded track plays). */
  private seqBus!: GainNode;
  sfxBus!: GainNode;
  /** Nature, weather, water, city, engines. */
  ambBus!: GainNode;
  noiseBuf!: AudioBuffer;
  /** 0..1: lowers the music while exploring quietly ("calm"), 1 = normal. */
  musicDuck = 1;
  private recorded: RecordedMusic | null = null;
  /** Play recorded tracks from /music when available (settings). */
  recordedOn = true;
  private nextNoteTime = 0;
  private step = 0;
  private timer: number | null = null;
  /** 0 = explore, 1 = drums, 2 = bass+lead, 3 = full (manhunt / max flow). */
  intensity = 0;
  private volumes = { master: 0.8, music: 0.55, sfx: 0.9, ambience: 0.8, voice: 0.9 };
  /** Tempo of the current theme. */
  bpm = 88;
  /** Musical theme: picked by the game from what's happening. */
  theme: MusicTheme = 'city';
  private playing: MusicTheme = 'city';
  private reverbIn!: GainNode;
  /** Spoken voice lines (Web Speech). */
  voiceOn = true;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.seqBus = this.ctx.createGain();
    this.sfxBus = this.ctx.createGain();
    this.ambBus = this.ctx.createGain();
    this.seqBus.connect(this.musicBus);
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);
    // a generated room reverb for the music (soft decaying noise impulse)
    const irLen = Math.floor(this.ctx.sampleRate * 2.2);
    const ir = this.ctx.createBuffer(2, irLen, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    const conv = this.ctx.createConvolver();
    conv.buffer = ir;
    this.reverbIn = this.ctx.createGain();
    this.reverbIn.gain.value = 0.35;
    this.reverbIn.connect(conv).connect(this.seqBus);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startMusic();
    this.recorded = new RecordedMusic(this.ctx, this.musicBus);
    void this.recorded.load();
  }

  setVolumes(master: number, music: number, sfx: number, ambience = this.volumes.ambience, voice = this.volumes.voice) {
    this.volumes = { master, music, sfx, ambience, voice };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.5 * this.musicDuck, this.ctx.currentTime, 0.8);
    this.sfxBus.gain.value = this.volumes.sfx;
    this.ambBus.gain.value = this.volumes.ambience;
  }

  /** Called every frame: calm ducking and recorded-music crossfades. */
  update(dt: number) {
    if (!this.ctx) return;
    this.applyVolumes();
    const mood: TrackMood = this.musicDuck < 0.8 && this.theme === 'city' ? 'calm' : this.theme;
    const rec = this.recorded;
    const usingTrack = !!rec && this.recordedOn && rec.update(dt, mood, this.intensity);
    // the procedural sequencer steps aside while a real track plays
    this.seqBus.gain.setTargetAtTime(usingTrack ? 0 : 1, this.ctx.currentTime, 0.6);
    if (rec && !this.recordedOn) rec.stop();
  }

  /** Music menu mode (title screen). */
  setMenu(on: boolean) {
    this.recorded?.setMenu(on);
  }

  // ------------------------------------------------------------ primitives

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number, bus: GainNode, filter?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    let node: AudioNode = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, bus: GainNode, q = 1, sweepTo?: number) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    s.connect(f).connect(g).connect(bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  /** Play an effect. `pan` -1..1, `dist` attenuates. */
  play(name: SfxName, opts: { vol?: number; pitch?: number; pan?: number } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.001;
    const v = opts.vol ?? 1;
    const p = opts.pitch ?? 1;
    let bus: GainNode = this.sfxBus;
    if (opts.pan !== undefined) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      panner.connect(this.sfxBus);
      const g = ctx.createGain();
      g.connect(panner);
      bus = g;
    }
    switch (name) {
      case 'step':
        this.noise(t, 0.05, 0.12 * v, 'bandpass', 900 * p, bus, 1.5);
        this.tone('sine', 120 * p, 60, t, 0.05, 0.08 * v, bus);
        break;
      case 'jump':
        this.noise(t, 0.12, 0.12 * v, 'highpass', 1800, bus, 0.7, 4000);
        this.tone('triangle', 260 * p, 520 * p, t, 0.1, 0.06 * v, bus);
        break;
      case 'land':
        this.tone('sine', 140 * p, 45, t, 0.16, 0.35 * v, bus);
        this.noise(t, 0.12, 0.2 * v, 'lowpass', 1200, bus);
        break;
      case 'whoosh':
        this.noise(t, 0.18, 0.18 * v, 'bandpass', 600 * p, bus, 2, 2500 * p);
        break;
      case 'hit':
        this.tone('sine', 190 * p, 55, t, 0.12, 0.55 * v, bus);
        this.noise(t, 0.06, 0.4 * v, 'highpass', 2500, bus);
        this.tone('square', 900 * p, 300, t, 0.03, 0.06 * v, bus, 3000);
        break;
      case 'heavyHit':
        this.tone('sine', 120 * p, 35, t, 0.28, 0.8 * v, bus);
        this.noise(t, 0.16, 0.5 * v, 'lowpass', 2500, bus);
        this.noise(t, 0.05, 0.4 * v, 'highpass', 4000, bus);
        break;
      case 'ink':
        this.noise(t, 0.35, 0.45 * v, 'lowpass', 2200, bus, 1, 300);
        this.tone('sine', 300 * p, 70, t, 0.25, 0.3 * v, bus);
        for (let i = 0; i < 4; i++) this.noise(t + 0.05 + i * 0.05, 0.04, 0.15 * v, 'bandpass', 1500 + Math.random() * 1500, bus, 4);
        break;
      case 'smash':
        this.tone('sine', 90, 30, t, 0.5, 0.9 * v, bus);
        this.noise(t, 0.6, 0.7 * v, 'lowpass', 3000, bus, 0.8, 200);
        for (let i = 0; i < 7; i++) this.noise(t + 0.06 + i * 0.07, 0.06, 0.25 * v, 'bandpass', 800 + Math.random() * 2000, bus, 3);
        break;
      case 'catch':
        this.noise(t, 0.5, 0.25 * v, 'bandpass', 800, bus, 3, 6000);
        this.tone('sine', 440, 880, t + 0.05, 0.5, 0.25 * v, bus);
        this.tone('sine', 660, 1320, t + 0.05, 0.5, 0.18 * v, bus);
        break;
      case 'absorb':
        this.tone('sawtooth', 220, 55, t, 0.7, 0.3 * v, bus, 900);
        this.tone('sine', 110, 40, t + 0.1, 0.8, 0.7 * v, bus);
        this.noise(t, 0.6, 0.3 * v, 'bandpass', 3000, bus, 2, 400);
        break;
      case 'dash':
        this.noise(t, 0.35, 0.5 * v, 'bandpass', 400, bus, 1.5, 5000);
        this.tone('sawtooth', 120, 600, t, 0.2, 0.15 * v, bus, 2000);
        break;
      case 'shock':
        this.tone('sine', 80, 25, t, 0.9, 1.0 * v, bus);
        this.noise(t, 0.9, 0.7 * v, 'lowpass', 5000, bus, 0.7, 120);
        this.tone('sawtooth', 200, 1600, t, 0.4, 0.12 * v, bus, 3000);
        break;
      case 'blink':
        this.tone('sine', 1200, 200, t, 0.25, 0.3 * v, bus);
        this.noise(t, 0.2, 0.25 * v, 'highpass', 3000, bus, 1, 800);
        break;
      case 'hurt':
        this.tone('square', 220, 90, t, 0.18, 0.15 * v, bus, 1200);
        this.tone('sine', 160, 50, t, 0.2, 0.5 * v, bus);
        break;
      case 'ui':
        this.tone('triangle', 660, 880, t, 0.06, 0.12 * v, bus);
        break;
      case 'uiBack':
        this.tone('triangle', 520, 330, t, 0.07, 0.12 * v, bus);
        break;
      case 'spot':
        // camera shutter click (Agents spotting you)
        this.noise(t, 0.02, 0.35 * v, 'highpass', 5000, bus);
        this.noise(t + 0.06, 0.02, 0.25 * v, 'highpass', 4000, bus);
        this.tone('square', 1800, 1700, t, 0.04, 0.04 * v, bus, 5000);
        break;
      case 'wallrun':
        this.noise(t, 0.08, 0.1 * v, 'bandpass', 1500 * p, bus, 2);
        break;
      case 'hornCar':
        this.tone('square', 415 * p, 412 * p, t, 0.45, 0.07 * v, bus, 1800);
        this.tone('square', 523 * p, 520 * p, t, 0.45, 0.06 * v, bus, 1800);
        break;
      case 'hornTuk':
        // the classic tuk-tuk "paap-paap"
        for (const k of [0, 0.2]) this.tone('square', 680 * p, 640 * p, t + k, 0.14, 0.08 * v, bus, 2600);
        break;
      case 'hornMoto':
        this.tone('sawtooth', 620 * p, 600 * p, t, 0.3, 0.06 * v, bus, 2400);
        break;
      case 'boost':
        this.noise(t, 0.7, 0.4 * v, 'bandpass', 300, bus, 1.2, 3000);
        this.tone('sawtooth', 90, 260, t, 0.5, 0.12 * v, bus, 1500);
        break;
      case 'crash':
        this.tone('sine', 70, 30, t, 0.45, 0.8 * v, bus);
        this.noise(t, 0.5, 0.6 * v, 'lowpass', 2600, bus, 0.8, 300);
        for (let i = 0; i < 5; i++) this.tone('triangle', 1200 + Math.random() * 1600, 900, t + 0.04 + i * 0.05, 0.12, 0.05 * v, bus, 5000);
        break;
      case 'splash':
        this.noise(t, 0.5, 0.4 * v, 'lowpass', 2400, bus, 0.8, 300);
        for (let i = 0; i < 6; i++) this.tone('sine', 900 + Math.random() * 900, 1800 + Math.random() * 800, t + 0.05 + Math.random() * 0.3, 0.05, 0.05 * v, bus);
        break;
      case 'door':
        this.tone('sine', 160, 90, t, 0.12, 0.3 * v, bus);
        this.noise(t, 0.06, 0.25 * v, 'bandpass', 1400, bus, 2);
        break;
    }
  }

  // ------------------------------------------------------------ stingers

  /** Short musical cue on top of the score (checkpoint, discovery, victory, …). */
  stinger(kind: Stinger) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.02;
    const bus = this.sfxBus;
    const chord = (notes: number[], at: number, dur: number, type: OscillatorType, vol: number) => {
      for (const f of notes) {
        this.tone(type, f, f, t + at, dur, vol, bus, 4000);
        this.tone('sine', f * 2, f * 2, t + at, dur * 0.8, vol * 0.4, this.reverbIn);
      }
    };
    switch (kind) {
      case 'checkpoint':
        // bright rising arpeggio + shimmer: "cleared!"
        [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.07, 0.35, 0.09, bus, 5000));
        chord([523.3, 659.3, 784], 0.3, 0.9, 'sine', 0.05);
        this.noise(t + 0.28, 0.6, 0.12, 'highpass', 6000, bus, 0.5, 9000);
        break;
      case 'discover':
        chord([392, 493.9, 587.3], 0, 1.4, 'triangle', 0.045);
        chord([440, 554.4, 659.3], 0.45, 1.6, 'triangle', 0.045);
        break;
      case 'reach':
        // a summit / landmark: wide open fifths
        chord([196, 293.7, 392, 587.3], 0, 2.4, 'sine', 0.06);
        this.noise(t, 2.2, 0.08, 'bandpass', 800, this.reverbIn, 0.6, 2400);
        break;
      case 'victory':
        [392, 392, 523.3, 659.3, 784].forEach((f, i) => this.tone('square', f, f, t + [0, 0.12, 0.24, 0.36, 0.52][i], i === 4 ? 0.8 : 0.1, 0.05, bus, 3200));
        chord([523.3, 659.3, 784, 1046.5], 0.52, 1.4, 'triangle', 0.05);
        this.tone('sine', 130.8, 130.8, t + 0.52, 1.2, 0.3, bus);
        break;
      case 'danger':
        this.tone('sawtooth', 110, 104, t, 0.7, 0.12, bus, 900);
        this.tone('sawtooth', 116.5, 110, t, 0.7, 0.1, bus, 900);
        this.noise(t, 0.6, 0.15, 'lowpass', 600, bus, 1, 120);
        break;
      case 'secret':
        [1318.5, 1568, 1975.5, 2637].forEach((f, i) => this.tone('sine', f, f, t + i * 0.09, 0.5, 0.05, bus));
        chord([659.3, 830.6, 987.8], 0.36, 1.6, 'sine', 0.04);
        break;
      case 'fail':
        [392, 349.2, 311.1, 261.6].forEach((f, i) => this.tone('triangle', f, f * 0.98, t + i * 0.16, 0.35, 0.07, bus, 2000));
        break;
    }
  }

  // ------------------------------------------------------------ music

  private startMusic() {
    this.nextNoteTime = this.ctx!.currentTime + 0.1;
    const tick = () => {
      if (!this.ctx) return;
      while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
        // themes change on the bar line so the groove never stumbles
        if (this.step % 16 === 0 && this.theme !== this.playing) {
          this.playing = this.theme;
          this.bpm = THEMES[this.playing].bpm;
        }
        const th = THEMES[this.playing];
        const swing = this.step % 2 === 1 ? th.swing * (60 / this.bpm / 4) : 0;
        this.scheduleStep(this.step, this.nextNoteTime + swing);
        this.nextNoteTime += 60 / this.bpm / 4;
        this.step = (this.step + 1) % 64;
      }
    };
    this.timer = window.setInterval(tick, 25);
  }

  /** Seconds until the next bar (for beat-synced events). */
  timeToNextBeat(): number {
    if (!this.ctx) return 0;
    const sixteenth = 60 / this.bpm / 4;
    const toNext = this.nextNoteTime - this.ctx.currentTime;
    const stepsToBeat = (4 - (this.step % 4)) % 4;
    return toNext + stepsToBeat * sixteenth;
  }

  private scheduleStep(s: number, t: number) {
    const bus = this.seqBus;
    const th = THEMES[this.playing];
    const lvl = this.playing === 'boss' || this.playing === 'chase' ? Math.max(2, this.intensity) : this.intensity;
    const bar = Math.floor(s / 16);
    const i = s % 16;
    const chords = th.chords;
    if (i === 0) {
      for (const f of chords[bar]) {
        this.tone(th.wave, f, f * 0.998, t, (60 / this.bpm) * 3.8, 0.03, bus, 900);
        this.tone('triangle', f * 2, f * 2, t, (60 / this.bpm) * 3.8, 0.018, this.reverbIn, 1500);
      }
    }
    // music-box arpeggio when exploring (wet, into the reverb)
    if (lvl < 2 && i % 4 === 2) {
      const ch = chords[bar];
      const f = ch[(i / 4 + bar) % 3 | 0] * 4;
      this.tone('sine', f, f, t, 0.35, 0.03, bus);
      this.tone('sine', f, f, t, 0.35, 0.025, this.reverbIn);
    }
    // a phrase melody (AABA over 4 bars) built from the chord tones
    if (lvl >= 1 && this.playing !== 'boss') {
      const motif = [0, -1, 2, -1, 1, -1, -1, 2, 0, -1, 1, -1, 2, 1, -1, -1];
      const variant = bar === 2 ? [2, -1, 1, -1, 0, -1, 2, -1, 1, -1, -1, 0, 2, -1, -1, -1] : motif;
      const n = variant[i];
      if (n >= 0) {
        const f = chords[bar][n] * 2;
        this.tone(th.lead, f, f, t, 0.22, 0.028, bus, 2600);
        this.tone(th.lead, f, f, t, 0.22, 0.02, this.reverbIn, 2600);
      }
    }
    if (this.playing === 'boss' && i % 2 === 0) {
      // pulsing low ostinato
      const f = chords[bar][0] / 2;
      this.tone('sawtooth', f, f, t, 0.14, 0.05, bus, 700);
    }
    if (lvl >= 1) {
      // boom-bap-ish trap drums
      const kick = [0, 7, 10].includes(i) || (lvl >= 3 && i === 14);
      if (kick) {
        this.tone('sine', 150, 42, t, 0.35, 0.55, bus);
      }
      if (i === 4 || i === 12) {
        this.noise(t, 0.18, 0.28, 'bandpass', 1800, bus, 0.8);
        this.tone('triangle', 220, 160, t, 0.08, 0.1, bus);
      }
      const hat = lvl >= 3 ? true : i % 2 === 0;
      if (hat) this.noise(t, 0.03, i % 4 === 2 ? 0.08 : 0.05, 'highpass', 8000, bus);
      if (lvl >= 2 && (i === 13 || i === 15) && bar % 2 === 1) this.noise(t, 0.02, 0.06, 'highpass', 9000, bus);
      // toy plastic click
      if (i === 6) this.tone('square', 1400, 1400, t, 0.015, 0.03, bus, 4000);
    }
    if (lvl >= 2) {
      // 808 bass following the chord root
      const root = chords[bar][0] / 4;
      if ([0, 3, 7, 10].includes(i)) this.tone('sine', root, root * 0.98, t, 0.32, 0.4, bus);
      // lead stabs
      if (lvl >= 3 && [0, 3, 6, 11].includes(i)) {
        const f = chords[bar][(i / 3) % 3 | 0] * 2;
        this.tone('square', f, f, t, 0.12, 0.04, bus, 2200);
      }
    }
  }

  /** Speak a line with the browser's speech synthesis (pitch per speaker). */
  speak(text: string, opts: { pitch?: number; rate?: number } = {}) {
    if (!this.voiceOn || typeof speechSynthesis === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = opts.pitch ?? 1.1;
      u.rate = opts.rate ?? 1.05;
      u.volume = Math.min(1, this.volumes.master * this.volumes.voice);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* speech not available */
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}

/**
 * Recorded soundtrack: put audio files in public/music/ and list them in
 * public/music/manifest.json, e.g.
 *   { "menu": ["menu.mp3"], "city": ["city-1.mp3", "city-2.mp3"], "calm": ["calm.mp3"],
 *     "night": ["night.mp3"], "chase": ["chase.mp3"], "boss": ["boss.mp3"] }
 * Tracks crossfade when the mood changes; moods without tracks fall back to
 * the procedural score. Nothing is downloaded when there is no manifest.
 */
class RecordedMusic {
  private manifest: Partial<Record<TrackMood, string[]>> = {};
  private decks: Array<{ el: HTMLAudioElement; gain: GainNode; mood: TrackMood | null }> = [];
  private active = 0;
  private mood: TrackMood | null = null;
  private menu = false;
  private loaded = false;

  constructor(private ctx: AudioContext, private bus: GainNode) {}

  async load() {
    try {
      const r = await fetch('music/manifest.json', { cache: 'no-cache' });
      if (!r.ok) return;
      const m = (await r.json()) as Partial<Record<TrackMood, string[]>>;
      if (m && typeof m === 'object') this.manifest = m;
      this.loaded = Object.values(this.manifest).some((l) => Array.isArray(l) && l.length > 0);
    } catch {
      /* no soundtrack installed */
    }
    if (!this.loaded) return;
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      const src = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.bus);
      el.addEventListener('ended', () => this.next(this.decks.indexOf(deck)));
      const deck = { el, gain, mood: null as TrackMood | null };
      this.decks.push(deck);
    }
  }

  setMenu(on: boolean) {
    this.menu = on;
  }

  private pick(mood: TrackMood): string | null {
    const list = this.manifest[mood];
    if (!list?.length) return null;
    return 'music/' + list[Math.floor(Math.random() * list.length)];
  }

  private next(i: number) {
    const d = this.decks[i];
    if (!d?.mood) return;
    const src = this.pick(d.mood);
    if (src) {
      d.el.src = src;
      void d.el.play().catch(() => {});
    }
  }

  /** Returns true while a recorded track covers the current mood. */
  update(_dt: number, mood: TrackMood, _intensity: number): boolean {
    if (!this.loaded || !this.decks.length) return false;
    const want: TrackMood = this.menu && this.manifest.menu?.length ? 'menu' : mood;
    if (want !== this.mood) {
      this.mood = want;
      const src = this.pick(want);
      const t = this.ctx.currentTime;
      const old = this.decks[this.active];
      old.gain.gain.setTargetAtTime(0, t, 0.9);
      const oldEl = old.el;
      setTimeout(() => {
        if (this.decks[this.active].el !== oldEl) oldEl.pause();
      }, 4000);
      if (!src) return false;
      this.active = 1 - this.active;
      const d = this.decks[this.active];
      d.mood = want;
      d.el.src = src;
      d.el.currentTime = 0;
      void d.el.play().catch(() => {});
      d.gain.gain.setTargetAtTime(1, t, 1.2);
    }
    return !!this.manifest[want]?.length;
  }

  stop() {
    for (const d of this.decks) {
      d.gain.gain.value = 0;
      d.el.pause();
    }
    this.mood = null;
  }
}
