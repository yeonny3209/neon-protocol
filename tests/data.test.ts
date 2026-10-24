import { describe, expect, it } from 'vitest';
import { DATA } from '../src/engine/data';
import { validateData } from '../src/engine/validate';

describe('데이터 파일', () => {
  it('검사 오류가 없다', () => {
    expect(validateData(DATA)).toEqual([]);
  });
  it('5성 4명과 적 3종이 들어 있다', () => {
    for (const id of ['kai', 'seraphine', 'zero', 'luna']) expect(DATA.characters[id]).toBeDefined();
    for (const id of ['sec_drone', 'street_thug', 'heavy_mech']) expect(DATA.enemies[id]).toBeDefined();
  });
});
