import { describe, expect, it } from 'vitest';
import { currentBanners, dive, exchange, exchangeList, fiveRate, rollOnce, standardSelect, type Banner } from '../src/engine/gacha';
import { DATA } from '../src/engine/data';
import { createRng } from '../src/engine/rng';
import { newSave } from '../src/engine/save';
import { addCharacter } from '../src/engine/state';

const charBanner = (): Banner => currentBanners(newSave(), new Date('2026-11-10T12:00:00'))[1];

describe('다이브 확률 (기획서 7.3)', () => {
  it('5성 확률: 기본 0.6%, 74회부터 매회 +6%p, 90회 100%', () => {
    const r = DATA.balance.gacha.character.five;
    expect(fiveRate(r, 1)).toBeCloseTo(0.006);
    expect(fiveRate(r, 73)).toBeCloseTo(0.006);
    expect(fiveRate(r, 74)).toBeCloseTo(0.066);
    expect(fiveRate(r, 89)).toBeCloseTo(0.966);
    expect(fiveRate(r, 90)).toBe(1);
  });

  it('20만 번 돌리면 5성 평균 약 62회, 90회를 넘는 일이 없고, 4성은 10회 안에 반드시 나온다', () => {
    const save = newSave();
    const rng = createRng(12345);
    const banner = charBanner();
    let since5 = 0;
    let since4 = 0;
    let max5 = 0;
    let max4 = 0;
    const gaps: number[] = [];
    let pickupWins = 0;
    let fives = 0;
    let worstPickup = 0;
    let sincePickup = 0;
    for (let i = 0; i < 200000; i++) {
      const r = rollOnce(save, banner, rng);
      since5++;
      since4++;
      sincePickup++;
      if (r.rarity >= 4) {
        max4 = Math.max(max4, since4);
        since4 = 0;
      }
      if (r.rarity === 5) {
        gaps.push(since5);
        max5 = Math.max(max5, since5);
        since5 = 0;
        fives++;
        if (r.pickup) {
          pickupWins++;
          worstPickup = Math.max(worstPickup, sincePickup);
          sincePickup = 0;
        }
      }
    }
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(avg).toBeGreaterThan(58);
    expect(avg).toBeLessThan(66);
    expect(max5).toBeLessThanOrEqual(90);
    expect(max4).toBeLessThanOrEqual(10);
    expect(worstPickup).toBeLessThanOrEqual(180);
    // 50:50 + 놓치면 확정 → 5성 중 픽업 비율은 약 2/3
    expect(pickupWins / fives).toBeGreaterThan(0.62);
    expect(pickupWins / fives).toBeLessThan(0.71);
    process.stderr.write(`[다이브] 5성 평균 ${avg.toFixed(1)}회, 최대 ${max5}회 / 4성 최대 간격 ${max4}회 / 픽업 최악 ${worstPickup}회\n`);
  });

  it('픽업을 놓치면 다음 5성은 픽업 확정', () => {
    const save = newSave();
    const banner = charBanner();
    save.gacha.pity.character = { five: 89, four: 0, guar5: true, guar4: false, total: 89 };
    const r = rollOnce(save, banner, createRng(1));
    expect(r.rarity).toBe(5);
    expect(r.pickup).toBe(true);
    expect(r.id).toBe(banner.pickup5);
  });

  it('카트리지 배너는 80회 천장', () => {
    const save = newSave();
    const banner = currentBanners(save, new Date('2026-11-10'))[2];
    const rng = createRng(9);
    let since = 0;
    let max = 0;
    for (let i = 0; i < 50000; i++) {
      since++;
      if (rollOnce(save, banner, rng).rarity === 5) {
        max = Math.max(max, since);
        since = 0;
      }
    }
    expect(max).toBeLessThanOrEqual(80);
  });

  it('천장 카운트는 같은 종류 배너끼리 다음 배너로 이어진다', () => {
    const save = newSave();
    const a = currentBanners(save, new Date('2026-11-10'))[1];
    const b = currentBanners(save, new Date('2026-11-20'))[1];
    expect(a.pickup5).not.toBe(b.pickup5);
    save.gacha.pity.character = { five: 40, four: 3, guar5: true, guar4: false, total: 40 };
    const r = rollOnce(save, b, createRng(3));
    if (r.rarity < 5) expect(save.gacha.pity.character.five).toBe(41);
    expect(save.gacha.pity.character.total).toBe(41);
  });
});

describe('초보자 다이브', () => {
  it('50회 안에 5성 확정, 첫 10회 안에 4성 캐릭터 확정, 10회는 키 8개', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const save = newSave();
      save.wallet.key = 40;
      const banner = currentBanners(save)[0];
      expect(banner.kind).toBe('beginner');
      const results = [];
      for (let i = 0; i < 5; i++) {
        const r = dive(save, banner, 10, createRng(seed * 31 + i));
        if (typeof r === 'string') throw new Error(r);
        results.push(...r);
        if (i === 0) expect(r.some((x) => x.rarity === 4 && x.kind === 'char')).toBe(true);
      }
      expect(save.wallet.key).toBe(0);
      expect(results.some((x) => x.rarity === 5)).toBe(true);
      expect(dive(save, banner, 1, createRng(1))).toBe('limit');
    }
  });
});

describe('중복과 교환소', () => {
  it('중복은 동기화 1~6, 넘치면 신호 조각(4성 8개, 5성 40개)', () => {
    const save = newSave();
    for (let i = 0; i < 7; i++) addCharacter(save, 'doyun');
    expect(save.chars.doyun.sync).toBe(6);
    const before = save.wallet.signal ?? 0;
    addCharacter(save, 'doyun');
    expect(save.wallet.signal).toBe(before + 8);
    for (let i = 0; i < 8; i++) addCharacter(save, 'kai');
    expect(save.wallet.signal).toBe(before + 8 + 40);
  });

  it('상시 5성 선택(300), 다이브 키(20, 달마다 5회)', () => {
    const save = newSave();
    save.wallet.signal = 1000;
    const list = exchangeList(save, new Date('2026-11-10'));
    const five = list.find((x) => x.kind === 'standardFive')!;
    const r = exchange(save, five, 'luna', new Date('2026-11-10'));
    expect(typeof r).toBe('object');
    expect(save.chars.luna).toBeDefined();
    const key = list.find((x) => x.kind === 'key')!;
    for (let i = 0; i < 5; i++) expect(exchange(save, key, 'key', new Date('2026-11-10'))).toBe('key');
    expect(exchange(save, key, 'key', new Date('2026-11-10'))).toBe('limit');
    expect(exchange(save, key, 'key', new Date('2026-12-02'))).toBe('key');
  });

  it('상시 다이브 300회를 채우면 상시 5성 1명을 고를 수 있다(한 번)', () => {
    const save = newSave();
    expect(standardSelect(save, 'zero')).toBeNull();
    save.gacha.standardPulls = 300;
    expect(standardSelect(save, 'zero')?.id).toBe('zero');
    expect(standardSelect(save, 'kai')).toBeNull();
  });
});
