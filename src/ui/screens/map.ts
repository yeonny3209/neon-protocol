// 스테이지 지도. 루멘 시티는 위로 갈수록 높은 층이라, 지도도 아래에서 위로 쌓인다.
import { DATA } from '../../engine/data';
import type { StageDef } from '../../engine/defs';
import type { App, Screen } from '../app';
import { button, elementChip, modal, topBar } from '../common';
import { h } from '../dom';
import { ELEMENT_INFO } from '../labels';
import { onPress } from '../press';
import { sfx } from '../audio';
import { storyParty } from '../../engine/party';
import { nextStageId, partyModal, stageAvailable, startStage, validParty } from './stage';

export function mapScreen(app: App): Screen {
  app.bgm('nest');
  const save = app.save;
  const col = h('div', { class: 'map-col' });
  const chapters = Object.values(DATA.chapters).sort((a, b) => b.order - a.order); // 위쪽이 높은 층
  let focus: HTMLElement | null = null;

  for (const ch of chapters) {
    const stages = DATA.stageOrder.map((id) => DATA.stages[id]).filter((s) => s.chapter === ch.id);
    const done = stages.filter((s) => save.story.cleared[s.id]).length;
    const block = h('div', { class: `map-ch${stages.length ? '' : ' soon'}`, style: `--cc:${ch.color}` });
    block.append(h('div', { class: 'map-ch-head' }, h('div', { class: 'name', text: `${ch.order === 0 ? '프롤로그' : `${ch.order}장`} · ${ch.title}` }), h('div', { class: 'sub', text: `${ch.zone} · ${ch.floors}${stages.length ? ` · ${done}/${stages.length}` : ' · 준비 중'}` })));
    const nodes = h('div', { class: 'map-nodes' });
    [...stages].reverse().forEach((st) => {
      const cleared = save.story.cleared[st.id] ?? 0;
      const ok = stageAvailable(app, st.id);
      const current = ok && !cleared;
      const stars = h('span', { class: 'ns' }, ...[1, 2, 4].map((b) => h('i', { class: cleared & b ? 'on' : '', text: '★' })));
      const node = h('div', { class: `map-node${cleared ? ' done' : ''}${current ? ' current' : ''}${ok ? '' : ' lock'}${st.boss ? ' boss' : ''}` }, h('b', { text: String(st.index) }), h('div', { class: 'nm' }, h('div', { text: st.name }), h('small', { text: `권장 Lv${st.recLevel}${st.boss ? ' · 보스' : ''}` })), cleared ? stars : null);
      onPress(node, () => (ok ? stageModal(app, st) : app.toast('앞 스테이지를 먼저 깨야 해')));
      nodes.append(node);
      if (current || (!focus && ok)) focus = node;
    });
    block.append(nodes);
    col.append(block);
  }

  const el = h('div', { class: 'scr' }, topBar(app, '스테이지', { currencies: ['shard', 'key', 'credit'] }), h('div', { class: 'scr-body' }, col));
  if (save.story.next) {
    // 마지막으로 보던 곳으로
  }
  setTimeout(() => (focus ?? col.lastElementChild)?.scrollIntoView({ block: 'center' }), 50);
  return { el };
}

export function stageModal(app: App, st: StageDef) {
  const save = app.save;
  const m = modal([h('h2', { text: `${st.index}. ${st.name}` }), h('div', { class: 'muted', text: `권장 Lv${st.recLevel}${st.boss ? ' · 보스 전투' : ''}${st.forcedParty ? ' · 체험 파티로 진행' : ''}` })]);
  const foes = h('div', { class: 'row' });
  const unique = [...new Set(st.enemies)];
  m.el.append(h('div', { class: 'muted', style: 'font-size:13px', text: '적을 먼저 누르고 출격하면 선공이야 (아군 행동 거리 30% 단축).' }), foes);
  unique.forEach((id) => {
    const e = DATA.enemies[id];
    const chip = h('div', { class: 'foe-chip panel', style: `--ecolor:${e.color}` }, h('b', { text: e.name.slice(0, 1) }), h('small', { text: e.name }), h('div', { class: 'row', style: 'gap:2px' }, ...e.weaknesses.map((w) => elementChip(w))));
    onPress(chip, () => {
      sfx('select');
      m.close();
      void startStage(app, st.id, true);
    }, { tip: () => `${e.name}\n약점: ${e.weaknesses.map((w) => ELEMENT_INFO[w].name).join(', ')}\n눌러서 선공으로 출격` });
    foes.append(chip);
  });
  const diff = h('div', { class: 'seg' });
  const drawDiff = () => {
    diff.replaceChildren(
      ...(['story', 'normal'] as const).map((v) => {
        const b = h('button', { class: save.settings.difficulty === v ? 'on' : '', text: v === 'story' ? '스토리' : '보통' });
        onPress(b, () => ((save.settings.difficulty = v), app.persist(), drawDiff()));
        return b;
      }),
    );
  };
  drawDiff();
  m.el.append(h('div', { class: 'row' }, '난이도', diff, h('span', { class: 'muted', style: 'font-size:12px', text: '보상은 똑같아' })));
  if (!st.forcedParty) {
    const sp = storyParty(save, st, save.settings.difficulty);
    const names = (ids: string[]) => ids.map((id) => DATA.characters[id].name).join(', ');
    m.el.append(h('div', { class: 'muted', style: 'font-size:13px', text: `${sp.filled.length ? `빈 자리는 체험 캐릭터(${names(sp.filled)})가 채워 줘. ` : ''}${sp.lifted.length ? `${names(sp.lifted)}는 권장 레벨보다 낮아서 스토리용으로 레벨을 올려 줄게.` : ''}` }));
  }
  const row = h('div', { class: 'row' });
  if (!st.forcedParty) row.append(button(`편성 (${validParty(app.save).map((id) => DATA.characters[id].name).join(', ')})`, () => partyModal(app, st, () => m.close()), ''));
  row.append(
    button('출격', () => {
      m.close();
      void startStage(app, st.id);
    }, 'primary big'),
  );
  m.el.append(row);
  void nextStageId;
}
