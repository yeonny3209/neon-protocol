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
    button('스토리 4장까지 클리어 처리 (반복 콘텐츠 전부 열기)', () => {
      const s = app.save;
      s.started = true;
      const upto = ['prologue', 'ch1', 'ch2', 'ch3', 'ch4'];
      for (const id of DATA.stageOrder) if (upto.includes(DATA.stages[id].chapter)) s.story.cleared[id] = 7;
      s.story.next = DATA.stageOrder.find((id) => !s.story.cleared[id]);
      for (const c of upto) if (!s.story.chapters.includes(c)) s.story.chapters.push(c);
      for (const f of DATA.characters.runner.forms ?? []) if ((f.unlockAfter === 'start' || upto.includes(f.unlockAfter)) && !s.runnerForms.includes(f.id)) s.runnerForms.push(f.id);
      done('4장까지 클리어 처리했어 (다이브·데일리·도감·딥 서버·루프 열림)');
    }),
    button('가진 캐릭터 전원 50레벨', () => {
      const s = app.save;
      s.rank.level = Math.max(s.rank.level, 40);
      for (const c of Object.values(s.chars)) {
        c.level = 50;
        c.asc = 3;
        c.skills = { basic: 5, skill: 8, overclock: 8, trait: 8 };
        c.big = [0, 1, 2];
        c.small = [0, 1, 2, 3, 4, 5, 6, 7];
      }
      done('전원 50레벨');
    }),
    button('저장 초기화', () => {
      app.save = newSave();
      done('초기화했어');
    }, 'ghost'),
  );
  return { el: h('div', { class: 'scr' }, topBar(app, '테스트 도구'), h('div', { class: 'scr-body' }, body)) };
}
