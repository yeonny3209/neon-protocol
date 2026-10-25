// 배경음. 실제 음원이 없을 때는 간단한 시퀀서로 곡을 합성한다.
// src/data/audio.json에 { "곡이름": "파일 경로" }를 넣으면 그 파일을 반복 재생한다.
import audioFiles from '../data/audio.json';
import { audioContext, bgmVolume, onVolumeChange } from './audio';

interface Track {
  bpm: number;
  root: number;
  scale: number[];
  chords: number[];
  bass: string;
  arp: string;
  kick: string;
  snare: string;
  hat: string;
  pad: OscillatorType;
  lead?: number[];
  bright: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PHRYG = [0, 1, 3, 5, 7, 8, 10];

// 패턴 문자열: 16칸, x = 소리, . = 쉼
const TRACKS: Record<string, Track> = {
  title: { bpm: 92, root: 45, scale: MINOR, chords: [0, 5, 3, 4], bass: 'x...x...x...x.x.', arp: 'x.x.x.x.x.x.x.x.', kick: 'x.......x.......', snare: '....x.......x...', hat: '..x...x...x...x.', pad: 'sawtooth', bright: 900, lead: [4, 3, 2, 0, 2, 3, 4, 6] },
  nest: { bpm: 78, root: 48, scale: DORIAN, chords: [0, 3, 5, 4], bass: 'x.....x...x.....', arp: 'x...x...x...x...', kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', pad: 'triangle', bright: 700 },
  undertown: { bpm: 96, root: 43, scale: MINOR, chords: [0, 6, 5, 4], bass: 'x..x..x.x..x..x.', arp: 'x.xx.x.xx.x.xx.x', kick: 'x...x...x...x...', snare: '....x.......x...', hat: '.x.x.x.x.x.x.x.x', pad: 'sawtooth', bright: 800 },
  market: { bpm: 108, root: 46, scale: DORIAN, chords: [0, 3, 4, 6], bass: 'x.x...x.x.x...x.', arp: 'xx.xx.xx.xx.x.x.', kick: 'x...x...x...x...', snare: '....x..x....x...', hat: 'xxxxxxxxxxxxxxxx', pad: 'square', bright: 1200 },
  academy: { bpm: 88, root: 48, scale: MAJOR, chords: [0, 4, 5, 3], bass: 'x.......x.......', arp: 'x.x.x.x.x.x.x.x.', kick: 'x.......x.......', snare: '........x.......', hat: '..x...x...x...x.', pad: 'triangle', bright: 1400 },
  garden: { bpm: 84, root: 50, scale: MAJOR, chords: [0, 5, 3, 4], bass: 'x...x.......x...', arp: 'x..x..x..x..x..x', kick: 'x.......x.......', snare: '....x.......x...', hat: 'x...x...x...x...', pad: 'sine', bright: 1600 },
  tower: { bpm: 70, root: 45, scale: PHRYG, chords: [0, 1, 0, 6], bass: 'x...............', arp: 'x.......x.......', kick: '................', snare: '................', hat: '....x.......x...', pad: 'sine', bright: 500 },
  core: { bpm: 118, root: 44, scale: MINOR, chords: [0, 5, 6, 4], bass: 'x.xxx.xxx.xxx.xx', arp: 'xxxxxxxxxxxxxxxx', kick: 'x...x...x...x...', snare: '....x.......x..x', hat: '.x.x.x.x.x.x.x.x', pad: 'sawtooth', bright: 2000 },
  battle: { bpm: 140, root: 45, scale: MINOR, chords: [0, 5, 6, 4], bass: 'x.xx.xx.x.xx.xx.', arp: 'x.xxx.xxx.xxx.xx', kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', pad: 'sawtooth', bright: 1800, lead: [0, 2, 4, 2, 5, 4, 2, 1] },
  battle2: { bpm: 150, root: 47, scale: DORIAN, chords: [0, 3, 4, 6], bass: 'xx.xx.x.xx.xx.x.', arp: 'x.x.xxx.x.x.xxx.', kick: 'x..x..x.x..x..x.', snare: '....x.......x...', hat: '.xxx.xxx.xxx.xxx', pad: 'square', bright: 1600, lead: [4, 3, 4, 6, 4, 3, 2, 0] },
  boss: { bpm: 128, root: 40, scale: PHRYG, chords: [0, 1, 5, 6], bass: 'x.xxx.xxx.xxx.xx', arp: 'xxx.xxx.xxx.xxx.', kick: 'x.x.x.x.x.x.x.x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx', pad: 'sawtooth', bright: 1500, lead: [0, 1, 0, 5, 4, 1, 0, 6] },
  boss2: { bpm: 136, root: 42, scale: MINOR, chords: [0, 6, 5, 6], bass: 'xxxxxxxxxxxxxxxx', arp: 'x.xxx.xxx.xxx.xx', kick: 'x...x...x...x.x.', snare: '....x..x....x...', hat: '.x.x.x.x.x.x.x.x', pad: 'sawtooth', bright: 2200, lead: [0, 2, 3, 5, 6, 5, 3, 2] },
  sad: { bpm: 66, root: 45, scale: MINOR, chords: [0, 5, 2, 6], bass: 'x.......x.......', arp: 'x...x...x...x...', kick: '................', snare: '................', hat: '................', pad: 'sine', bright: 600, lead: [4, 2, 0, 2, 4, 5, 4, 2] },
  ending: { bpm: 76, root: 48, scale: MAJOR, chords: [0, 4, 5, 3], bass: 'x.......x...x...', arp: 'x.x.x.x.x.x.x.x.', kick: 'x.......x.......', snare: '........x.......', hat: '..x...x...x...x.', pad: 'triangle', bright: 1100, lead: [0, 2, 4, 5, 4, 2, 1, 0] },
};

let current = '';
let timer = 0;
let step = 0;
let nextTime = 0;
let fileAudio: HTMLAudioElement | null = null;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function note(t: Track, degree: number, octave = 0): number {
  const s = t.scale;
  const d = ((degree % 7) + 7) % 7;
  const oct = Math.floor(degree / 7) + octave;
  return midi(t.root + s[d] + 12 * oct);
}

function play(freq: number, at: number, dur: number, type: OscillatorType, vol: number, cutoff: number) {
  const { ctx, bgmGain } = audioContext();
  if (!ctx || !bgmGain) return;
  const o = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(f).connect(g).connect(bgmGain);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function drum(kind: 'kick' | 'snare' | 'hat', at: number) {
  const { ctx, bgmGain } = audioContext();
  if (!ctx || !bgmGain) return;
  if (kind === 'kick') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, at);
    o.frequency.exponentialRampToValueAtTime(40, at + 0.15);
    g.gain.setValueAtTime(0.5, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
    o.connect(g).connect(bgmGain);
    o.start(at);
    o.stop(at + 0.2);
    return;
  }
  const len = kind === 'snare' ? 0.12 : 0.04;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = kind === 'snare' ? 1200 : 6000;
  const g = ctx.createGain();
  g.gain.value = kind === 'snare' ? 0.25 : 0.08;
  src.connect(f).connect(g).connect(bgmGain);
  src.start(at);
}

function schedule() {
  const { ctx } = audioContext();
  const t = TRACKS[current];
  if (!ctx || !t) return;
  const stepDur = 60 / t.bpm / 4;
  if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
  while (nextTime < ctx.currentTime + 0.25) {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const chord = t.chords[bar % t.chords.length];
    if (s === 0) for (const deg of [0, 2, 4]) play(note(t, chord + deg, 0), nextTime, stepDur * 15, t.pad, 0.05, t.bright);
    if (t.bass[s] === 'x') play(note(t, chord, -1), nextTime, stepDur * 1.8, 'square', 0.12, 500);
    if (t.arp[s] === 'x') play(note(t, chord + [0, 2, 4, 7][s % 4], 1), nextTime, stepDur * 0.9, 'triangle', 0.05, t.bright * 1.5);
    if (t.lead && s % 4 === 0 && bar % 2 === 1) play(note(t, t.lead[(s / 4 + (bar % 4) * 4) % t.lead.length] + chord, 1), nextTime, stepDur * 3.5, 'square', 0.035, t.bright);
    if (t.kick[s] === 'x') drum('kick', nextTime);
    if (t.snare[s] === 'x') drum('snare', nextTime);
    if (t.hat[s] === 'x') drum('hat', nextTime);
    nextTime += stepDur;
    step++;
  }
}

onVolumeChange(() => {
  if (fileAudio) fileAudio.volume = Math.min(1, bgmVolume());
});

let currentFile = '';

export function playBgm(name: string) {
  if (name === current) {
    // 첫 터치 전에 시작한 음원 파일은 브라우저가 막아 둔 상태라, 터치 뒤에 다시 부르면 재생을 시도한다
    if (fileAudio?.paused) void fileAudio.play().catch(() => undefined);
    return;
  }
  const file = (audioFiles as Record<string, string>)[name];
  // 이름은 달라도 같은 음원 파일이면 끊지 않고 이어서 재생한다(예: 프롤로그~3장이 한 곡을 같이 씀)
  if (file && file === currentFile && fileAudio && !fileAudio.paused) {
    current = name;
    return;
  }
  stopBgm();
  current = name;
  currentFile = file ?? '';
  if (file) {
    fileAudio = new Audio(file);
    fileAudio.loop = true;
    fileAudio.volume = Math.min(1, bgmVolume());
    void fileAudio.play().catch(() => undefined);
    return;
  }
  step = 0;
  nextTime = 0;
  timer = window.setInterval(schedule, 80);
}

export function stopBgm() {
  clearInterval(timer);
  timer = 0;
  current = '';
  currentFile = '';
  fileAudio?.pause();
  fileAudio = null;
}

export function setBgmFileVolume(v: number) {
  if (fileAudio) fileAudio.volume = v;
}
