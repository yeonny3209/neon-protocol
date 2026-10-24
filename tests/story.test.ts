import { describe, expect, it } from 'vitest';
import { DATA } from '../src/engine/data';
import { newSave } from '../src/engine/save';
import { allScripts, endingOpen, evalCond, rebuildFromChoices, resetChoicesFrom, StoryRunner, trueEndingOpen } from '../src/engine/story/runner';
import { parseScript } from '../src/engine/story/script';
import { validateData } from '../src/engine/validate';

const SAMPLE = `
@bg undertown
@summary 첫 단락 요약
러너: 안녕
도윤[smile]: 반가워
* 나레이션
@summary 둘째 단락 요약
러너: 선택하자
@choice c1 big
- 부수자 | nox+3 | set:true_ch2=1
- 고치자 | white+3
- 맡기자 | loop+3
@if nox>=3
도윤: 녹스트리트가 앞섰네
@else
도윤: 아직 모르겠네
@endif
@summary 셋째 단락 요약
러너: 끝
@end
`;

const run = (save = newSave()) => new StoryRunner(parseScript('t', SAMPLE), save, 'ch2');

describe('대본 파서', () => {
  it('모든 줄을 읽고 오류가 없다', () => {
    const s = parseScript('t', SAMPLE);
    expect(s.errors).toEqual([]);
    expect(s.ops.filter((o) => o.op === 'line')).toHaveLength(7);
  });

  it('모르는 명령·읽을 수 없는 줄은 오류로 알려 준다', () => {
    const s = parseScript('t', '@wat x\n???\n@if flag:a');
    expect(s.errors.length).toBe(3);
  });

  it('선택지는 2개 이상이어야 한다', () => {
    expect(parseScript('t', '@choice a\n- 하나').errors.length).toBeGreaterThan(0);
  });
});

describe('대본 실행', () => {
  it('대사를 한 줄씩 내보내고 장면 정보를 들고 있다', () => {
    const r = run();
    const a = r.next();
    expect(a).toMatchObject({ t: 'line', who: '러너', text: '안녕' });
    expect(a.scene.bg).toBe('undertown');
    expect(r.next()).toMatchObject({ who: '도윤', face: 'smile' });
    expect(r.next()).toMatchObject({ narr: true });
  });

  it('선택지를 고르면 신뢰도와 플래그가 바뀌고 분기가 갈린다', () => {
    const save = newSave();
    const r = run(save);
    let step = r.next();
    while (step.t !== 'choice') step = r.next();
    r.choose(step, 0);
    expect(save.story.trust.nox).toBe(3);
    expect(save.story.flags.true_ch2).toBe(1);
    expect(save.story.choices.c1).toBe(0);
    expect(r.next()).toMatchObject({ t: 'line', text: '녹스트리트가 앞섰네' });

    const save2 = newSave();
    const r2 = run(save2);
    let s2 = r2.next();
    while (s2.t !== 'choice') s2 = r2.next();
    r2.choose(s2, 1);
    expect(r2.next()).toMatchObject({ text: '아직 모르겠네' });
  });

  it('스킵하면 다음 선택지에서 멈추고, 건너뛴 구간 요약을 돌려준다', () => {
    const r = run();
    r.next();
    const sk = r.skip();
    expect(sk.step.t).toBe('choice');
    expect(sk.summaries).toEqual(['첫 단락 요약', '둘째 단락 요약']);
    if (sk.step.t !== 'choice') return;
    r.choose(sk.step, 1);
    const sk2 = r.skip();
    expect(sk2.step.t).toBe('end');
    expect(sk2.summaries).toContain('셋째 단락 요약');
  });
});

describe('엔딩 조건', () => {
  it('끄기는 녹스트리트 ≥ 화이트 노이즈, 다시 쓰기는 반대, 공존은 트루 조건', () => {
    const s = newSave();
    s.story.trust = { nox: 4, white: 2, loop: 0 };
    expect(endingOpen(s, 'A')).toBe(true);
    expect(endingOpen(s, 'B')).toBe(false);
    expect(endingOpen(s, 'C')).toBe(false);
    s.story.trust = { nox: 5, white: 5, loop: 5 };
    expect(trueEndingOpen(s)).toBe(false);
    Object.assign(s.story.flags, { true_ch2: 1, true_ch4: 1, true_ch5: 1 });
    expect(trueEndingOpen(s)).toBe(true);
    expect(endingOpen(s, 'C')).toBe(true);
  });

  it('어떤 신뢰도에서도 A나 B 중 하나는 반드시 고를 수 있다', () => {
    for (let n = 0; n < 8; n++)
      for (let w = 0; w < 8; w++) {
        const s = newSave();
        s.story.trust = { nox: n, white: w, loop: 0 };
        expect(endingOpen(s, 'A') || endingOpen(s, 'B')).toBe(true);
      }
  });

  it('조건식', () => {
    const s = newSave();
    s.story.trust = { nox: 3, white: 1, loop: 0 };
    s.story.flags.x = 1;
    expect(evalCond('highest:nox && flag:x', s)).toBe(true);
    expect(evalCond('lowest:white', s)).toBe(false);
    expect(evalCond('!flag:y && white<2', s)).toBe(true);
  });
});

describe('다시 고르기(챕터 선택)', () => {
  it('고른 챕터 이후의 선택은 지우고 신뢰도를 다시 계산한다', () => {
    const s = newSave();
    s.story.choices = { c1: 0, c2: 1 };
    s.story.choiceChapter = { c1: 'ch2', c2: 'ch3' };
    resetChoicesFrom(s, { ch2: 2, ch3: 3 }, 'ch3', {
      ...DATA,
      scripts: { ...DATA.scripts, t: SAMPLE.replace('@choice c1 big', '@choice c1 big') },
    });
    expect(s.story.choices).toEqual({ c1: 0 });
    expect(s.story.trust.nox).toBe(3);
    expect(s.story.flags.true_ch2).toBe(1);
    rebuildFromChoices(s, { ...DATA, scripts: { ...DATA.scripts, t: SAMPLE } });
    expect(s.story.trust.nox).toBe(3);
  });
});

describe('실제 데이터', () => {
  it('모든 대본에 문법 오류가 없다', () => {
    for (const s of allScripts()) expect(s.errors).toEqual([]);
  });

  it('스테이지·챕터·대본·적 참조가 모두 맞다', () => {
    expect(validateData(DATA)).toEqual([]);
  });

  it('프롤로그는 스테이지 3개, 순서대로 이어진다', () => {
    expect(DATA.stageOrder.slice(0, 3)).toEqual(['prologue-1', 'prologue-2', 'prologue-3']);
  });
});
