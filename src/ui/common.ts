// 여러 화면이 같이 쓰는 조각: 윗줄(뒤로·재화), 아이템 아이콘, 보상 목록, 초상, 모달.
import { DATA } from '../engine/data';
import type { Element, Reward } from '../engine/defs';
import { count } from '../engine/state';
import type { App } from './app';
import { clear, fmt, h } from './dom';
import { ELEMENT_INFO, PROTOCOL_INFO } from './labels';
import { onPress } from './press';
import { sfx } from './audio';

/** 다른 화면으로 가는 길. 순환 import를 피하려고 나중에 채운다 */
export const nav: {
  toMaterial?: (app: App, stageId: string) => void;
  toNest?: (app: App) => void;
} = {};

export function button(text: string, onTap: () => void, cls = '', tip?: () => string): HTMLButtonElement {
  const b = h('button', { class: `btn ${cls}`, text }) as HTMLButtonElement;
  onPress(b, () => {
    if (b.disabled) return;
    sfx('tap');
    onTap();
  }, tip ? { tip } : {});
  return b;
}

export function modal(content: HTMLElement | (HTMLElement | string)[], opts: { onClose?: () => void; wide?: boolean; noClose?: boolean } = {}): { close: () => void; el: HTMLElement } {
  const panel = h('div', { class: `modal panel${opts.wide ? ' wide' : ''}` });
  const back = h('div', { class: 'modal-back' }, panel);
  const close = () => {
    back.remove();
    opts.onClose?.();
  };
  if (!opts.noClose) {
    const x = h('button', { class: 'btn ghost modal-x', 'aria-label': '닫기', text: '✕' });
    onPress(x, () => {
      sfx('cancel');
      close();
    });
    panel.append(x);
  }
  if (Array.isArray(content)) panel.append(...content);
  else panel.append(content);
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back && !opts.noClose) close();
  });
  document.getElementById('app')!.append(back);
  return { close, el: panel };
}

export function confirmBox(title: string, body: string, ok: string, onOk: () => void, cancel = '취소') {
  const m = modal([h('h2', { text: title }), h('div', { class: 'muted', text: body })]);
  const row = h('div', { class: 'row', style: 'justify-content:flex-end' }, button(cancel, () => m.close(), 'ghost'), button(ok, () => (m.close(), onOk()), 'primary'));
  m.el.append(row);
}

// ───────────────────────── 아이템

const KIND_GLYPH: Record<string, string> = { currency: '◆', exp: '▤', part: '⬡', core: '◉', chip: '▣', weekly: '✶', other: '■' };
const CUR_COLOR: Record<string, string> = { shard: '#40e8ff', key: '#ffd166', signal: '#b07cff', credit: '#ffe14d', cart_data: '#9fe9ff', core: '#ff4d6d', weekly: '#ff3e9a' };
const RARITY_COLOR = ['#6c7199', '#6c7199', '#7fbf7f', '#4fa3ff', '#b07cff', '#ffd166'];

export function itemColor(id: string): string {
  const def = DATA.items[id];
  if (CUR_COLOR[id]) return CUR_COLOR[id];
  if (def?.element) return ELEMENT_INFO[def.element].color;
  return RARITY_COLOR[def?.rarity ?? 2];
}

export function itemName(id: string): string {
  if (id.startsWith('char:')) return DATA.characters[id.slice(5)]?.name ?? id;
  if (id.startsWith('cart:')) return DATA.cartridges[id.slice(5)]?.name ?? id;
  if (id === 'rankExp') return '러너 등급 경험치';
  if (id === 'exp') return '경험치';
  return DATA.items[id]?.name ?? id;
}

export function itemIcon(app: App | null, id: string, n?: number, opts: { have?: boolean; small?: boolean } = {}): HTMLElement {
  const def = DATA.items[id];
  const glyph = id === 'key' ? '⚿' : id === 'shard' ? '◆' : id === 'signal' ? '✦' : id === 'credit' ? '¢' : id.startsWith('char:') ? DATA.characters[id.slice(5)]?.name.slice(0, 1) ?? '?' : id.startsWith('cart:') ? '▭' : id === 'rankExp' ? '★' : KIND_GLYPH[def?.kind ?? 'other'] ?? '■';
  const size = def?.id.endsWith('_l') ? '대' : def?.id.endsWith('_m') ? '중' : def?.id.endsWith('_s') ? '소' : '';
  const el = h('div', { class: `item${opts.small ? ' small' : ''}`, style: `--ic:${itemColor(id)}` }, h('span', { class: 'g', text: glyph }), size ? h('span', { class: 'sz', text: size }) : null, n !== undefined ? h('span', { class: 'n', text: fmt(n) }) : null);
  if (opts.have && app) {
    const have = count(app.save, id);
    if (n !== undefined && have < n) el.classList.add('lack');
  }
  onPress(el, () => itemInfo(app, id), { tip: () => `${itemName(id)}\n${def?.desc ?? ''}` });
  return el;
}

