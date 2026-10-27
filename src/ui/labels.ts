// 화면에 보이는 이름과 색. 게임 안 글자는 전부 여기서 나온다.
import artFiles from '../data/art.json';
import { DATA } from '../engine/data';
import type { ArtPaths, Element, Protocol } from '../engine/defs';

export const ELEMENT_INFO: Record<Element, { name: string; color: string; glyph: string }> = {
  kinetic: { name: '키네틱', color: '#a7b0c0', glyph: '◆' },
  plasma: { name: '플라즈마', color: '#ff8a3d', glyph: '▲' },
  cryo: { name: '크라이오', color: '#7fd6ff', glyph: '✱' },
  volt: { name: '볼트', color: '#ffe14d', glyph: 'ϟ' },
  glitch: { name: '글리치', color: '#3dff8b', glyph: '▦' },
  void: { name: '보이드', color: '#b07cff', glyph: '◐' },
};

export const PROTOCOL_INFO: Record<Protocol, { name: string; role: string; glyph: string }> = {
  strike: { name: '스트라이크', role: '단일 딜러', glyph: '✦' },
  blitz: { name: '블리츠', role: '광역 딜러', glyph: '✸' },
  hack: { name: '해킹', role: '디버퍼', glyph: '⌬' },
  amp: { name: '앰프', role: '버퍼', glyph: '⇡' },
  shield: { name: '실드', role: '탱커', glyph: '⬢' },
  reboot: { name: '리부트', role: '힐러', glyph: '✚' },
};

export const KIND_NAME = { basic: '일반공격', skill: '전투스킬', overclock: '오버클럭', trait: '특성' } as const;

export const FACTION_NAME: Record<string, string> = {
  nox: '녹스트리트',
  white: '화이트 노이즈',
  loop: '더 루프',
  neutral: '중립',
  helix: '헬릭스',
  protagonist: '주인공',
};

let gender: 'male' | 'female' = 'male';

/** 지금 저장의 주인공 모습을 알려 준다(화면 전체가 같은 그림을 쓰게) */
export function setGender(g: 'male' | 'female') {
  gender = g;
}

/** 캐릭터의 일러스트 경로. 목록(art.json)에 있으면 그것을, 없으면 캐릭터 데이터의 art를 쓴다 */
export function artFor(charId: string): ArtPaths {
  const hit = (artFiles as Record<string, ArtPaths | string>)[artId(charId, gender)];
  if (hit && typeof hit === 'object') return hit;
  return DATA.characters[charId]?.art ?? {};
}

/** 일러스트 파일을 찾을 때 쓰는 이름. 주인공만 선택한 모습에 따라 `runner_male` / `runner_female`로 갈린다 */
export function artId(charId: string, gender: 'male' | 'female'): string {
  return charId === 'runner' ? `runner_${gender}` : charId;
}
