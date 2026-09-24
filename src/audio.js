import { sliceAt, regionAt } from './world/layout.js';
import { pathAt } from './world/plan.js';
import { rng } from './core/math.js';

// Procedural ambience with the Web Audio API: air-handling hum, running
// water, birdsong by day, crickets by night, footsteps and passing trains.

function noiseBuffer(ctx, seconds, type = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (type === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else if (type === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    } else d[i] = w;
  }
  return buf;
}

export class AudioScape {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.R = rng(1234);
    this.birdTimer = 2;
    this.cricketTimer = 1;
    this._reg = {};
    this._path = { d: 0, pave: 0 };
  }

  start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);
    this.white = noiseBuffer(ctx, 2, 'white');
    const loop = (buf) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start();
      return src;
    };
    // habitat hum
    const hum = loop(noiseBuffer(ctx, 4, 'brown'));
    const humF = ctx.createBiquadFilter();
    humF.type = 'lowpass';
    humF.frequency.value = 220;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.16;
    hum.connect(humF).connect(this.humGain).connect(this.master);
    const tone = ctx.createOscillator();
    tone.frequency.value = 57;
    const toneG = ctx.createGain();
    toneG.gain.value = 0.012;
    tone.connect(toneG).connect(this.master);
    tone.start();
    // water
    const water = loop(noiseBuffer(ctx, 3, 'pink'));
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 1100;
    wf.Q.value = 0.5;
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    water.connect(wf).connect(this.waterGain).connect(this.master);
    // train rumble
    const tr = loop(noiseBuffer(ctx, 3, 'brown'));
    const tf = ctx.createBiquadFilter();
    tf.type = 'lowpass';
    tf.frequency.value = 500;
    this.trainGain = ctx.createGain();
    this.trainGain.gain.value = 0;
    tr.connect(tf).connect(this.trainGain).connect(this.master);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.1);
    return this.muted;
  }

  chirp(pan = 0, vol = 0.05) {
    const ctx = this.ctx;
    const R = this.R;
    const t0 = ctx.currentTime + 0.02;
    const notes = R.int(2, 6);
    const base = R.range(2200, 4200);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain();
    out.gain.value = vol;
    if (p) {
      p.pan.value = pan;
      out.connect(p).connect(this.master);
    } else out.connect(this.master);
    let t = t0;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      const f0 = base * R.range(0.8, 1.3);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * R.range(0.6, 1.5), t + 0.08);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + R.range(0.06, 0.14));
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.2);
      t += R.range(0.07, 0.18);
    }
  }

  cricket(pan = 0, vol = 0.025) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.02;
    const o = ctx.createOscillator();
    o.frequency.value = 4300 + this.R() * 600;
    const g = ctx.createGain();
    g.gain.value = 0;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const out = ctx.createGain();
    out.gain.value = vol;
    o.connect(g).connect(out);
    if (p) {
      p.pan.value = pan;
      out.connect(p).connect(this.master);
    } else out.connect(this.master);
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.09;
      for (let k = 0; k < 4; k++) {
        g.gain.setValueAtTime(1, t + k * 0.016);
        g.gain.setValueAtTime(0, t + k * 0.016 + 0.008);
      }
    }
    o.start(t0);
    o.stop(t0 + 0.4);
  }

  step(kind) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.8 + this.R() * 0.4;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (kind === 'water') {
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 0.8;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    } else if (kind === 'hard') {
      f.type = 'bandpass';
      f.frequency.value = 2400;
      f.Q.value = 1.2;
      g.gain.setValueAtTime(0.18, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    } else {
      f.type = 'lowpass';
      f.frequency.value = 900;
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    }
    src.connect(f).connect(g).connect(this.master);
    src.start(t, this.R() * 1.5);
    src.stop(t + 0.4);
  }

  surfaceKind(player) {
    if (player.inWater) return 'water';
    const sl = sliceAt(player.s);
    const reg = regionAt(sl, player.u, this._reg);
    if (reg.kind === 'bank' || reg.kind === 'water') return 'soft';
    pathAt(player.s, player.u, sl, this._path);
    if (this._path.d < 0 && this._path.pave > 0.5) return 'hard';
    return 'soft';
  }

  update(dt, player, env, life) {
    if (!this.ctx) return;
    if (!this._hooked) {
      this._hooked = true;
      player.onStep = () => this.step(this.surfaceKind(player));
      player.onLand = () => this.step('hard');
    }
    const t = this.ctx.currentTime;
    // water proximity
    const sl = sliceAt(player.s);
    const dw = Math.max(0, Math.abs(player.u - sl.river.c) - sl.river.hw);
    const wv = Math.max(0, 1 - dw / 28) * (0.12 + 0.18 * (1 - Math.min(1, Math.abs(player.h) / 20)));
    this.waterGain.gain.setTargetAtTime(wv, t, 0.3);
    // train
    const tv = Math.max(0, 1 - life.nearTrain / 90) * Math.min(1, (life.trainSpeed || 0) / 10) * 0.5;
    this.trainGain.gain.setTargetAtTime(tv, t, 0.2);
    // wildlife
    this.birdTimer -= dt;
    this.cricketTimer -= dt;
    if (env.day > 0.6 && this.birdTimer < 0) {
      this.birdTimer = this.R.range(1.5, 6);
      if (!this.muted) this.chirp(this.R.range(-0.8, 0.8), this.R.range(0.02, 0.06));
    }
    if (env.night > 0.6 && this.cricketTimer < 0) {
      this.cricketTimer = this.R.range(0.3, 1.4);
      if (!this.muted) this.cricket(this.R.range(-0.9, 0.9), this.R.range(0.01, 0.03));
    }
  }
}
