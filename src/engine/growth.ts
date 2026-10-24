// 성장: 레벨·돌파·스킬·회로도·카트리지. 전부 "재료를 정해진 만큼 쓰면 확실히 강해지는" 구조다.
import type { CartridgeDef, Element, Reward, SkillKind } from './defs';
import { DATA, type GameData } from './data';
import { buildAlly, kitFor, type Loadout } from './loadout';
import type { AllySetup } from './battle/types';
import type { CartState, CharState, SaveData } from './save';
import { addItem, canAfford, count, mergeReward, missing, spend, track } from './state';

export type SkillSlot = SkillKind | 'trait';
export const SKILL_SLOTS: SkillSlot[] = ['skill', 'overclock', 'trait', 'basic'];
const PACKS = [
  { id: 'pack_l', exp: 10000 },
  { id: 'pack_m', exp: 2000 },
  { id: 'pack_s', exp: 500 },
];

const G = (data: GameData) => data.balance.growth;

export function expToNext(level: number, data: GameData = DATA): number {
  const e = G(data).exp;
  return Math.round(e.a * Math.pow(level, e.p) + e.b);
}

export function levelCap(asc: number, data: GameData = DATA): number {
  return G(data).levelCaps[Math.min(asc, G(data).levelCaps.length - 1)];
}

/** 지금 상태에서 target 레벨까지 필요한 경험치 */
export function expNeeded(level: number, exp: number, target: number, data: GameData = DATA): number {
  let need = -exp;
  for (let l = level; l < target; l++) need += expToNext(l, data);
  return Math.max(0, need);
}

/** 경험치를 넣었을 때 레벨(돌파 상한까지) */
export function applyExp(c: { level: number; exp: number; asc: number }, gained: number, data: GameData = DATA) {
  const cap = levelCap(c.asc, data);
  c.exp += gained;
  while (c.level < cap && c.exp >= expToNext(c.level, data)) {
    c.exp -= expToNext(c.level, data);
    c.level++;
  }
  if (c.level >= cap) c.exp = Math.min(c.exp, 0) || 0;
}

/** 필요한 경험치를 데이터 팩으로 채우는 방법. 큰 팩부터 넘치지 않게 쓰고, 마지막은 가장 작은 팩으로 메운다 */
export function packPlan(have: Record<string, number>, need: number): { use: Reward; exp: number } {
  const use: Reward = {};
  let left = need;
  for (const p of PACKS) {
    const n = Math.min(have[p.id] ?? 0, Math.floor(left / p.exp));
    if (n > 0) {
      use[p.id] = n;
      left -= n * p.exp;
    }
  }
  for (const p of [...PACKS].reverse()) {
    while (left > 0 && (have[p.id] ?? 0) - (use[p.id] ?? 0) > 0) {
      use[p.id] = (use[p.id] ?? 0) + 1;
      left -= p.exp;
    }
  }
  const exp = Object.entries(use).reduce((s, [id, n]) => s + n * (PACKS.find((p) => p.id === id)?.exp ?? 0), 0);
  return { use, exp };
}

export interface LevelResult {
  from: number;
  to: number;
  used: Reward;
  missing: Reward;
}

/** target 레벨까지(돌파 상한 안에서) 올린다. 팩이 모자라면 올릴 수 있는 만큼만 */
export function levelUp(save: SaveData, charId: string, target: number, data: GameData = DATA): LevelResult {
  const c = save.chars[charId];
  const from = c.level;
  const goal = Math.min(target, levelCap(c.asc, data));
  const need = expNeeded(c.level, c.exp, goal, data);
  if (need <= 0) return { from, to: from, used: {}, missing: {} };
  const plan = packPlan(save.wallet, need);
  const credits = Math.ceil(Math.min(plan.exp, need) * G(data).creditPerExp);
  const lackCredit = Math.max(0, credits - count(save, 'credit'));
  const lack: Reward = {};
  if (plan.exp < need) lack.pack_m = Math.ceil((need - plan.exp) / 2000);
  if (lackCredit > 0) {
    lack.credit = lackCredit;
    return { from, to: from, used: {}, missing: lack };
  }
  if (plan.exp <= 0) return { from, to: from, used: {}, missing: lack };
  spend(save, { ...plan.use, credit: credits });
  applyExp(c, plan.exp, data);
  if (c.level >= goal) c.exp = Math.min(c.exp, expToNext(c.level, data) - 1);
  if (c.level > from) track(save, 'grow');
  return { from, to: c.level, used: { ...plan.use, credit: credits }, missing: lack };
}

