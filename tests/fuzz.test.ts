// 마구잡이 전투: 어떤 조합·행동에서도 멈추거나 값이 깨지지 않는지 확인한다.
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle/battle';
import type { AllySetup } from '../src/engine/battle/types';
import { DATA } from '../src/engine/data';
import { ascForLevel, buildAlly, standardLoadout } from '../src/engine/loadout';
import { createRng } from '../src/engine/rng';

const charIds = Object.keys(DATA.characters);
const enemyIds = Object.keys(DATA.enemies);
const cartIds = Object.keys(DATA.cartridges);

function randomAllies(r: () => number, n: number): AllySetup[] {
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const ids = new Set<string>();
  while (ids.size < n) ids.add(pick(charIds));
  return [...ids].map((id) => {
    const level = 1 + Math.floor(r() * 60);
    const def = DATA.characters[id];
    const form = id === 'runner' ? pick((def.forms ?? []).map((f) => f.id)) : undefined;
    const cartridge = r() < 0.6 ? { id: pick(cartIds), level: 1 + Math.floor(r() * 50), asc: Math.floor(r() * 5), rank: 1 + Math.floor(r() * 5) } : undefined;
    return buildAlly(standardLoadout(id, level, { asc: ascForLevel(level), sync: Math.floor(r() * 7), cartridge, form }), DATA, DATA.cartridges);
  });
}

function check(b: Battle, tag: string) {
  for (const u of b.units) {
    for (const k of ['hp', 'maxHp', 'av', 'heat', 'firewall'] as const) {
      if (!Number.isFinite(u[k])) throw new Error(`${tag}: ${u.uid}(${u.defId}).${k}=${u[k]}`);
    }
    if (u.hp < 0 || u.hp > u.maxHp + 1e-6) throw new Error(`${tag}: ${u.uid}(${u.defId}) hp ${u.hp}/${u.maxHp}`);
    if (u.alive !== u.hp > 0) throw new Error(`${tag}: ${u.uid}(${u.defId}) alive=${u.alive} hp=${u.hp}`);
    if (u.firewall < 0) throw new Error(`${tag}: ${u.uid} firewall ${u.firewall}`);
    if (u.heat < 0) throw new Error(`${tag}: ${u.uid} heat ${u.heat}`);
  }
  const cp = (b as unknown as { cp?: number }).cp;
  if (cp !== undefined && (cp < 0 || cp > 5)) throw new Error(`${tag}: cp ${cp}`);
}

/** 같은 시드면 같은 선택을 하는 무작위 플레이어. 로그를 돌려준다 */
function play(seed: number, speedless = true) {
  const rng = createRng(seed * 7919 + 1);
  const r = () => rng.next();
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const allies = randomAllies(r, 1 + Math.floor(r() * 4));
  const enemies = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ defId: pick(enemyIds), level: 1 + Math.floor(r() * 60) }));
  const difficulty = pick(['story', 'normal'] as const);
  const b = new Battle({ allies, enemies, seed, difficulty, ambush: r() < 0.3 });
  const log: string[] = [];
  let steps = 0;
  while (!b.ended && steps++ < 4000) {
    if (r() < 0.25) {
      const cands = b.allies().filter((a) => b.canOverclock(a.uid));
      if (cands.length) {
        const a = pick(cands);
        const tg = r() < 0.5 ? b.defaultTarget(a.uid, 'overclock') : pick([...b.validTargets(a.uid, 'overclock'), undefined as unknown as string]);
        b.overclock(a.uid, tg);
        log.push(`O${a.uid}`);
        check(b, `seed ${seed} step ${steps} overclock`);
        continue;
      }
    }
    if (b.phase === 'idle') {
      b.advance();
      log.push('A');
    } else if (b.phase === 'input') {
      const u = b.activeUnit!;
      const kind = b.canUseSkill() && b.validTargets(u.uid, 'skill').length && r() < 0.5 ? 'skill' : 'basic';
      const valid = b.validTargets(u.uid, kind);
      const tg = valid.length ? pick(valid) : undefined;
      b.act(kind, tg);
      log.push(`${kind[0]}${u.uid}>${tg}`);
    } else break;
    check(b, `seed ${seed} step ${steps}`);
  }
  void speedless;
  return { b, log, steps, desc: `seed ${seed}: ${allies.map((a) => a.defId).join(',')} vs ${enemies.map((e) => e.defId + e.level).join(',')} ${difficulty}` };
}

describe('마구잡이 전투', () => {
  it('4000판을 돌려도 멈추거나 값이 깨지지 않는다', () => {
    const bad: string[] = [];
    let ended = 0;
    for (let seed = 1; seed <= 4000; seed++) {
      try {
        const res = play(seed);
        if (res.steps >= 4000) bad.push(`무한 루프? ${res.desc}`);
        if (res.b.ended) ended++;
      } catch (e) {
        bad.push(`${(e as Error).message}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(ended).toBeGreaterThan(3500);
  });

  it('같은 시드와 같은 선택이면 결과가 같다(재현성)', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const a = play(seed);
      const c = play(seed);
      expect(c.log.join()).toBe(a.log.join());
      expect(c.b.phase).toBe(a.b.phase);
      expect(c.b.units.map((u) => u.hp)).toEqual(a.b.units.map((u) => u.hp));
    }
  });
});
