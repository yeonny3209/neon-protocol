import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle/battle';
import { autoPlay } from '../src/engine/battle/autoplay';
import { DATA } from '../src/engine/data';
import { buildAlly, standardLoadout } from '../src/engine/loadout';
import { newSave } from '../src/engine/save';
import { grant } from '../src/engine/state';

const ch1 = DATA.stageOrder.filter((id) => DATA.stages[id].chapter === 'ch1');

function winRate(id: string, difficulty: 'story' | 'normal', policy: 'smart' | 'weakOnly' | 'basicOnly', runs = 60) {
  const st = DATA.stages[id];
  let wins = 0;
  let secs = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const r = autoPlay(
      new Battle({
        allies: (st.forcedParty ?? st.trialParty)!.map((c) => buildAlly(standardLoadout(c, st.recLevel, { trial: true }))),
        enemies: st.enemies.map((e) => ({ defId: e, level: st.enemyLevel })),
        seed,
        difficulty,
      }),
      policy,
    );
    if (r.result === 'won') wins++;
    secs += r.seconds;
  }
  return { win: wins / runs, sec: secs / runs };
}

describe('1장', () => {
  it('스테이지 10개가 이어지고 보스로 끝난다', () => {
    expect(ch1).toHaveLength(10);
    expect(DATA.stages[ch1[9]].boss).toBe(true);
  });

  it('스토리 난이도: 생각 없이 일반공격만 눌러도 대부분 이긴다', () => {
    const lines: string[] = [];
    for (const id of ch1) {
      const r = winRate(id, 'story', 'basicOnly');
      lines.push(`${id} ${(r.win * 100).toFixed(0)}% ${r.sec.toFixed(0)}초`);
      expect(r.win).toBeGreaterThan(0.85);
    }
    process.stderr.write(`[1장 스토리·일반공격만] ${lines.join(' | ')}\n`);
  });

  it('보통 난이도: 약점을 신경 쓰면 이기고, 한 판이 너무 길지 않다', () => {
    const lines: string[] = [];
    for (const id of ch1) {
      const r = winRate(id, 'normal', 'smart');
      lines.push(`${id} ${(r.win * 100).toFixed(0)}% ${r.sec.toFixed(0)}초`);
      expect(r.win).toBeGreaterThan(0.7);
      expect(r.sec).toBeLessThan(150);
    }
    process.stderr.write(`[1장 보통·스마트] ${lines.join(' | ')}\n`);
  });

  it('챕터 클리어 보상: 다이브 키와 4성 카트리지, 샤드', () => {
    const s = newSave();
    const g = grant(s, DATA.chapters.ch1.completeReward);
    expect(s.wallet.key).toBe(40);
    expect(s.wallet.shard).toBe(3200);
    expect(g.carts[0].id).toBe('c4_scanner');
  });
});
