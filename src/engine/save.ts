// 브라우저 저장. 맨 위 version 숫자로 구조를 구분하고, 구조가 바뀌면 MIGRATIONS에 변환을 추가한다.

export const SAVE_KEY = 'neon-protocol.save';

export interface Settings {
  speed: 1 | 2 | 3;
  difficulty: 'story' | 'normal';
  cutin: 'first' | 'always' | 'never';
  skipBossIntro: boolean;
  skipVictory: boolean;
}

export interface SaveV1 {
  version: 1;
  settings: Settings;
  seenCutins: string[];
}

export type SaveData = SaveV1;
export const SAVE_VERSION = 1;

export function defaultSettings(): Settings {
  return { speed: 1, difficulty: 'story', cutin: 'first', skipBossIntro: false, skipVictory: false };
}

export function newSave(): SaveData {
  return { version: 1, settings: defaultSettings(), seenCutins: [] };
}

type Migration = (old: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
/** MIGRATIONS[n]은 버전 n을 n+1로 바꾼다 */
export const MIGRATIONS: Record<number, Migration> = {};

export function migrate(raw: unknown): SaveData {
  if (!raw || typeof raw !== 'object' || typeof (raw as { version?: unknown }).version !== 'number') return newSave();
  let data = raw as { version: number };
  while (data.version < SAVE_VERSION) {
    const m = MIGRATIONS[data.version];
    if (!m) throw new Error(`저장 데이터 변환 규칙이 없음: v${data.version}`);
    data = m(data);
  }
  return { ...newSave(), ...(data as SaveData), settings: { ...defaultSettings(), ...(data as SaveData).settings } };
}

export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
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
    } catch {
      /* 저장 공간이 막힌 환경: 이번 실행 동안만 유지 */
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

export function writeSave(data: SaveData, storage: Storage = browserStorage) {
  storage.set(SAVE_KEY, JSON.stringify(data));
}