// ───────────────────────── 돌파

export function partId(el: Element, size: string): string {
  return `part_${el}_${size}`;
}

export function charElement(save: SaveData, charId: string, data: GameData = DATA): Element {
  const def = data.characters[charId];
  return charId === 'runner' ? kitFor(def, save.runnerForm).element : def.element;
}

/** 돌파 재료. 러너는 지금 형태의 속성 부품을 쓴다 */
export function ascensionCost(save: SaveData, charId: string, data: GameData = DATA): Reward | null {
  const c = save.chars[charId];
  const step = G(data).ascension[c.asc];
  if (!step) return null;
  const cost: Reward = { [partId(charElement(save, charId, data), step.part)]: step.parts, credit: step.credits };
  if (step.cores) cost.core = step.cores;
  return cost;
}

export function ascensionRankReq(asc: number, data: GameData = DATA): number {
  return G(data).ascensionRankReq[asc] ?? 99;
}

export type AscendCheck = { ok: true; cost: Reward } | { ok: false; reason: 'max' | 'level' | 'rank' | 'items'; cost?: Reward; missing?: Reward; need?: number };

export function canAscend(save: SaveData, charId: string, data: GameData = DATA): AscendCheck {
  const c = save.chars[charId];
  const cost = ascensionCost(save, charId, data);
  if (!cost) return { ok: false, reason: 'max' };
  if (c.level < levelCap(c.asc, data)) return { ok: false, reason: 'level', cost, need: levelCap(c.asc, data) };
  const req = ascensionRankReq(c.asc, data);
  if (save.rank.level < req) return { ok: false, reason: 'rank', cost, need: req };
  const lack = missing(save, cost);
  if (Object.keys(lack).length) return { ok: false, reason: 'items', cost, missing: lack };
  return { ok: true, cost };
}

export function ascend(save: SaveData, charId: string, data: GameData = DATA): boolean {
  const chk = canAscend(save, charId, data);
  if (!chk.ok) return false;
  spend(save, chk.cost);
  save.chars[charId].asc++;
  track(save, 'grow');
  track(save, 'ascend');
  return true;
}

// ───────────────────────── 스킬과 회로도

export function protocolOf(save: SaveData, charId: string, data: GameData = DATA) {
  const def = data.characters[charId];
  return charId === 'runner' ? kitFor(def, save.runnerForm).protocol : def.protocol;
}

export function skillCap(slot: SkillSlot, asc: number, data: GameData = DATA): number {
  return (G(data).skillCapByAscension as Record<string, number[]>)[slot][asc];
}

export function skillCost(save: SaveData, charId: string, slot: SkillSlot, data: GameData = DATA): Reward | null {
  const c = save.chars[charId];
  const to = c.skills[slot] + 1;
  if (to > (G(data).skillMax as Record<string, number>)[slot]) return null;
  const sc = G(data).skillCost;
  const cost: Reward = { [`chip_${protocolOf(save, charId, data)}`]: sc.chips[to], credit: sc.credits[to] };
  if (sc.weekly[to]) cost.weekly = sc.weekly[to];
  return cost;
}

export type UpCheck = { ok: true; cost: Reward } | { ok: false; reason: 'max' | 'cap' | 'items' | 'asc'; cost?: Reward; missing?: Reward; need?: number };

