// 업적과 도감. 업적 진행도는 save.stats 또는 저장 데이터에서 계산한 값으로 읽는다.
import { DATA, type GameData } from './data';
import type { AchievementDef } from './defs';
import type { SaveData } from './save';
import { grant, type Granted } from './state';

/** 업적이 읽는 값 */
export function statValue(save: SaveData, key: string, data: GameData = DATA): number {
  const [k, arg] = key.split(':');
  const chars = Object.values(save.chars);
  switch (k) {
    case 'chapter':
      return save.story.chapters.includes(arg) ? 1 : 0;
    case 'ending':
      return save.story.endings.includes(arg) ? 1 : 0;
    case 'endingsSeen':
      return save.story.endings.length;
    case 'stagesCleared':
      return Object.keys(save.story.cleared).length;
    case 'storyStars':
      return Object.values(save.story.cleared).reduce((s, b) => s + (b & 1 ? 1 : 0) + (b & 2 ? 1 : 0) + (b & 4 ? 1 : 0), 0);
    case 'trustAll5': {
      const t = save.story.trust;
      return t.nox >= 5 && t.white >= 5 && t.loop >= 5 ? 1 : 0;
    }
    case 'charsOwned':
      return chars.length;
    case 'maxSync':
      return Math.max(0, ...chars.map((c) => c.sync));
    case 'cartsOwned':
      return new Set(save.carts.map((c) => c.id)).size;
    case 'codexCount':
      return codexEntries(save, data).filter((e) => e.unlocked).length;
    case 'patchCount':
      return save.loop.patches.length;
    case 'maxLevel':
      return Math.max(0, ...chars.map((c) => c.level));
    case 'maxAsc':
      return Math.max(0, ...chars.map((c) => c.asc));
    case 'maxSkill':
      return Math.max(0, ...chars.flatMap((c) => Object.values(c.skills)));
    case 'rankLevel':
      return save.rank.level;
    case 'runnerForms':
      return save.runnerForms.length;
    case 'maxCartLevel':
      return Math.max(0, ...save.carts.map((c) => c.level));
    case 'nodesOpened':
      return chars.reduce((s, c) => s + c.big.length + c.small.length, 0);
    case 'party50':
      return save.party.length >= 4 && save.party.every((id) => (save.chars[id]?.level ?? 0) >= 50) ? 1 : 0;
    case 'repOther':
      return save.rep !== 'runner' ? 1 : 0;
    case 'customName':
      return save.name && save.name !== '러너' ? 1 : 0;
    case 'achAll':
      return data.achievements.every((a) => a.stat === 'achAll' || save.ach.done[a.id]) ? 1 : 0;
    default:
      return save.stats[key] ?? 0;
  }
}

export function achProgress(save: SaveData, a: AchievementDef, data: GameData = DATA): { value: number; done: boolean } {
  const value = statValue(save, a.stat, data);
  return { value: Math.min(value, a.target), done: !!save.ach.done[a.id] || value >= a.target };
}

/** 새로 달성한 업적을 기록하고 돌려준다 */
export function checkAchievements(save: SaveData, now = Date.now(), data: GameData = DATA): AchievementDef[] {
  const out: AchievementDef[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const a of data.achievements) {
      if (save.ach.done[a.id]) continue;
      if (statValue(save, a.stat, data) >= a.target) {
        save.ach.done[a.id] = now;
        out.push(a);
      }
    }
  }
  return out;
}

export function achClaimable(save: SaveData, data: GameData = DATA): AchievementDef[] {
  return data.achievements.filter((a) => save.ach.done[a.id] && !save.ach.claimed.includes(a.id));
}

export function claimAchievements(save: SaveData, ids?: string[], data: GameData = DATA): Granted {
  const list = achClaimable(save, data).filter((a) => !ids || ids.includes(a.id));
  const reward: Record<string, number> = {};
  for (const a of list) {
    save.ach.claimed.push(a.id);
    for (const [k, v] of Object.entries(a.reward)) reward[k] = (reward[k] ?? 0) + v;
  }
  return grant(save, reward, data);
}

// ───────────────────────── 도감

export type CodexKind = 'char' | 'enemy' | 'cart' | 'ending' | 'patch' | 'event';

export interface CodexEntry {
  id: string;
  kind: CodexKind;
  ref: string;
  name: string;
  unlocked: boolean;
}

export function codexEntries(save: SaveData, data: GameData = DATA): CodexEntry[] {
  const out: CodexEntry[] = [];
  for (const c of Object.values(data.characters)) out.push({ id: `char:${c.id}`, kind: 'char', ref: c.id, name: c.name, unlocked: !!save.chars[c.id] });
  for (const e of Object.values(data.enemies)) out.push({ id: `enemy:${e.id}`, kind: 'enemy', ref: e.id, name: e.name, unlocked: save.codex.enemies.includes(e.id) });
  for (const c of Object.values(data.cartridges)) out.push({ id: `cart:${c.id}`, kind: 'cart', ref: c.id, name: c.name, unlocked: save.carts.some((x) => x.id === c.id) });
  for (const id of ['A', 'B', 'C']) out.push({ id: `ending:${id}`, kind: 'ending', ref: id, name: `엔딩 ${id}`, unlocked: save.story.endings.includes(id) });
  for (const p of Object.values(data.patches)) out.push({ id: `patch:${p.id}`, kind: 'patch', ref: p.id, name: p.name, unlocked: save.loop.patches.includes(p.id) });
  for (const ev of Object.values(data.loopEvents)) out.push({ id: `event:${ev.id}`, kind: 'event', ref: ev.id, name: ev.title, unlocked: save.loop.events.includes(ev.id) });
  return out;
}

export function codexClaimable(save: SaveData, data: GameData = DATA): CodexEntry[] {
  return codexEntries(save, data).filter((e) => e.unlocked && !save.codex.claimed.includes(e.id));
}

/** 처음 채운 도감 항목마다 샤드를 조금씩 */
export function claimCodex(save: SaveData, data: GameData = DATA): Granted {
  const list = codexClaimable(save, data);
  for (const e of list) save.codex.claimed.push(e.id);
  return grant(save, { shard: list.length * data.balance.economy.codexShards }, data);
}

export function noteEnemies(save: SaveData, ids: string[]) {
  for (const id of ids) if (!save.codex.enemies.includes(id)) save.codex.enemies.push(id);
}
