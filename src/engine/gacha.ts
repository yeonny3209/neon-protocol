// 다이브(뽑기). 확률·천장·픽업 규칙은 balance.gacha, 배너 순환은 banners.json.
import { DATA, type GameData } from './data';
import type { Rng } from './rng';
import type { DiveRecord, PityState, SaveData } from './save';
import { addCartridge, addCharacter, addItem, count, monthKey, track, type CartGain, type CharGain } from './state';

export type BannerKind = 'beginner' | 'character' | 'cartridge' | 'standard';

export interface Banner {
  id: string;
  kind: BannerKind;
  title: string;
  /** 픽업 5성 (캐릭터 또는 카트리지 id) */
  pickup5?: string;
  pickup4: string[];
  ends?: Date;
  period: number;
}

export interface PullResult {
  kind: 'char' | 'cart';
  id: string;
  rarity: 3 | 4 | 5;
  pickup: boolean;
  char?: CharGain;
  cart?: CartGain;
  signal: number;
}

type Rates = { five: { base: number; softStart: number; softStep: number; hard: number }; four: { base: number; hard: number } };

export function bannerPeriod(now: Date, data: GameData = DATA): number {
  const epoch = Date.parse(`${data.balance.gacha.bannerEpoch}T00:00:00`);
  const days = Math.floor((now.getTime() - epoch) / 86400_000);
  return Math.floor(days / data.balance.gacha.bannerDays);
}

function periodEnd(period: number, data: GameData): Date {
  const epoch = Date.parse(`${data.balance.gacha.bannerEpoch}T00:00:00`);
  return new Date(epoch + (period + 1) * data.balance.gacha.bannerDays * 86400_000);
}

export function currentBanners(save: SaveData, now = new Date(), data: GameData = DATA): Banner[] {
  const p = bannerPeriod(now, data);
  const rot = data.banners.rotation;
  const r = rot[((p % rot.length) + rot.length) % rot.length];
  const ends = periodEnd(p, data);
  const list: Banner[] = [];
  if (save.gacha.beginner < data.balance.gacha.beginner.limit) list.push({ id: 'beginner', kind: 'beginner', title: '초보자 다이브', pickup4: [], period: p });
  list.push({ id: `char-${p}`, kind: 'character', title: r.title, pickup5: r.char, pickup4: r.chars4, ends, period: p });
  list.push({ id: `cart-${p}`, kind: 'cartridge', title: `${data.cartridges[r.cart]?.name ?? ''} 픽업`, pickup5: r.cart, pickup4: r.carts4, ends, period: p });
  list.push({ id: 'standard', kind: 'standard', title: '상시 다이브', pickup4: [], period: p });
  return list;
}

function ratesFor(kind: BannerKind, data: GameData): Rates {
  const g = data.balance.gacha;
  return kind === 'beginner' ? g.beginner : kind === 'character' ? g.character : kind === 'cartridge' ? g.cartridge : g.standard;
}

export function pityOf(save: SaveData, kind: BannerKind): PityState {
  return (save.gacha.pity[kind] ??= { five: 0, four: 0, guar5: false, guar4: false, total: 0 });
}

/** 이번 뽑기(카운트 n번째)의 5성 확률 */
export function fiveRate(r: Rates['five'], n: number): number {
  if (n >= r.hard) return 1;
  return r.base + (n >= r.softStart ? (n - r.softStart + 1) * r.softStep : 0);
}

export function costOf(kind: BannerKind, times: number, data: GameData = DATA): number {
  if (kind === 'beginner' && times === 10) return data.balance.gacha.beginner.tenCost;
  return times;
}

function pick<T>(rng: Rng, list: T[]): T {
  return list[Math.floor(rng.next() * list.length)];
}

