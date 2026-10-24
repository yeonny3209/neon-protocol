import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle/battle';
import { autoPlay } from '../src/engine/battle/autoplay';
import type { BattleEvent } from '../src/engine/battle/types';
import { DATA } from '../src/engine/data';
import type { Element } from '../src/engine/defs';
import { buildAlly, standardLoadout } from '../src/engine/loadout';
import { battle, dummy, enemy, plainAlly, untilInput, withEnemies } from './helpers';

const slowDummy = (weak: Element[] = ['kinetic'], over = {}) => dummy('dummy', { stats: { hp: 100000, atk: 10, def: 100, spd: 10 }, weaknesses: weak, ...over });
const dmgOf = (ev: BattleEvent[], kind = 'hit') => ev.filter((e) => e.t === 'damage' && e.kind === kind).map((e) => (e as { amount: number }).amount);

describe('피해 공식', () => {
  it('공격력 × 배율 × (1+피해증가) × 방어계수 × 치명타 × 다운계수', () => {
    const data = withEnemies([slowDummy()]);
    const b = battle([plainAlly('kai')], [enemy('dummy')], {}, data);
    untilInput(b);
    // 92 × 1.0 × 100/(100+100) × 0.9(방화벽 남음) = 41.4
    expect(dmgOf(b.act('basic', 'e0'))).toEqual([41]);
    untilInput(b);
    // 피스톤 펀치 92 × 2.2 × 0.5 × 0.9 = 91.08 → 방화벽 20 → 0 이 되어 다운
    const ev = b.act('skill', 'e0');
    expect(dmgOf(ev)).toEqual([91]);
    expect(ev.some((e) => e.t === 'down')).toBe(true);
    // 다운 추가 피해: 92 × 1.6(키네틱) × 1.0(일반) × 0.5 = 73.6
    expect(dmgOf(ev, 'break')).toEqual([74]);
    untilInput(b);
    // 다운 중: 92 × 2.2 × (1+0.5 다운 대상 보너스) × 0.5 × 1.1 = 166.98
    expect(dmgOf(b.act('skill', 'e0'))).toEqual([167]);
  });

  it('치명타는 1 + 치명타 피해를 곱한다', () => {
    const data = withEnemies([slowDummy(['cryo'])]);
    const b = battle([plainAlly('kai', { critRate: 1, critDmg: 0.5 })], [enemy('dummy')], {}, data);
    untilInput(b);
    const ev = b.act('basic', 'e0');
    const hit = ev.find((e) => e.t === 'damage') as { amount: number; crit: boolean };
    expect(hit.crit).toBe(true);
    expect(hit.amount).toBe(Math.round(92 * 0.5 * 0.9 * 1.5));
  });

  it('방어 감소는 방어 계수의 방어력을 줄인다', () => {
    const data = withEnemies([slowDummy(['cryo'])]);
    const b = battle([plainAlly('zero'), plainAlly('kai')], [enemy('dummy')], {}, data);
    untilInput(b);
    expect(b.activeUnit!.defId).toBe('kai');
    b.act('basic', 'e0');
    untilInput(b);
    expect(b.activeUnit!.defId).toBe('zero');
    b.act('skill', 'e0'); // 방어 30% 감소
    untilInput(b);
    // 92 × 100/(100+70) × 0.9
    expect(dmgOf(b.act('basic', 'e0'))).toEqual([Math.round(92 * (100 / 170) * 0.9)]);
  });
});

