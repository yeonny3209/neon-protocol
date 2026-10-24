// 재료 스테이지: 단계 선택, 출격, 소탕(1/5/10회)
import { DATA } from '../../engine/data';
import { canSweepTier, clearTier, materialSetup, sweep, sweepsLeft, tierOpen, tierReward, tierStars, weeklyLeft } from '../../engine/materials';
import { randomSeed } from '../../engine/rng';
import type { MaterialStageDef } from '../../engine/defs';
import type { App, Screen } from '../app';
import { button, elementChip, modal, nav, rewardList, topBar } from '../common';
import { h } from '../dom';
import { ELEMENT_INFO, PROTOCOL_INFO } from '../labels';
import { onPress } from '../press';
import { sfx } from '../audio';
import { battleHostScreen } from './battlehost';
import { partyModal } from './stage';

const KIND_TITLE: Record<string, string> = { exp: '경험치', credit: '크레딧', part: '돌파 부품', chip: '회로 칩', core: '보스 코어', weekly: '주간 보스' };

export function materialScreen(app: App, focus?: string): Screen {
  const save = app.save;
  const list = h('div', { class: 'mat-list' });
  const kinds = ['exp', 'credit', 'part', 'chip', 'core', 'weekly'];
  for (const k of kinds) {
    const stages = Object.values(DATA.materials).filter((m) => m.kind === k);
    const box = h('div', { class: 'section panel' }, h('h3', { text: KIND_TITLE[k] }));
    const row = h('div', { class: 'mat-row' });
    for (const m of stages) {
      const best = m.tiers.reduce((b, _, i) => (tierStars(save, m.id, i) === 7 ? i + 1 : b), 0);
      const card = h('div', { class: `mat-card${focus === m.id ? ' focus' : ''}` }, m.element ? elementChip(m.element) : m.protocol ? h('span', { class: 'proto-tag', text: PROTOCOL_INFO[m.protocol].glyph }) : null, h('b', { text: m.name }), h('small', { class: 'muted', text: best ? `${best}단계까지 소탕 가능` : '아직 소탕 불가' }));
      onPress(card, () => stageModal(app, m));
      row.append(card);
      if (focus === m.id) setTimeout(() => stageModal(app, m), 50);
    }
    box.append(row);
    list.append(box);
  }
  const el = h('div', { class: 'scr' }, topBar(app, '재료 스테이지', { currencies: ['credit'] }), h('div', { class: 'muted', style: 'font-size:13px', text: '한 번 별 3개로 깬 단계는 소탕으로 바로 보상을 받아. 스테이지마다 하루 30회.' }), h('div', { class: 'scr-body' }, list));
  return { el };
}

function stageModal(app: App, m: MaterialStageDef) {
  const save = app.save;
  const mo = modal([h('h2', { text: m.name }), h('div', { class: 'muted', text: `오늘 남은 소탕 ${sweepsLeft(save, m.id)}회${m.kind === 'weekly' ? ` · 이번 주 보상 ${weeklyLeft(save)}회 남음` : ''}${m.element ? ` · ${ELEMENT_INFO[m.element].name} 속성 부품` : ''}` })], { wide: true });
  m.tiers.forEach((t, i) => {
    const open = tierOpen(save, m.id, i);
    const stars = tierStars(save, m.id, i);
    const row = h('div', { class: `section panel${open ? '' : ' locked'}` }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', { text: `${i + 1}단계 · Lv${t.level}` }), h('span', { class: 'ns' }, ...[1, 2, 4].map((b) => h('i', { class: stars & b ? 'on' : '', text: '★' })))));
    row.append(rewardList(app, tierReward(save, m.id, i, 1), { small: true }));
    if (!open) {
      row.append(h('div', { class: 'muted', text: `러너 등급 ${t.rank} 이상` }));
    } else {
      const btns = h('div', { class: 'row' });
      btns.append(button('출격', () => (mo.close(), fight(app, m, i)), 'primary'));
      if (canSweepTier(save, m.id, i)) {
        for (const n of DATA.balance.materials.sweepTimes) {
          btns.append(button(`소탕 ${n}회`, () => {
            const r = sweep(save, m.id, i, n);
            if (typeof r === 'string') return app.toast(r === 'limit' ? '오늘 소탕 횟수를 다 썼어' : '별 3개로 깨야 소탕할 수 있어');
            sfx('reward');
            app.persist();
            mo.close();
            app.refresh();
            showGot(app, '소탕 완료', r.items);
          }));
        }
      } else btns.append(h('span', { class: 'muted', style: 'font-size:13px', text: '별 3개로 깨면 소탕이 열려' }));
      row.append(btns);
    }
    mo.el.append(row);
  });
  mo.el.append(button('편성', () => partyModal(app, null, () => undefined)));
}

function showGot(app: App, title: string, items: Record<string, number>) {
  modal([h('h2', { text: title }), rewardList(app, items)]);
}

function fight(app: App, m: MaterialStageDef, tier: number) {
  app.go((a) =>
    battleHostScreen(a, {
      title: `${m.name} ${tier + 1}단계`,
      boss: m.kind === 'core' || m.kind === 'weekly',
      makeSetup: () => materialSetup(a.save, m.id, tier, randomSeed()),
      onWin: (b) => {
        let stars = 1;
        if (b.allies(false).every((u) => u.alive)) stars |= 2;
        if (b.round() <= DATA.balance.story.defaultStarRounds) stars |= 4;
        const got = clearTier(a.save, m.id, tier, stars);
        a.persist();
        const panel = modal([h('div', { class: 'headline win', text: '클리어' }), h('div', { class: 'stars' }, ...[1, 2, 4].map((bit) => h('span', { class: stars & bit ? 'on' : 'off', text: '★' }))), rewardList(a, got.items)], { noClose: true });
        panel.el.classList.add('result');
        panel.el.append(button('재료 스테이지로', () => (panel.close(), a.back()), 'primary big'));
      },
      onChangeParty: (view) => partyModal(a, null, () => view.restart()),
      onQuit: () => a.back(),
    }),
  );
}

nav.toMaterial = (app, id) => app.go((a) => materialScreen(a, id));
