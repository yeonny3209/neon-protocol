import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle/battle';
import { autoPlay } from '../src/engine/battle/autoplay';
import { DATA } from '../src/engine/data';
import { buildAlly, standardLoadout } from '../src/engine/loadout';
import { newSave, type SaveData } from '../src/engine/save';
import { allScripts, choiceIndex, endingOpen, getScript, StoryRunner, trueEndingOpen, type Step } from '../src/engine/story/runner';
import { validateData } from '../src/engine/validate';

const order = DATA.stageOrder;

/** 전체 이야기를 처음부터 끝까지 자동으로 읽으며, 선택지는 picker가 고른다. 엔딩 id를 돌려준다 */
function playThrough(picker: (id: string, step: Extract<Step, { t: 'choice' }>, save: SaveData) => number): { save: SaveData; ending?: string; seen: string[] } {
  const save = newSave();
  const seen: string[] = [];
  let ending: string | undefined;
  for (const sid of order) {
    const st = DATA.stages[st_id(sid)];
    for (const script of [st.pre, st.post]) {
      if (!script) continue;
      const r = new StoryRunner(getScript(script), save, st.chapter);
      seen.push(script);
      let step = r.next();
      let guard = 0;
      while (step.t !== 'end' && guard++ < 500) {
        if (step.t === 'choice') {
          const idx = picker(step.id, step, save);
          r.choose(step, idx);
        }
        step = r.next();
      }
      if (r.ending) ending = r.ending;
    }
  }
  return { save, ending, seen };
}
const st_id = (x: string) => x;

const firstOk = (step: Extract<Step, { t: 'choice' }>) => step.options.findIndex((o) => o.ok);

/** 한 세력만 밀어 주는 선택 */
const lean = (f: 'nox' | 'white' | 'loop') => (_id: string, step: Extract<Step, { t: 'choice' }>) => {
  const i = step.options.findIndex((o) => o.ok && (o.opt.trust[f] ?? 0) > 0);
  return i >= 0 ? i : firstOk(step);
};