export function canSkillUp(save: SaveData, charId: string, slot: SkillSlot, data: GameData = DATA): UpCheck {
  const c = save.chars[charId];
  const cost = skillCost(save, charId, slot, data);
  if (!cost) return { ok: false, reason: 'max' };
  if (c.skills[slot] >= skillCap(slot, c.asc, data)) return { ok: false, reason: 'cap', cost };
  const lack = missing(save, cost);
  if (Object.keys(lack).length) return { ok: false, reason: 'items', cost, missing: lack };
  return { ok: true, cost };
}

export function skillUp(save: SaveData, charId: string, slot: SkillSlot, data: GameData = DATA): boolean {
  const chk = canSkillUp(save, charId, slot, data);
  if (!chk.ok) return false;
  spend(save, chk.cost);
  save.chars[charId].skills[slot]++;
  track(save, 'grow');
  return true;
}

export function nodeCost(save: SaveData, charId: string, type: 'big' | 'small', i: number, data: GameData = DATA): { cost: Reward; asc: number } {
  const g = type === 'big' ? G(data).bigNode : G(data).smallNode;
  const chip = `chip_${protocolOf(save, charId, data)}`;
  const cost: Reward = { [chip]: g.chips[i], credit: g.credits[i] };
  if (type === 'big' && G(data).bigNode.weekly[i]) cost.weekly = G(data).bigNode.weekly[i];
  return { cost, asc: g.ascension[i] };
}

export function canUnlockNode(save: SaveData, charId: string, type: 'big' | 'small', i: number, data: GameData = DATA): UpCheck {
  const c = save.chars[charId];
  const table = type === 'big' ? G(data).bigNode : G(data).smallNode;
  if (!Number.isInteger(i) || i < 0 || i >= table.chips.length) return { ok: false, reason: 'max' };
  if ((type === 'big' ? c.big : c.small).includes(i)) return { ok: false, reason: 'max' };
  const { cost, asc } = nodeCost(save, charId, type, i, data);
  if (c.asc < asc) return { ok: false, reason: 'asc', cost, need: asc };
  const lack = missing(save, cost);
  if (Object.keys(lack).length) return { ok: false, reason: 'items', cost, missing: lack };
  return { ok: true, cost };
}

export function unlockNode(save: SaveData, charId: string, type: 'big' | 'small', i: number, data: GameData = DATA): boolean {
  const chk = canUnlockNode(save, charId, type, i, data);
  if (!chk.ok) return false;
  spend(save, chk.cost);
  (type === 'big' ? save.chars[charId].big : save.chars[charId].small).push(i);
  track(save, 'grow');
  return true;
}

export type PlanStep = { kind: 'skill'; slot: SkillSlot; to: number } | { kind: 'big'; i: number } | { kind: 'small'; i: number };

/** 추천 순서: 전투스킬 → 오버클럭 → 특성을 한 단계씩 번갈아 올리고, 큰 노드는 열리는 대로, 작은 노드는 마지막 */
export function recommendedOrder(): PlanStep[] {
  const steps: PlanStep[] = [];
  for (let lv = 2; lv <= 10; lv++) {
    for (const slot of ['skill', 'overclock', 'trait'] as const) steps.push({ kind: 'skill', slot, to: lv });
    if (lv <= 6) steps.push({ kind: 'skill', slot: 'basic', to: lv });
    if (lv === 3) steps.push({ kind: 'big', i: 0 });
    if (lv === 5) steps.push({ kind: 'big', i: 1 });
    if (lv === 7) steps.push({ kind: 'big', i: 2 });
  }
  for (let i = 0; i < 10; i++) steps.push({ kind: 'small', i });
  return steps;
}

