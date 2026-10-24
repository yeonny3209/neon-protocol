import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle/battle';
import { autoPlay } from '../src/engine/battle/autoplay';
import { DATA } from '../src/engine/data';
import { batchGrow } from '../src/engine/growth';
import { storyParty } from '../src/engine/party';
import { newCharState, newSave } from '../src/engine/save';

const stages = DATA.stageOrder.map((id) => DATA.stages[id]).filter((s) => !s.forcedParty);

function rate(save: ReturnType<typeof newSave>, id: string, difficulty: 'story' | 'normal', policy: 'smart' | 'basicOnly', n = 20) {
  const st = DATA.stages[id];
  let w = 0;
  for (let seed = 1; seed <= n; seed++) {
    const sp = storyParty(save, st, difficulty);
    const r = autoPlay(new Battle({ allies: sp.allies, enemies: st.enemies.map((e) => ({ defId: e, level: st.enemyLevel })), seed, difficulty }), policy);
    if (r.result === 'won') w++;
  }
  return w / n;
}

describe('스토리 편성: 내 캐릭터 + 체험 캐릭터', () => {
  it('처음 시작한 저장(러너만)도 빈 자리가 체험 캐릭터로 채워져 4명이 된다', () => {
    const save = newSave();
    for (const st of stages) expect(storyParty(save, st, 'story').allies).toHaveLength(4);
  });

  it('키우지 않은 내 캐릭터는 스토리 난이도에서 권장 −10레벨까지 올려서 내보낸다', () => {
    const save = newSave();
    const st = DATA.stages['ch3-1'];
    const sp = storyParty(save, st, 'story');
    expect(sp.lifted).toEqual(['runner']);
    expect(sp.allies[0].level).toBe(st.recLevel - 10);
    expect(sp.filled).toHaveLength(3);
    const normal = storyParty(save, st, 'normal');
    expect(normal.allies[0].level).toBe(st.recLevel - 3);
  });

  it('권장 레벨 이상으로 키운 캐릭터는 실제 능력치로 싸운다', () => {
    const save = newSave();
    Object.assign(save.wallet, { pack_l: 500, pack_m: 500, pack_s: 500, credit: 9_000_000, core: 99 });
    for (const sz of ['s', 'm', 'l']) for (const el of ['glitch', 'void', 'kinetic', 'cryo']) save.wallet[`part_${el}_${sz}`] = 99;
    save.rank.level = 40;
    batchGrow(save, 'runner', 50);
    const st = DATA.stages['ch3-1'];
    const sp = storyParty(save, st, 'story');
    expect(sp.lifted).toEqual([]);
    expect(sp.allies[0].level).toBe(50);
    expect(sp.allies[0].stats.atk).toBeGreaterThan(storyParty(newSave(), st, 'story').allies[0].stats.atk);
  });

  it('내 캐릭터가 4명이면 체험 캐릭터는 들어오지 않는다', () => {
    const save = newSave();
    for (const id of ['kai', 'luna', 'zero']) save.chars[id] = newCharState(id);
    save.party = ['runner', 'kai', 'luna', 'zero'];
    const sp = storyParty(save, DATA.stages['ch2-1'], 'story');
    expect(sp.filled).toEqual([]);
    expect(sp.allies.map((a) => a.defId)).toEqual(['runner', 'kai', 'luna', 'zero']);
  });

  it('프롤로그는 체험 파티로 고정이다', () => {
    const save = newSave();
    const sp = storyParty(save, DATA.stages['prologue-1'], 'story');
    expect(sp.allies.map((a) => a.defId)).toEqual(['runner', 'doyun', 'mio', 'basil']);
  });

  it('처음 저장 그대로 스토리 난이도로 가면 일반공격만 눌러도 대부분 깬다(1~6장, 최종 보스 제외)', () => {
    const bad: string[] = [];
    for (const st of stages) {
      if (st.id === 'ch6-12') continue;
      const r = rate(newSave(), st.id, 'story', 'basicOnly', 12);
      if (r < 0.75) bad.push(`${st.id}:${Math.round(r * 100)}`);
    }
    expect(bad).toEqual([]);
  });

  it('보통 난이도에서는 약점을 노리면 대부분 깬다', () => {
    const bad: string[] = [];
    for (const st of stages) {
      const r = rate(newSave(), st.id, 'normal', 'smart', 12);
      if (r < 0.7) bad.push(`${st.id}:${Math.round(r * 100)}`);
    }
    expect(bad).toEqual([]);
  });
});
