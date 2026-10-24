// 데이터 파일 검사. 오타·없는 id·빠진 칸을 찾아서 사람이 읽을 수 있는 문장으로 돌려준다.
import { ELEMENTS, PROTOCOLS, type Effect, type Passive, type SkillDef } from './defs';
import type { GameData } from './data';

const EFFECT_TYPES = new Set(['damage', 'firewall', 'status', 'advance', 'heal', 'shield', 'cleanse', 'revive', 'cp', 'heat', 'addWeakness', 'breakEffect', 'counter']);
const TARGETS = new Set(['enemy', 'blast', 'allEnemies', 'ally', 'allyOther', 'allAllies', 'self']);
const WHO = new Set(['target', 'main', 'adjacent', 'self', 'allAllies', 'otherAllies', 'allEnemies', 'lowestHpAlly']);
const TRIGGERS = new Set(['battleStart', 'turnStart', 'afterBasic', 'afterSkill', 'afterOverclock', 'allyHit', 'selfHit', 'enemyDebuffed', 'kill', 'enemyDown']);
const MOD_KEYS = new Set(['hpPct', 'atkPct', 'defPct', 'spdPct', 'spdFlat', 'critRate', 'critDmg', 'effHit', 'effRes', 'dmgBonus', 'dmgTaken', 'dmgReduce', 'defReduction', 'defIgnore', 'heatGain', 'breakEff', 'breakDmg', 'dotBonus', 'healBonus', 'shieldBonus', 'basicDmg', 'skillDmg', 'overclockDmg']);

export function validateData(data: GameData): string[] {
  const errors: string[] = [];
  const err = (where: string, msg: string) => errors.push(`${where}: ${msg}`);

  const checkMods = (where: string, mods: Record<string, number> | undefined) => {
    for (const k of Object.keys(mods ?? {})) if (!MOD_KEYS.has(k)) err(where, `알 수 없는 보정 키 "${k}"`);
  };

  const checkEffects = (where: string, effects: Effect[]) => {
    if (!Array.isArray(effects)) return err(where, 'effects가 배열이 아님');
    effects.forEach((e, i) => {
      const w = `${where}.effects[${i}]`;
      if (!EFFECT_TYPES.has(e.type)) return err(w, `알 수 없는 효과 "${e.type}"`);
      if ('who' in e && e.who && !WHO.has(e.who)) err(w, `알 수 없는 대상 "${e.who}"`);
      if (e.type === 'status' && !data.statuses[e.status]) err(w, `없는 상태 id "${e.status}"`);
      if ((e.type === 'addWeakness' || e.type === 'breakEffect') && !ELEMENTS.includes(e.element)) err(w, `없는 속성 "${e.element}"`);
      if (e.type === 'damage') {
        if (!(e.scale > 0)) err(w, 'scale은 0보다 커야 함');
        e.bonus?.forEach((b, j) => checkMods(`${w}.bonus[${j}]`, b.mods));
      }
    });
  };

  const checkSkill = (where: string, s: SkillDef | undefined) => {
    if (!s) return err(where, '스킬이 없음');
    if (!s.name) err(where, '이름이 없음');
    if (!TARGETS.has(s.target)) err(where, `알 수 없는 대상 방식 "${s.target}"`);
    checkEffects(where, s.effects);
  };

  const checkPassive = (where: string, p: Passive | undefined) => {
    if (!p) return err(where, '없음');
    if (!p.desc) err(where, '설명(desc)이 없음');
    checkMods(where, p.mods);
    p.condMods?.forEach((c, i) => checkMods(`${where}.condMods[${i}]`, c.mods));
    p.triggers?.forEach((t, i) => {
      if (!TRIGGERS.has(t.on)) err(`${where}.triggers[${i}]`, `알 수 없는 발동 시점 "${t.on}"`);
      checkEffects(`${where}.triggers[${i}]`, t.effects);
    });
    p.skillAdds?.forEach((a, i) => checkEffects(`${where}.skillAdds[${i}]`, a.effects));
  };

  for (const c of Object.values(data.characters)) {
    const w = `캐릭터 ${c.id}`;
    if (!ELEMENTS.includes(c.element)) err(w, `없는 속성 "${c.element}"`);
    if (!PROTOCOLS.includes(c.protocol)) err(w, `없는 프로토콜 "${c.protocol}"`);
    checkSkill(`${w}.basic`, c.skills?.basic);
    checkSkill(`${w}.skill`, c.skills?.skill);
    checkSkill(`${w}.overclock`, c.skills?.overclock);
    if (c.skills?.basic && c.skills.basic.kind !== 'basic') err(`${w}.basic`, 'kind가 basic이 아님');
    if (c.skills?.skill && c.skills.skill.kind !== 'skill') err(`${w}.skill`, 'kind가 skill이 아님');
    if (c.skills?.overclock && c.skills.overclock.kind !== 'overclock') err(`${w}.overclock`, 'kind가 overclock이 아님');
    checkPassive(`${w}.trait`, c.trait);
    if (c.rarity !== 0) {
      if (c.circuit?.big?.length !== 3) err(w, '회로도 큰 노드는 3개여야 함');
      if (c.circuit?.small?.length !== 10) err(w, '회로도 작은 노드는 10개여야 함');
      c.circuit?.big?.forEach((p, i) => checkPassive(`${w}.circuit.big[${i}]`, p));
      c.circuit?.small?.forEach((p, i) => checkMods(`${w}.circuit.small[${i}]`, p.mods));
      for (const k of ['1', '2', '3', '4', '5', '6'] as const) checkPassive(`${w}.sync.${k}`, c.sync?.[k]);
      if ((c.lines?.nest?.length ?? 0) < 5) err(w, '둥지 대사는 5줄 이상');
    }
    if (!(c.heatMax > 0)) err(w, 'heatMax가 없음');
    for (const f of c.forms ?? []) {
      const fw = `${w}.forms.${f.id}`;
      checkSkill(`${fw}.basic`, f.skills.basic);
      checkSkill(`${fw}.skill`, f.skills.skill);
      checkSkill(`${fw}.overclock`, f.skills.overclock);
      checkPassive(`${fw}.trait`, f.trait);
    }
  }

  for (const e of Object.values(data.enemies)) {
    const w = `적 ${e.id}`;
    if (!e.weaknesses?.length) err(w, '약점이 없음');
    e.weaknesses?.forEach((el) => !ELEMENTS.includes(el) && err(w, `없는 약점 속성 "${el}"`));
    if (!e.actions?.length) err(w, '행동이 없음');
    e.actions?.forEach((a, i) => checkSkill(`${w}.actions[${i}]`, a.skill));
    e.phases?.forEach((p, i) => p.actions?.forEach((a, j) => checkSkill(`${w}.phases[${i}].actions[${j}]`, a.skill)));
    if (e.charge) checkSkill(`${w}.charge`, e.charge.skill);
  }

  return errors;
}
