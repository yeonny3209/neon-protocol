// 캐릭터 목록
import { DATA } from '../../engine/data';
import type { Element, Protocol } from '../../engine/defs';
import { growable } from '../../engine/growth';
import { kitFor } from '../../engine/loadout';
import type { App, Screen } from '../app';
import { dot, elementChip, portrait, protocolTag, stars, topBar } from '../common';
import { clear, h } from '../dom';
import { ELEMENT_INFO, PROTOCOL_INFO } from '../labels';
import { onPress } from '../press';
import { charScreen } from './char';

let filterEl: Element | null = null;
let filterPr: Protocol | null = null;

export function charsScreen(app: App): Screen {
  const grid = h('div', { class: 'char-grid' });
  const filters = h('div', { class: 'filter-row' });
  const draw = () => {
    clear(filters);
    for (const el of Object.keys(ELEMENT_INFO) as Element[]) {
      const b = h('button', { class: `chip${filterEl === el ? ' on' : ''}`, title: ELEMENT_INFO[el].name }, elementChip(el));
      onPress(b, () => ((filterEl = filterEl === el ? null : el), draw()), { tip: () => ELEMENT_INFO[el].name });
      filters.append(b);
    }
    for (const p of Object.keys(PROTOCOL_INFO) as Protocol[]) {
      const b = h('button', { class: `chip${filterPr === p ? ' on' : ''}`, text: PROTOCOL_INFO[p].name });
      onPress(b, () => ((filterPr = filterPr === p ? null : p), draw()));
      filters.append(b);
    }
    clear(grid);
    const all = Object.values(DATA.characters).sort((a, b) => {
      const oa = app.save.chars[a.id] ? 0 : 1;
      const ob = app.save.chars[b.id] ? 0 : 1;
      return oa - ob || (b.rarity || 4.5) - (a.rarity || 4.5) || a.name.localeCompare(b.name);
    });
    for (const def of all) {
      const own = app.save.chars[def.id];
      const kit = kitFor(def, def.id === 'runner' ? app.save.runnerForm : undefined);
      if (filterEl && kit.element !== filterEl) continue;
      if (filterPr && kit.protocol !== filterPr) continue;
      const card = h(
        'div',
        { class: `char-card panel${own ? '' : ' locked'}` },
        portrait(def.id, 72, kit.element),
        h('div', { class: 'nm', text: def.name }),
        stars(def.rarity),
        h('div', { class: 'meta' }, elementChip(kit.element), protocolTag(kit.protocol)),
        h('div', { class: 'meta', text: own ? `Lv${own.level}${own.sync ? ` · 동기화 ${own.sync}` : ''}` : '미보유' }),
        own ? dot(growable(app.save, def.id).any) : null,
      );
      onPress(card, () => app.go((a) => charScreen(a, def.id)));
      grid.append(card);
    }
  };
  draw();
  const el = h('div', { class: 'scr' }, topBar(app, '캐릭터'), filters, h('div', { class: 'scr-body' }, grid));
  return { el };
}