/** 추천 순서대로 연다. 재료가 모자란 단계를 만나면 거기서 멈춘다(뒤의 싼 것에 재료를 먼저 쓰지 않는다). 연 개수를 돌려준다 */
export function applyRecommended(save: SaveData, charId: string, data: GameData = DATA): number {
  const c = save.chars[charId];
  let done = 0;
  for (const st of recommendedOrder()) {
    if (st.kind === 'skill' && c.skills[st.slot] >= st.to) continue;
    const chk = st.kind === 'skill' ? canSkillUp(save, charId, st.slot, data) : canUnlockNode(save, charId, st.kind, st.i, data);
    if (!chk.ok && chk.reason === 'items') break;
    if (!chk.ok) continue;
    if (st.kind === 'skill') skillUp(save, charId, st.slot, data);
    else unlockNode(save, charId, st.kind, st.i, data);
    done++;
  }
  return done;
}

// ───────────────────────── 일괄 성장

export interface BatchResult {
  from: number;
  to: number;
  ascended: number;
  /** 목표에 닿지 못했다면 모자란 재료 */
  missing: Reward;
  /** 막힌 이유 */
  blocked?: 'rank' | 'items' | null;
}

/** 목표 레벨까지 레벨업과 돌파를 반복한다 */
export function batchGrow(save: SaveData, charId: string, target: number, data: GameData = DATA): BatchResult {
  const c = save.chars[charId];
  const from = c.level;
  let ascended = 0;
  let lack: Reward = {};
  let blocked: BatchResult['blocked'] = null;
  for (let guard = 0; guard < 20 && c.level < target; guard++) {
    const r = levelUp(save, charId, target, data);
    if (c.level >= target) break;
    if (c.level < levelCap(c.asc, data)) {
      lack = mergeReward(lack, r.missing);
      blocked = 'items';
      break;
    }
    const chk = canAscend(save, charId, data);
    if (chk.ok) {
      ascend(save, charId, data);
      ascended++;
      continue;
    }
    if (chk.reason === 'rank') blocked = 'rank';
    else if (chk.reason === 'items') {
      lack = mergeReward(lack, chk.missing ?? {});
      blocked = 'items';
    }
    break;
  }
  return { from, to: c.level, ascended, missing: lack, blocked };
}

/** 목표 레벨까지 필요한 재료 총량(지금 가진 것과 무관) */
export function totalCostToLevel(save: SaveData, charId: string, target: number, data: GameData = DATA): Reward {
  const c = save.chars[charId];
  let total: Reward = {};
  let asc = c.asc;
  let level = c.level;
  let exp = c.exp;
  const el = charElement(save, charId, data);
  while (level < target) {
    const cap = Math.min(target, levelCap(asc, data));
    const need = expNeeded(level, exp, cap, data);
    if (need > 0) total = mergeReward(total, { exp: need, credit: Math.ceil(need * G(data).creditPerExp) });
    level = cap;
    exp = 0;
    if (level >= target) break;
    const step = G(data).ascension[asc];
    if (!step) break;
    total = mergeReward(total, { [partId(el, step.part)]: step.parts, credit: step.credits, ...(step.cores ? { core: step.cores } : {}) });
    asc++;
  }
  return total;
}

// ───────────────────────── 카트리지

export function cartDef(c: CartState, data: GameData = DATA): CartridgeDef {
  return data.cartridges[c.id];
}

export function cartExpToNext(level: number, rarity: number, data: GameData = DATA): number {
  return Math.round(expToNext(level, data) * data.balance.cartridge.expMult * (rarity === 5 ? 1 : rarity === 4 ? 0.8 : 0.6));
}

export function cartLevelUp(save: SaveData, uid: number, target: number, data: GameData = DATA): LevelResult {
  const c = save.carts.find((x) => x.uid === uid)!;
  const def = cartDef(c, data);
  const from = c.level;
  const goal = Math.min(target, levelCap(c.asc, data));
  let need = -c.exp;
  for (let l = c.level; l < goal; l++) need += cartExpToNext(l, def.rarity, data);
  if (need <= 0) return { from, to: from, used: {}, missing: {} };
  const useExp = Math.min(need, count(save, 'cart_data'));
  const credits = Math.ceil(useExp * G(data).creditPerExp);
  if (useExp <= 0 || count(save, 'credit') < credits) return { from, to: from, used: {}, missing: { ...(useExp < need ? { cart_data: need - useExp } : {}), ...(count(save, 'credit') < credits ? { credit: credits - count(save, 'credit') } : {}) } };
  spend(save, { cart_data: useExp, credit: credits });
  c.exp += useExp;
  while (c.level < goal && c.exp >= cartExpToNext(c.level, def.rarity, data)) {
    c.exp -= cartExpToNext(c.level, def.rarity, data);
    c.level++;
  }
  track(save, 'grow');
  return { from, to: c.level, used: { cart_data: useExp, credit: credits }, missing: useExp < need ? { cart_data: need - useExp } : {} };
}

