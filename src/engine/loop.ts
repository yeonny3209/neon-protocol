// 시뮬레이션 루프(로그라이크): 구역 3개 × 노드 6~8개, 전투를 이기면 패치 3개 중 1개, 같은 계열 3·6개면 세트 효과.
import type { Battle } from './battle/battle';
import type { BattleSetup } from './battle/types';
import { DATA, type GameData } from './data';
import type { LoopEffect, Passive } from './defs';
import { allyFromSave, protocolOf } from './growth';
import { createRng, pickWeighted, type Rng } from './rng';
import type { SaveData } from './save';
import { addItem, grant, setMaxStat, track, weekKey, type Granted } from './state';

export type NodeType = 'battle' | 'elite' | 'event' | 'shop' | 'rest' | 'boss';

export interface LoopNode {
  type: NodeType;
  enemies?: string[];
  event?: string;
}

export interface ShopItem {
  kind: 'patch' | 'heal' | 'reroll';
  id?: string;
  price: number;
  sold?: boolean;
}

export type Pending =
  | { kind: 'battle'; node: LoopNode }
  | { kind: 'patch'; options: string[] }
  | { kind: 'event'; id: string }
  | { kind: 'shop'; items: ShopItem[] }
  | { kind: 'rest' };

export interface LoopRun {
  rng: number;
  difficulty: number;
  family: string;
  party: string[];
  zone: number;
  step: number;
  map: LoopNode[][][];
  hp: Record<string, number>;
  heat: Record<string, number>;
  patches: string[];
  coins: number;
  score: number;
  pending: Pending | null;
  result?: 'clear' | 'fail';
}

const ZONE_POOL = [
  { normal: ['sec_drone', 'street_thug', 'flame_drone', 'volt_drone', 'stall_bot', 'holo_ad', 'debt_collector', 'memory_clerk'], elite: ['heavy_mech', 'auction_guard', 'hit_squad'], boss: ['iron_boss', 'memory_broker'] },
  { normal: ['prefect_drone', 'smile_student', 'lab_assistant', 'gardener_drone', 'sentry_turret', 'vine_bot', 'rogue_drone'], elite: ['lab_golem', 'proctor', 'thorn_walker', 'manor_butler'], boss: ['emotion_editor', 'garden_warden'] },
  { normal: ['white_guard', 'silent_unit', 'data_clerk', 'data_wraith', 'memory_shard', 'glitch_beast'], elite: ['mute_enforcer', 'tower_sniper', 'core_guard', 'echo_self'], boss: ['silence', 'oracle_core'] },
];

const L = (data: GameData) => data.balance.loop;

function pick<T>(rng: Rng, xs: T[]): T {
  return xs[Math.floor(rng.next() * xs.length)];
}

function withRng<T>(run: LoopRun, fn: (rng: Rng) => T): T {
  const rng = createRng(run.rng);
  const out = fn(rng);
  run.rng = rng.state();
  return out;
}

export function loopUnlocked(save: SaveData, data: GameData = DATA): boolean {
  return save.story.chapters.includes(L(data).unlockChapter);
}

export function difficultyOpen(save: SaveData, d: number, data: GameData = DATA): boolean {
  return save.rank.level >= L(data).difficultyRank[d - 1] && (d === 1 || save.loop.firstClear.includes(d - 1));
}

export function ensureLoopWeek(save: SaveData, now = new Date()) {
  const wk = weekKey(now);
  if (save.loop.week !== wk) {
    save.loop.week = wk;
    save.loop.score = 0;
    save.loop.weeklyClaimed = false;
  }
}

function makeEnemies(rng: Rng, zone: number, type: NodeType): string[] {
  const p = ZONE_POOL[zone];
  const normals = (n: number) => Array.from({ length: n }, () => pick(rng, p.normal));
  if (type === 'boss') return [pick(rng, p.normal), pick(rng, p.boss), pick(rng, p.normal)];
  if (type === 'elite') return [pick(rng, p.elite), ...normals(rng.next() < 0.5 ? 1 : 2)];
  return normals(rng.next() < 0.4 ? 2 : 3);
}

