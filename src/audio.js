// Sonido 100% sintetizado con Web Audio: no hace falta ningún archivo.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.chugPhase = 0;
    this.chugCount = 0;
    this.clackDist = 0;
    this.lastWarn = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // ruido blanco reutilizable
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // viento / rodadura continuo
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  noiseBurst({ freq = 400, q = 1, type = 'bandpass', gain = 0.3, attack = 0.004, decay = 0.1, when = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5);
    s.stop(t + attack + decay + 0.05);
  }

  tone(freq, { type = 'sine', gain = 0.2, attack = 0.005, decay = 0.25, when = 0, slide = 0 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + attack + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  /** Llamar cada frame: traqueteo de vapor y golpes de carril según la velocidad. */
  update(dt, speed, running) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (!running) {
      this.windGain.gain.setTargetAtTime(0, now, 0.2);
      return;
    }
    this.windGain.gain.setTargetAtTime(0.025 + speed * 0.0028, now, 0.2);
    this.windFilter.frequency.setTargetAtTime(250 + speed * 22, now, 0.2);
    const rate = Math.min(speed * 0.42, 15);
    this.chugPhase += dt * rate;
    if (this.chugPhase >= 1) {
      this.chugPhase -= 1;
      const accent = this.chugCount++ % 4 === 0;
      this.noiseBurst({
        freq: 260 + Math.random() * 120, q: 0.9, gain: accent ? 0.32 : 0.18,
        decay: Math.max(0.05, 0.16 - speed * 0.002),
      });
    }
    this.clackDist += speed * dt;
    if (this.clackDist > 16) {
      this.clackDist = 0;
      const gap = Math.min(0.12, 2.2 / Math.max(speed, 1));
      this.noiseBurst({ freq: 2400, type: 'highpass', q: 0.7, gain: 0.12, decay: 0.03 });
      this.noiseBurst({ freq: 2200, type: 'highpass', q: 0.7, gain: 0.1, decay: 0.03, when: gap });
    }
  }

  whistle() {
    if (!this.ctx) return;
    for (const [f, d] of [[740, 0], [932, 0.01], [1110, 0.02]]) {
      this.tone(f, { type: 'sawtooth', gain: 0.04, attack: 0.08, decay: 0.9, when: d });
      this.tone(f * 1.003, { type: 'square', gain: 0.02, attack: 0.08, decay: 0.9, when: d });
    }
    this.noiseBurst({ freq: 900, q: 4, gain: 0.06, attack: 0.05, decay: 0.9 });
  }

  coin() {
    if (!this.ctx) return;
    this.tone(1318.5, { type: 'triangle', gain: 0.16, decay: 0.12 });
    this.tone(1975.5, { type: 'triangle', gain: 0.14, decay: 0.25, when: 0.06 });
  }

  gem() {
    if (!this.ctx) return;
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) =>
      this.tone(f, { type: 'triangle', gain: 0.14, decay: 0.3, when: i * 0.06 })
    );
  }

  bonus() {
    if (!this.ctx) return;
    this.tone(523.25, { type: 'square', gain: 0.05, decay: 0.12 });
    this.tone(784, { type: 'square', gain: 0.05, decay: 0.2, when: 0.09 });
  }

  pickup() {
    if (!this.ctx) return;
    // "ding-dong" de estación
    this.tone(784, { type: 'sine', gain: 0.22, decay: 0.5 });
    this.tone(622.3, { type: 'sine', gain: 0.22, decay: 0.7, when: 0.28 });
  }

  deliver() {
    if (!this.ctx) return;
    [523.25, 659.25, 784, 1046.5].forEach((f, i) => {
      this.tone(f, { type: 'square', gain: 0.06, decay: 0.18, when: i * 0.08 });
      this.tone(f * 2, { type: 'triangle', gain: 0.08, decay: 0.25, when: i * 0.08 });
    });
    this.tone(1046.5, { type: 'triangle', gain: 0.1, decay: 0.6, when: 0.34 });
    this.tone(1318.5, { type: 'triangle', gain: 0.08, decay: 0.6, when: 0.34 });
  }

  fail() {
    if (!this.ctx) return;
    this.tone(392, { type: 'sawtooth', gain: 0.07, decay: 0.25 });
    this.tone(311, { type: 'sawtooth', gain: 0.07, decay: 0.25, when: 0.22 });
    this.tone(233, { type: 'sawtooth', gain: 0.07, decay: 0.6, when: 0.44, slide: 0.8 });
  }

  tick(sec) {
    if (!this.ctx) return;
    this.tone(sec <= 2 ? 1320 : 990, { type: 'square', gain: 0.05, decay: 0.05 });
  }

  // ---------- Bar ----------

  /** Chisporroteo continuo de la plancha; level = cuántas cosas se están cocinando. */
  sizzle(level) {
    if (!this.ctx) return;
    if (!this.sizzleGain) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 3200;
      const am = this.ctx.createGain();
      // crepitar: modulación rápida de volumen
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 23;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain).connect(am.gain);
      lfo.start();
      this.sizzleGain = this.ctx.createGain();
      this.sizzleGain.gain.value = 0;
      src.connect(f).connect(am).connect(this.sizzleGain).connect(this.master);
      src.start();
    }
    this.sizzleGain.gain.setTargetAtTime(Math.min(0.09, level * 0.03), this.ctx.currentTime, 0.15);
  }

  shake() {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++) this.noiseBurst({ freq: 6000, type: 'highpass', gain: 0.08, decay: 0.05, when: i * 0.09 });
  }

  squirt() {
    if (!this.ctx) return;
    this.noiseBurst({ freq: 700, q: 3, gain: 0.15, attack: 0.02, decay: 0.3 });
    this.tone(300, { type: 'sine', gain: 0.05, decay: 0.25, slide: 0.6 });
  }

  ice() {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++) this.tone(2400 + Math.random() * 1200, { type: 'triangle', gain: 0.06, decay: 0.06, when: i * 0.05 });
  }

  /** Voz inventada de los clientes: sílabas con formantes, cada cliente con su tono. */
  voice(pitch = 1, n = 3) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const VOWELS = [[730, 1090], [270, 2290], [530, 1840], [570, 840], [300, 870]];
    let t = ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const dur = 0.07 + Math.random() * 0.06;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 160 * pitch * (0.9 + Math.random() * 0.25);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f0 * (0.92 + Math.random() * 0.16), t + dur);
      const v = VOWELS[(Math.random() * VOWELS.length) | 0];
      const out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, t);
      out.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
      out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      for (const fr of v) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = fr * (pitch > 1.1 ? 1.15 : 1);
        bp.Q.value = 6;
        o.connect(bp).connect(out);
      }
      out.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.02);
      t += dur + 0.02 + Math.random() * 0.03;
    }
  }

  plop() {
    if (!this.ctx) return;
    this.tone(220, { type: 'sine', gain: 0.15, decay: 0.12, slide: 0.5 });
    this.noiseBurst({ freq: 4000, type: 'highpass', gain: 0.12, decay: 0.25 });
  }

  pour() {
    if (!this.ctx) return;
    this.noiseBurst({ freq: 900, q: 1.5, gain: 0.12, attack: 0.05, decay: 1.0 });
    this.tone(500, { type: 'sine', gain: 0.03, attack: 0.05, decay: 1.0, slide: 1.8 });
  }

  trash() {
    if (!this.ctx) return;
    this.noiseBurst({ freq: 300, type: 'lowpass', gain: 0.3, decay: 0.2 });
    this.tone(140, { type: 'triangle', gain: 0.1, decay: 0.15 });
  }

  serveItem() {
    if (!this.ctx) return;
    this.tone(880, { type: 'triangle', gain: 0.1, decay: 0.12 });
    this.noiseBurst({ freq: 2500, q: 2, gain: 0.05, decay: 0.05 });
  }

  register() {
    if (!this.ctx) return;
    this.noiseBurst({ freq: 1800, q: 3, gain: 0.2, decay: 0.08 });
    this.tone(1568, { type: 'sine', gain: 0.15, decay: 0.5, when: 0.08 });
    this.tone(2093, { type: 'sine', gain: 0.12, decay: 0.7, when: 0.12 });
  }

  bell() {
    if (!this.ctx) return;
    this.tone(1760, { type: 'sine', gain: 0.1, decay: 0.8 });
    this.tone(2637, { type: 'sine', gain: 0.05, decay: 0.6 });
  }

  orderPing() {
    if (!this.ctx) return;
    this.tone(1046, { type: 'sine', gain: 0.07, decay: 0.15 });
    this.tone(1318, { type: 'sine', gain: 0.07, decay: 0.2, when: 0.09 });
  }

  ding() {
    if (!this.ctx) return;
    this.tone(2093, { type: 'triangle', gain: 0.1, decay: 0.6 });
  }

  burn() {
    if (!this.ctx) return;
    for (let i = 0; i < 3; i++) this.tone(1200, { type: 'square', gain: 0.04, decay: 0.07, when: i * 0.14 });
  }

  /** Gruñido de cliente molesto (0..1 de intensidad). */
  angry(k = 1) {
    if (!this.ctx) return;
    this.tone(180, { type: 'sawtooth', gain: 0.06 * k, attack: 0.03, decay: 0.35, slide: 0.7 });
    this.tone(140, { type: 'sawtooth', gain: 0.05 * k, attack: 0.03, decay: 0.4, slide: 0.7, when: 0.05 });
  }

  honk() {
    if (!this.ctx) return;
    this.tone(415, { type: 'square', gain: 0.07, attack: 0.01, decay: 0.22 });
    this.tone(523, { type: 'square', gain: 0.06, attack: 0.01, decay: 0.22 });
    this.noiseBurst({ freq: 500, type: 'lowpass', q: 0.7, gain: 0.35, decay: 0.25 });
  }

  warn() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastWarn < 0.7) return;
    this.lastWarn = now;
    this.tone(880, { type: 'square', gain: 0.06, decay: 0.09 });
    this.tone(660, { type: 'square', gain: 0.06, decay: 0.09, when: 0.12 });
  }

  crash() {
    if (!this.ctx) return;
    this.noiseBurst({ freq: 900, type: 'lowpass', q: 0.5, gain: 0.9, attack: 0.005, decay: 1.6 });
    this.noiseBurst({ freq: 3000, type: 'bandpass', q: 0.6, gain: 0.3, attack: 0.002, decay: 0.5 });
    this.tone(90, { type: 'sine', gain: 0.6, decay: 0.9, slide: 0.35 });
    for (let i = 0; i < 6; i++) {
      this.noiseBurst({ freq: 1500 + Math.random() * 3000, q: 3, gain: 0.12, decay: 0.15, when: 0.15 + Math.random() * 0.8 });
    }
  }
}
