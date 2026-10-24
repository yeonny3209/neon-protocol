import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle/battle';
import { autoPlay } from '../src/engine/battle/autoplay';
import { DATA } from '../src/engine/data';
import { batchGrow, applyRecommended } from '../src/engine/growth';
import { canSweepTier, clearTier, sweep, sweepsLeft, tierOpen, weeklyLeft } from '../src/engine/materials';
import { allDailyDone, claimBacklog, claimDaily, claimWeekly, ensureDaily } from '../src/engine/missions';
import { achClaimable, checkAchievements, claimAchievements, claimCodex, codexClaimable } from '../src/engine/achievements';
import { deepSetup, ensureDeep, floorOpen, recordFloor, totalStars } from '../src/engine/deep';
import { afterBattle, chooseNode, choosePatch, claimLoopWeekly, currentChoices, finishRun, leaveShop, loopSetup, resolveEvent, rest, startRun, type LoopRun } from '../src/engine/loop';
import { newCharState, newSave, type SaveData } from '../src/engine/save';
import { track } from '../src/engine/state';

const D = (s: string) => new Date(`${s}T12:00:00`);

/** 4명을 레벨 lv까지 키운 저장 */
function strongSave(lv = 50, ids = ['kai', 'seraphine', 'zero', 'luna']): SaveData {
  const s = newSave();
  s.rank.level = 40;
  Object.assign(s.wallet, { pack_l: 900, credit: 50_000_000, core: 99, weekly: 99 });
  for (const it of Object.values(DATA.items)) if (it.kind === 'part' || it.kind === 'chip') s.wallet[it.id] = 999;
  for (const id of ids) {
    s.chars[id] = newCharState(id);
    batchGrow(s, id, lv);
    applyRecommended(s, id);
  }
  s.party = ids;
  return s;
}

describe('재료 스테이지와 소탕', () => {
  it('단계는 러너 등급으로 열린다', () => {
    const s = newSave();
    expect(tierOpen(s, 'mat_exp', 0)).toBe(true);
    expect(tierOpen(s, 'mat_exp', 1)).toBe(false);
    s.rank.level = 8;
    expect(tierOpen(s, 'mat_exp', 1)).toBe(true);
  });

  it('별 3개로 깨야 소탕할 수 있고, 소탕은 즉시 보상', () => {
    const s = newSave();
    expect(sweep(s, 'mat_exp', 0, 1)).toBe('stars');
    clearTier(s, 'mat_exp', 0, 1 | 2);
    expect(canSweepTier(s, 'mat_exp', 0)).toBe(false);
    clearTier(s, 'mat_exp', 0, 7);
    const before = s.wallet.pack_s ?? 0;
    const r = sweep(s, 'mat_exp', 0, 5);
    expect(typeof r).toBe('object');
    expect(s.wallet.pack_s).toBe(before + 8 * 5);
  });

  it('소탕은 스테이지당 하루 30회', () => {
    const s = newSave();
    clearTier(s, 'mat_credit', 0, 7);
    const now = D('2026-11-10');
    for (let i = 0; i < 3; i++) expect(typeof sweep(s, 'mat_credit', 0, 10, now)).toBe('object');
    expect(sweepsLeft(s, 'mat_credit', now)).toBe(0);
    expect(sweep(s, 'mat_credit', 0, 1, now)).toBe('limit');
    expect(sweepsLeft(s, 'mat_credit', D('2026-11-11'))).toBe(30);
  });

  it('주간 보스 재료는 주 3회까지만', () => {
    const s = newSave();
    const now = D('2026-11-10');
    clearTier(s, 'mat_weekly', 0, 7, now);
    expect(weeklyLeft(s, now)).toBe(2);
    const w = s.wallet.weekly ?? 0;
    sweep(s, 'mat_weekly', 0, 5, now);
    expect(s.wallet.weekly).toBe(w + 2);
    expect(weeklyLeft(s, now)).toBe(0);
    expect(weeklyLeft(s, D('2026-11-17'))).toBe(3);
  });
});