describe('타임라인', () => {
  it('7칸을 보여 주고, 속도 125는 속도 100보다 1.25배 자주 행동한다', () => {
    const data = withEnemies([dummy('d100', { stats: { hp: 1e6, atk: 1, def: 0, spd: 100 } })]);
    const a = plainAlly('kai', { spd: 125 });
    const b = battle([a], [enemy('d100')], {}, data);
    expect(b.order()).toHaveLength(7);
    const seq = b.order(45);
    expect(seq.filter((x) => x === 'a0')).toHaveLength(25);
    expect(seq.filter((x) => x === 'e0')).toHaveLength(20);
  });

  it('행동 당기기는 대상의 전체 행동 거리 기준 %로 줄인다', () => {
    const data = withEnemies([slowDummy()]);
    const b = battle([plainAlly('kai', { spd: 50 }), plainAlly('seraphine')], [enemy('dummy')], {}, data);
    untilInput(b);
    expect(b.activeUnit!.defId).toBe('seraphine');
    const kai = b.unit('a0');
    const before = kai.av;
    b.act('skill', 'a0');
    expect(kai.av).toBeCloseTo(before - 0.5 * (10000 / 50), 5);
  });

  it('스킬을 고르면 바뀐 순서를 미리 보여 준다 (실제 상태는 그대로)', () => {
    const data = withEnemies([dummy('d', { stats: { hp: 1e6, atk: 1, def: 0, spd: 120 } })]);
    const b = battle([plainAlly('kai', { spd: 55 }), plainAlly('seraphine')], [enemy('d')], {}, data);
    untilInput(b);
    while (b.activeUnit?.defId !== 'seraphine') {
      b.act('basic');
      untilInput(b);
    }
    const plain = b.order();
    const preview = b.previewAct('skill', 'a0');
    expect(preview[0]).toBe('a1');
    expect(preview.indexOf('a0')).toBeLessThan(plain.indexOf('a0'));
    expect(b.order()).toEqual(plain);
  });

  it('선공이면 아군 행동 거리가 30% 줄어서 시작한다', () => {
    const data = withEnemies([slowDummy()]);
    const b = battle([plainAlly('kai')], [enemy('dummy')], { ambush: true }, data);
    expect(b.unit('a0').av).toBeCloseTo((10000 / 102) * 0.7, 5);
  });
});

describe('연산력(CP)', () => {
  it('3에서 시작, 일반공격 +1, 전투스킬 -1, 최대 5', () => {
    const data = withEnemies([slowDummy(['void'])]);
    const b = battle([plainAlly('kai')], [enemy('dummy')], {}, data);
    untilInput(b);
    expect(b.cp).toBe(3);
    b.act('basic');
    untilInput(b);
    expect(b.cp).toBe(4);
    b.act('basic');
    untilInput(b);
    b.act('basic');
    untilInput(b);
    expect(b.cp).toBe(5);
    b.act('skill');
    untilInput(b);
    expect(b.cp).toBe(4);
  });

  it('CP가 0이면 전투스킬을 쓸 수 없다', () => {
    const data = withEnemies([slowDummy(['void'])]);
    const b = battle([plainAlly('kai')], [enemy('dummy')], {}, data);
    untilInput(b);
    b.cp = 0;
    expect(b.canUseSkill()).toBe(false);
    expect(() => b.act('skill')).toThrow();
  });

  it('세라핀 특성: 전투 시작 시 CP +1', () => {
    const data = withEnemies([slowDummy()]);
    const b = battle([plainAlly('kai'), plainAlly('seraphine')], [enemy('dummy')], {}, data);
    untilInput(b);
    expect(b.cp).toBe(4);
  });
});

