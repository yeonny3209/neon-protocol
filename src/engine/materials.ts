// 재료 스테이지와 소탕. 한 번 별 3개로 깬 단계는 소탕으로 즉시 보상을 받는다(스테이지당 하루 30회).
import type { BattleSetup } from './battle/types';
import { DATA, type GameData } from './data';
import type { Reward } from './defs';
import { allyFromSave } from './growth';
import { validParty } from './party';
import type { SaveData } from './save';
import { dayKey, grant, scaleReward, track, weekKey, type Granted } from './state';

export const matKey = (id: string, tier: number) => `${id}#${tier}`;

export function tierOpen(save: SaveData, id: string, tier: number, data: GameData = DATA): boolean {
  const t = data.materials[id]?.tiers[tier];
  return !!t && save.rank.level >= t.rank;
}

export function tierStars(save: SaveData, id: string, tier: number): number {
  return save.mats.stars[matKey(id, tier)] ?? 0;
}

export function canSweepTier(save: SaveData, id: string, tier: number): boolean {
  return tierStars(save, id, tier) === 7;
}

export function sweepsLeft(save: SaveData, id: string, now = new Date(), data: GameData = DATA): number {
  const s = save.mats.sweeps[id];
  const used = s && s.day === dayKey(now) ? s.n : 0;
  return Math.max(0, data.balance.economy.sweepDailyLimit - used);
}

/** 주간 보스 보상은 주 3회 */
export function weeklyLeft(save: SaveData, now = new Date(), data: GameData = DATA): number {
  const w = save.mats.weekly;
  const used = w.week === weekKey(now) ? w.n : 0;
  return Math.max(0, data.balance.materials.weeklyLimit - used);
}

function useWeekly(save: SaveData, n: number, now: Date) {
  const wk = weekKey(now);
  if (save.mats.weekly.week !== wk) save.mats.weekly = { week: wk, n: 0 };
  save.mats.weekly.n += n;
}

/** times번 받을 보상. 주간 보스는 남은 횟수만큼만 */
export function tierReward(save: SaveData, id: string, tier: number, times: number, now = new Date(), data: GameData = DATA): Reward {
  const m = data.materials[id];
  const base = m.tiers[tier].reward;
  if (m.kind !== 'weekly') return scaleReward(base, times);
  const n = Math.min(times, weeklyLeft(save, now, data));
  const r: Reward = { credit: (base.credit ?? 0) * times };
  if (n > 0) r.weekly = (base.weekly ?? 0) * n;
  return r;
}

export function materialSetup(save: SaveData, id: string, tier: number, seed: number, data: GameData = DATA): BattleSetup {
  const t = data.materials[id].tiers[tier];
  return {
    allies: validParty(save).map((c) => allyFromSave(save, c, data)),
    enemies: t.enemies.map((e) => ({ defId: e, level: t.level })),
    seed,
    difficulty: save.settings.difficulty,
  };
}

/** 전투로 클리어했을 때 */
export function clearTier(save: SaveData, id: string, tier: number, stars: number, now = new Date(), data: GameData = DATA): Granted {
  const k = matKey(id, tier);
  save.mats.stars[k] = (save.mats.stars[k] ?? 0) | stars;
  const r = tierReward(save, id, tier, 1, now, data);
  if (r.weekly) useWeekly(save, 1, now);
  return grant(save, { ...r, rankExp: data.balance.economy.rankExp.battleWin }, data);
}

export type SweepResult = Granted | 'stars' | 'limit' | 'locked';

export function sweep(save: SaveData, id: string, tier: number, times: number, now = new Date(), data: GameData = DATA): SweepResult {
  if (!tierOpen(save, id, tier, data)) return 'locked';
  if (!canSweepTier(save, id, tier)) return 'stars';
  if (sweepsLeft(save, id, now, data) < times) return 'limit';
  const r = tierReward(save, id, tier, times, now, data);
  if (r.weekly) useWeekly(save, r.weekly / (data.materials[id].tiers[tier].reward.weekly ?? 1), now);
  const day = dayKey(now);
  const s = save.mats.sweeps[id];
  save.mats.sweeps[id] = { day, n: (s && s.day === day ? s.n : 0) + times };
  const got = grant(save, { ...r, rankExp: data.balance.economy.rankExp.sweep * times }, data);
  track(save, 'sweep', times);
  return got;
}

/** 재료 아이템 → 그 재료를 주는 스테이지(아이템의 "이동" 버튼) */
export function stageForItem(itemId: string, data: GameData = DATA): string | undefined {
  return data.items[itemId]?.stage;
}