describe('데일리 루틴', () => {
  it('하루 4개, 이벤트로 진행되고 다 끝내면 샤드 90', () => {
    const s = newSave();
    ensureDaily(s, D('2026-11-10'));
    expect(s.daily.list).toHaveLength(4);
    for (const ev of ['battleWin', 'overclock', 'sweep', 'grow']) track(s, ev, 5);
    expect(allDailyDone(s)).toBe(true);
    const sh = s.wallet.shard ?? 0;
    expect(claimDaily(s)).not.toBeNull();
    expect((s.wallet.shard ?? 0) - sh).toBeGreaterThanOrEqual(90);
    expect(claimDaily(s)).toBeNull();
  });

  it('하루를 빠져도 보상은 최대 3일치까지 "밀린 루틴"으로 모아 받는다', () => {
    const s = newSave();
    ensureDaily(s, D('2026-11-10'));
    ensureDaily(s, D('2026-11-12'));
    expect(s.daily.backlog).toBe(2);
    ensureDaily(s, D('2026-11-20'));
    expect(s.daily.backlog).toBe(3);
    const sh = s.wallet.shard ?? 0;
    claimBacklog(s);
    expect((s.wallet.shard ?? 0) - sh).toBe(270);
    expect(s.daily.backlog).toBe(0);
  });

  it('주간 미션 3개', () => {
    const s = newSave();
    ensureDaily(s, D('2026-11-10'));
    expect(s.daily.weekly).toHaveLength(3);
    track(s, 'loopClear');
    expect(claimWeekly(s, 'w_loop')).not.toBeNull();
    expect(claimWeekly(s, 'w_deep')).toBeNull();
  });
});

describe('업적과 도감', () => {
  it('업적은 100개 안팎, 숨은 업적 10개', () => {
    expect(DATA.achievements.length).toBeGreaterThanOrEqual(95);
    expect(DATA.achievements.filter((a) => a.hidden)).toHaveLength(10);
    expect(new Set(DATA.achievements.map((a) => a.cat))).toEqual(new Set(['story', 'battle', 'collect', 'growth', 'loop', 'fun']));
  });

  it('조건을 채우면 달성, 보상은 따로 받는다', () => {
    const s = newSave();
    s.repTouches = 0;
    track(s, 'repTouch', 10);
    track(s, 'battleWin', 1);
    const done = checkAchievements(s).map((a) => a.id);
    expect(done).toContain('f_touch10');
    expect(done).toContain('b_win1');
    const before = s.wallet.shard ?? 0;
    claimAchievements(s);
    expect((s.wallet.shard ?? 0) - before).toBeGreaterThan(0);
    expect(achClaimable(s)).toHaveLength(0);
  });

  it('도감 항목을 처음 채울 때마다 샤드를 준다', () => {
    const s = newSave();
    s.codex.enemies.push('sec_drone', 'street_thug');
    const n = codexClaimable(s).length;
    expect(n).toBeGreaterThanOrEqual(3); // 러너 + 적 2
    claimCodex(s);
    expect(s.wallet.shard).toBe(n * DATA.balance.economy.codexShards);
    expect(codexClaimable(s)).toHaveLength(0);
  });
});

