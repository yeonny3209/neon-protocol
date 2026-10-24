// 딥 서버(도전 탑): 12층, 7층부터 파티 두 개, 층마다 별 3개, 2주마다 적 구성·서버 환경·별 초기화.
import type { Battle } from './battle/battle';
import type { BattleSetup } from './battle/types';
import { DATA, type GameData } from './data';
import type { DeepEnvDef, DeepFloorDef } from './defs';
import { allyFromSave } from './growth';
import type { SaveData } from './save';
import { grant, setMaxStat, track, type Granted } from './state';

export function deepPeriod(now: Date, data: GameData = DATA): number {
  const epoch = Date.parse(`${data.balance.gacha.bannerEpoch}T00:00:00`);
  return Math.floor(Math.floor((now.getTime() - epoch) / 86400_000) / data.balance.deep.periodDays);
}

export function deepEnv(now: Date, data: GameData = DATA): DeepEnvDef {
  const envs = data.deep.envs;
  const p = deepPeriod(now, data);
  return envs[((p % envs.length) + envs.length) % envs.length];
}

export function deepPeriodEnd(now: Date, data: GameData = DATA): Date {
  const epoch = Date.parse(`${data.balance.gacha.bannerEpoch}T00:00:00`);
  return new Date(epoch + (deepPeriod(now, data) + 1) * data.balance.deep.periodDays * 86400_000);
}

export function deepUnlocked(save: SaveData, data: GameData = DATA): boolean {
  return save.story.chapters.includes(data.balance.deep.unlockChapter);
}

/** 기간이 바뀌었으면 별과 받은 보상을 초기화(보상은 다시 받을 수 있다) */
export function ensureDeep(save: SaveData, now = new Date(), data: GameData = DATA) {
  const key = String(deepPeriod(now, data));
  if (save.deep.period !== key) save.deep = { period: key, stars: {}, claimed: [], weeklyClaimed: [] };
}

/** 2주마다 바뀌는 적 구성: 같은 층의 적을 기간마다 한 칸씩 돌린다 */
export function floorEnemies(f: DeepFloorDef, part: 'A' | 'B', now: Date, data: GameData = DATA): string[] {
  const list = part === 'A' ? f.partA : f.partB ?? [];
  const p = deepPeriod(now, data);
  const k = ((p % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

export function floorStars(save: SaveData, floor: number): number {
  return save.deep.stars[String(floor)] ?? 0;
}

export function floorOpen(save: SaveData, floor: number): boolean {
  return floor === 1 || floorStars(save, floor - 1) > 0;
}

export function starCount(bits: number): number {
  return (bits & 1 ? 1 : 0) + (bits & 2 ? 1 : 0) + (bits & 4 ? 1 : 0);
}

export function totalStars(save: SaveData): number {
  return Object.values(save.deep.stars).reduce((s, b) => s + starCount(b), 0);
}

export function needsTwoTeams(floor: number, data: GameData = DATA): boolean {
  return floor >= data.balance.deep.twoTeamsFrom;
}

export function deepSetup(save: SaveData, floor: number, part: 'A' | 'B', party: string[], seed: number, now = new Date(), data: GameData = DATA): BattleSetup {
  const f = data.deep.floors[floor - 1];
  return {
    allies: party.filter((id) => save.chars[id]).map((id) => allyFromSave(save, id, data)),
    enemies: floorEnemies(f, part, now, data).map((e) => ({ defId: e, level: f.level })),
    seed,
    difficulty: 'fixed',
    diffMult: { enemyHp: f.hp, enemyAtk: f.atk, enemyFirewall: f.fw },
    elementBonus: deepEnv(now, data).elementBonus,
  };
}

/** 한 파트(또는 한 층) 결과에서 별 계산: 1 클리어, 2 전원 생존, 4 제한 라운드 안 */
export function partStars(b: Battle, floor: number, data: GameData = DATA): number {
  if (b.phase !== 'won') return 0;
  let s = 1;
  if (b.allies(false).every((u) => u.alive)) s |= 2;
  if (b.round() <= data.deep.floors[floor - 1].rounds) s |= 4;
  return s;
}

export interface DeepResult {
  stars: number;
  got: Granted;
}

/** 층 클리어 기록. 두 파트면 두 결과의 별을 AND로 합친다. 별 총합이 기준을 넘으면 보상을 준다 */
export function recordFloor(save: SaveData, floor: number, stars: number, data: GameData = DATA): DeepResult {
  const k = String(floor);
  save.deep.stars[k] = (save.deep.stars[k] ?? 0) | stars;
  const total = totalStars(save);
  const reward: Record<string, number> = {};
  for (const r of data.balance.deep.starRewards) {
    if (total >= r.stars && !save.deep.claimed.includes(r.stars)) {
      save.deep.claimed.push(r.stars);
      reward.shard = (reward.shard ?? 0) + r.shard;
    }
  }
  for (const s of data.balance.deep.starWeeklyMat.stars) {
    if (total >= s && !save.deep.weeklyClaimed.includes(s)) {
      save.deep.weeklyClaimed.push(s);
      reward.weekly = (reward.weekly ?? 0) + data.balance.deep.starWeeklyMat.weekly;
    }
  }
  if (stars & 1) {
    setMaxStat(save, 'deepFloor', floor);
    reward.rankExp = data.balance.economy.rankExp.deepFloor;
  }
  setMaxStat(save, 'deepStarsMax', total);
  return { stars: save.deep.stars[k], got: grant(save, reward, data) };
}

export function noteDeepAttempt(save: SaveData) {
  track(save, 'deepAttempt');
}
