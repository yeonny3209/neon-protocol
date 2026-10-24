import { describe, expect, it } from 'vitest';
import { allyFromSave, applyRecommended, ascend, batchGrow, canAscend, canSkillUp, equip, expNeeded, levelCap, levelUp, packPlan, skillUp } from '../src/engine/growth';
import { newCharState, newSave } from '../src/engine/save';
import { addCartridge, addRankExp, grant } from '../src/engine/state';

const rich = () => {
  const s = newSave();
  s.chars.kai = newCharState('kai');
  Object.assign(s.wallet, { pack_l: 200, pack_m: 200, pack_s: 200, credit: 5_000_000, core: 50, weekly: 50, chip_strike: 500 });
  for (const sz of ['s', 'm', 'l']) s.wallet[`part_kinetic_${sz}`] = 100;
  s.rank.level = 40;
  return s;
};

describe('레벨과 돌파', () => {
  it('데이터 팩은 큰 것부터 넘치지 않게 쓴다', () => {
    expect(packPlan({ pack_l: 5, pack_m: 5, pack_s: 5 }, 12500).use).toEqual({ pack_l: 1, pack_m: 1, pack_s: 1 });
  });

  it('돌파 전에는 20레벨에서 멈춘다', () => {
    const s = rich();
    levelUp(s, 'kai', 60);
    expect(s.chars.kai.level).toBe(20);
  });

  it('돌파: 속성 부품 + 크레딧, 러너 등급 조건', () => {
    const s = rich();
    s.rank.level = 1;
    levelUp(s, 'kai', 20);
    expect(canAscend(s, 'kai').ok).toBe(true);
    expect(ascend(s, 'kai')).toBe(true);
    expect(levelCap(s.chars.kai.asc)).toBe(30);
    levelUp(s, 'kai', 30);
    const chk = canAscend(s, 'kai');
    expect(chk.ok).toBe(false);
    if (!chk.ok) expect(chk.reason).toBe('rank');
  });

  it('일괄 성장: 목표 레벨까지 레벨업과 돌파를 반복한다', () => {
    const s = rich();
    const r = batchGrow(s, 'kai', 55);
    expect(r.to).toBe(55);
    expect(s.chars.kai.asc).toBe(4);
    expect(r.ascended).toBe(4);
  });

  it('재료가 모자라면 어디서 막혔는지 알려 준다', () => {
    const s = newSave();
    s.chars.kai = newCharState('kai');
    s.wallet = { pack_m: 1, credit: 100000 };
    const r = batchGrow(s, 'kai', 30);
    expect(r.to).toBeLessThan(30);
    expect(r.blocked).toBe('items');
    expect(Object.keys(r.missing).length).toBeGreaterThan(0);
  });

  it('필요 경험치 계산', () => {
    expect(expNeeded(1, 0, 2)).toBeGreaterThan(0);
    expect(expNeeded(5, 0, 5)).toBe(0);
  });
});

describe('스킬과 회로도', () => {
  it('스킬 레벨은 돌파 단계에 따라 상한이 있다', () => {
    const s = rich();
    expect(skillUp(s, 'kai', 'skill')).toBe(true);
    expect(skillUp(s, 'kai', 'skill')).toBe(true);
    const chk = canSkillUp(s, 'kai', 'skill');
    expect(chk.ok).toBe(false);
    if (!chk.ok) expect(chk.reason).toBe('cap');
  });

  it('추천 순서 일괄 해금은 살 수 있는 만큼 연다', () => {
    const s = rich();
    batchGrow(s, 'kai', 60);
    const n = applyRecommended(s, 'kai');
    expect(n).toBeGreaterThan(20);
    expect(s.chars.kai.skills.skill).toBe(10);
    expect(s.chars.kai.big).toHaveLength(3);
    expect(s.chars.kai.small).toHaveLength(10);
  });

  it('성장하면 전투 스탯이 오른다', () => {
    const s = rich();
    const before = allyFromSave(s, 'kai');
    batchGrow(s, 'kai', 40);
    const after = allyFromSave(s, 'kai');
    expect(after.stats.atk).toBeGreaterThan(before.stats.atk * 3);
  });
});

describe('카트리지', () => {
  it('같은 프로토콜이면 고유 효과, 다르면 수치만', () => {
    const s = rich();
    const noCart = allyFromSave(s, 'kai');
    const g = addCartridge(s, 'c4_knuckle');
    equip(s, 'kai', g.uid);
    expect(allyFromSave(s, 'kai').passives.some((p) => p.name === '한 방')).toBe(true);
    const g2 = addCartridge(s, 'c4_riotshield');
    equip(s, 'kai', g2.uid);
    const other = allyFromSave(s, 'kai');
    expect(other.passives.some((p) => p.name === '대열 유지')).toBe(false);
    expect(other.stats.hp).toBeGreaterThan(noCart.stats.hp);
  });

  it('중복은 중첩 5단계까지, 그 뒤는 카트리지 데이터', () => {
    const s = newSave();
    for (let i = 0; i < 5; i++) addCartridge(s, 'c3_pipe');
    expect(s.carts[0].rank).toBe(5);
    addCartridge(s, 'c3_pipe');
    expect(s.wallet.cart_data).toBeGreaterThan(0);
  });
});

describe('러너 등급', () => {
  it('등급이 오를 때마다 샤드, 5단위마다 다이브 키', () => {
    const s = newSave();
    const up = addRankExp(s, 100000);
    expect(up!.to).toBeGreaterThan(10);
    expect(up!.reward.shard).toBe((up!.to - 1) * 100);
    expect(up!.reward.key).toBe(Math.floor(up!.to / 5));
  });

  it('보상 지급: 재화·캐릭터·카트리지·등급 경험치', () => {
    const s = newSave();
    const g = grant(s, { shard: 100, 'char:kai': 1, 'cart:c4_knuckle': 1, rankExp: 100 });
    expect(s.wallet.shard).toBeGreaterThanOrEqual(100);
    expect(s.chars.kai).toBeDefined();
    expect(g.carts).toHaveLength(1);
    expect(s.rank.level).toBe(2);
  });
});