describe('딥 서버', () => {
  it('2주마다 별이 초기화되고, 층은 앞 층을 깨야 열린다', () => {
    const s = newSave();
    ensureDeep(s, D('2026-11-03'));
    recordFloor(s, 1, 7);
    expect(floorOpen(s, 2)).toBe(true);
    expect(floorOpen(s, 3)).toBe(false);
    expect(totalStars(s)).toBe(3);
    ensureDeep(s, D('2026-11-20'));
    expect(totalStars(s)).toBe(0);
  });

  it('별 36개를 모으면 2주치 샤드는 800 안팎', () => {
    const s = newSave();
    ensureDeep(s, D('2026-11-03'));
    s.rank.level = 40; // 등급 상승 샤드는 빼고 잰다
    const before = s.wallet.shard ?? 0;
    for (let f = 1; f <= 12; f++) recordFloor(s, f, 7);
    const got = (s.wallet.shard ?? 0) - before;
    expect(got).toBeGreaterThanOrEqual(700);
    expect(got).toBeLessThanOrEqual(820);
    expect(s.wallet.weekly).toBe(4);
  });

  it('1~4층은 스토리 난이도로 본편을 깬 정도(50레벨)면 넉넉히 깨고, 12층은 확실히 어렵다', () => {
    const s = strongSave(50);
    const rate = (floor: number) => {
      let w = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const b = new Battle(deepSetup(s, floor, 'A', s.party, seed, D('2026-11-03')));
        if (autoPlay(b, 'smart').result === 'won') w++;
      }
      return w / 10;
    };
    const easy = [1, 2, 3, 4].map(rate);
    const hard = rate(12);
    process.stderr.write(`[딥 서버 Lv50 파티] 1~4층 ${easy.map((x) => Math.round(x * 100)).join('/')}% · 12층 ${Math.round(hard * 100)}%\n`);
    expect(Math.min(...easy)).toBeGreaterThanOrEqual(0.9);
    expect(hard).toBeLessThan(0.6);
  });
});

describe('시뮬레이션 루프', () => {
  /** 루프 한 판을 자동으로 끝까지 */
  function autoRun(s: SaveData, diff: number, seed: number): { run: LoopRun; nodes: number } {
    const run = startRun(s, diff, 'firewall', s.party, seed);
    let nodes = 0;
    for (let guard = 0; guard < 200 && !run.result; guard++) {
      const p = chooseNode(s, run, 0);
      nodes++;
      if (p.kind === 'battle') {
        const b = new Battle(loopSetup(s, run, p.node, seed * 100 + guard));
        autoPlay(b, 'smart');
        const next = afterBattle(s, run, b);
        if (next?.kind === 'patch') choosePatch(s, run, next.options[0]);
      } else if (p.kind === 'event') resolveEvent(s, run, 0);
      else if (p.kind === 'shop') leaveShop(run);
      else rest(run);
    }
    return { run, nodes };
  }

  it('지도는 구역 3개, 구역마다 노드 6~8개, 마지막은 보스', () => {
    const s = strongSave(50);
    const run = startRun(s, 1, 'cache', s.party, 7);
    expect(run.map).toHaveLength(3);
    for (const z of run.map) {
      expect(z.length).toBeGreaterThanOrEqual(6);
      expect(z.length).toBeLessThanOrEqual(8);
      expect(z[z.length - 1][0].type).toBe('boss');
    }
    expect(currentChoices(run).every((n) => n.type === 'battle')).toBe(true);
  });

  it('50레벨 파티로 난이도 1을 대부분 완주하고, 보상과 최초 완주 보상을 받는다', () => {
    const s = strongSave(50);
    let clears = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { run } = autoRun(s, 1, seed);
      if (run.result === 'clear') clears++;
      const end = finishRun(s, run, D('2026-11-10'));
      expect(end.score).toBeGreaterThan(0);
      expect(s.loop.run).toBeNull();
    }
    expect(clears).toBeGreaterThanOrEqual(5);
    expect(s.loop.firstClear).toContain(1);
    expect(s.loop.patches.length).toBeGreaterThan(5);
  });

  it('한 번 완주하면 주간 점수 목표에 거의 닿아 샤드 225를 받는다', () => {
    const s = strongSave(50);
    const { run } = autoRun(s, 1, 3);
    finishRun(s, run, D('2026-11-10'));
    expect(s.loop.score).toBeGreaterThanOrEqual(DATA.balance.loop.weeklyScoreTarget * 0.8);
    if (s.loop.score >= DATA.balance.loop.weeklyScoreTarget) expect(claimLoopWeekly(s, D('2026-11-10'))?.items.shard).toBe(225);
  });
});