describe('방화벽과 시스템 다운', () => {
  it('약점이 아니면 방화벽이 깎이지 않는다', () => {
    const data = withEnemies([slowDummy(['cryo'])]);
    const b = battle([plainAlly('kai')], [enemy('dummy')], {}, data);
    untilInput(b);
    b.act('skill', 'e0');
    expect(b.unit('e0').firewall).toBe(30);
  });

  it('일반공격 10, 단일 스킬 20, 광역 스킬 대상당 10, 오버클럭 30', () => {
    const data = withEnemies([slowDummy(['plasma'], { firewall: 100 }), dummy('d2', { stats: { hp: 1e5, atk: 1, def: 100, spd: 10 }, weaknesses: ['plasma'], firewall: 100 })]);
    const b = battle([plainAlly('luna')], [enemy('dummy'), enemy('d2')], {}, data);
    untilInput(b);
    b.act('basic', 'e0');
    expect(b.unit('e0').firewall).toBe(90);
    untilInput(b);
    b.act('skill');
    expect(b.unit('e0').firewall).toBe(80);
    expect(b.unit('e1').firewall).toBe(90);
    b.unit('a0').heat = b.unit('a0').heatMax;
    b.overclock('a0');
    // 오버클럭 30 + 피날레 추가 15
    expect(b.unit('e0').firewall).toBe(35);
  });

  it('다운: 행동 25% 밀림, 다음 차례에 방화벽 완전 회복', () => {
    const data = withEnemies([dummy('d', { stats: { hp: 1e6, atk: 1, def: 100, spd: 90 }, weaknesses: ['plasma'] })]);
    const b = battle([plainAlly('luna')], [enemy('d')], {}, data);
    untilInput(b);
    b.act('basic', 'e0');
    untilInput(b);
    b.act('basic', 'e0');
    untilInput(b);
    const e = b.unit('e0');
    const before = e.av;
    b.act('basic', 'e0');
    expect(e.down).toBe(true);
    expect(e.av).toBeCloseTo(before + 0.25 * (10000 / 90), 5);
    let recovered = false;
    for (let i = 0; i < 10 && !recovered; i++) {
      const ev = b.phase === 'idle' ? b.advance() : b.act('basic', 'e0');
      recovered = ev.some((x) => x.t === 'recover');
    }
    expect(recovered).toBe(true);
    expect(e.down).toBe(false);
    expect(e.firewall).toBe(30);
  });

  it('다운 계수: 방화벽이 남아 있으면 0.9, 다운이면 1.1', () => {
    const data = withEnemies([slowDummy(['cryo'])]);
    const b = battle([plainAlly('seraphine')], [enemy('dummy')], {}, data);
    untilInput(b);
    const up = dmgOf(b.act('basic', 'e0'))[0];
    b.unit('e0').down = true;
    untilInput(b);
    const down = dmgOf(b.act('basic', 'e0'))[0];
    expect(up).toBe(Math.round(70 * 0.5 * 0.9));
    expect(down).toBe(Math.round(70 * 0.5 * 1.1));
  });

  const elementCase = (el: Element) => {
    const data = withEnemies([dummy('d', { stats: { hp: 1e6, atk: 1, def: 100, spd: 90 }, weaknesses: [el], firewall: 10 }), dummy('d2', { stats: { hp: 1e6, atk: 1, def: 100, spd: 10 }, weaknesses: [] as Element[], firewall: 10 })]);
    const a = plainAlly('kai');
    a.element = el;
    const b = battle([a], [enemy('d'), enemy('d2')], {}, data);
    untilInput(b);
    const ev = b.act('basic', 'e0');
    return { b, ev, e: b.unit('e0') };
  };

  it('키네틱 다운: 출혈 2턴', () => {
    const { e } = elementCase('kinetic');
    expect(e.statuses.find((s) => s.id === 'bleed')?.turns).toBe(2);
  });

  it('플라즈마 다운: 과열(지속 피해 + 방어 감소)', () => {
    const { b, e } = elementCase('plasma');
    expect(e.statuses.some((s) => s.id === 'overheat')).toBe(true);
    expect(b.mod(e, 'defReduction')).toBeCloseTo(DATA.balance.battle.downEffects.overheat.defReduction);
  });

  it('크라이오 다운: 다음 행동 1회를 건너뛴다', () => {
    const { b } = elementCase('cryo');
    let skipped = false;
    let enemyActed = false;
    for (let i = 0; i < 6; i++) {
      const ev = b.phase === 'idle' ? b.advance() : b.act('basic', 'e1');
      if (ev.some((x) => x.t === 'skip' && x.uid === 'e0')) skipped = true;
      if (!skipped && ev.some((x) => x.t === 'action' && x.uid === 'e0')) enemyActed = true;
    }
    expect(skipped).toBe(true);
    expect(enemyActed).toBe(false);
  });

  it('볼트 다운: 감전 피해가 양옆 적에게도 튄다', () => {
    const { b } = elementCase('volt');
    let spread = false;
    for (let i = 0; i < 8 && !spread; i++) {
      const ev = b.phase === 'idle' ? b.advance() : b.act('basic', 'e1');
      spread = ev.some((x) => x.t === 'damage' && x.uid === 'e1' && x.kind === 'dot');
    }
    expect(spread).toBe(true);
  });

  it('글리치 다운: 기본 밀기보다 더 크게 민다', () => {
    const { b, e } = elementCase('glitch');
    const pushes = b.order(3);
    expect(pushes).toBeDefined();
    const full = 10000 / 90;
    // 다운 25% + 글리치 추가 35%
    expect(e.av).toBeGreaterThan(full * (0.25 + 0.35) - 1);
  });

  it('보이드 다운: 소거(받는 피해 증가 + 속도 감소)', () => {
    const { b, e } = elementCase('void');
    expect(b.mod(e, 'dmgTaken')).toBeCloseTo(0.15);
    expect(b.spd(e)).toBeCloseTo(90 * 0.9);
  });
});