export function buildMap(rng: Rng, data: GameData = DATA): LoopNode[][][] {
  const [lo, hi] = L(data).nodesPerZone;
  const events = Object.keys(data.loopEvents);
  const map: LoopNode[][][] = [];
  for (let z = 0; z < L(data).zones; z++) {
    const steps = lo + Math.floor(rng.next() * (hi - lo + 1));
    const zone: LoopNode[][] = [];
    for (let s = 0; s < steps - 1; s++) {
      const n = rng.next() < 0.5 ? 2 : 3;
      const choices: LoopNode[] = [];
      for (let i = 0; i < n; i++) {
        const type: NodeType = s === 0 ? 'battle' : pickWeighted(rng, ['battle', 'elite', 'event', 'shop', 'rest'] as NodeType[], (t) => ({ battle: 40, elite: 12, event: 25, shop: 10, rest: 13 })[t as 'battle']);
        const node: LoopNode = { type };
        if (type === 'battle' || type === 'elite') node.enemies = makeEnemies(rng, z, type);
        if (type === 'event') node.event = pick(rng, events);
        choices.push(node);
      }
      zone.push(choices);
    }
    zone.push([{ type: 'boss', enemies: makeEnemies(rng, z, 'boss') }]);
    map.push(zone);
  }
  return map;
}

export function startRun(save: SaveData, difficulty: number, family: string, party: string[], seed: number, data: GameData = DATA): LoopRun {
  const rng = createRng(seed);
  const map = buildMap(rng, data);
  const ids = party.filter((id) => save.chars[id]).slice(0, 4);
  const run: LoopRun = { rng: rng.state(), difficulty, family, party: ids, zone: 0, step: 0, map, hp: Object.fromEntries(ids.map((id) => [id, 1])), heat: {}, patches: [], coins: L(data).startCoins, score: 0, pending: null };
  save.loop.run = run;
  return run;
}

export function currentChoices(run: LoopRun): LoopNode[] {
  return run.map[run.zone]?.[run.step] ?? [];
}

function advance(run: LoopRun, data: GameData) {
  run.pending = null;
  run.step++;
  if (run.step >= run.map[run.zone].length) {
    run.zone++;
    run.step = 0;
    if (run.zone >= L(data).zones) run.result = 'clear';
  }
}

export function patchOptions(run: LoopRun, n: number, data: GameData = DATA): string[] {
  return withRng(run, (rng) => {
    const all = Object.values(data.patches).filter((p) => !run.patches.includes(p.id));
    const out: string[] = [];
    while (out.length < n && out.length < all.length) {
      const fam = rng.next() < 0.6 ? all.filter((p) => p.family === run.family && !out.includes(p.id)) : [];
      const pool = fam.length ? fam : all.filter((p) => !out.includes(p.id));
      out.push(pick(rng, pool).id);
    }
    return out;
  });
}

/** 노드를 골랐다. 전투면 pending.battle, 아니면 그 노드의 처리 대기 */
export function chooseNode(save: SaveData, run: LoopRun, idx: number, data: GameData = DATA): Pending {
  const node = currentChoices(run)[idx];
  if (!node) throw new Error('없는 노드');
  let p: Pending;
  if (node.type === 'battle' || node.type === 'elite' || node.type === 'boss') p = { kind: 'battle', node };
  else if (node.type === 'event') {
    p = { kind: 'event', id: node.event! };
    if (!save.loop.events.includes(node.event!)) save.loop.events.push(node.event!);
  } else if (node.type === 'shop') {
    const pr = L(data).shopPrices;
    p = { kind: 'shop', items: [...patchOptions(run, 3, data).map((id) => ({ kind: 'patch' as const, id, price: pr.patch })), { kind: 'heal', price: pr.heal }, { kind: 'reroll', price: pr.reroll }] };
  } else p = { kind: 'rest' };
  run.pending = p;
  return p;
}

