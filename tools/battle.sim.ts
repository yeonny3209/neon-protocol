// 전투 길이·승률 시뮬레이션. 결과는 콘솔에 표로 찍힌다.
import { it } from 'vitest';
import { Battle } from '../src/engine/battle/battle';
import { autoPlay, type Policy } from '../src/engine/battle/autoplay';
import type { Difficulty } from '../src/engine/battle/types';
import { buildAlly, standardLoadout } from '../src/engine/loadout';

const out = (s: string) => process.stderr.write(s + '\n');
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

export function simulate(party: string[], foes: string[], level: number, diff: Difficulty, policy: Policy, runs = 200, enemyLevel = level) {
  const res = [];
  for (let seed = 1; seed <= runs; seed++) {
    const b = new Battle({
      allies: party.map((id) => buildAlly(standardLoadout(id, level))),
      enemies: foes.map((id) => ({ defId: id, level: enemyLevel })),
      seed,
      difficulty: diff,
    });
    res.push(autoPlay(b, policy));
  }
  const wins = res.filter((r) => r.result === 'won');
  return {
    win: wins.length / runs,
    sec: median(res.map((r) => r.seconds)),
    acts: median(res.map((r) => r.allyActions)),
    oc: median(res.map((r) => r.overclocks)),
    downs: median(res.map((r) => r.downs)),
    rounds: median(res.map((r) => r.rounds)),
  };
}

it('프로토타입 전투 (5성 4명 vs 드론·불량배·기갑병)', () => {
  const party = ['kai', 'seraphine', 'zero', 'luna'];
  const foes = ['sec_drone', 'heavy_mech', 'street_thug'];
  out('난이도 | 정책 | 승률 | 시간(초,1배속) | 아군행동 | 오버클럭 | 다운 | 라운드');
  for (const diff of ['normal', 'story'] as const) {
    for (const policy of ['smart', 'weakOnly', 'basicOnly'] as const) {
      const r = simulate(party, foes, 20, diff, policy);
      out(`${diff} | ${policy} | ${(r.win * 100).toFixed(0)}% | ${r.sec.toFixed(0)} | ${r.acts} | ${r.oc} | ${r.downs} | ${r.rounds}`);
    }
  }
  const low = simulate(party, foes, 10, 'story', 'weakOnly', 200, 20);
  out(`story -10레벨 weakOnly | ${(low.win * 100).toFixed(0)}% | ${low.sec.toFixed(0)}초`);
});
