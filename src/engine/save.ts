// 브라우저 저장. 맨 위 version 숫자로 구조를 구분하고, 구조가 바뀌면 MIGRATIONS에 변환을 하나 추가한다.
// 저장 시점: 전투 종료, 선택지 직후, 다이브 결과 직후(연출 전), 성장 직후, 화면 이동 시.
import type { SkillLevels } from './loadout';

export const SAVE_KEY = 'neon-protocol.save';
export const SAVE_VERSION = 2;

export interface Settings {
  speed: 1 | 2 | 3;
  difficulty: 'story' | 'normal';
  cutin: 'first' | 'always' | 'never';
  skipBossIntro: boolean;
  skipVictory: boolean;
  storyAlwaysSkip: boolean;
  autoText: boolean;
  instantText: boolean;
  bgm: number;
  sfx: number;
  /** 글자 크기: 대사·안내·모달 글자를 키운다 */
  bigText: boolean;
  /** 흔들림·번쩍임·화면 전환 효과를 끈다(기기의 "동작 줄이기"와 별개로 게임 안에서도 켤 수 있다) */
  calm: boolean;
}

export interface CharState {
  id: string;
  level: number;
  exp: number;
  asc: number;
  skills: SkillLevels;
  big: number[];
  small: number[];
  sync: number;
  cart: number | null;
  obtained: number;
}

export interface CartState {
  uid: number;
  id: string;
  level: number;
  exp: number;
  asc: number;
  rank: number;
}

export interface PityState {
  five: number;
  four: number;
  guar5: boolean;
  guar4: boolean;
  total: number;
}

export interface DiveRecord {
  at: number;
  banner: string;
  kind: 'char' | 'cart';
  id: string;
  rarity: number;
}

export interface StoryState {
  /** 스테이지 id → 별(비트: 1 클리어, 2 전원 생존, 4 제한 라운드) */
  cleared: Record<string, number>;
  chapters: string[];
  trust: { nox: number; white: number; loop: number };
  flags: Record<string, number>;
  /** 선택지 id → 고른 번호 */
  choices: Record<string, number>;
  /** 선택지 id → 그 선택지를 고른 챕터(챕터 선택용) */
  choiceChapter: Record<string, string>;
  seen: string[];
  endings: string[];
  /** 보통 난이도에서 이어지는 체력 (캐릭터 id → 0~1) */
  hp: Record<string, number>;
  /** 다음에 할 스테이지 (결과 화면의 "다음 스테이지") */
  next?: string;
}

export interface MissionProgress {
  id: string;
  p: number;
  claimed: boolean;
}

export interface DailyState {
  day: string;
  list: MissionProgress[];
  allClaimed: boolean;
  /** 받지 못한 일일 완료 보상 수(최대 3) */
  backlog: number;
  week: string;
  weekly: MissionProgress[];
}

export interface DeepState {
  period: string;
  /** 층 → 별 비트 */
  stars: Record<string, number>;
  claimed: number[];
  weeklyClaimed: number[];
}

export interface LoopState {
  week: string;
  score: number;
  weeklyClaimed: boolean;
  firstClear: number[];
  /** 진행 중인 루프(없으면 null) */
  run: unknown;
  patches: string[];
  events: string[];
  maxDifficulty: number;
}

export interface SaveV2 {
  version: 2;
  created: number;
  updated: number;
  name: string;
  started: boolean;
  settings: Settings;
  seenCutins: string[];
  seenDive: string[];
  tutorials: string[];
  rank: { level: number; exp: number };
  /** 재화와 재료 수량 */
  wallet: Record<string, number>;
  chars: Record<string, CharState>;
  carts: CartState[];
  nextCart: number;
  party: string[];
  partyB: string[];
  rep: string;
  repTouches: number;
  runnerForm: string;
  runnerForms: string[];
  story: StoryState;
  gacha: {
    pity: Record<string, PityState>;
    beginner: number;
    standardPulls: number;
    standardPicked: boolean;
    history: DiveRecord[];
    keyExMonth: string;
    keyExCount: number;
  };
  mats: { stars: Record<string, number>; sweeps: Record<string, { day: string; n: number }>; weekly: { week: string; n: number } };
  daily: DailyState;
  deep: DeepState;
  loop: LoopState;
  codex: { enemies: string[]; claimed: string[] };
  ach: { done: Record<string, number>; claimed: string[] };
  stats: Record<string, number>;
}

export type SaveData = SaveV2;

export function defaultSettings(): Settings {
  return { speed: 1, difficulty: 'story', cutin: 'first', skipBossIntro: false, skipVictory: false, storyAlwaysSkip: false, autoText: false, instantText: false, bgm: 0.6, sfx: 0.8, bigText: false, calm: false };
}

export function newCharState(id: string, now = Date.now()): CharState {
  return { id, level: 1, exp: 0, asc: 0, skills: { basic: 1, skill: 1, overclock: 1, trait: 1 }, big: [], small: [], sync: 0, cart: null, obtained: now };
}

