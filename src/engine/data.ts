// 데이터 파일을 모아 하나의 객체로 만든다. 새 파일을 폴더에 넣으면 자동으로 읽힌다.
import balanceJson from '../data/balance.json';
import statusesJson from '../data/statuses.json';
import cartridgesJson from '../data/cartridges.json';
import itemsJson from '../data/items.json';
import bannersJson from '../data/banners.json';
import chaptersJson from '../data/chapters.json';
import type { CartridgeDef, ChapterDef, CharacterDef, EnemyDef, ItemDef, StageDef, StatusDef } from './defs';

export type Balance = typeof balanceJson;
export type BannerData = typeof bannersJson;

const characterFiles = import.meta.glob<CharacterDef>('../data/characters/*.json', { eager: true, import: 'default' });
const stageFiles = import.meta.glob<StageDef[]>('../data/stages/*.json', { eager: true, import: 'default' });
const scriptFiles = import.meta.glob<string>('../data/story/*.txt', { query: '?raw', import: 'default', eager: true });
const enemyFiles = import.meta.glob<EnemyDef[]>('../data/enemies/*.json', { eager: true, import: 'default' });

function byId<T extends { id: string }>(list: T[], what: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const it of list) {
    if (out[it.id]) throw new Error(`${what} id 중복: ${it.id}`);
    out[it.id] = it;
  }
  return out;
}

export interface GameData {
  balance: Balance;
  characters: Record<string, CharacterDef>;
  enemies: Record<string, EnemyDef>;
  statuses: Record<string, StatusDef>;
  cartridges: Record<string, CartridgeDef>;
  items: Record<string, ItemDef>;
  banners: BannerData;
  chapters: Record<string, ChapterDef>;
  stages: Record<string, StageDef>;
  /** 스테이지 진행 순서(챕터 → 번호) */
  stageOrder: string[];
  scripts: Record<string, string>;
}

const stages = byId(Object.values(stageFiles).flat(), '스테이지');
const chapters = byId(chaptersJson as unknown as ChapterDef[], '챕터');
const scripts: Record<string, string> = {};
for (const [path, text] of Object.entries(scriptFiles)) scripts[path.split('/').pop()!.replace(/\.txt$/, '')] = text;

export const DATA: GameData = {
  balance: balanceJson,
  characters: byId(Object.values(characterFiles), '캐릭터'),
  enemies: byId(Object.values(enemyFiles).flat(), '적'),
  statuses: byId(statusesJson as StatusDef[], '상태'),
  cartridges: byId(cartridgesJson as CartridgeDef[], '카트리지'),
  items: byId(itemsJson as ItemDef[], '아이템'),
  banners: bannersJson,
  chapters,
  stages,
  stageOrder: Object.values(stages)
    .sort((a, b) => (chapters[a.chapter]?.order ?? 0) - (chapters[b.chapter]?.order ?? 0) || a.index - b.index)
    .map((x) => x.id),
  scripts,
};
// (개발 참고) 데이터 폴더에 새 파일을 넣고 테스트가 못 찾으면 이 줄을 살짝 고쳐 저장해서 목록을 새로 읽게 해 줘. [v6]
