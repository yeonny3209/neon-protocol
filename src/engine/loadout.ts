// 성장 상태(레벨·돌파·스킬 레벨·회로도·동기화·카트리지)를 전투용 아군 설정으로 바꾼다.
import type { CartridgeDef, CharacterDef, CharacterKit, Effect, Mods, Passive, SkillDef, SkillKind, StatRange, Stats } from './defs';
import type { AllySetup } from './battle/types';
import { DATA, type GameData } from './data';

export interface SkillLevels {
  basic: number;
  skill: number;
  overclock: number;
  trait: number;
}

export interface CartridgeLoadout {
  id: string;
  level: number;
  asc: number;
  /** 중첩 1~5 */
  rank: number;
}

export interface Loadout {
  charId: string;
  level: number;
  asc: number;
  skills: SkillLevels;
  bigNodes: number[];
  smallNodes: number[];
  sync: number;
  cartridge?: CartridgeLoadout;
  /** 러너 형태 id */
  form?: string;
  trial?: boolean;
}

export function statMult(level: number, asc: number, data: GameData = DATA): number {
  const s = data.balance.scaling;
  return 1 + s.perLevel * (level - 1) + s.perAscension * asc;
}

export function defMult(level: number, asc: number, data: GameData = DATA): number {
  const s = data.balance.scaling;
  return 1 + s.defPerLevel * (level - 1) + s.defPerAscension * asc;
}

/** [1레벨, 60레벨 4차 돌파] 사이를 성장 곡선으로 잇는다 */
export function statAt(range: StatRange, level: number, asc: number, isDef = false, data: GameData = DATA): number {
  const f = isDef ? defMult : statMult;
  const t = (f(level, asc, data) - 1) / (f(60, 4, data) - 1);
  return range[0] + (range[1] - range[0]) * t;
}

/** 레벨에 맞는 돌파 단계(적 성장·체험 캐릭터용) */
export function ascForLevel(level: number, data: GameData = DATA): number {
  return data.balance.scaling.enemyAscensionAt.filter((l) => level >= l).length;
}

export function defaultSkillLevels(asc: number, data: GameData = DATA): SkillLevels {
  const caps = data.balance.growth.skillCapByAscension;
  return { basic: caps.basic[asc], skill: caps.skill[asc], overclock: caps.overclock[asc], trait: caps.trait[asc] };
}

function scaleEffect(e: Effect, scaleMul: number, valueMul: number): Effect {
  switch (e.type) {
    case 'damage':
      return { ...e, scale: e.scale * scaleMul, adjScale: e.adjScale !== undefined ? e.adjScale * scaleMul : undefined };
    case 'heal':
    case 'shield':
      return { ...e, scale: e.scale * scaleMul, flat: e.flat !== undefined ? e.flat * scaleMul : undefined };
    case 'counter':
      return { ...e, scale: e.scale * scaleMul };
    case 'status':
      return e.value !== undefined ? { ...e, value: e.value * valueMul } : e;
    default:
      return e;
  }
}

function levelMuls(level: number, data: GameData) {
  const sl = data.balance.battle.skillLevel;
  return { scale: 1 + sl.scalePerLevel * (level - 1), value: 1 + sl.valuePerLevel * (level - 1) };
}

export function scaleSkill(skill: SkillDef, level: number, data: GameData = DATA): SkillDef {
  const m = levelMuls(level, data);
  return { ...skill, effects: skill.effects.map((e) => scaleEffect(e, m.scale, m.value)) };
}

function scaleMods(mods: Mods | undefined, mul: number): Mods | undefined {
  if (!mods) return undefined;
  const out: Mods = {};
  for (const [k, v] of Object.entries(mods)) out[k as keyof Mods] = (v as number) * mul;
  return out;
}

/** 패시브 숫자를 배율만큼 키운다(특성 레벨, 카트리지 중첩). CP·턴 수·확률은 그대로 */
export function scalePassive(p: Passive, scaleMul: number, valueMul: number): Passive {
  return {
    ...p,
    mods: scaleMods(p.mods, valueMul),
    condMods: p.condMods?.map((c) => ({ ...c, mods: scaleMods(c.mods, valueMul)! })),
    triggers: p.triggers?.map((t) => ({
      ...t,
      effects: t.effects.map((e) => (e.type === 'heat' ? { ...e, amount: e.amount * valueMul } : scaleEffect(e, scaleMul, valueMul))),
    })),
    skillAdds: p.skillAdds?.map((a) => ({ ...a, effects: a.effects.map((e) => scaleEffect(e, scaleMul, valueMul)) })),
  };
}

