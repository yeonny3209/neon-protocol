// 효과음과 BGM. 지금은 실제 음원 대신 브라우저에서 합성한 소리를 쓴다.
// 아이패드는 화면을 한 번 터치하기 전에는 소리를 낼 수 없어서 unlockAudio()를 첫 터치에서 부른다.
import type { Element } from '../engine/defs';

let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
let bgmGain: GainNode | null = null;
let volumes = { sfx: 0.7, bgm: 0.5 };

export function unlockAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  sfxGain = ctx.createGain();
  bgmGain = ctx.createGain();
  sfxGain.connect(ctx.destination);
  bgmGain.connect(ctx.destination);
  applyVolumes();
}

export function setVolumes(v: { sfx: number; bgm: number }) {
  volumes = v;
  applyVolumes();
}

const volumeListeners: (() => void)[] = [];
/** 음원 파일처럼 오디오 컨텍스트 밖에서 재생되는 소리가 볼륨 변경을 따라가게 한다 */
export function onVolumeChange(fn: () => void) {
  volumeListeners.push(fn);
}
export function bgmVolume(): number {
  return volumes.bgm;
}

function applyVolumes() {
  for (const fn of volumeListeners) fn();
  if (sfxGain) sfxGain.gain.value = volumes.sfx * 0.5;
  if (bgmGain) bgmGain.gain.value = volumes.bgm * 0.35;
}

export function audioContext() {
  return { ctx, bgmGain };
}

const EL_FREQ: Record<Element, number> = { kinetic: 180, plasma: 260, cryo: 880, volt: 620, glitch: 420, void: 140 };

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.3, slide = 0, delay = 0) {
  if (!ctx || !sfxGain) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(sfxGain);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.25, delay = 0, hp = 800) {
  if (!ctx || !sfxGain) return;
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(sfxGain);
  src.start(t);
}

export type SfxName =
  | 'tap' | 'select' | 'confirm' | 'cancel' | 'attack' | 'enemy' | 'hit' | 'crit' | 'firewall' | 'down' | 'kill' | 'ko'
  | 'heal' | 'shield' | 'overclock' | 'charge' | 'win' | 'lose' | 'reward' | 'levelup' | 'dive' | 'dive3' | 'dive4' | 'dive5' | 'page' | 'hurt' | 'weak';

const EL_WAVE: Record<Element, OscillatorType> = { kinetic: 'square', volt: 'sawtooth', plasma: 'sawtooth', cryo: 'triangle', glitch: 'square', void: 'sine' };

/** strength: 0 약함, 1 보통(약점·큰 피해), 2 강함(치명타·큰 피해) */
export function sfx(name: SfxName, el?: Element, strength = 0) {
  if (!ctx) return;
  const f = el ? EL_FREQ[el] : 300;
  switch (name) {
    case 'tap':
    case 'page':
      return tone(660, 0.05, 'sine', 0.2);
    case 'select':
      return tone(880, 0.06, 'triangle', 0.22);
    case 'confirm':
      tone(660, 0.05, 'square', 0.15);
      return tone(990, 0.08, 'square', 0.15, 0, 0.05);
    case 'cancel':
      return tone(440, 0.08, 'triangle', 0.2, -120);
    case 'attack':
      return noise(0.12, 0.2, 0, 1600);
    case 'enemy':
      return tone(160, 0.18, 'sawtooth', 0.18, -60);
    case 'hit': {
      tone(f, 0.08 + strength * 0.03, el ? EL_WAVE[el] : 'square', 0.18, -f * 0.4);
      noise(0.06 + strength * 0.04, 0.12, 0, el === 'cryo' ? 4000 : 2000);
      if (strength >= 1) tone(90, 0.14, 'sine', 0.3, -50);
      if (strength >= 2) noise(0.18, 0.18, 0.02, 500);
      return;
    }
    case 'hurt':
      tone(130, 0.16, 'sawtooth', 0.2, -60);
      return noise(0.1, 0.14, 0, 700);
    case 'weak':
      tone(1320, 0.07, 'triangle', 0.14, 0, 0.02);
      return tone(1760, 0.1, 'triangle', 0.12, 0, 0.07);
    case 'crit':
      tone(f * 1.5, 0.12, el ? EL_WAVE[el] : 'square', 0.22, -f);
      tone(80, 0.2, 'sine', 0.32, -40);
      return noise(0.14, 0.2, 0, 1200);
    case 'firewall':
      return tone(1400, 0.04, 'square', 0.1);
    case 'down':
      tone(f, 0.35, 'sawtooth', 0.25, -f * 0.7);
      tone(f * 2, 0.25, 'square', 0.15, f, 0.05);
      return noise(0.35, 0.25, 0, 400);
    case 'kill':
      return tone(320, 0.25, 'triangle', 0.2, -240);
    case 'ko':
      return tone(220, 0.4, 'sine', 0.25, -150);
    case 'heal':
      tone(660, 0.12, 'sine', 0.18, 220);
      return tone(990, 0.15, 'sine', 0.12, 220, 0.08);
    case 'shield':
      return tone(520, 0.18, 'triangle', 0.18, 260);
    case 'overclock':
      tone(220, 0.5, 'sawtooth', 0.22, 660);
      return noise(0.4, 0.15, 0.1, 600);
    case 'charge':
      return tone(110, 0.6, 'sawtooth', 0.2, 330);
    case 'win':
      [523, 659, 784, 1046].forEach((fr, i) => tone(fr, 0.18, 'square', 0.16, 0, i * 0.1));
      return;
    case 'lose':
      [392, 330, 262].forEach((fr, i) => tone(fr, 0.25, 'triangle', 0.18, 0, i * 0.15));
      return;
    case 'reward':
      tone(880, 0.08, 'sine', 0.2);
      return tone(1320, 0.12, 'sine', 0.2, 0, 0.08);
    case 'levelup':
      [660, 880, 1100].forEach((fr, i) => tone(fr, 0.1, 'triangle', 0.2, 0, i * 0.07));
      return;
    case 'dive':
      return tone(200, 0.8, 'sine', 0.2, 800);
    case 'dive3':
      return tone(700, 0.25, 'sine', 0.2);
    case 'dive4':
      tone(700, 0.2, 'triangle', 0.22);
      return tone(1050, 0.3, 'triangle', 0.22, 0, 0.12);
    case 'dive5':
      [523, 659, 784, 1046, 1318].forEach((fr, i) => tone(fr, 0.3, 'square', 0.16, 0, i * 0.09));
      return;
  }
}
