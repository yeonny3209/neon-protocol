// 터치·마우스 공통 입력. 짧게 누르면 실행, 길게 누르면(터치) 또는 올려 두면(마우스) 설명이 뜬다.
import { h } from './dom';

const LONG_MS = 450;
const MOVE_PX = 14;
let tipEl: HTMLElement | null = null;
let tipOwner: Element | null = null;

export type TipSource = () => string | HTMLElement | null | undefined;

export function showTip(anchor: Element, content: string | HTMLElement) {
  hideTip();
  tipEl = h('div', { class: 'tooltip', role: 'tooltip' });
  if (typeof content === 'string') tipEl.textContent = content;
  else tipEl.append(content);
  document.body.append(tipEl);
  tipOwner = anchor;
  const r = anchor.getBoundingClientRect();
  const t = tipEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(8, Math.min(vw - t.width - 8, left));
  let top = r.top - t.height - 10;
  if (top < 8) top = Math.min(vh - t.height - 8, r.bottom + 10);
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}

export function hideTip(owner?: Element) {
  if (owner && owner !== tipOwner) return;
  tipEl?.remove();
  tipEl = null;
  tipOwner = null;
}

export interface PressOptions {
  tip?: TipSource;
  /** 마우스를 올렸을 때 실행(커서 이동 등) */
  hover?: () => void;
}

/** 요소에 탭/클릭 + 설명 툴팁을 붙인다 */
export function onPress(el: HTMLElement, tap: (ev: PointerEvent) => void, opts: PressOptions = {}) {
  let timer = 0;
  let longFired = false;
  let start: { x: number; y: number; id: number } | null = null;

  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    start = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    longFired = false;
    if (ev.pointerType !== 'mouse' && opts.tip) {
      timer = window.setTimeout(() => {
        const c = opts.tip!();
        if (c) {
          longFired = true;
          showTip(el, c);
        }
      }, LONG_MS);
    }
  });
  el.addEventListener('pointermove', (ev) => {
    if (start && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > MOVE_PX) {
      clearTimeout(timer);
      start = null;
    }
  });
  const end = (ev: PointerEvent) => {
    clearTimeout(timer);
    if (!start || start.id !== ev.pointerId) return;
    start = null;
    if (longFired) {
      hideTip(el);
      return;
    }
    tap(ev);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => {
    clearTimeout(timer);
    start = null;
    if (longFired) hideTip(el);
  });
  el.addEventListener('contextmenu', (ev) => ev.preventDefault());
  el.addEventListener('pointerenter', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    opts.hover?.();
    if (opts.tip) {
      timer = window.setTimeout(() => {
        const c = opts.tip!();
        if (c) showTip(el, c);
      }, 350);
    }
  });
  el.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    clearTimeout(timer);
    hideTip(el);
  });
}
