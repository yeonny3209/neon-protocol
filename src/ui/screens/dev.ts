// 개발·테스트용 패널(주소 뒤 #dev). 게임 기능이 아니라 확인용 도구다.
import { DATA } from '../../engine/data';
import { newSave } from '../../engine/save';
import { addCharacter, addItem, grant } from '../../engine/state';
import type { App, Screen } from '../app';
import { button, topBar } from '../common';
import { h } from '../dom';

export function devScreen(app: App): Screen {
  const done = (msg: string) => {
    app.persist();
    app.toast(msg);
  };
  const body = h(
    'div',
    { class: 'section panel' },
    h('h3', { text: '테스트 도구' }),
    h('div', { class: 'muted', text: '실제 게임에는 없는 버튼이야. 기능 확인용.' }),
    button('재료 잔뜩 받기', () => {
      const r: Record<string, number> = { shard: 20000, key: 100, signal: 500, credit: 3_000_000, pack_l: 150, pack_m: 200, pack_s: 200, core: 60, weekly: 60, cart_data: 2_000_000 };
      for (const it of Object.values(DATA.items)) if (it.kind === 'part' || it.kind === 'chip') r[it.id] = 80;
      grant(app.save, r);
      done('받았어');
    }),
    button('캐릭터 전원 합류', () => {
      for (const id of Object.keys(DATA.characters)) if (!app.save.chars[id]) addCharacter(app.save, id);
      done('전원 합류');
    }),
    button('러너 등급 40', () => {
      app.save.rank.level = 40;
      done('등급 40');
    }),
    button('다이브 키 10개', () => {
      addItem(app.save, 'key', 10);
      done('키 +10');
    }),
    button('저장 초기화', () => {
      app.save = newSave();
      done('초기화했어');
    }, 'ghost'),
  );
  return { el: h('div', { class: 'scr' }, topBar(app, '테스트 도구'), h('div', { class: 'scr-body' }, body)) };
}