export function cartAscensionCost(c: CartState, data: GameData = DATA): Reward | null {
  const step = data.balance.cartridge.ascension[c.asc];
  if (!step) return null;
  return { [`chip_${cartDef(c, data).protocol}`]: step.chips, credit: step.credits };
}

export function cartAscend(save: SaveData, uid: number, data: GameData = DATA): boolean {
  const c = save.carts.find((x) => x.uid === uid)!;
  const cost = cartAscensionCost(c, data);
  if (!cost || c.level < levelCap(c.asc, data) || !canAfford(save, cost)) return false;
  spend(save, cost);
  c.asc++;
  track(save, 'grow');
  return true;
}

export function equip(save: SaveData, charId: string, uid: number | null) {
  if (uid !== null) for (const ch of Object.values(save.chars)) if (ch.cart === uid) ch.cart = null;
  save.chars[charId].cart = uid;
}

export function equippedBy(save: SaveData, uid: number): string | undefined {
  return Object.values(save.chars).find((c) => c.cart === uid)?.id;
}

// ───────────────────────── 빨간 점

export interface Growable {
  level: boolean;
  ascend: boolean;
  skill: boolean;
  node: boolean;
  cart: boolean;
  any: boolean;
}

export function growable(save: SaveData, charId: string, data: GameData = DATA): Growable {
  const c = save.chars[charId];
  const hasPacks = PACKS.some((p) => count(save, p.id) > 0);
  const level = hasPacks && c.level < levelCap(c.asc, data) && count(save, 'credit') >= 100;
  const ascend = canAscend(save, charId, data).ok;
  const skill = SKILL_SLOTS.some((s) => canSkillUp(save, charId, s, data).ok);
  const node = [0, 1, 2].some((i) => canUnlockNode(save, charId, 'big', i, data).ok) || Array.from({ length: 10 }, (_, i) => i).some((i) => canUnlockNode(save, charId, 'small', i, data).ok);
  const cartFree = c.cart === null && save.carts.some((x) => !equippedBy(save, x.uid) && cartDef(x, data).protocol === protocolOf(save, charId, data));
  return { level, ascend, skill, node, cart: cartFree, any: level || ascend || skill || node || cartFree };
}

// ───────────────────────── 전투용 설정

export function loadoutOf(save: SaveData, c: CharState): Loadout {
  const cart = c.cart !== null ? save.carts.find((x) => x.uid === c.cart) : undefined;
  return {
    charId: c.id,
    level: c.level,
    asc: c.asc,
    skills: { ...c.skills },
    bigNodes: [...c.big],
    smallNodes: [...c.small],
    sync: c.sync,
    cartridge: cart ? { id: cart.id, level: cart.level, asc: cart.asc, rank: cart.rank } : undefined,
    form: c.id === 'runner' ? save.runnerForm : undefined,
  };
}

export function allyFromSave(save: SaveData, charId: string, data: GameData = DATA): AllySetup {
  return buildAlly(loadoutOf(save, save.chars[charId]), data, data.cartridges);
}

/** 전투력 비슷한 숫자(편성 화면에 보여 주는 용도) */
export function power(a: AllySetup): number {
  const s = a.stats;
  return Math.round(s.hp * 0.25 + s.atk * 1.6 + s.def * 2 + (a.passives.length - 1) * 30);
}

export { addItem };
