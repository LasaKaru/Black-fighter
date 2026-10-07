/**
 * Procedural audio: every sound effect is synthesised with the Web Audio API
 * and the music is a small adaptive step sequencer (lo-fi trap with toy
 * percussion) whose layers open up with intensity (README §22).
 */

export type MusicTheme = 'city' | 'night' | 'chase' | 'boss';

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
  | 'catch' | 'absorb' | 'dash' | 'shock' | 'blink' | 'hurt' | 'ui' | 'uiBack' | 'spot' | 'wallrun';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private nextNoteTime = 0;
  private step = 0;
  private timer: number | null = null;
  /** 0 = explore, 1 = drums, 2 = bass+lead, 3 = full (manhunt / max flow). */
  intensity = 0;
  private volumes = { master: 0.8, music: 0.55, sfx: 0.9 };
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
    this.sfxBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
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
    this.reverbIn.connect(conv).connect(this.musicBus);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startMusic();
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.musicBus.gain.value = this.volumes.music * 0.5;
    this.sfxBus.gain.value = this.volumes.sfx;
  }

  // ------------------------------------------------------------ primitives

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number, bus: GainNode, filter?: number) {
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

  private noise(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, bus: GainNode, q = 1, sweepTo?: number) {
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
    const bus = this.musicBus;
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
      u.volume = Math.min(1, this.volumes.master * this.volumes.sfx);
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
