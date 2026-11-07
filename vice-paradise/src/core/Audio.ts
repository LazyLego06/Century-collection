import * as THREE from 'three';

/** Fully synthesized WebAudio sound (no audio files): engine, guns, sirens, impacts, UI. */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private engOsc: OscillatorNode | null = null;
  private engOsc2: OscillatorNode | null = null;
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private sirenOsc: OscillatorNode | null = null;
  private sirenGain!: GainNode;
  private hornOsc: OscillatorNode | null = null;
  private hornGain!: GainNode;
  private listener = new THREE.Vector3();
  volume = 0.6;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(c.destination);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.engFilter = c.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 700;
    this.engGain = c.createGain(); this.engGain.gain.value = 0;
    this.engOsc = c.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 50;
    this.engOsc2 = c.createOscillator(); this.engOsc2.type = 'square'; this.engOsc2.frequency.value = 25;
    const g2 = c.createGain(); g2.gain.value = 0.4;
    this.engOsc.connect(this.engFilter); this.engOsc2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.engOsc.start(); this.engOsc2.start();

    this.sirenGain = c.createGain(); this.sirenGain.gain.value = 0;
    this.sirenOsc = c.createOscillator(); this.sirenOsc.type = 'triangle'; this.sirenOsc.frequency.value = 700;
    this.sirenOsc.connect(this.sirenGain).connect(this.master); this.sirenOsc.start();

    this.hornGain = c.createGain(); this.hornGain.gain.value = 0;
    this.hornOsc = c.createOscillator(); this.hornOsc.type = 'square'; this.hornOsc.frequency.value = 415;
    const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1200;
    this.hornOsc.connect(hf).connect(this.hornGain).connect(this.master); this.hornOsc.start();
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.value = v; }
  setListener(p: THREE.Vector3) { this.listener.copy(p); }

  private att(pos: THREE.Vector3 | null, range = 120) {
    if (!pos) return 1;
    const d = pos.distanceTo(this.listener);
    return Math.max(0, 1 - d / range) ** 1.5;
  }

  private noise(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass', q = 1, attack = 0.002) {
    const c = this.ctx; if (!c || gain <= 0.001) return;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', endFreq?: number, delay = 0) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(); o.type = type; const g = c.createGain();
    const t = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  gunshot(pos: THREE.Vector3 | null, vol = 1, kind = 'pistol') {
    const a = this.att(pos, 200) * vol;
    const big = kind === 'shotgun' ? 1.6 : kind === 'rifle' ? 1.25 : 1;
    this.noise(0.18 * big, 2400, 0.55 * a, 'lowpass');
    this.noise(0.35 * big, 400, 0.4 * a * big, 'lowpass');
    this.tone(140, 0.12, 0.25 * a, 'square', 50);
  }
  explosion(pos: THREE.Vector3 | null) { const a = this.att(pos, 300); this.noise(1.6, 300, 1.0 * a, 'lowpass', 1, 0.01); this.tone(70, 1.0, 0.5 * a, 'sine', 25); }
  crash(pos: THREE.Vector3 | null, strength: number) { const a = this.att(pos, 120) * Math.min(1, strength); this.noise(0.4, 900, 0.6 * a, 'bandpass', 0.8); this.noise(0.25, 3000, 0.25 * a, 'highpass'); }
  thud() { this.noise(0.15, 300, 0.4, 'lowpass'); }
  whoosh() { this.noise(0.12, 1500, 0.15, 'bandpass', 2); }
  click() { this.tone(1200, 0.04, 0.1, 'square'); }
  reload() { this.tone(900, 0.05, 0.1, 'square'); this.tone(600, 0.06, 0.1, 'square', undefined, 0.25); }
  door() { this.noise(0.12, 500, 0.3, 'lowpass'); }
  jump() { this.noise(0.08, 600, 0.08, 'lowpass'); }
  pickup() { this.tone(880, 0.1, 0.15, 'triangle'); this.tone(1320, 0.15, 0.15, 'triangle', undefined, 0.08); }
  wantedUp() { this.tone(520, 0.12, 0.12, 'square'); this.tone(390, 0.18, 0.12, 'square', undefined, 0.12); }
  money() { this.tone(1500, 0.06, 0.1, 'square'); this.tone(2000, 0.08, 0.1, 'square', undefined, 0.06); }
  passed() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 0.18, 'triangle', undefined, i * 0.12)); }
  failed() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 0.18, 'sawtooth', undefined, i * 0.18)); }
  checkpoint() { this.tone(1046, 0.12, 0.15, 'triangle'); this.tone(1568, 0.18, 0.15, 'triangle', undefined, 0.07); }
  wasted() { this.tone(200, 1.8, 0.3, 'sawtooth', 40); }

  /** Continuous sounds updated every frame. */
  update(engineOn: boolean, rpm: number, throttle: number, sirenDist: number, horn: boolean, time: number) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    const eg = engineOn ? 0.05 + throttle * 0.07 : 0;
    this.engGain.gain.setTargetAtTime(eg, t, 0.08);
    const f = 32 + rpm * 95;
    this.engOsc!.frequency.setTargetAtTime(f, t, 0.05);
    this.engOsc2!.frequency.setTargetAtTime(f / 2, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(400 + throttle * 900 + rpm * 400, t, 0.1);
    const sg = sirenDist < 1e8 ? Math.max(0, 1 - sirenDist / 160) ** 1.5 * 0.07 : 0;
    this.sirenGain.gain.setTargetAtTime(sg, t, 0.1);
    this.sirenOsc!.frequency.setTargetAtTime(Math.sin(time * 4) > 0 ? 960 : 720, t, 0.05);
    this.hornGain.gain.setTargetAtTime(horn ? 0.08 : 0, t, 0.02);
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(0, t, 0.05); this.sirenGain.gain.setTargetAtTime(0, t, 0.05); this.hornGain.gain.setTargetAtTime(0, t, 0.02);
  }
}
