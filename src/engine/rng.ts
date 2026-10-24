// 시드 고정 난수. 전투·다이브 결과가 같은 시드와 같은 입력이면 항상 같게 나온다.

export interface Rng {
  next(): number;
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state: () => s,
  };
}

/** 미리보기용: 항상 같은 값을 돌려줘서 치명타·확률 효과가 터지지 않는다 */
export function fixedRng(value = 0.999): Rng {
  return { next: () => value, state: () => 0 };
}

export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}

export function pickWeighted<T>(rng: Rng, items: T[], weight: (t: T) => number): T {
  const total = items.reduce((s, it) => s + Math.max(0, weight(it)), 0);
  let r = rng.next() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r < 0) return it;
  }
  return items[items.length - 1];
}