/** 한 번 뽑기. 저장 데이터의 천장·확정 상태를 갱신한다(아이템 지급은 하지 않음) */
export function rollOnce(save: SaveData, banner: Banner, rng: Rng, data: GameData = DATA): Omit<PullResult, 'char' | 'cart' | 'signal'> {
  const B = data.banners;
  const g = data.balance.gacha;
  const r = ratesFor(banner.kind, data);
  const pity = pityOf(save, banner.kind);
  pity.five++;
  pity.four++;
  pity.total++;
  // 초보자 다이브: 10번째까지 4성 캐릭터가 없었으면 10번째는 4성 캐릭터 확정
  if (banner.kind === 'beginner' && save.gacha.beginner === 9 && !save.gacha.history.some((h) => h.banner === banner.title && h.rarity === 4 && h.kind === 'char')) {
    pity.four = 0;
    return { kind: 'char', id: pick(rng, B.fourChars), rarity: 4, pickup: false };
  }
  const x = rng.next();
  const p5 = fiveRate(r.five, pity.five);

  if (x < p5) {
    pity.five = 0;
    pity.four = 0;
    if (banner.kind === 'character' || banner.kind === 'cartridge') {
      const chance = banner.kind === 'character' ? g.character.pickupChance : g.cartridge.pickupChance;
      const win = pity.guar5 || rng.next() < chance;
      pity.guar5 = !win;
      const pool = banner.kind === 'character' ? B.standardChars : B.standardCarts;
      const id = win ? banner.pickup5! : pick(rng, pool.filter((c) => c !== banner.pickup5));
      return { kind: banner.kind === 'character' ? 'char' : 'cart', id, rarity: 5, pickup: win };
    }
    if (banner.kind === 'beginner') return { kind: 'char', id: pick(rng, B.standardChars), rarity: 5, pickup: false };
    const isChar = rng.next() < g.standard.charShare;
    return isChar ? { kind: 'char', id: pick(rng, B.standardChars), rarity: 5, pickup: false } : { kind: 'cart', id: pick(rng, B.standardCarts), rarity: 5, pickup: false };
  }

  if (pity.four >= r.four.hard || x < p5 + r.four.base) {
    pity.four = 0;
    // 초보자 다이브 첫 10회 안의 4성은 캐릭터로 확정
    if (banner.kind === 'beginner' && save.gacha.beginner < 10) return { kind: 'char', id: pick(rng, B.fourChars), rarity: 4, pickup: false };
    if (banner.kind === 'character' || banner.kind === 'cartridge') {
      const chance = banner.kind === 'character' ? g.character.fourPickupChance : g.cartridge.fourPickupChance;
      const win = pity.guar4 || rng.next() < chance;
      pity.guar4 = !win;
      if (win) return { kind: banner.kind === 'character' ? 'char' : 'cart', id: pick(rng, banner.pickup4), rarity: 4, pickup: true };
    }
    const isChar = rng.next() < 0.5;
    return isChar ? { kind: 'char', id: pick(rng, B.fourChars), rarity: 4, pickup: false } : { kind: 'cart', id: pick(rng, B.fourCarts), rarity: 4, pickup: false };
  }
  return { kind: 'cart', id: pick(rng, B.threeCarts), rarity: 3, pickup: false };
}

export type DiveError = 'keys' | 'limit';

/** 다이브. 키를 쓰고, 결과를 저장 데이터에 바로 반영한다(연출 전에 저장하라고 부르는 쪽에 돌려줌) */
export function dive(save: SaveData, banner: Banner, times: 1 | 10, rng: Rng, now = Date.now(), data: GameData = DATA): PullResult[] | DiveError {
  if (banner.kind === 'beginner' && save.gacha.beginner + times > data.balance.gacha.beginner.limit) return 'limit';
  const cost = costOf(banner.kind, times, data);
  if (count(save, 'key') < cost) return 'keys';
  addItem(save, 'key', -cost);
  const out: PullResult[] = [];
  for (let i = 0; i < times; i++) {
    const r = rollOnce(save, banner, rng, data);
    if (banner.kind === 'beginner') save.gacha.beginner++;
    if (banner.kind === 'standard') save.gacha.standardPulls++;
    let signal = data.balance.gacha.signal.perPull;
    addItem(save, 'signal', signal);
    const res: PullResult = { ...r, signal };
    if (r.kind === 'char') {
      res.char = addCharacter(save, r.id, data);
      res.signal += res.char.signal;
    } else {
      res.cart = addCartridge(save, r.id, data);
    }
    out.push(res);
    const rec: DiveRecord = { at: now, banner: banner.title, kind: r.kind, id: r.id, rarity: r.rarity };
    save.gacha.history.unshift(rec);
  }
  save.gacha.history.length = Math.min(save.gacha.history.length, data.balance.gacha.historyLimit);
  track(save, 'dives', times);
  if (out.some((r) => r.rarity === 5)) track(save, 'dive5');
  return out;
}