/** 재료 아이콘을 누르면 항상 획득처와 "이동" 버튼이 나온다 */
export function itemInfo(app: App | null, id: string) {
  const def = DATA.items[id];
  if (!def) return;
  const parts: HTMLElement[] = [
    h('div', { class: 'row' }, itemIcon(null, id), h('div', null, h('h2', { text: def.name }), h('div', { class: 'muted', text: app ? `보유 ${fmt(count(app.save, id))}` : '' }))),
    h('div', { text: def.desc }),
    h('div', { class: 'muted', text: '얻는 곳' }),
    h('ul', { class: 'src-list' }, ...def.sources.map((s) => h('li', { text: s }))),
  ];
  const m = modal(parts);
  if (app && def.stage && nav.toMaterial) m.el.append(button('이동', () => (m.close(), nav.toMaterial!(app, def.stage!)), 'primary big'));
}

export function rewardList(app: App | null, r: Reward, opts: { have?: boolean; small?: boolean } = {}): HTMLElement {
  const box = h('div', { class: 'rewards' });
  for (const [id, n] of Object.entries(r)) if (n) box.append(itemIcon(app, id, n, opts));
  return box;
}

// ───────────────────────── 윗줄

export function topBar(app: App, title: string, opts: { back?: boolean | (() => void); currencies?: string[]; right?: HTMLElement[] } = {}): HTMLElement {
  const bar = h('div', { class: 'topbar' });
  if (opts.back !== false) {
    const b = h('button', { class: 'btn back', 'aria-label': '뒤로', text: '‹' });
    onPress(b, () => (typeof opts.back === 'function' ? opts.back() : app.back()));
    bar.append(b);
  }
  bar.append(h('div', { class: 'title', text: title }));
  const cur = h('div', { class: 'curs' });
  for (const id of opts.currencies ?? ['shard', 'key', 'credit']) {
    const chip = h('div', { class: 'cur', style: `--ic:${itemColor(id)}` }, h('span', { class: 'g', text: id === 'key' ? '⚿' : id === 'shard' ? '◆' : id === 'signal' ? '✦' : '¢' }), h('span', { text: fmt(count(app.save, id)) }));
    onPress(chip, () => itemInfo(app, id), { tip: () => itemName(id) });
    cur.append(chip);
  }
  bar.append(cur, ...(opts.right ?? []));
  return bar;
}

// ───────────────────────── 캐릭터

export function portrait(charId: string, size = 64, element?: Element): HTMLElement {
  const def = DATA.characters[charId];
  const el = element ?? def?.element ?? 'kinetic';
  const box = h('div', { class: 'portrait', style: `--pc:${def?.look.color ?? '#888'};--elc:${ELEMENT_INFO[el].color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px` });
  if (def?.art?.icon) box.append(h('img', { src: def.art.icon, alt: def.name }));
  else box.textContent = def?.name.slice(0, 1) ?? '?';
  return box;
}

export function stars(r: number): HTMLElement {
  return h('span', { class: `stars-r r${r}`, text: r === 0 ? '무료' : '★'.repeat(r) });
}

export function elementChip(el: Element): HTMLElement {
  const info = ELEMENT_INFO[el];
  return h('span', { class: 'el-chip', style: `background:${info.color}`, title: info.name }, info.glyph);
}

export function protocolTag(p: keyof typeof PROTOCOL_INFO): HTMLElement {
  return h('span', { class: 'proto-tag', text: `${PROTOCOL_INFO[p].glyph} ${PROTOCOL_INFO[p].name}` });
}

export function dot(on: boolean): HTMLElement | null {
  return on ? h('span', { class: 'red-dot' }) : null;
}

export function tabs(names: string[], render: (i: number, body: HTMLElement) => void, start = 0, dots: boolean[] = []): HTMLElement {
  const bar = h('div', { class: 'tabs' });
  const body = h('div', { class: 'tab-body' });
  const btns = names.map((n, i) => {
    const b = h('button', { class: 'tab', text: n });
    if (dots[i]) b.append(h('span', { class: 'red-dot' }));
    onPress(b, () => select(i));
    return b;
  });
  const select = (i: number) => {
    btns.forEach((b, j) => b.classList.toggle('on', i === j));
    clear(body);
    render(i, body);
    sfx('page');
  };
  bar.append(...btns);
  select(start);
  return h('div', { class: 'tabs-wrap' }, bar, body);
}
