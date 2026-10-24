// 데일리 루틴: 하루 4개(+ 주간 3개). 하루를 빠져도 보상을 최대 3일치까지 모아 받는다("밀린 루틴").
import { DATA, type GameData } from './data';
import type { MissionDef } from './defs';
import type { MissionProgress, SaveData } from './save';
import { dayKey, daysBetween, grant, onTrack, scaleReward, track, weekKey, type Granted } from './state';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 그날의 미션 4개(슬롯마다 하나) */
export function dailyDefs(day: string, data: GameData = DATA): MissionDef[] {
  return data.missions.daily.map((slot, i) => slot.variants[hash(`${day}:${i}`) % slot.variants.length]);
}

export function missionDef(id: string, data: GameData = DATA): MissionDef | undefined {
  for (const s of data.missions.daily) for (const v of s.variants) if (v.id === id) return v;
  return data.missions.weekly.find((w) => w.id === id);
}

export function dailyUnlocked(save: SaveData, data: GameData = DATA): boolean {
  return save.story.chapters.includes(data.balance.daily.unlockChapter);
}

/** 날짜·주가 바뀌었으면 새 미션으로 바꾸고, 못 받은 보상을 밀린 루틴에 쌓는다 */
export function ensureDaily(save: SaveData, now = new Date(), data: GameData = DATA) {
  const today = dayKey(now);
  const d = save.daily;
  if (d.day !== today) {
    if (d.day) {
      let missed = d.allClaimed ? 0 : 1;
      missed += Math.max(0, daysBetween(d.day, today) - 1);
      d.backlog = Math.min(data.balance.daily.backlogDays, d.backlog + missed);
    }
    d.day = today;
    d.list = dailyDefs(today, data).map((m) => ({ id: m.id, p: 0, claimed: false }));
    d.allClaimed = false;
  }
  const wk = weekKey(now);
  if (d.week !== wk) {
    d.week = wk;
    d.weekly = data.missions.weekly.map((m) => ({ id: m.id, p: 0, claimed: false }));
  }
}

export function isDone(m: MissionProgress, data: GameData = DATA): boolean {
  const def = missionDef(m.id, data);
  return !!def && m.p >= def.n;
}

export function allDailyDone(save: SaveData, data: GameData = DATA): boolean {
  return save.daily.list.length > 0 && save.daily.list.every((m) => isDone(m, data));
}

export function claimDaily(save: SaveData, data: GameData = DATA): Granted | null {
  if (save.daily.allClaimed || !allDailyDone(save, data)) return null;
  save.daily.allClaimed = true;
  track(save, 'dailyDone');
  return grant(save, { ...data.balance.daily.allReward, rankExp: data.balance.economy.rankExp.dailyAll }, data);
}

/** 밀린 루틴: 쌓인 날 수만큼 일일 완료 보상을 한 번에 */
export function claimBacklog(save: SaveData, data: GameData = DATA): Granted | null {
  const n = save.daily.backlog;
  if (n <= 0) return null;
  save.daily.backlog = 0;
  return grant(save, scaleReward(data.balance.daily.allReward, n), data);
}

export function claimWeekly(save: SaveData, id: string, data: GameData = DATA): Granted | null {
  const m = save.daily.weekly.find((x) => x.id === id);
  if (!m || m.claimed || !isDone(m, data)) return null;
  m.claimed = true;
  return grant(save, data.balance.daily.weeklyReward, data);
}

export function missionsClaimable(save: SaveData, data: GameData = DATA): boolean {
  if (!dailyUnlocked(save, data)) return false;
  return (allDailyDone(save, data) && !save.daily.allClaimed) || save.daily.backlog > 0 || save.daily.weekly.some((m) => !m.claimed && isDone(m, data));
}

// 진행도: state.track()으로 들어오는 이벤트를 센다
onTrack((save, ev, n) => {
  if (!save.daily?.list) return;
  for (const m of [...save.daily.list, ...save.daily.weekly]) {
    const def = missionDef(m.id);
    if (def && def.ev === ev && m.p < def.n) m.p = Math.min(def.n, m.p + n);
  }
});
