// 도감·업적. 도감 항목을 처음 채우면 샤드를 조금씩, 업적은 따로 받는다.
import { achClaimable, achProgress, claimAchievements, claimCodex, codexClaimable, codexEntries, type CodexKind } from '../../engine/achievements';
import { DATA } from '../../engine/data';
import type { App, Screen } from '../app';
import { button, elementChip, modal, portrait, tabs, topBar } from '../common';
import { h } from '../dom';
import { ELEMENT_INFO, FACTION_NAME, PROTOCOL_INFO } from '../labels';
import { onPress } from '../press';
import { sfx } from '../audio';
import { ENDING_INFO } from './stage';
import { cartIcon } from './char';

const CAT_NAME: Record<string, string> = { story: '스토리', battle: '전투', collect: '수집', growth: '성장', loop: '루프·루틴', fun: '장난' };

export function codexScreen(app: App): Screen {
  const save = app.save;
  const refresh = (msg: string) => {
    sfx('reward');
    app.persist();
    app.toast(msg);
    app.refresh();
  };

  const body = tabs(['업적', '캐릭터', '적', '카트리지', '엔딩', '루프'], (i, b) => {
    if (i === 0) {
      const claim = achClaimable(save);
      const top = h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'muted', text: `달성 ${Object.keys(save.ach.done).length} / ${DATA.achievements.length}` }));
      const btn = button(claim.length ? `보상 모두 받기 (${claim.length})` : '받을 보상 없음', () => {
        const g = claimAchievements(save);
        refresh(`데이터 샤드 +${g.items.shard ?? 0}`);
      }, claim.length ? 'primary' : '');
      btn.disabled = !claim.length;
      top.append(btn);
      b.append(top);
      for (const cat of Object.keys(CAT_NAME)) {
        const list = DATA.achievements.filter((a) => a.cat === cat);
        const box = h('div', { class: 'section panel' }, h('h3', { text: CAT_NAME[cat] }));
        for (const a of list) {
          const pr = achProgress(save, a);
          const secret = a.hidden && !pr.done;
          box.append(
            h('div', { class: `mission${pr.done ? ' done' : ''}` }, h('span', null, h('b', { text: secret ? '??? (숨은 업적)' : a.name }), h('br'), h('small', { class: 'muted', text: secret ? '어떻게 달성하는지 찾아봐' : a.desc })), h('span', { class: 'muted', text: secret ? '' : `${pr.value} / ${a.target}` }), h('div', { class: 'bar' }, h('i', { style: `width:${secret ? 0 : (pr.value / a.target) * 100}%` })), save.ach.claimed.includes(a.id) ? h('small', { class: 'muted', text: '받음' }) : null),
          );
        }
        b.append(box);
      }
      return;
    }
    const kinds: CodexKind[][] = [[], ['char'], ['enemy'], ['cart'], ['ending'], ['patch', 'event']];
    const entries = codexEntries(save).filter((e) => kinds[i].includes(e.kind));
    const claim = codexClaimable(save);
    const top = h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { class: 'muted', text: `채운 항목 ${entries.filter((e) => e.unlocked).length} / ${entries.length}` }));
    const btn = button(claim.length ? `처음 채운 보상 받기 (${claim.length})` : '받을 보상 없음', () => {
      const g = claimCodex(save);
      refresh(`데이터 샤드 +${g.items.shard ?? 0}`);
    }, claim.length ? 'primary' : '');
    btn.disabled = !claim.length;
    top.append(btn);
    b.append(top);
    const grid = h('div', { class: 'char-grid' });
    for (const e of entries) {
      const card = h('div', { class: `char-card panel${e.unlocked ? '' : ' locked'}` });
      if (e.kind === 'char') card.append(portrait(e.ref, 56));
      else if (e.kind === 'enemy') card.append(h('div', { class: 'foe-chip', style: `--ecolor:${DATA.enemies[e.ref].color}` }, h('b', { text: e.unlocked ? e.name.slice(0, 1) : '?' })));
      else if (e.kind === 'cart') card.append(cartIcon(DATA.cartridges[e.ref].rarity, DATA.cartridges[e.ref].protocol));
      else card.append(h('div', { class: 'lv-big', text: e.kind === 'ending' ? e.ref : e.kind === 'patch' ? '◇' : '✎' }));
      card.append(h('div', { class: 'nm', text: e.unlocked || e.kind === 'char' ? e.name : '???' }));
      if (!save.codex.claimed.includes(e.id) && e.unlocked) card.append(h('span', { class: 'red-dot' }));
      onPress(card, () => detail(e.kind, e.ref, e.unlocked));
      grid.append(card);
    }
    b.append(grid);
  });

  const detail = (kind: CodexKind, ref: string, unlocked: boolean) => {
    if (!unlocked && kind !== 'ending' && kind !== 'char') return app.toast('아직 만나지 못했어');
    if (kind === 'char') {
      const d = DATA.characters[ref];
      const m = modal([h('h2', { text: d.name }), h('div', { class: 'muted', text: `${FACTION_NAME[d.faction] ?? ''} · ${ELEMENT_INFO[d.element].name} · ${PROTOCOL_INFO[d.protocol].name}` }), h('div', { text: d.profile })]);
      if (unlocked) {
        m.el.append(h('h3', { text: '대사 다시 보기' }));
        const ul = h('ul', { class: 'src-list' }, ...[...d.lines.nest, d.lines.dive, d.lines.overclock, d.lines.victory].map((l) => h('li', { text: l })));
        m.el.append(ul);
      } else m.el.append(h('div', { class: 'muted', text: '다이브에서 만나면 대사를 볼 수 있어.' }));
    } else if (kind === 'enemy') {
      const e = DATA.enemies[ref];
      modal([h('h2', { text: e.name }), h('div', { class: 'row' }, h('span', { class: 'muted', text: '약점' }), ...e.weaknesses.map((w) => elementChip(w))), h('div', { text: e.desc })]);
    } else if (kind === 'cart') {
      const c = DATA.cartridges[ref];
      modal([h('h2', { text: `${c.name} ${'★'.repeat(c.rarity)}` }), h('div', { class: 'muted', text: PROTOCOL_INFO[c.protocol].name }), h('div', { text: c.desc }), h('div', { text: `「${c.effect.name}」 ${c.effect.desc}` })]);
    } else if (kind === 'ending') {
      const info = ENDING_INFO[ref];
      modal([h('h2', { text: unlocked ? `엔딩 ${ref}. ${info.title}` : `엔딩 ${ref}. ???` }), h('div', { class: 'muted', text: `조건 힌트: ${info.hint}` })]);
    } else if (kind === 'patch') {
      const p = DATA.patches[ref];
      modal([h('h2', { text: p.name }), h('div', { class: 'muted', text: DATA.families[p.family]?.name ?? '공용' }), h('div', { text: p.desc })]);
    } else {
      const ev = DATA.loopEvents[ref];
      modal([h('h2', { text: ev.title }), h('div', { text: ev.text })]);
    }
  };

  return { el: h('div', { class: 'scr' }, topBar(app, '도감·업적', { currencies: ['shard'] }), h('div', { class: 'scr-body' }, body)) };
}
