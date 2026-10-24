// 사람 대신 전투를 진행하는 간단한 규칙. 테스트와 밸런스 시뮬레이션에서만 쓴다.
import type { Battle } from './battle';

export type Policy = 'smart' | 'weakOnly' | 'basicOnly';

export interface AutoResult {
  result: 'won' | 'lost' | 'timeout';
  allyActions: number;
  enemyActions: number;
  overclocks: number;
  downs: number;
  rounds: number;
  /** 추정 소요 시간(초, 1배속). 생각하는 시간 포함 */
  seconds: number;
}

export interface Timing {
  think: number;
  allyAnim: number;
  enemyAnim: number;
  overclock: number;
  down: number;
  kill: number;
}

/** 1배속 기준 대략적인 연출 시간(초). 화면 쪽 실제 값과 맞춰 둔다 */
export const DEFAULT_TIMING: Timing = { think: 2.2, allyAnim: 1.2, enemyAnim: 1.1, overclock: 2.0, down: 0.7, kill: 0.4 };

export function autoPlay(b: Battle, policy: Policy = 'smart', timing: Timing = DEFAULT_TIMING, maxSteps = 2000): AutoResult {
  let seconds = 0;
  let steps = 0;
  const count = (events: { t: string }[]) => {
    for (const e of events) {
      if (e.t === 'down') seconds += timing.down;
      if (e.t === 'death') seconds += timing.kill;
    }
  };
  while (!b.ended && steps++ < maxSteps) {
    if (policy !== 'basicOnly') {
      for (const a of b.allies()) {
        if (b.canOverclock(a.uid)) {
          count(b.overclock(a.uid, b.defaultTarget(a.uid, 'overclock')));
          seconds += timing.overclock;
          if (b.ended) break;
        }
      }
      if (b.ended) break;
    }
    if (b.phase === 'idle') {
      const before = b.stats.enemyActions;
      count(b.advance());
      if (b.stats.enemyActions > before) seconds += timing.enemyAnim;
      continue;
    }
    if (b.phase === 'input') {
      const u = b.activeUnit!;
      const kind = chooseKind(b, policy);
      const target = b.defaultTarget(u.uid, kind);
      count(b.act(kind, target));
      seconds += timing.think + timing.allyAnim;
    }
  }
  return {
    result: b.phase === 'won' ? 'won' : b.phase === 'lost' ? 'lost' : 'timeout',
    allyActions: b.stats.allyActions,
    enemyActions: b.stats.enemyActions,
    overclocks: b.stats.overclocks,
    downs: b.stats.downs,
    rounds: b.round(),
    seconds,
  };
}

function chooseKind(b: Battle, policy: Policy): 'basic' | 'skill' {
  const u = b.activeUnit!;
  if (policy === 'basicOnly' || !b.canUseSkill()) return 'basic';
  const skill = u.skills.skill!;
  if (skill.target === 'allyOther' && b.validTargets(u.uid, 'skill').length === 0) return 'basic';
  if (policy === 'weakOnly') return b.hitsWeakness(u.uid, 'skill', b.defaultTarget(u.uid, 'skill')) || skill.target.startsWith('ally') ? 'skill' : 'basic';
  const dps = u.protocol === 'strike' || u.protocol === 'blitz';
  return dps || b.cp >= 3 ? 'skill' : 'basic';
}