/** 샤드로 다이브 키 사기 */
export function buyKeys(save: SaveData, n: number, data: GameData = DATA): boolean {
  const price = data.balance.gacha.keyPriceShards * n;
  if (count(save, 'shard') < price || n <= 0) return false;
  addItem(save, 'shard', -price);
  addItem(save, 'key', n);
  return true;
}

// ───────────────────────── 신호 교환소

export interface ExchangeItem {
  id: string;
  title: string;
  price: number;
  kind: 'standardFive' | 'pickupFour' | 'fourCartridge' | 'key';
  options: string[];
  limitLeft?: number;
}

export function exchangeList(save: SaveData, now = new Date(), data: GameData = DATA): ExchangeItem[] {
  const ex = data.balance.gacha.exchange;
  const banners = currentBanners(save, now, data);
  const charBanner = banners.find((b) => b.kind === 'character')!;
  const month = monthKey(now);
  const used = save.gacha.keyExMonth === month ? save.gacha.keyExCount : 0;
  return [
    { id: 'standardFive', title: '상시 5성 캐릭터 선택', price: ex.standardFive, kind: 'standardFive', options: data.banners.standardChars },
    { id: 'pickupFour', title: '이번 배너 픽업 4성 선택', price: ex.pickupFour, kind: 'pickupFour', options: charBanner.pickup4 },
    { id: 'fourCartridge', title: '4성 카트리지 선택', price: ex.fourCartridge, kind: 'fourCartridge', options: data.banners.fourCarts },
    { id: 'key', title: '다이브 키', price: ex.key, kind: 'key', options: ['key'], limitLeft: ex.keyMonthlyLimit - used },
  ];
}

export function exchange(save: SaveData, item: ExchangeItem, option: string, now = new Date(), data: GameData = DATA): PullResult | 'key' | 'signal' | 'limit' | 'option' {
  if (!item.options.includes(option)) return 'option';
  if (count(save, 'signal') < item.price) return 'signal';
  if (item.kind === 'key') {
    const month = monthKey(now);
    if (save.gacha.keyExMonth !== month) {
      save.gacha.keyExMonth = month;
      save.gacha.keyExCount = 0;
    }
    if (save.gacha.keyExCount >= data.balance.gacha.exchange.keyMonthlyLimit) return 'limit';
    save.gacha.keyExCount++;
    addItem(save, 'signal', -item.price);
    addItem(save, 'key', 1);
    return 'key';
  }
  addItem(save, 'signal', -item.price);
  if (item.kind === 'fourCartridge') return { kind: 'cart', id: option, rarity: 4, pickup: false, cart: addCartridge(save, option, data), signal: 0 };
  const rarity = item.kind === 'standardFive' ? 5 : 4;
  const char = addCharacter(save, option, data);
  return { kind: 'char', id: option, rarity, pickup: false, char, signal: char.signal };
}

/** 상시 다이브 300회 보상: 상시 5성 1명 선택(1회) */
export function standardSelectReady(save: SaveData, data: GameData = DATA): boolean {
  return !save.gacha.standardPicked && save.gacha.standardPulls >= data.balance.gacha.standard.selectAt;
}

export function standardSelect(save: SaveData, charId: string, data: GameData = DATA): CharGain | null {
  if (!standardSelectReady(save, data) || !data.banners.standardChars.includes(charId)) return null;
  save.gacha.standardPicked = true;
  return addCharacter(save, charId, data);
}
