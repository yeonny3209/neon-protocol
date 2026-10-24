import { describe, expect, it } from 'vitest';
import { exportSave, importSave, loadSave, migrate, newSave, SAVE_VERSION, writeSave, type Storage } from '../src/engine/save';

const memory = (): Storage & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return { data, get: (k) => data[k] ?? null, set: (k, v) => (data[k] = v) };
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