describe('2~6장 데이터', () => {
  it('스테이지는 69개(프롤로그 3 + 10, 10, 11, 11, 12, 12)이고 참조가 모두 맞다', () => {
    expect(validateData(DATA)).toEqual([]);
    expect(order).toHaveLength(69);
    const per = (c: string) => order.filter((id) => DATA.stages[id].chapter === c).length;
    expect([per('prologue'), per('ch1'), per('ch2'), per('ch3'), per('ch4'), per('ch5'), per('ch6')]).toEqual([3, 10, 10, 11, 11, 12, 12]);
  });

  it('모든 대본이 문법 오류 없이 읽히고 끝난다', () => {
    for (const s of allScripts()) expect(s.errors).toEqual([]);
  });

  it('챕터마다 보스가 있다', () => {
    for (const c of ['prologue', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6']) {
      const last = order.filter((id) => DATA.stages[id].chapter === c).pop()!;
      expect(DATA.stages[last].boss).toBe(true);
    }
  });

  it('선택지 id는 겹치지 않는다', () => {
    const seen = new Set<string>();
    for (const s of allScripts()) for (const op of s.ops) if (op.op === 'choice') {
      expect(seen.has(op.id)).toBe(false);
      seen.add(op.id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });
});

describe('엔딩 3종 (기획서 3.3)', () => {
  it('녹스트리트 쪽으로만 가면 A. 정전', () => {
    const r = playThrough(lean('nox'));
    expect(r.ending).toBe('A');
    expect(r.save.story.trust.nox).toBeGreaterThan(r.save.story.trust.white);
  });

  it('화이트 노이즈 쪽으로만 가면 B. 재부팅', () => {
    const r = playThrough(lean('white'));
    expect(r.ending).toBe('B');
  });

  it('세 세력을 모두 5 이상 쌓고 특정 선택지 3개를 고르면 C. 공존', () => {
    // 계획: 2·4·5장의 특정 선택지로 세 세력에 +3씩, 3장 큰 선택은 녹스트리트, 작은 선택으로 나머지를 채운다
    const plan: Record<string, number> = {
      s2_stall: 1, ch2_market: 2, s3_student: 0, s3_argue: 2, ch3_mediate: 0, s4_resident: 2, ch4_loop: 1, s5_files: 0, ch5_identity: 0, ch6_finale: 2,
    };
    const r = playThrough((id) => plan[id]);
    expect(trueEndingOpen(r.save)).toBe(true);
    expect(r.save.story.trust.nox).toBeGreaterThanOrEqual(5);
    expect(r.save.story.trust.white).toBeGreaterThanOrEqual(5);
    expect(r.save.story.trust.loop).toBeGreaterThanOrEqual(5);
    expect(r.ending).toBe('C');
  });

  it('특정 선택지 3개 중 하나라도 빠지면 C는 나오지 않는다', () => {
    const plan: Record<string, number> = { s2_stall: 1, ch2_market: 0, s3_student: 0, s3_argue: 2, ch3_mediate: 0, s4_resident: 2, ch4_loop: 1, s5_files: 0, ch5_identity: 0 };
    const r = playThrough((id, step) => plan[id] ?? firstOk(step));
    expect(r.ending).not.toBe('C');
  });

  it('아무렇게나 골라도 마지막에는 반드시 A나 B 중 하나는 고를 수 있다', () => {
    for (let seed = 0; seed < 30; seed++) {
      let n = seed;
      const r = playThrough((_id, step) => {
        const ok = step.options.map((o, i) => (o.ok ? i : -1)).filter((i) => i >= 0);
        n = (n * 31 + 7) % 997;
        return ok[n % ok.length];
      });
      expect(['A', 'B', 'C']).toContain(r.ending);
    }
  });

  it('공존(C)은 첫 플레이에서 아무렇게나 해서는 나오지 않는다', () => {
    const save = newSave();
    save.story.trust = { nox: 3, white: 3, loop: 3 };
    expect(endingOpen(save, 'C')).toBe(false);
  });

  it('작은 선택지가 6개 이상이고 모든 선택지에는 세력이 연결돼 있다', () => {
    const idx = choiceIndex();
    expect(Object.keys(idx).length).toBeGreaterThanOrEqual(10);
    for (const { opts } of Object.values(idx)) {
      for (const o of opts) if (!o.ending) expect(Object.keys(o.trust).length).toBeGreaterThan(0);
    }
  });
});

describe('5장 배신·희생 분기', () => {
  it('신뢰도가 가장 낮은 세력의 동료가 배신하고, 가장 높은 세력의 동료가 버틴다', () => {
    const texts = (nox: number, white: number, loop: number) => {
      const save = newSave();
      save.story.trust = { nox, white, loop };
      const r = new StoryRunner(getScript('ch5_7_pre'), save, 'ch5');
      const out: string[] = [];
      let s = r.next();
      while (s.t !== 'end') {
        if (s.t === 'line') out.push(s.text);
        s = r.next();
      }
      return out.join(' ');
    };
    expect(texts(0, 5, 5)).toContain('이 이상은 같이 못 간다'); // 카이 배신
    expect(texts(5, 0, 5)).toContain('시스템을 부수게 둘 수 없어요'); // 세라핀 배신
    expect(texts(5, 5, 0)).toContain('명령을 거부하지 못합니다'); // 제로 배신
    expect(texts(5, 3, 1)).toContain('내 팔이 부서져도 좋다'); // 카이 버팀
    expect(texts(1, 5, 3)).toContain('계산이 틀려도 좋아요');
  });
});

describe('최종 보스', () => {
  it('스킬과 오버클럭을 쓰면 스토리 난이도에서 거의 이기고, 보통 난이도에서도 이길 수 있다', () => {
    const st = DATA.stages['ch6-12'];
    const rate = (diff: 'story' | 'normal') => {
      let w = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const r = autoPlay(new Battle({ allies: (st.forcedParty ?? st.trialParty)!.map((c) => buildAlly(standardLoadout(c, st.recLevel, { trial: true }))), enemies: st.enemies.map((e) => ({ defId: e, level: st.enemyLevel })), seed, difficulty: diff }), 'smart');
        if (r.result === 'won') w++;
      }
      return w / 40;
    };
    const s = rate('story');
    const n = rate('normal');
    process.stderr.write(`[최종 보스 smart] 스토리 ${Math.round(s * 100)}% 보통 ${Math.round(n * 100)}%
`);
    expect(s).toBeGreaterThan(0.85);
    expect(n).toBeGreaterThan(0.4);
  });
});

describe('2~6장 전투 난이도', () => {
  it('스토리 난이도에서 일반공격만으로도 대부분 클리어된다', () => {
    const lines: string[] = [];
    const bad: string[] = [];
    for (const id of order.filter((x) => DATA.stages[x].chapter >= 'ch2' && DATA.stages[x].chapter !== 'prologue' && x !== 'ch6-12')) {
      const st = DATA.stages[id];
      let wins = 0;
      const n = 25;
      for (let seed = 1; seed <= n; seed++) {
        const r = autoPlay(
          new Battle({ allies: (st.forcedParty ?? st.trialParty)!.map((c) => buildAlly(standardLoadout(c, st.recLevel, { trial: true }))), enemies: st.enemies.map((e) => ({ defId: e, level: st.enemyLevel })), seed, difficulty: 'story' }),
          'basicOnly',
        );
        if (r.result === 'won') wins++;
      }
      lines.push(`${id}:${Math.round((wins / n) * 100)}`);
      if (wins / n <= 0.8) bad.push(`${id}:${Math.round((wins / n) * 100)}`);
    }
    process.stderr.write(`[2~6장 스토리·일반공격만 승률%] ${lines.join(' ')}\n`);
    expect(bad).toEqual([]);
  });
});
