// 스토리 전투 편성: 내 캐릭터가 실제 능력치로 싸우고, 빈 자리는 체험 캐릭터로 채운다.
import type { AllySetup } from './battle/types';
import { DATA, type GameData } from './data';
import type { StageDef } from './defs';
import { loadoutOf } from './growth';
import { buildAlly, standardLoadout } from './loadout';
import type { SaveData } from './save';

/** 스토리 난이도는 권장 −10레벨, 보통은 −3레벨까지 키우지 않은 캐릭터를 자동으로 올려 준다 */
export function levelFloor(st: StageDef, difficulty: 'story' | 'normal'): number {
  return Math.max(1, st.recLevel - (difficulty === 'story' ? 10 : 3));
}

export function validParty(save: SaveData): string[] {
  let party = save.party.filter((id) => save.chars[id]).slice(0, 4);
  if (!party.length) party = Object.keys(save.chars).slice(0, 4);
  save.party = party;
  return party;
}

export interface StoryParty {
  allies: AllySetup[];
  /** 체험 캐릭터로 채운 자리의 캐릭터 id */
  filled: string[];
  /** 자동으로 올려 준 내 캐릭터 */
  lifted: string[];
}

export function storyParty(save: SaveData, st: StageDef, difficulty: 'story' | 'normal', data: GameData = DATA): StoryParty {
  if (st.forcedParty) {
    return { allies: st.forcedParty.map((id) => buildAlly(standardLoadout(id, st.recLevel, { trial: true }, data), data, data.cartridges)), filled: st.forcedParty, lifted: [] };
  }
  const floor = levelFloor(st, difficulty);
  const hp = difficulty === 'normal' ? save.story.hp : {};
  const own = validParty(save);
  const allies: AllySetup[] = [];
  const lifted: string[] = [];
  for (const id of own) {
    const c = save.chars[id];
    let lo = loadoutOf(save, c);
    if (c.level < floor) {
      lo = standardLoadout(id, floor, { sync: c.sync, cartridge: lo.cartridge, form: lo.form }, data);
      lifted.push(id);
    }
    allies.push({ ...buildAlly(lo, data, data.cartridges), hpFrac: hp[id] });
  }
  const filled: string[] = [];
  for (const id of st.trialParty ?? []) {
    if (allies.length >= 4) break;
    if (own.includes(id) || save.chars[id]) continue;
    allies.push(buildAlly(standardLoadout(id, st.recLevel, { trial: true }, data), data, data.cartridges));
    filled.push(id);
  }
  // 체험 풀이 모자라면 아직 편성하지 않은 내 캐릭터로 채운다
  for (const id of Object.keys(save.chars)) {
    if (allies.length >= 4) break;
    if (own.includes(id)) continue;
    const c = save.chars[id];
    let lo = loadoutOf(save, c);
    if (c.level < floor) lo = standardLoadout(id, floor, { sync: c.sync, cartridge: lo.cartridge, form: lo.form }, data);
    allies.push(buildAlly(lo, data, data.cartridges));
  }
  return { allies, filled, lifted };
}
