import { Battle } from '../src/engine/battle/battle';
import type { AllySetup, BattleSetup, EnemySetup } from '../src/engine/battle/types';
import { DATA, type GameData } from '../src/engine/data';
import type { EnemyDef } from '../src/engine/defs';
import { buildAlly, standardLoadout } from '../src/engine/loadout';

/** 성장 보너스 없는 1레벨 캐릭터. 치명타 0으로 계산을 정확히 맞출 수 있게 한다 */
export function plainAlly(id: string, over: Partial<AllySetup['stats']> = {}, level = 1): AllySetup {
  const a = buildAlly(standardLoadout(id, level, { asc: 0, skills: { basic: 1, skill: 1, overclock: 1, trait: 1 }, bigNodes: [], smallNodes: [] }));
  a.stats = { ...a.stats, critRate: 0, ...over };
  return a;
}

export function enemy(id: string, level = 1): EnemySetup {
  return { defId: id, level };
}

export function battle(allies: AllySetup[], enemies: EnemySetup[], opts: Partial<BattleSetup> = {}, data: GameData = DATA): Battle {
  return new Battle({ allies, enemies, seed: 1, difficulty: 'fixed', ...opts }, data);
}

/** 테스트용 적을 끼워 넣은 데이터 */
export function withEnemies(extra: EnemyDef[]): GameData {
  const enemies = { ...DATA.enemies };
  for (const e of extra) enemies[e.id] = e;
  return { ...DATA, enemies };
}

export function dummy(id: string, over: Partial<EnemyDef> = {}): EnemyDef {
  return {
    id,
    name: id,
    rank: 'normal',
    family: 'test',
    desc: '',
    element: 'kinetic',
    color: '#888',
    stats: { hp: 100000, atk: 10, def: 100, spd: 100 },
    weaknesses: ['kinetic'],
    firewall: 30,
    actions: [{ skill: { name: '찌르기', kind: 'basic', target: 'enemy', desc: '', effects: [{ type: 'damage', scale: 1 }] }, weight: 1 }],
    ...over,
  };
}

/** 지금 차례가 올 때까지 진행(아군 입력 대기 또는 종료) */
export function untilInput(b: Battle) {
  let guard = 0;
  while (b.phase === 'idle' && guard++ < 500) b.advance();
}