export function newSave(now = Date.now()): SaveData {
  return {
    version: 2,
    created: now,
    updated: now,
    name: '러너',
    started: false,
    settings: defaultSettings(),
    seenCutins: [],
    seenDive: [],
    tutorials: [],
    rank: { level: 1, exp: 0 },
    wallet: {},
    chars: { runner: newCharState('runner', now) },
    carts: [],
    nextCart: 1,
    party: ['runner'],
    partyB: [],
    rep: 'runner',
    repTouches: 0,
    runnerForm: 'debug',
    runnerForms: ['debug'],
    story: { cleared: {}, chapters: [], trust: { nox: 0, white: 0, loop: 0 }, flags: {}, choices: {}, choiceChapter: {}, seen: [], endings: [], hp: {} },
    gacha: { pity: {}, beginner: 0, standardPulls: 0, standardPicked: false, history: [], keyExMonth: '', keyExCount: 0 },
    mats: { stars: {}, sweeps: {}, weekly: { week: '', n: 0 } },
    daily: { day: '', list: [], allClaimed: false, backlog: 0, week: '', weekly: [] },
    deep: { period: '', stars: {}, claimed: [], weeklyClaimed: [] },
    loop: { week: '', score: 0, weeklyClaimed: false, firstClear: [], run: null, patches: [], events: [], maxDifficulty: 1 },
    codex: { enemies: [], claimed: [] },
    ach: { done: {}, claimed: [] },
    stats: {},
  };
}

type AnySave = { version: number } & Record<string, unknown>;
/** MIGRATIONS[n]은 버전 n 저장을 n+1로 바꾼다 */
export const MIGRATIONS: Record<number, (old: AnySave) => AnySave> = {
  // v1(전투 프로토타입): 설정과 본 컷인만 있었다
  1: (old) => {
    const fresh = newSave() as unknown as AnySave;
    const s = (old.settings ?? {}) as Partial<Settings>;
    return { ...fresh, settings: { ...defaultSettings(), ...s }, seenCutins: Array.isArray(old.seenCutins) ? old.seenCutins : [] };
  },
};

/** 빠진 칸은 기본값으로 채우고, 종류가 다른 칸(손으로 고친 파일, 깨진 파일)은 기본값으로 되돌린다 */
function fillDefaults<T>(base: T, data: unknown): T {
  if (data === undefined || data === null) return base;
  if (Array.isArray(base)) return (Array.isArray(data) ? data : base) as T;
  if (base === null) return data as T;
  if (typeof base === 'number') return (typeof data === 'number' && Number.isFinite(data) ? data : base) as T;
  if (typeof base !== 'object') return (typeof data === typeof base ? data : base) as T;
  if (typeof data !== 'object' || Array.isArray(data)) return base;
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const [k, v] of Object.entries(base as Record<string, unknown>)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) out[k] = fillDefaults(v, out[k]);
    else out[k] = fillDefaults(v, out[k]);
  }
  return out as T;
}

/** 재화·재료 같은 "이름 → 숫자" 칸에서 숫자가 아닌 값을 걸러낸다 */
function cleanCounts(rec: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
  return out;
}

function repair(save: SaveData): SaveData {
  save.wallet = cleanCounts(save.wallet);
  save.stats = cleanCounts(save.stats);
  for (const [id, c] of Object.entries(save.chars)) save.chars[id] = fillDefaults(newCharState(id), c);
  if (!save.chars.runner) save.chars.runner = newCharState('runner');
  return save;
}

export function migrate(raw: unknown): SaveData {
  if (!raw || typeof raw !== 'object' || typeof (raw as { version?: unknown }).version !== 'number') return newSave();
  let data = raw as AnySave;
  if (data.version > SAVE_VERSION) throw new Error(`이 게임보다 새 버전의 저장 데이터예요 (v${data.version})`);
  while (data.version < SAVE_VERSION) {
    const m = MIGRATIONS[data.version];
    if (!m) throw new Error(`저장 데이터 변환 규칙이 없음: v${data.version}`);
    data = m(data);
  }
  return repair(fillDefaults(newSave(), data));
}

export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): boolean | void;
}

export const browserStorage: Storage = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      /* 저장 공간이 막힌 환경: 이번 실행 동안만 유지 */
      return false;
    }
  },
};

export function loadSave(storage: Storage = browserStorage): SaveData {
  const text = storage.get(SAVE_KEY);
  if (!text) return newSave();
  try {
    return migrate(JSON.parse(text));
  } catch {
    return newSave();
  }
}

/** 저장했으면 true. 저장 공간이 막혀 있으면 false(이번 실행 동안만 유지됨) */
export function writeSave(data: SaveData, storage: Storage = browserStorage): boolean {
  data.updated = Date.now();
  return storage.set(SAVE_KEY, JSON.stringify(data)) !== false;
}

/** 내보내기용 문자열 */
export function exportSave(data: SaveData): string {
  return JSON.stringify(data);
}

/** 불러오기. 잘못된 파일이면 예외 */
export function importSave(text: string): SaveData {
  const raw = JSON.parse(text);
  if (!raw || typeof raw.version !== 'number') throw new Error('네온 프로토콜 저장 파일이 아니에요');
  return migrate(raw);
}