export function familyCounts(run: LoopRun, data: GameData = DATA): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of run.patches) {
    const f = data.patches[id]?.family;
    if (f) out[f] = (out[f] ?? 0) + 1;
  }
  return out;
}

export function activePassives(run: LoopRun, data: GameData = DATA): Passive[] {
  const ps: Passive[] = run.patches.map((id) => data.patches[id].passive);
  const [t3, t6] = L(data).setThresholds;
  for (const [f, n] of Object.entries(familyCounts(run, data))) {
    const fam = data.families[f];
    if (!fam) continue;
    if (n >= t3) ps.push(fam.set3);
    if (n >= t6) ps.push(fam.set6);
  }
  return ps;
}

export function nodeLevel(run: LoopRun, node: LoopNode, data: GameData = DATA): number {
  return L(data).difficultyLevel[run.difficulty - 1] + run.zone * 3 + (node.type === 'elite' ? 2 : node.type === 'boss' ? 3 : 0);
}

export function loopSetup(save: SaveData, run: LoopRun, node: LoopNode, seed: number, data: GameData = DATA): BattleSetup {
  const m = L(data).difficultyMult[run.difficulty - 1];
  return {
    allies: run.party.filter((id) => (run.hp[id] ?? 0) > 0).map((id) => ({ ...allyFromSave(save, id, data), hpFrac: run.hp[id], heat: run.heat[id] ?? 0 })),
    enemies: (node.enemies ?? []).map((e) => ({ defId: e, level: nodeLevel(run, node, data) })),
    seed,
    difficulty: 'fixed',
    diffMult: { enemyHp: m[0], enemyAtk: m[1], enemyFirewall: m[2] },
    allyPassives: activePassives(run, data),
  };
}

/** 전투가 끝났다. 이기면 패치 고르기, 지면 루프 종료 */
export function afterBattle(save: SaveData, run: LoopRun, b: Battle, data: GameData = DATA): Pending | null {
  const node = run.pending?.kind === 'battle' ? run.pending.node : undefined;
  for (const u of b.allies(false)) {
    run.hp[u.defId] = u.alive ? u.hp / u.maxHp : 0;
    run.heat[u.defId] = u.heat;
  }
  if (b.phase !== 'won') {
    run.result = 'fail';
    run.pending = null;
    return null;
  }
  const sc = L(data).score;
  const t = node?.type ?? 'battle';
  run.score += t === 'boss' ? sc.boss : t === 'elite' ? sc.elite : sc.battle;
  run.coins += t === 'elite' || t === 'boss' ? L(data).coinsPerElite : L(data).coinsPerBattle;
  if (t === 'boss') track(save, 'loopZone');
  run.pending = { kind: 'patch', options: patchOptions(run, L(data).patchChoices, data) };
  return run.pending;
}

export function choosePatch(save: SaveData, run: LoopRun, id: string, data: GameData = DATA) {
  if (run.pending?.kind !== 'patch' || !run.pending.options.includes(id)) throw new Error('고를 수 없는 패치');
  run.patches.push(id);
  if (!save.loop.patches.includes(id)) save.loop.patches.push(id);
  advance(run, data);
}

function heal(run: LoopRun, pct: number, revive: boolean) {
  for (const id of run.party) {
    const v = run.hp[id] ?? 0;
    if (v <= 0 && !revive) continue;
    run.hp[id] = Math.min(1, v + pct);
  }
}

export function resolveEvent(save: SaveData, run: LoopRun, opt: number, data: GameData = DATA): string {
  if (run.pending?.kind !== 'event') throw new Error('이벤트 없음');
  const ev = data.loopEvents[run.pending.id];
  const o = ev.options[opt];
  for (const e of o.effects as LoopEffect[]) {
    switch (e.type) {
      case 'heal':
        heal(run, e.pct, false);
        break;
      case 'hurt':
        for (const id of run.party) if ((run.hp[id] ?? 0) > 0) run.hp[id] = Math.max(0.05, run.hp[id] - e.pct);
        break;
      case 'coins':
        run.coins = Math.max(0, run.coins + e.n);
        break;
      case 'score':
        run.score += e.n;
        break;
      case 'patch': {
        const [id] = patchOptions(run, 1, data);
        if (id) {
          run.patches.push(id);
          if (!save.loop.patches.includes(id)) save.loop.patches.push(id);
        }
        break;
      }
    }
  }
  run.score += L(data).score.event;
  advance(run, data);
  return o.result;
}