describe('오버클럭', () => {
  it('열량이 가득 차면 누구 차례든 끼어들고, 차례를 쓰지 않는다', () => {
    const data = withEnemies([slowDummy()]);
    const b = battle([plainAlly('kai'), plainAlly('luna')], [enemy('dummy')], {}, data);
    untilInput(b);
    const actor = b.active;
    const kai = b.unit('a0');
    expect(b.canOverclock('a0')).toBe(false);
    kai.heat = kai.heatMax;
    expect(b.canOverclock('a0')).toBe(true);
    const ev = b.overclock('a0', 'e0');
    expect(dmgOf(ev).length).toBe(2);
    expect(b.active).toBe(actor);
    expect(b.phase).toBe('input');
    expect(kai.heat).toBe(DATA.balance.battle.heat.overclockRefund);
  });

  it('행동·피격·처치로 열량이 찬다', () => {
    const data = withEnemies([slowDummy()]);
    const b = battle([plainAlly('kai')], [enemy('dummy')], {}, data);
    untilInput(b);
    b.act('basic');
    expect(b.unit('a0').heat).toBe(DATA.balance.battle.heat.basic);
  });
});

describe('특성', () => {
  it('카이 반격은 카이 차례 사이에 한 번만', () => {
    const aoe = dummy('aoe', { stats: { hp: 1e6, atk: 1, def: 100, spd: 300 }, weaknesses: ['cryo'], actions: [{ skill: { name: '난사', kind: 'skill', target: 'allEnemies', desc: '', effects: [{ type: 'damage', scale: 1 }] }, weight: 1 }] });
    const b = battle([plainAlly('kai', { spd: 50 }), plainAlly('luna'), plainAlly('zero')], [enemy('aoe')], {}, withEnemies([aoe]));
    b.advance();
    let counters = 0;
    for (let i = 0; i < 3; i++) {
      const ev = b.advance();
      counters += ev.filter((e) => e.t === 'action' && e.kind === 'counter').length;
      if (b.phase === 'input') break;
    }
    expect(counters).toBe(1);
  });
});

describe('난이도', () => {
  it('스토리: 적 체력 60%, 공격력 50%, 방화벽 70%', () => {
    const s = new Battle({ allies: [plainAlly('kai')], enemies: [enemy('heavy_mech', 10)], seed: 1, difficulty: 'story' });
    const n = new Battle({ allies: [plainAlly('kai')], enemies: [enemy('heavy_mech', 10)], seed: 1, difficulty: 'normal' });
    const es = s.unit('e0');
    const en = n.unit('e0');
    expect(es.maxHp / en.maxHp).toBeCloseTo(0.6, 2);
    expect(es.base.atk / en.base.atk).toBeCloseTo(0.5, 5);
    expect(es.firewallMax).toBe(Math.round(90 * 0.7));
  });
});

describe('결정성', () => {
  const party = () => ['kai', 'seraphine', 'zero', 'luna'].map((id) => buildAlly(standardLoadout(id, 20)));
  const foes = () => [enemy('sec_drone', 20), enemy('heavy_mech', 20), enemy('street_thug', 20)];

  it('같은 시드와 같은 입력이면 결과가 같다', () => {
    const run = () => {
      const b = new Battle({ allies: party(), enemies: foes(), seed: 42, difficulty: 'normal' });
      const r = autoPlay(b);
      return { r, units: b.units.map((u) => [u.hp, u.heat, u.statuses.length]) };
    };
    expect(run()).toEqual(run());
  });

  it('미리보기를 아무리 해도 실제 결과는 바뀌지 않는다', () => {
    const plain = new Battle({ allies: party(), enemies: foes(), seed: 7, difficulty: 'normal' });
    const peeky = new Battle({ allies: party(), enemies: foes(), seed: 7, difficulty: 'normal' });
    const origAct = peeky.act.bind(peeky);
    peeky.act = (k, t) => {
      peeky.previewAct('skill', t);
      peeky.previewAct('basic', t);
      return origAct(k, t);
    };
    expect(autoPlay(peeky)).toEqual(autoPlay(plain));
  });

  it('5성 4명 vs 적 3종 전투가 끝까지 돌아간다', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = autoPlay(new Battle({ allies: party(), enemies: foes(), seed, difficulty: 'story' }));
      expect(r.result).toBe('won');
    }
  });
});
