// 저장 데이터를 바꾸는 공통 동작: 보상 지급, 재화 소모, 러너 등급, 캐릭터·카트리지 획득.
import type { Reward } from './defs';
import { DATA, type GameData } from './data';
import { newCharState, type SaveData } from './save';

export function count(save: SaveData, id: string): number {
  return save.wallet[id] ?? 0;
}

export function addItem(save: SaveData, id: string, n: number) {
  save.wallet[id] = Math.max(0, (save.wallet[id] ?? 0) + n);
}

/** 모자란 만큼을 돌려준다. 다 있으면 빈 객체 */
export function missing(save: SaveData, cost: Reward): Reward {
  const out: Reward = {};
  for (const [id, n] of Object.entries(cost)) {
    const lack = n - count(save, id);
    if (lack > 0) out[id] = lack;
  }
  return out;
}

export function canAfford(save: SaveData, cost: Reward): boolean {
  return Object.keys(missing(save, cost)).length === 0;
}

/** 전부 있을 때만 한꺼번에 뺀다 */
export function spend(save: SaveData, cost: Reward): boolean {
  if (!canAfford(save, cost)) return false;
  for (const [id, n] of Object.entries(cost)) addItem(save, id, -n);
  return true;
}

export function mergeReward(...rs: Reward[]): Reward {
  const out: Reward = {};
  for (const r of rs) for (const [k, v] of Object.entries(r)) out[k] = (out[k] ?? 0) + v;
  return out;
}

export function scaleReward(r: Reward, m: number): Reward {
  const out: Reward = {};
  for (const [k, v] of Object.entries(r)) out[k] = Math.round(v * m);
  return out;
}

// ───────────────────────── 통계와 이벤트(미션·업적이 듣는다)

type Listener = (save: SaveData, ev: string, n: number) => void;
const listeners: Listener[] = [];

export function onTrack(fn: Listener) {
  listeners.push(fn);
}

export function track(save: SaveData, ev: string, n = 1) {
  save.stats[ev] = (save.stats[ev] ?? 0) + n;
  for (const l of listeners) l(save, ev, n);
}

export function setMaxStat(save: SaveData, ev: string, v: number) {
  if ((save.stats[ev] ?? 0) < v) save.stats[ev] = v;
}

// ───────────────────────── 러너 등급

export interface RankUp {
  from: number;
  to: number;
  reward: Reward;
}

export function rankExpToNext(level: number, data: GameData = DATA): number {
  const t = data.balance.economy.runnerRank.expPerRank;
  return t[level] ?? t[t.length - 1];
}

export function addRankExp(save: SaveData, amount: number, data: GameData = DATA): RankUp | null {
  const rr = data.balance.economy.runnerRank;
  const from = save.rank.level;
  if (from >= rr.max) return null;
  save.rank.exp += amount;
  const reward: Reward = {};
  while (save.rank.level < rr.max && save.rank.exp >= rankExpToNext(save.rank.level, data)) {
    save.rank.exp -= rankExpToNext(save.rank.level, data);
    save.rank.level++;
    reward.shard = (reward.shard ?? 0) + rr.shardsPerRank;
    if (save.rank.level % rr.keysEvery === 0) reward.key = (reward.key ?? 0) + rr.keysPerMilestone;
  }
  if (save.rank.level >= rr.max) save.rank.exp = 0;
  if (save.rank.level === from) return null;
  for (const [k, v] of Object.entries(reward)) addItem(save, k, v);
  return { from, to: save.rank.level, reward };
}

// ───────────────────────── 캐릭터·카트리지 획득

export interface CharGain {
  id: string;
  isNew: boolean;
  sync: number;
  signal: number;
}

export function addCharacter(save: SaveData, id: string, data: GameData = DATA): CharGain {
  const def = data.characters[id];
  if (!def) throw new Error(`없는 캐릭터: ${id}`);
  const have = save.chars[id];
  if (!have) {
    save.chars[id] = newCharState(id);
    track(save, 'charsOwned');
    return { id, isNew: true, sync: 0, signal: 0 };
  }
  if (have.sync < 6) {
    have.sync++;
    return { id, isNew: false, sync: have.sync, signal: 0 };
  }
  const sig = def.rarity === 5 ? data.balance.gacha.signal.dupFiveOverflow : data.balance.gacha.signal.dupFourOverflow;
  addItem(save, 'signal', sig);
  return { id, isNew: false, sync: 6, signal: sig };
}

export interface CartGain {
  id: string;
  uid: number;
  isNew: boolean;
  rank: number;
  data: number;
}

/** 첫 획득은 새 카트리지, 중복은 중첩(최대 5), 그 뒤는 카트리지 데이터로 바뀐다 */
export function addCartridge(save: SaveData, id: string, data: GameData = DATA): CartGain {
  const def = data.cartridges[id];
  if (!def) throw new Error(`없는 카트리지: ${id}`);
  const own = save.carts.filter((c) => c.id === id).sort((a, b) => a.rank - b.rank)[0];
  if (!own) {
    const uid = save.nextCart++;
    save.carts.push({ uid, id, level: 1, exp: 0, asc: 0, rank: 1 });
    return { id, uid, isNew: true, rank: 1, data: 0 };
  }
  if (own.rank < 5) {
    own.rank++;
    return { id, uid: own.uid, isNew: false, rank: own.rank, data: 0 };
  }
  const exp = (data.balance.cartridge.fodderExp as Record<string, number>)[String(def.rarity)] ?? 1000;
  addItem(save, 'cart_data', exp);
  return { id, uid: own.uid, isNew: false, rank: 5, data: exp };
}

export interface Granted {
  items: Reward;
  chars: CharGain[];
  carts: CartGain[];
  rank: RankUp | null;
}

/** 보상 지급. 키: 재화·재료 id, "char:<id>", "cart:<id>", "rankExp" */
export function grant(save: SaveData, reward: Reward, data: GameData = DATA): Granted {
  const out: Granted = { items: {}, chars: [], carts: [], rank: null };
  for (const [k, n] of Object.entries(reward)) {
    if (!n) continue;
    if (k.startsWith('char:')) for (let i = 0; i < n; i++) out.chars.push(addCharacter(save, k.slice(5), data));
    else if (k.startsWith('cart:')) for (let i = 0; i < n; i++) out.carts.push(addCartridge(save, k.slice(5), data));
    else if (k === 'rankExp') out.rank = addRankExp(save, n, data);
    else {
      addItem(save, k, n);
      out.items[k] = (out.items[k] ?? 0) + n;
    }
  }
  if (out.rank) for (const [k, v] of Object.entries(out.rank.reward)) out.items[k] = (out.items[k] ?? 0) + v;
  return out;
}

// ───────────────────────── 날짜(일일·주간 초기화는 기기 시간 새벽 4시 기준)

export function dayKey(now: Date = new Date(), resetHour = DATA.balance.economy.dailyReset): string {
  const d = new Date(now.getTime() - resetHour * 3600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function weekKey(now: Date = new Date(), resetHour = DATA.balance.economy.dailyReset): string {
  const d = new Date(now.getTime() - resetHour * 3600_000);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

export function monthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);
}
