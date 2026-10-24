// 재화·다이브·성장·반복 콘텐츠를 마구 눌러도 값이 깨지지 않는지 확인한다.
import { describe, expect, it } from 'vitest';
import { claimAchievements, checkAchievements, claimCodex } from '../src/engine/achievements';
import { DATA } from '../src/engine/data';
import { currentBanners, dive, exchange, exchangeList, buyKeys, standardSelect, standardSelectReady } from '../src/engine/gacha';
import { ascend, batchGrow, cartAscend, cartLevelUp, equip, levelUp, skillUp, unlockNode } from '../src/engine/growth';
import { claimBacklog, claimDaily, claimWeekly, ensureDaily } from '../src/engine/missions';
import { sweep } from '../src/engine/materials';
import { createRng } from '../src/engine/rng';
import { newSave, type SaveData } from '../src/engine/save';
import { addCharacter, addItem, grant } from '../src/engine/state';
import { deepEnv, deepPeriodEnd, ensureDeep, floorEnemies } from '../src/engine/deep';

function sane(s: SaveData, tag: string) {
  for (const [k, v] of Object.entries(s.wallet)) {
    if (!Number.isFinite(v) || v < 0) throw new Error(`${tag}: wallet.${k}=${v}`);
  }
  for (const [id, c] of Object.entries(s.chars)) {
    for (const k of ['level', 'exp', 'asc', 'sync'] as const) if (!Number.isFinite(c[k]) || c[k] < 0) throw new Error(`${tag}: ${id}.${k}=${c[k]}`);
    if (c.level > DATA.balance.growth.maxLevel) throw new Error(`${tag}: ${id} level ${c.level}`);
  }
  if (new Set(s.ach.claimed).size !== s.ach.claimed.length) throw new Error(`${tag}: 업적 보상 중복 수령`);
  if (new Set(s.codex.claimed).size !== s.codex.claimed.length) throw new Error(`${tag}: 도감 보상 중복 수령`);
  const uids = s.carts.map((c) => c.uid);
  if (new Set(uids).size !== uids.length) throw new Error(`${tag}: 카트리지 uid 중복`);
  for (const c of Object.values(s.chars)) if (c.cart !== null && !uids.includes(c.cart)) throw new Error(`${tag}: ${c.id} 없는 카트리지 ${c.cart} 장착`);
  const eq = Object.values(s.chars).map((c) => c.cart).filter((x) => x !== null);
  if (new Set(eq).size !== eq.length) throw new Error(`${tag}: 한 카트리지를 두 명이 장착`);
}

describe('재화·성장 마구 누르기', () => {
  it('아무 순서로 눌러도 재화가 음수·NaN이 되거나 보상이 두 번 들어가지 않는다', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const rng = createRng(seed);
      const r = () => rng.next();
      const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
      const s = newSave();
      s.started = true;
      s.rank.level = 1 + Math.floor(r() * 40);
      grant(s, { shard: 4000, key: 30, credit: 400000, pack_l: 30, pack_m: 30, pack_s: 30, core: 5, weekly: 5 });
      for (const id of Object.keys(DATA.chapters)) if (r() < 0.7) s.story.chapters.push(id);
      const now = new Date(Date.UTC(2026, 10, 1 + Math.floor(r() * 60)));
      try {
        for (let step = 0; step < 150; step++) {
          const ids = Object.keys(s.chars);
          const cid = pick(ids);
          const op = Math.floor(r() * 16);
          switch (op) {
            case 0: { const b = pick(currentBanners(s, now)); dive(s, b, r() < 0.5 ? 1 : 10, rng, now.getTime()); break; }
            case 1: buyKeys(s, 1 + Math.floor(r() * 3)); break;
            case 2: levelUp(s, cid, 1 + Math.floor(r() * 60)); break;
            case 3: ascend(s, cid); break;
            case 4: batchGrow(s, cid, 1 + Math.floor(r() * 60)); break;
            case 5: skillUp(s, cid, pick(['basic', 'skill', 'overclock', 'trait'] as const)); break;
            case 6: unlockNode(s, cid, pick(['big', 'small'] as const), Math.floor(r() * 10)); break;
            case 7: if (s.carts.length) { const c = pick(s.carts); cartLevelUp(s, c.uid, 1 + Math.floor(r() * 50)); cartAscend(s, c.uid); equip(s, cid, c.uid); } break;
            case 8: { ensureDaily(s, now); claimDaily(s); claimBacklog(s); for (const m of s.daily.weekly) claimWeekly(s, m.id); break; }
            case 9: { const id = pick(Object.keys(DATA.materials)); sweep(s, id, Math.floor(r() * 5), pick([1, 5, 10]), now); break; }
            case 10: { checkAchievements(s); claimAchievements(s); claimCodex(s); break; }
            case 11: { const list = exchangeList(s, now); const it = pick(list); exchange(s, it, pick(it.options?.length ? it.options : ['']), now); break; }
            case 12: if (standardSelectReady(s)) standardSelect(s, pick(DATA.banners.standardChars)); break;
            case 13: addCharacter(s, pick(Object.keys(DATA.characters))); break;
            case 14: grant(s, { shard: Math.floor(r() * 2000), key: Math.floor(r() * 12), credit: Math.floor(r() * 90000), pack_l: 5, core: 2, weekly: 2 }); break;
            case 15: addItem(s, pick(Object.keys(DATA.items)), Math.floor(r() * 40)); break;
          }
          sane(s, `seed ${seed} step ${step} op ${op}`);
        }
      } catch (e) {
        bad.push((e as Error).message);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });

  it('다이브 배너·딥 서버 환경이 먼 미래까지 정상으로 돈다', () => {
    const s = newSave();
    s.story.chapters.push('ch3');
    for (let day = -80; day < 1500; day += 7) {
      const now = new Date(Date.UTC(2026, 10, 2 + day));
      const banners = currentBanners(s, now);
      for (const b of banners) {
        for (const id of [b.pickup5, ...b.pickup4].filter(Boolean) as string[]) {
          if (!DATA.characters[id] && !DATA.cartridges[id]) throw new Error(`배너 ${b.id}: 없는 id ${id} (${now.toISOString()})`);
        }
      }
      const env = deepEnv(now);
      expect(env).toBeDefined();
      expect(deepPeriodEnd(now).getTime()).toBeGreaterThan(now.getTime());
      ensureDeep(s, now);
      for (const f of DATA.deep.floors) {
        for (const part of ['A', 'B'] as const) {
          for (const e of floorEnemies(f, part, now)) if (!DATA.enemies[e]) throw new Error(`딥 서버 ${f.floor}${part}: 없는 적 ${e}`);
        }
      }
    }
  });
});

describe('날짜가 넘어갈 때', () => {
  it('새벽 4시 기준 일일 초기화와 주간 초기화가 어떤 시각에도 깨지지 않는다', () => {
    const s = newSave();
    s.started = true;
    s.story.chapters.push('ch1');
    let prev = '';
    for (let h = 0; h < 24 * 20; h += 1) {
      const now = new Date(2026, 9, 24, 0, 30 + h * 60);
      ensureDaily(s, now);
      expect(s.daily.list.length).toBe(DATA.balance.daily.count);
      expect(s.daily.backlog).toBeLessThanOrEqual(DATA.balance.daily.backlogDays);
      if (prev && prev !== s.daily.day) {
        const hr = now.getHours();
        expect(hr).toBe(4);
      }
      prev = s.daily.day;
    }
  });
});
