// 기록 보관소: 본 스토리 다시 보기, 엔딩 보기와 조건 힌트, 챕터 선택(선택지만 다시 고르기)
import { DATA } from '../../engine/data';
import { getScript, resetChoicesFrom } from '../../engine/story/runner';
import type { App, Screen } from '../app';
import { button, confirmBox, tabs, topBar } from '../common';
import { h } from '../dom';
import { playScript } from '../story';
import { ENDING_INFO, playEnding } from './stage';

function hasChoice(id: string): boolean {
  return getScript(id).ops.some((o) => o.op === 'choice');
}

export function archiveScreen(app: App): Screen {
  const save = app.save;
  const chapterOrder = Object.fromEntries(Object.values(DATA.chapters).map((c) => [c.id, c.order]));

  const body = tabs(['이야기 다시 보기', '엔딩', '챕터 선택'], (i, b) => {
    if (i === 0) {
      for (const ch of Object.values(DATA.chapters).sort((a, c) => a.order - c.order)) {
        const ids = DATA.stageOrder.filter((id) => DATA.stages[id].chapter === ch.id && save.story.cleared[id]);
        if (!ids.length) continue;
        const box = h('div', { class: 'section panel' }, h('h3', { text: `${ch.order === 0 ? '프롤로그' : `${ch.order}장`} · ${ch.title}` }));
        for (const id of ids) {
          const st = DATA.stages[id];
          const row = h('div', { class: 'row' }, h('span', { style: 'flex:1', text: `${st.index}. ${st.name}` }));
          if (st.pre) row.append(button('전', () => void playScript(app, st.pre!, st.chapter, { sandbox: true }), 'ghost'));
          if (st.post) row.append(button('후', () => void playScript(app, st.post!, st.chapter, { sandbox: true }), 'ghost'));
          box.append(row);
        }
        b.append(box);
      }
      if (!b.children.length) b.append(h('div', { class: 'muted', text: '아직 본 이야기가 없어. 스테이지를 깨면 여기서 다시 볼 수 있어.' }));
      return;
    }
    if (i === 1) {
      for (const [id, info] of Object.entries(ENDING_INFO)) {
        const seen = save.story.endings.includes(id);
        const box = h('div', { class: 'section panel' }, h('h3', { text: seen ? `엔딩 ${id}. ${info.title}` : `엔딩 ${id}. ???` }), h('div', { class: 'muted', style: 'font-size:14px', text: `조건 힌트: ${info.hint}` }));
        if (seen) box.append(button('다시 보기', () => void playEnding(app, id, true), 'primary'));
        b.append(box);
      }
      return;
    }
    if (!save.story.endings.length) {
      b.append(h('div', { class: 'section panel' }, h('h3', { text: '아직 잠겨 있어' }), h('div', { class: 'muted', text: '엔딩을 하나 보면 열려. 전투는 다시 하지 않고, 고른 챕터부터 선택지만 다시 고를 수 있어.' })));
      return;
    }
    b.append(h('div', { class: 'muted', text: '고른 챕터의 선택지부터 다시 고른다. 전투는 하지 않고, 대사는 건너뛰고 선택지에서만 멈춰.' }));
    for (const ch of Object.values(DATA.chapters).sort((a, c) => a.order - c.order)) {
      const ids = DATA.stageOrder.filter((id) => DATA.stages[id].chapter === ch.id);
      const scripts = ids.flatMap((id) => [DATA.stages[id].pre, DATA.stages[id].post]).filter((x): x is string => !!x && hasChoice(x));
      if (!scripts.length || ch.order === 0) continue;
      b.append(
        h('div', { class: 'section panel' }, h('h3', { text: `${ch.order}장 · ${ch.title}` }), h('div', { class: 'muted', style: 'font-size:13px', text: `선택지 ${scripts.length}곳` }),
          button('여기서부터 다시 고르기', () =>
            confirmBox('이 챕터부터 다시 고를까?', `${ch.order}장 이후의 선택이 모두 지워지고 처음부터 다시 고르게 돼. 신뢰도도 그에 맞게 다시 계산돼.`, '다시 고르기', () => void redo(ch.id)), 'primary')),
      );
    }
  });

  const redo = async (chapter: string) => {
    resetChoicesFrom(save, chapterOrder, chapter);
    app.persist();
    let ending: string | undefined;
    for (const id of DATA.stageOrder) {
      const st = DATA.stages[id];
      if ((chapterOrder[st.chapter] ?? 0) < (chapterOrder[chapter] ?? 0)) continue;
      for (const sc of [st.pre, st.post]) {
        if (sc && hasChoice(sc)) {
          const r = await playScript(app, sc, st.chapter, { replay: true });
          if (r.ending) ending = r.ending;
        }
      }
    }
    if (ending) await playEnding(app, ending);
    else app.refresh();
  };

  const el = h('div', { class: 'scr' }, topBar(app, '기록 보관소', { currencies: [] }), h('div', { class: 'scr-body' }, body));
  return { el };
}
