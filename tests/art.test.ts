import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import artFiles from '../src/data/art.json';
import { DATA } from '../src/engine/data';

describe('일러스트 목록', () => {
  const entries = Object.entries(artFiles).filter(([k]) => !k.startsWith('_')) as [string, { icon?: string; full?: string }][];

  it('목록의 파일이 모두 public 폴더에 있다', () => {
    const missing: string[] = [];
    for (const [k, v] of entries) for (const path of [v.icon, v.full]) if (path && !existsSync(`public/${path}`)) missing.push(`${k}: ${path}`);
    expect(missing).toEqual([]);
  });

  it('키는 캐릭터 id 또는 runner_male / runner_female 이다', () => {
    const ok = new Set([...Object.keys(DATA.characters).filter((id) => id !== 'runner'), 'runner_male', 'runner_female']);
    expect(entries.map(([k]) => k).filter((k) => !ok.has(k))).toEqual([]);
  });
});
