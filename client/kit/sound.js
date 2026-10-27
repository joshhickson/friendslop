// Zero-asset sound effects synthesized with WebAudio. Good enough for playtesting.
//
//   sfx.play('shoot');  sfx.play('hit', { volume: 0.5 });
//   sfx.define('boing', { type: 'sine', freq: [300, 900], dur: 0.25 });

let ctx = null;
let master = null;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

let noiseBuffer = null;
function noise(ac) {
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

const presets = {
  shoot: { type: 'square', freq: [520, 90], dur: 0.09, noise: 0.5 },
  hit: { type: 'triangle', freq: [900, 600], dur: 0.06 },
  hurt: { type: 'sawtooth', freq: [220, 70], dur: 0.18 },
  kill: { type: 'square', freq: [660, 990], dur: 0.16 },
  die: { type: 'sawtooth', freq: [300, 40], dur: 0.6 },
  pickup: { type: 'sine', freq: [500, 1200], dur: 0.2 },
  score: { type: 'triangle', freq: [440, 880], dur: 0.45, steps: 3 },
  alarm: { type: 'square', freq: [700, 500], dur: 0.35, steps: 4 },
  click: { type: 'sine', freq: [800, 800], dur: 0.03 },
  jump: { type: 'sine', freq: [200, 400], dur: 0.1 },
};

export const sfx = {
  enabled: true,
  volume(v) {
    audio();
    if (master) master.gain.value = v;
  },
  define(name, preset) {
    presets[name] = preset;
  },
  play(name, { volume = 1, pitch = 1 } = {}) {
    if (!this.enabled) return;
    const p = presets[name];
    const ac = audio();
    if (!p || !ac) return;
    const t0 = ac.currentTime;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);
    gain.connect(master);

    const osc = ac.createOscillator();
    osc.type = p.type ?? 'sine';
    const [f0, f1] = p.freq;
    if (p.steps) {
      for (let i = 0; i < p.steps; i++) osc.frequency.setValueAtTime((f0 + ((f1 - f0) * i) / (p.steps - 1)) * pitch, t0 + (p.dur / p.steps) * i);
    } else {
      osc.frequency.setValueAtTime(f0 * pitch, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * pitch), t0 + p.dur);
    }
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + p.dur + 0.02);

    if (p.noise) {
      const src = ac.createBufferSource();
      src.buffer = noise(ac);
      const ng = ac.createGain();
      ng.gain.setValueAtTime(p.noise * volume, t0);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + p.dur);
      src.connect(ng).connect(master);
      src.start(t0);
      src.stop(t0 + p.dur + 0.02);
    }
  },
};
