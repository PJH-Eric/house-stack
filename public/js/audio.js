/* 疊疊高樓 — 音訊：全部用 WebAudio 合成（落地敲擊、旋律），無外部授權素材；可由設定獨立控制背景音樂與音效。 */
let ctx = null, master = null, musicGain = null, sfxGain = null;
let cfg = { music: true, musicVol: 0.5, sfx: true, sfxVol: 0.8 };
let unlocked = false, bgmTimer = 0, bgmOn = false, nextT = 0, beat = 0, altitude = 0;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  musicGain = ctx.createGain(); sfxGain = ctx.createGain();
  musicGain.connect(master); sfxGain.connect(master);
  apply();
  return ctx;
}
function apply() {
  if (!ctx) return;
  musicGain.gain.setTargetAtTime(cfg.music ? cfg.musicVol * 0.5 : 0, ctx.currentTime, 0.05);
  sfxGain.gain.setTargetAtTime(cfg.sfx ? cfg.sfxVol : 0, ctx.currentTime, 0.02);
}
export function configure(next) { cfg = { ...cfg, ...next }; apply(); }

/** 第一次使用者手勢後解鎖音訊並開始音樂。 */
export function unlock() {
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  if (!unlocked) { unlocked = true; if (bgmOn) startBgm(); }
}
window.addEventListener('pointerdown', unlock, { passive: true });
window.addEventListener('keydown', unlock);

function env(g, t, a, d, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(freq, t, dur, { type = 'sine', peak = 0.3, bus = sfxGain, glide = 0 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * glide), t + dur);
  env(g, t, 0.006, dur, peak);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, { peak = 0.25, freq = 900, q = 1 } = {}) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); env(g, t, 0.003, dur, peak);
  s.connect(f); f.connect(g); g.connect(sfxGain); s.start(t);
}
const ok = () => ctx && cfg.sfx && ctx.state === 'running';

export const sfx = {
  /** 木頭敲擊：強度 0~1 */
  tock(strength = 0.6) {
    if (!ok()) return; const t = ctx.currentTime;
    const base = 160 + Math.random() * 90;
    tone(base, t, 0.12, { type: 'triangle', peak: 0.18 + strength * 0.3, glide: 0.55 });
    noise(t, 0.05, { peak: 0.1 + strength * 0.2, freq: 1400 + Math.random() * 600, q: 1.4 });
  },
  click() { if (!ok()) return; const t = ctx.currentTime; tone(520, t, 0.07, { type: 'triangle', peak: 0.15 }); },
  rotate() { if (!ok()) return; const t = ctx.currentTime; tone(420, t, 0.05, { type: 'triangle', peak: 0.12 }); tone(630, t + 0.04, 0.05, { type: 'triangle', peak: 0.1 }); },
  drop() { if (!ok()) return; const t = ctx.currentTime; tone(700, t, 0.22, { type: 'sine', peak: 0.12, glide: 0.35 }); },
  fall() { if (!ok()) return; const t = ctx.currentTime; tone(520, t, 0.55, { type: 'sawtooth', peak: 0.08, glide: 0.2 }); noise(t, 0.4, { peak: 0.06, freq: 500 }); },
  lose() { if (!ok()) return; const t = ctx.currentTime; [392, 330, 262].forEach((f, i) => tone(f, t + i * 0.16, 0.3, { type: 'triangle', peak: 0.2 })); },
  win() { if (!ok()) return; const t = ctx.currentTime; [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.12, 0.34, { type: 'triangle', peak: 0.22 })); },
  turn() { if (!ok()) return; const t = ctx.currentTime; tone(880, t, 0.14, { type: 'sine', peak: 0.12 }); tone(1175, t + 0.1, 0.18, { type: 'sine', peak: 0.1 }); },
  perfect(combo = 1) { if (!ok()) return; const t = ctx.currentTime; const base = 660 * Math.pow(1.0595, Math.min(combo, 8) * 2); [0, 0.07, 0.14].forEach((o, i) => tone(base * [1, 1.26, 1.5][i], t + o, 0.22, { type: 'triangle', peak: 0.2 })); },
  creak() { if (!ok()) return; const t = ctx.currentTime; tone(95, t, 0.5, { type: 'sawtooth', peak: 0.05, glide: 1.5 }); noise(t, 0.35, { peak: 0.04, freq: 300, q: 4 }); },
  thunder() { if (!ok()) return; const t = ctx.currentTime; noise(t, 1.4, { peak: 0.09, freq: 140, q: 0.7 }); noise(t + 0.15, 0.9, { peak: 0.05, freq: 90, q: 0.5 }); },
  pop() { if (!ok()) return; const t = ctx.currentTime; tone(300, t, 0.09, { type: 'sine', peak: 0.15, glide: 2 }); },
};

/* ---- 背景音樂：木琴風短旋律，高度越高音域越高、越空靈 ---- */
const PENT = [0, 2, 4, 7, 9]; // C 大調五聲
const MELODY = [0, 2, 4, 2, 3, 2, 1, 0, 2, 4, 3, 4, 2, 1, 0, 1];
const BASS = [0, 0, 3, 3, 4, 4, 2, 2];
function note(deg, oct) { return 261.63 * Math.pow(2, (PENT[((deg % 5) + 5) % 5] + 12 * (oct + Math.floor(deg / 5))) / 12); }
function schedule() {
  if (!ctx || !bgmOn) return;
  const spb = 0.34;
  while (nextT < ctx.currentTime + 0.6) {
    const i = beat % MELODY.length;
    const hi = altitude > 100 ? 1 : 0;
    if (i % 2 === 0 || beat % 8 === 5) {
      tone(note(MELODY[i], 0 + hi), nextT, 0.5, { type: 'sine', peak: 0.22, bus: musicGain });
      tone(note(MELODY[i], 1 + hi) * 1, nextT, 0.18, { type: 'triangle', peak: 0.06, bus: musicGain });
    }
    if (beat % 4 === 0) tone(note(BASS[(beat / 4) % BASS.length | 0], -1), nextT, 0.9, { type: 'triangle', peak: 0.2, bus: musicGain });
    nextT += spb; beat++;
  }
}
function startBgm() {
  if (!ctx || bgmTimer) return;
  nextT = ctx.currentTime + 0.1; beat = 0;
  bgmTimer = setInterval(schedule, 120);
}
export function bgm(on) {
  bgmOn = on;
  if (on) { if (unlocked) startBgm(); }
  else if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = 0; }
}
export function setAltitude(a) { altitude = a; }

export function vibrate(ms) { try { if (cfg.vibrate !== false && navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } }
export function setVibrate(on) { cfg.vibrate = on; }
