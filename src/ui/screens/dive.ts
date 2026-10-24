// 다이브(뽑기) 화면. 결과는 연출을 시작하기 전에 먼저 저장한다.
import { DATA } from '../../engine/data';
import { buyKeys, costOf, currentBanners, dive, exchange, exchangeList, pityOf, standardSelect, standardSelectReady, type Banner, type PullResult } from '../../engine/gacha';
import { randomSeed, createRng } from '../../engine/rng';
import { count } from '../../engine/state';
import type { App, Screen } from '../app';
import { button, modal, portrait, topBar } from '../common';
import { clear, fmt, h, sleep } from '../dom';
import { onPress } from '../press';
import { sfx } from '../audio';
import { cartIcon } from './char';

let selected = 1;

export function diveScreen(app: App): Screen {
  const banners = currentBanners(app.save);
  if (selected >= banners.length) selected = 0;
  const tabsEl = h('div', { class: 'banner-tabs' });
  const main = h('div', { class: 'banner-main' });
  const wrap = h('div', { class: 'dive' }, tabsEl, main);
  const el = h('div', { class: 'scr' }, topBar(app, '다이브', { currencies: ['shard', 'key', 'signal'] }), wrap);

  const drawTabs = () => {
    clear(tabsEl);
    banners.forEach((b, i) => {
      const t = h('button', { class: `banner-tab${i === selected ? ' on' : ''}` }, b.title, h('small', { text: kindLabel(b) }));
      onPress(t, () => ((selected = i), drawTabs(), drawMain()));
      tabsEl.append(t);
    });
  };

  const drawMain = () => {
    clear(main);
    const b = banners[selected];
    const pity = pityOf(app.save, b.kind);
    const g = DATA.balance.gacha;
    const rates = b.kind === 'beginner' ? g.beginner : b.kind === 'character' ? g.character : b.kind === 'cartridge' ? g.cartridge : g.standard;
    const heroId = b.kind === 'character' ? b.pickup5! : b.kind === 'cartridge' ? DATA.cartridges[b.pickup5!]?.exclusiveFor : undefined;
    const color = heroId ? DATA.characters[heroId]?.look.color ?? '#9b5cff' : '#9b5cff';
    const art = h('div', { class: 'banner-art', style: `--bc:${color}` });
    if (heroId) art.append(h('div', { class: 'hero', text: DATA.characters[heroId]?.name.slice(0, 1) ?? '' }));
    art.append(h('h2', { text: b.title }), h('div', { class: 'sub', text: bannerDesc(b) }));
    if (b.ends) art.append(h('div', { class: 'sub', text: `${fmtDate(b.ends)}까지 (기기 날짜 기준 2주마다 교체)` }));
    main.append(art);

    const left5 = rates.five.hard - pity.five;
    const left4 = rates.four.hard - pity.four;
    const guar = (b.kind === 'character' || b.kind === 'cartridge') && pity.guar5;
    const pb = h(
      'div',
      { class: 'pity-box' },
      h('div', { class: 'p' }, '5성 천장까지', h('b', { text: `${left5}회` })),
      b.kind === 'character' || b.kind === 'cartridge' ? h('div', { class: `p${guar ? ' guar' : ''}` }, '다음 5성', h('b', { text: guar ? '픽업 확정!' : `픽업 ${Math.round((b.kind === 'character' ? g.character.pickupChance : g.cartridge.pickupChance) * 100)}%` })) : null,
      h('div', { class: 'p' }, '4성 이상 확정까지', h('b', { text: `${left4}회` })),
      b.kind === 'beginner' ? h('div', { class: 'p' }, '남은 횟수', h('b', { text: `${g.beginner.limit - app.save.gacha.beginner}회` })) : null,
      b.kind === 'standard' ? h('div', { class: 'p' }, '상시 5성 선택까지', h('b', { text: app.save.gacha.standardPicked ? '받음' : `${Math.max(0, g.standard.selectAt - app.save.gacha.standardPulls)}회` })) : null,
    );
    main.append(pb);

    const one = costOf(b.kind, 1);
    const ten = costOf(b.kind, 10);
    const btns = h('div', { class: 'dive-btns' });
    const pullBtn = (times: 1 | 10, cost: number) => {
      const btn = h('button', { class: `btn big ${times === 10 ? 'primary' : 'cyan'}` }, `${times}회 다이브`, h('small', { text: `다이브 키 ${cost}개${b.kind === 'beginner' && times === 10 ? ' (20% 할인)' : ''}` }));
      onPress(btn, () => doPull(b, times, cost));
      return btn;
    };
    btns.append(pullBtn(1, one), pullBtn(10, ten));
    main.append(btns);

    const extra = h('div', { class: 'row' });
    extra.append(button(`샤드로 키 사기 (${g.keyPriceShards}개 = 1개)`, () => buyKeysModal(), ''));
    extra.append(button('다이브 기록', () => historyModal()));
    extra.append(button('신호 교환소', () => exchangeModal()));
    extra.append(button('확률 정보', () => rateModal(b)));
    if (b.kind === 'standard' && standardSelectReady(app.save)) extra.append(button('상시 5성 고르기', () => selectModal(), 'primary'));
    main.append(extra);
  };

  const doPull = async (b: Banner, times: 1 | 10, cost: number) => {
    if (count(app.save, 'key') < cost) return buyKeysModal(cost - count(app.save, 'key'));
    const res = dive(app.save, b, times, createRng(randomSeed()));
    if (typeof res === 'string') return app.toast(res === 'limit' ? '초보자 다이브는 50회로 끝나' : '다이브 키가 부족해');
    app.persist(); // 연출 전에 먼저 저장
    await playResults(app, el, res);
    if (b.kind === 'beginner' && app.save.gacha.beginner >= DATA.balance.gacha.beginner.limit) app.refresh();
    else {
      el.querySelector('.topbar')!.replaceWith(topBar(app, '다이브', { currencies: ['shard', 'key', 'signal'] }));
      drawMain();
    }
  };

  const buyKeysModal = (need = 1) => {
    const price = DATA.balance.gacha.keyPriceShards;
    const max = Math.floor(count(app.save, 'shard') / price);
    let n = Math.max(1, Math.min(need, max));
    const label = h('div', { style: 'font-size:20px;font-weight:900;text-align:center' });
    const draw = () => (label.textContent = `다이브 키 ${n}개 = 데이터 샤드 ${fmt(n * price)}개`);
    draw();
    const m = modal([h('h2', { text: '다이브 키 사기' }), h('div', { class: 'muted', text: `가진 데이터 샤드 ${fmt(count(app.save, 'shard'))}개 (최대 ${max}개 살 수 있어)` }), label]);
    const row = h('div', { class: 'row', style: 'justify-content:center' });
    for (const d of [-10, -1, 1, 10]) row.append(button(d > 0 ? `+${d}` : String(d), () => ((n = Math.max(1, Math.min(max, n + d))), draw())));
    m.el.append(row, button('사기', () => {
      if (!buyKeys(app.save, n)) return app.toast('데이터 샤드가 부족해');
      app.persist();
      m.close();
      app.toast(`다이브 키 ${n}개를 샀어`);
      app.refresh();
    }, 'primary big'));
    if (max <= 0) m.el.append(h('div', { class: 'muted', text: '데이터 샤드는 스토리, 업적, 미션에서 얻어.' }));
  };

  const historyModal = () => {
    const list = h('div', { class: 'history-list' });
    if (!app.save.gacha.history.length) list.append(h('div', { class: 'muted', text: '아직 기록이 없어' }));
    for (const r of app.save.gacha.history) {
      const name = r.kind === 'char' ? DATA.characters[r.id]?.name : DATA.cartridges[r.id]?.name;
      list.append(h('div', null, h('span', { class: `r${r.rarity}`, text: `${'★'.repeat(r.rarity)} ${name}` }), h('span', { class: 'muted', text: `${r.banner} · ${new Date(r.at).toLocaleDateString('ko-KR')}` })));
    }
    modal([h('h2', { text: `다이브 기록 (최근 ${DATA.balance.gacha.historyLimit}회)` }), list], { wide: true });
  };

  const exchangeModal = () => {
    const items = exchangeList(app.save);
    const m = modal([h('h2', { text: '신호 교환소' }), h('div', { class: 'muted', text: `신호 조각 ${fmt(count(app.save, 'signal'))}개. 운이 없어도 오래 하면 원하는 걸 고를 수 있어.` })], { wide: true });
    for (const it of items) {
      const row = h('div', { class: 'section panel' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', { text: it.title }), h('span', { text: `신호 조각 ${it.price}${it.limitLeft !== undefined ? ` · 이번 달 ${it.limitLeft}회 남음` : ''}` })));
      const opts = h('div', { class: 'row' });
      for (const o of it.options) {
        const name = o === 'key' ? '다이브 키 1개' : DATA.characters[o]?.name ?? DATA.cartridges[o]?.name ?? o;
        opts.append(button(name, () => {
          const r = exchange(app.save, it, o);
          if (r === 'signal') return app.toast('신호 조각이 부족해');
          if (r === 'limit') return app.toast('이번 달 교환 횟수를 다 썼어');
          app.persist();
          m.close();
          app.toast(`${name} 교환 완료`);
          app.refresh();
        }));
      }
      row.append(opts);
      m.el.append(row);
    }
  };

  const selectModal = () => {
    const m = modal([h('h2', { text: '상시 5성 1명 고르기' }), h('div', { class: 'muted', text: '상시 다이브 300회를 채운 보상이야. 한 번만 고를 수 있어.' })]);
    const row = h('div', { class: 'row' });
    for (const id of DATA.banners.standardChars) {
      row.append(button(DATA.characters[id].name, () => {
        standardSelect(app.save, id);
        app.persist();
        m.close();
        app.toast(`${DATA.characters[id].name} 합류!`);
        app.refresh();
      }));
    }
    m.el.append(row);
  };

  const rateModal = (b: Banner) => {
    const g = DATA.balance.gacha;
    const r = b.kind === 'beginner' ? g.beginner : b.kind === 'character' ? g.character : b.kind === 'cartridge' ? g.cartridge : g.standard;
    const lines = [
      `5성 기본 ${(r.five.base * 100).toFixed(1)}%, ${r.five.softStart}회째부터 매회 +${(r.five.softStep * 100).toFixed(0)}%p, ${r.five.hard}회째 확정`,
      `4성 기본 ${(r.four.base * 100).toFixed(1)}%, ${r.four.hard}회 안에 최소 1번 확정`,
      '3성: 3성 카트리지만 나온다',
    ];
    if (b.kind === 'character') lines.push(`픽업 5성 ${g.character.pickupChance * 100}% — 놓치면 다음 5성은 픽업 확정`, `4성이 나오면 ${g.character.fourPickupChance * 100}%로 픽업 4성 — 놓치면 다음 4성은 픽업 확정`);
    if (b.kind === 'cartridge') lines.push(`픽업 5성 카트리지 ${g.cartridge.pickupChance * 100}% — 놓치면 다음 5성은 픽업 확정`);
    if (b.kind === 'beginner') lines.push('상시 5성 캐릭터 중 1명이 50회 안에 확정', '첫 10회 안에 4성 캐릭터 1명 확정', '10회 다이브는 키 8개');
    if (b.kind === 'standard') lines.push(`${g.standard.selectAt}회를 채우면 상시 5성 1명을 고를 수 있다`);
    lines.push('천장 횟수와 확정 상태는 같은 종류의 다음 배너로 이어진다');
    modal([h('h2', { text: '확률 정보' }), h('ul', { class: 'src-list' }, ...lines.map((l) => h('li', { text: l })))]);
  };

  drawTabs();
  drawMain();
  app.bgm('nest');
  return { el };
}

function kindLabel(b: Banner): string {
  return b.kind === 'beginner' ? '초보자' : b.kind === 'character' ? '캐릭터 픽업' : b.kind === 'cartridge' ? '카트리지 픽업' : '상시';
}

function bannerDesc(b: Banner): string {
  if (b.kind === 'beginner') return '상시 5성 캐릭터 1명이 50회 안에 확정! 10회 다이브 20% 할인';
  if (b.kind === 'standard') return '모든 상시 캐릭터와 카트리지';
  const name = (id: string) => DATA.characters[id]?.name ?? DATA.cartridges[id]?.name ?? id;
  return `픽업 5성: ${name(b.pickup5!)} · 픽업 4성: ${b.pickup4.map(name).join(', ')}`;
}

function fmtDate(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 다이브 연출: 신호 색(파랑 3성/보라 4성/금색 5성)으로 등급 암시 → 결과 → 5성 첫 획득 장면 */
export async function playResults(app: App, host: HTMLElement, res: PullResult[]) {
  const best = Math.max(...res.map((r) => r.rarity));
  const color = best === 5 ? '#ffd166' : best === 4 ? '#b07cff' : '#4fa3ff';
  let skip = false;
  const anim = h('div', { class: 'dive-anim' }, h('div', { class: 'tunnel' }), h('div', { class: 'signal', style: `--sc:${color}` }));
  const skipBtn = button('건너뛰기', () => (skip = true), 'ghost skip');
  anim.append(skipBtn);
  host.append(anim);
  sfx('dive');
  for (let t = 0; t < 1500 && !skip; t += 50) await sleep(50);
  sfx(best === 5 ? 'dive5' : best === 4 ? 'dive4' : 'dive3');
  anim.remove();

  // 5성: 처음 얻을 때는 항상 전신 + 이름 + 한 줄 대사
  for (const r of res.filter((x) => x.rarity === 5 && x.kind === 'char')) {
    const first = !app.save.seenDive.includes(r.id);
    if (!first && skip) continue;
    if (first) app.save.seenDive.push(r.id);
    const def = DATA.characters[r.id];
    await new Promise<void>((done) => {
      const show = h('div', { class: 'five-show', style: `--pc:${def.look.color}` }, h('div', { class: 'fig', text: def.name.slice(0, 1) }), h('div', { class: 'nm', text: def.name }), h('div', { class: 'muted', style: 'font-size:18px', text: `「${def.lines.dive}」` }), h('div', { class: 'muted', text: '눌러서 계속' }));
      onPress(show, () => (show.remove(), done()));
      host.append(show);
    });
  }
  app.persist();

  await new Promise<void>((done) => {
    const grid = h('div', { class: 'res-grid' });
    res.forEach((r, i) => {
      const rc = r.rarity === 5 ? '#ffd166' : r.rarity === 4 ? '#b07cff' : '#4fa3ff';
      const name = r.kind === 'char' ? DATA.characters[r.id].name : DATA.cartridges[r.id].name;
      const card = h('div', { class: 'res-card', style: `--rc:${rc};animation-delay:${i * 60}ms` });
      if (r.kind === 'char') card.append(portrait(r.id, 56));
      else card.append(cartIcon(r.rarity, DATA.cartridges[r.id].protocol));
      card.append(h('div', { class: `r${r.rarity}`, text: '★'.repeat(r.rarity) }), h('div', { text: name }));
      if (r.char?.isNew || r.cart?.isNew) card.append(h('span', { class: 'tag-new', text: 'NEW' }));
      if (r.char && !r.char.isNew) card.append(h('div', { class: 'muted', style: 'font-size:11px', text: r.char.signal ? `신호 조각 +${r.char.signal}` : `동기화 ${r.char.sync}` }));
      if (r.cart && !r.cart.isNew) card.append(h('div', { class: 'muted', style: 'font-size:11px', text: r.cart.data ? `데이터 +${fmt(r.cart.data)}` : `중첩 ${r.cart.rank}` }));
      grid.append(card);
    });
    const ok = button('확인', () => (box.remove(), done()), 'primary big');
    const box = h('div', { class: 'dive-result' }, h('h2', { text: '다이브 결과' }), grid, h('div', { class: 'muted', text: `신호 조각 +${res.reduce((s, r) => s + r.signal, 0)}` }), ok);
    host.append(box);
  });
}
