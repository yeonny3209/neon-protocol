import { describe, expect, it } from 'vitest';
import { DATA } from '../src/engine/data';
import { dailyUnlocked } from '../src/engine/missions';
import { migrate, newSave } from '../src/engine/save';

describe('주인공 모습·데일리 해금', () => {
  it('예전 저장에도 주인공 모습이 채워진다', () => {
    const old = JSON.parse(JSON.stringify(newSave())) as Record<string, unknown>;
    delete old.gender;
    expect(migrate(old).gender).toBe('male');
  });

  it('여자로 고른 저장은 내보내기·불러오기 뒤에도 유지된다', () => {
    const s = newSave();
    s.gender = 'female';
    expect(migrate(JSON.parse(JSON.stringify(s))).gender).toBe('female');
  });

  it('대본에 성별을 정하는 표현이 없다', () => {
    const bad = /그녀|소녀|소년/;
    const hits = Object.entries(DATA.scripts).filter(([, t]) => t.split('\n').some((l) => l.startsWith('러너') && bad.test(l)));
    expect(hits.map(([k]) => k)).toEqual([]);
  });

  it('데일리 루틴은 프롤로그를 깨면 열린다', () => {
    const s = newSave();
    expect(dailyUnlocked(s)).toBe(false);
    s.story.chapters.push('prologue');
    expect(dailyUnlocked(s)).toBe(true);
  });
});