export function kitFor(def: CharacterDef, formId?: string): CharacterKit & { name: string } {
  if (def.forms?.length) {
    const form = def.forms.find((f) => f.id === formId) ?? def.forms[0];
    return { ...form, name: def.name };
  }
  return def;
}

export function cartridgeStats(c: CartridgeDef, level: number, asc: number, data: GameData = DATA) {
  return {
    hp: statAt(c.stats.hp, level, asc, false, data),
    atk: statAt(c.stats.atk, level, asc, false, data),
    def: statAt(c.stats.def, level, asc, false, data),
  };
}

export function baseStats(def: CharacterDef, level: number, asc: number, data: GameData = DATA): Stats {
  return {
    hp: statAt(def.stats.hp, level, asc, false, data),
    atk: statAt(def.stats.atk, level, asc, false, data),
    def: statAt(def.stats.def, level, asc, true, data),
    spd: def.stats.spd,
    critRate: def.stats.critRate,
    critDmg: def.stats.critDmg,
    effHit: def.stats.effHit,
    effRes: def.stats.effRes,
  };
}

export function effectiveSkillLevels(def: CharacterDef, lo: Loadout): SkillLevels {
  const lv = { ...lo.skills };
  if (def.rarity === 0) return lv;
  for (let i = 1; i <= lo.sync; i++) {
    const bonus = def.sync?.[String(i) as '1']?.skillLevels;
    if (bonus) for (const [k, v] of Object.entries(bonus)) lv[k as keyof SkillLevels] += v ?? 0;
  }
  return lv;
}

export function buildAlly(lo: Loadout, data: GameData = DATA, cartridges?: Record<string, CartridgeDef>): AllySetup {
  const def = data.characters[lo.charId];
  if (!def) throw new Error(`없는 캐릭터: ${lo.charId}`);
  const kit = kitFor(def, lo.form);
  const lv = effectiveSkillLevels(def, lo);
  const stats = baseStats(def, lo.level, lo.asc, data);
  const passives: Passive[] = [];

  const traitMul = levelMuls(lv.trait, data);
  passives.push(scalePassive(kit.trait, traitMul.scale, traitMul.value));
  {
    for (const i of lo.bigNodes) if (def.circuit.big[i]) passives.push(def.circuit.big[i]);
    for (let i = 1; i <= lo.sync; i++) {
      const s = def.sync?.[String(i) as '1'];
      if (s && !s.skillLevels) passives.push(s);
    }
  }
  const small: Mods = {};
  {
    for (const i of lo.smallNodes) {
      for (const [k, v] of Object.entries(def.circuit.small[i]?.mods ?? {})) small[k as keyof Mods] = (small[k as keyof Mods] ?? 0) + (v as number);
    }
  }
  if (Object.keys(small).length) passives.push({ desc: '회로도', mods: small });

  if (lo.cartridge && cartridges?.[lo.cartridge.id]) {
    const c = cartridges[lo.cartridge.id];
    const cs = cartridgeStats(c, lo.cartridge.level, lo.cartridge.asc, data);
    stats.hp += cs.hp;
    stats.atk += cs.atk;
    stats.def += cs.def;
    if (c.protocol === kit.protocol) {
      const m = 1 + data.balance.cartridge.superimposeStep * (lo.cartridge.rank - 1);
      passives.push(scalePassive(c.effect, m, m));
    }
  }

  const skills = {} as Record<SkillKind, SkillDef>;
  for (const k of ['basic', 'skill', 'overclock'] as const) skills[k] = scaleSkill(kit.skills[k], lv[k], data);

  return {
    defId: def.id,
    name: def.name,
    element: kit.element,
    protocol: kit.protocol,
    level: lo.level,
    color: def.look.color,
    stats,
    heatMax: kit.heatMax,
    skills,
    passives,
    trial: lo.trial,
  };
}

/** 체험 캐릭터·프로토타입용 기본 성장 상태 */
export function standardLoadout(charId: string, level: number, opts: Partial<Loadout> = {}, data: GameData = DATA): Loadout {
  const asc = opts.asc ?? ascForLevel(level, data);
  const bigCount = data.balance.growth.bigNode.ascension.filter((a) => asc >= a).length;
  const smallCount = data.balance.growth.smallNode.ascension.filter((a) => asc >= a).length;
  return {
    charId,
    level,
    asc,
    skills: defaultSkillLevels(asc, data),
    bigNodes: Array.from({ length: bigCount }, (_, i) => i),
    smallNodes: Array.from({ length: smallCount }, (_, i) => i),
    sync: 0,
    ...opts,
  };
}
