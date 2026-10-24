import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle/battle';
import { autoPlay } from '../src/engine/battle/autoplay';
import type { BattleEvent } from '../src/engine/battle/types';
import { DATA } from '../src/engine/data';
import { buildAlly, standardLoadout } from '../src/engine/loadout';

const party = () => DATA.stages['prologue-3'].forcedParty!.map((id) => buildAlly(standardLoadout(id, 6, { trial: true })));
const foes = () => DATA.stages['prologue-3'].enemies.map((id) => ({ defId: id, level: DATA.stages['prologue-3'].enemyLevel }));

describe('프롤로그 보스 (회수 부대장 K-9)', () => {
  it('체력 50% 이하에서 페이즈가 바뀌고 약점이 바뀌며, 충전 예고가 나온다', () => {
    const events: BattleEvent[] = [];
    let phase = 0;
    let charge = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const b = new Battle({ allies: party(), enemies: foes(), seed, difficulty: 'normal' });
      const orig = b.advance.bind(b);
      b.advance = () => {
        const ev = orig();
        events.push(...ev);
        return ev;
      };
      const origAct = b.act.bind(b);
      b.act = (k, t) => {
        const ev = origAct(k, t);
        events.push(...ev);
        return ev;
      };
      autoPlay(b, 'smart');
    }
    phase = events.filter((e) => e.t === 'phase').length;
    charge = events.filter((e) => e.t === 'charge').length;
    expect(phase).toBeGreaterThan(0);
    expect(charge).toBeGreaterThan(0);
  });

  it('스토리 난이도에서는 체험 파티로 대부분 이긴다', () => {
    let wins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = autoPlay(new Battle({ allies: party(), enemies: foes(), seed, difficulty: 'story' }), 'smart');
      if (r.result === 'won') wins++;
    }
    expect(wins / 40).toBeGreaterThan(0.9);
  });

  it('충전 중에 시스템 다운을 내면 충전이 취소된다', () => {
    const b = new Battle({ allies: party(), enemies: [{ defId: 'recall_hound', level: 6 }], seed: 3, difficulty: 'story' });
    const boss = b.unit('e0');
    boss.charging = true;
    boss.firewall = 1;
    boss.weaknesses = [b.unit('a0').element];
    let cancelled = false;
    let guard = 0;
    while (!cancelled && guard++ < 30 && !b.ended) {
      const ev = b.phase === 'idle' ? b.advance() : b.act('basic', 'e0');
      cancelled = ev.some((e) => e.t === 'chargeCancel');
    }
    expect(cancelled).toBe(true);
    expect(boss.charging).toBe(false);
  });
});
