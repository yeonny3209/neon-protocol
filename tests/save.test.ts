import { describe, expect, it } from 'vitest';
import { exportSave, importSave, loadSave, migrate, newSave, SAVE_VERSION, writeSave, type Storage } from '../src/engine/save';

const memory = (): Storage & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, get: (k) => data[k] ?? null, set: (k, v) => {
    data[k] = v;
  } };
};

describe('저장', () => {
  it('저장 데이터에 버전 번호가 들어간다', () => {
    const st = memory();
    writeSave(newSave(), st);
    expect(JSON.parse(Object.values(st.data)[0]).version).toBe(SAVE_VERSION);
  });

  it('v1(전투 프로토타입) 저장을 v2로 바꾸면 설정이 남는다', () => {
    const v1 = { version: 1, settings: { speed: 3, difficulty: 'normal', cutin: 'never', skipBossIntro: true, skipVictory: false }, seenCutins: ['kai'] };
    const v2 = migrate(v1);
    expect(v2.version).toBe(2);
    expect(v2.settings.speed).toBe(3);
    expect(v2.settings.difficulty).toBe('normal');
    expect(v2.seenCutins).toEqual(['kai']);
    expect(v2.chars.runner).toBeDefined();
    expect(v2.settings.storyAlwaysSkip).toBe(false);
  });

  it('빠진 칸은 기본값으로 채운다', () => {
    const partial = { ...newSave(), story: undefined } as unknown;
    const fixed = migrate(partial);
    expect(fixed.story.trust).toEqual({ nox: 0, white: 0, loop: 0 });
  });

  it('내보내기 → 불러오기가 같은 데이터를 돌려준다', () => {
    const s = newSave();
    s.wallet.shard = 1234;
    s.name = '테스트';
    expect(importSave(exportSave(s))).toEqual(s);
  });

  it('깨진 저장은 새 게임으로', () => {
    const st = memory();
    st.set('neon-protocol.save', '{망가짐');
    expect(loadSave(st).version).toBe(SAVE_VERSION);
  });

  it('더 새 버전 저장은 거부한다', () => {
    expect(() => importSave(JSON.stringify({ version: 999 }))).toThrow();
  });
});

describe('망가진 저장', () => {
  it('칸의 종류가 틀리거나 값이 깨져도 기본값으로 되돌린다', () => {
    const bad = {
      ...newSave(),
      wallet: { shard: 'abc', key: NaN, credit: 500, pack_s: -3 },
      party: 'runner',
      story: null,
      chars: { runner: { id: 'runner', level: 'x' }, kai: 5 },
      rank: { level: null },
      settings: { speed: '빠름' },
    };
    const s = JSON.parse(JSON.stringify(bad)) as unknown;
    const fixed = migrate(s);
    expect(fixed.wallet).toEqual({ credit: 500 });
    expect(Array.isArray(fixed.party)).toBe(true);
    expect(fixed.story.trust).toEqual({ nox: 0, white: 0, loop: 0 });
    expect(fixed.chars.runner.level).toBe(1);
    expect(fixed.chars.kai.level).toBe(1);
    expect(fixed.rank.level).toBe(1);
    expect(typeof fixed.settings.speed).toBe('number');
  });

  it('러너가 없는 저장에도 러너를 채운다', () => {
    const s = { ...newSave(), chars: {} };
    expect(migrate(JSON.parse(JSON.stringify(s))).chars.runner).toBeDefined();
  });
});

describe('모르는 id 정리', () => {
  it('없는 캐릭터·카트리지·스테이지·러너 형태를 걷어낸다', async () => {
    const { pruneUnknown } = await import('../src/engine/state');
    const { newCharState } = await import('../src/engine/save');
    const s = newSave();
    s.chars.ghost = newCharState('ghost');
    s.chars.runner.cart = 7;
    s.party = ['ghost', 'runner', 'runner'];
    s.partyB = ['ghost'];
    s.rep = 'ghost';
    s.runnerForm = 'nope';
    s.runnerForms = ['nope'];
    s.story.cleared['x-1'] = 7;
    s.story.next = 'x-2';
    pruneUnknown(s);
    expect(s.chars.ghost).toBeUndefined();
    expect(s.chars.runner.cart).toBeNull();
    expect(s.party).toEqual(['runner']);
    expect(s.partyB).toEqual([]);
    expect(s.rep).toBe('runner');
    expect(s.runnerForm).toBe(s.runnerForms[0]);
    expect(s.story.cleared['x-1']).toBeUndefined();
    expect(s.story.next).toBeUndefined();
  });
});

describe('저장 실패', () => {
  it('저장 공간이 막혀 있으면 writeSave가 false를 돌려준다', () => {
    const blocked: Storage = { get: () => null, set: () => false };
    expect(writeSave(newSave(), blocked)).toBe(false);
    expect(writeSave(newSave(), memory())).toBe(true);
  });
});
