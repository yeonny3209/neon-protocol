// 데이터 파일을 모아 하나의 객체로 만든다. 새 파일을 폴더에 넣으면 자동으로 읽힌다.
import balanceJson from '../data/balance.json';
import statusesJson from '../data/statuses.json';
import cartridgesJson from '../data/cartridges.json';
import itemsJson from '../data/items.json';
import bannersJson from '../data/banners.json';
import type { CartridgeDef, CharacterDef, EnemyDef, ItemDef, StatusDef } from './defs';

export type Balance = typeof balanceJson;
export type BannerData = typeof bannersJson;

const characterFiles = import.meta.glob<CharacterDef>('../data/characters/*.json', { eager: true, import: 'default' });
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
}

export const DATA: GameData = {
  balance: balanceJson,
  characters: byId(Object.values(characterFiles), '캐릭터'),
  enemies: byId(Object.values(enemyFiles).flat(), '적'),
  statuses: byId(statusesJson as StatusDef[], '상태'),
  cartridges: byId(cartridgesJson as CartridgeDef[], '카트리지'),
  items: byId(itemsJson as ItemDef[], '아이템'),
  banners: bannersJson,
};