export function shopBuy(save: SaveData, run: LoopRun, i: number, data: GameData = DATA): boolean {
  if (run.pending?.kind !== 'shop') return false;
  const it = run.pending.items[i];
  if (!it || it.sold || run.coins < it.price) return false;
  run.coins -= it.price;
  if (it.kind === 'patch' && it.id) {
    run.patches.push(it.id);
    if (!save.loop.patches.includes(it.id)) save.loop.patches.push(it.id);
    it.sold = true;
  } else if (it.kind === 'heal') {
    heal(run, 0.3, true);
    it.sold = true;
  } else if (it.kind === 'reroll') {
    const pr = L(data).shopPrices.patch;
    const keep = run.pending.items.filter((x) => x.kind !== 'patch');
    run.pending.items = [...patchOptions(run, 3, data).map((id) => ({ kind: 'patch' as const, id, price: pr })), ...keep];
  }
  return true;
}

export function leaveShop(run: LoopRun, data: GameData = DATA) {
  if (run.pending?.kind === 'shop') advance(run, data);
}

export function rest(run: LoopRun, data: GameData = DATA) {
  if (run.pending?.kind !== 'rest') return;
  heal(run, L(data).restHealPct, true);
  advance(run, data);
}

export interface LoopEnd {
  score: number;
  got: Granted;
  firstClear: boolean;
  weeklyReady: boolean;
}

/** 완주하거나 전멸하면 점수에 따라 보상(전멸해도 그때까지의 보상은 받는다) */
export function finishRun(save: SaveData, run: LoopRun, now = new Date(), data: GameData = DATA): LoopEnd {
  ensureLoopWeek(save, now);
  const cleared = run.result === 'clear';
  const score = Math.round((run.score + (cleared ? L(data).score.clearBonus : 0)) * L(data).score.difficultyMult[run.difficulty - 1]);
  const rps = L(data).rewardPerScore;
  const reward: Record<string, number> = { credit: Math.round(score * rps.credit), pack_m: Math.floor(score * rps.pack_m) };
  const chip = Math.floor(score * rps.chip_any);
  if (chip > 0 && run.party[0]) reward[`chip_${protocolOf(save, run.party[0], data)}`] = chip;
  reward.rankExp = Math.min(run.zone, L(data).zones) * data.balance.economy.rankExp.loopZone;
  let firstClear = false;
  if (cleared) {
    track(save, 'loopClear');
    setMaxStat(save, 'loopDiff', run.difficulty);
    if (!save.loop.firstClear.includes(run.difficulty)) {
      save.loop.firstClear.push(run.difficulty);
      firstClear = true;
      for (const [k, v] of Object.entries(L(data).firstClear)) reward[k] = (reward[k] ?? 0) + v;
    }
  }
  setMaxStat(save, 'loopMaxScore', score);
  save.loop.score += score;
  save.loop.maxDifficulty = Math.max(save.loop.maxDifficulty, ...save.loop.firstClear.map((d) => d + 1), 1);
  save.loop.run = null;
  const got = grant(save, reward, data);
  return { score, got, firstClear, weeklyReady: !save.loop.weeklyClaimed && save.loop.score >= L(data).weeklyScoreTarget };
}

export function claimLoopWeekly(save: SaveData, now = new Date(), data: GameData = DATA): Granted | null {
  ensureLoopWeek(save, now);
  if (save.loop.weeklyClaimed || save.loop.score < L(data).weeklyScoreTarget) return null;
  save.loop.weeklyClaimed = true;
  return grant(save, { shard: L(data).weeklyShards }, data);
}

export { addItem };
