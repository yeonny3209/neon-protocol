// 캐릭터 상세와 성장. 탭 4개: 레벨·돌파 / 카트리지 / 회로도 / 동기화
import { DATA } from '../../engine/data';
import type { SkillDef } from '../../engine/defs';
import {
  allyFromSave, applyRecommended, ascend, batchGrow, canAscend, canSkillUp, canUnlockNode, cartAscend, cartAscensionCost, cartDef, cartExpToNext, cartLevelUp, equip, equippedBy,
  expToNext, growable, levelCap, levelUp, nodeCost, protocolOf, skillCap, skillUp, totalCostToLevel, unlockNode, type SkillSlot,
} from '../../engine/growth';
import { cartridgeStats, kitFor } from '../../engine/loadout';
import { count, missing } from '../../engine/state';
import type { App, Screen } from '../app';
import { button, elementChip, modal, portrait, protocolTag, rewardList, stars, tabs, topBar } from '../common';
import { clear, fmt, h } from '../dom';
import { ELEMENT_INFO, FACTION_NAME, KIND_NAME, PROTOCOL_INFO } from '../labels';
import { onPress } from '../press';
import { sfx } from '../audio';

const TAB_NAMES = ['레벨·돌파', '카트리지', '회로도', '동기화'];
let lastTab = 0;

export function charScreen(app: App, charId: string): Screen {
  const def = DATA.characters[charId];
  const own = app.save.chars[charId];
  const side = h('div', { class: 'char-side panel' });
  const main = h('div', { class: 'char-main' });
  const body = h('div', { class: 'char-detail' }, side, main);
  const el = h('div', { class: 'scr' }, topBar(app, def.name), body);

  const done = (msg?: string) => {
    app.persist();
    if (msg) app.toast(msg);
    sfx('levelup');
    redraw();
  };

  const redraw = () => {
    drawSide();
    clear(main);
    if (!own) {
      main.append(h('div', { class: 'section panel' }, h('h3', { text: '아직 연결되지 않은 신호' }), h('div', { class: 'muted', text: '다이브에서 만나면 동료가 된다. 아래는 이 캐릭터의 스킬이야.' })), skillInfoList());
      return;
    }
    const g = growable(app.save, charId);
    main.append(tabs(TAB_NAMES, (i, b) => ((lastTab = i), [levelTab, cartTab, circuitTab, syncTab][i](b)), lastTab, [g.level || g.ascend, g.cart, g.skill || g.node, false]));
  };

  const drawSide = () => {
    clear(side);
    const kit = kitFor(def, charId === 'runner' ? app.save.runnerForm : undefined);
    side.append(portrait(charId, 120, kit.element));
    side.append(h('div', { style: 'text-align:center' }, h('div', { class: 'big-name', text: def.name }), stars(def.rarity)));
    side.append(h('div', { class: 'row', style: 'justify-content:center' }, elementChip(kit.element), h('span', { text: ELEMENT_INFO[kit.element].name }), protocolTag(kit.protocol)));
    side.append(h('div', { class: 'muted', style: 'font-size:13px;text-align:center', text: `${FACTION_NAME[def.faction] ?? ''} · ${def.concept}` }));
    if (own) {
      const a = allyFromSave(app.save, charId);
      const s = a.stats;
      const pct = (k: string) => a.passives.reduce((sum, p) => sum + ((p.mods as Record<string, number> | undefined)?.[k] ?? 0), 0);
      side.append(
        h(
          'div',
          { class: 'stat-grid' },
          h('div', null, h('span', { text: '레벨' }), h('span', { text: `${own.level} / ${levelCap(own.asc)}` })),
          h('div', null, h('span', { text: '돌파' }), h('span', { text: `${own.asc}단계` })),
          h('div', null, h('span', { text: '체력' }), h('span', { text: fmt(s.hp * (1 + pct('hpPct'))) })),
          h('div', null, h('span', { text: '공격력' }), h('span', { text: fmt(s.atk * (1 + pct('atkPct'))) })),
          h('div', null, h('span', { text: '방어력' }), h('span', { text: fmt(s.def * (1 + pct('defPct'))) })),
          h('div', null, h('span', { text: '속도' }), h('span', { text: fmt(s.spd + pct('spdFlat')) })),
          h('div', null, h('span', { text: '치명타' }), h('span', { text: `${Math.round((s.critRate + pct('critRate')) * 100)}%` })),
          h('div', null, h('span', { text: '치명 피해' }), h('span', { text: `${Math.round((s.critDmg + pct('critDmg')) * 100)}%` })),
        ),
      );
    }
    if (charId === 'runner') {
      const forms = h('div', { class: 'row', style: 'justify-content:center' });
      for (const f of def.forms ?? []) {
        const unlocked = app.save.runnerForms.includes(f.id);
        const b = button(f.name, () => {
          if (!unlocked) return app.toast('챕터를 깨면 열려');
          app.save.runnerForm = f.id;
          done(`${f.name}로 전환`);
        }, app.save.runnerForm === f.id ? 'cyan' : unlocked ? '' : 'ghost', () => `${ELEMENT_INFO[f.element].name} · ${PROTOCOL_INFO[f.protocol].name}${unlocked ? '' : '\n아직 잠김'}`);
        if (!unlocked) b.style.opacity = '0.4';
        forms.append(b);
      }
      side.append(h('div', { class: 'muted', style: 'font-size:13px', text: '형태 전환' }), forms);
    }
    const prof = button('프로필', () => modal([h('h2', { text: def.name }), h('div', { text: def.profile }), h('div', { class: 'muted', text: `외형: ${def.look.hair} · 눈 ${def.look.eyes} · ${def.look.accents.join(', ')}` })]), 'ghost');
    side.append(prof);
    if (own) {
      const isRep = app.save.rep === charId;
      side.append(button(isRep ? '둥지 대표 ✓' : '둥지 대표로', () => {
        app.save.rep = charId;
        done(`${def.name}가 둥지 대표가 됐어`);
      }, isRep ? 'cyan' : 'ghost'));
    }
  };

  // ───── 레벨·돌파
  const levelTab = (b: HTMLElement) => {
    const c = app.save.chars[charId];
    const cap = levelCap(c.asc);
    const next = expToNext(c.level);
    const box = h('div', { class: 'section panel' });
    box.append(h('div', { class: 'lv-big' }, `Lv ${c.level}`, h('small', { text: ` / ${cap}` })));
    box.append(h('div', { class: 'bar exp-bar' }, h('i', { style: `width:${c.level >= cap ? 100 : (c.exp / next) * 100}%` })));
    box.append(h('div', { class: 'muted', style: 'font-size:13px', text: c.level >= cap ? '돌파해야 더 올라가요' : `다음 레벨까지 ${fmt(next - c.exp)}` }));
    box.append(h('div', { class: 'row' }, ...['pack_s', 'pack_m', 'pack_l', 'credit'].map((id) => rewardList(app, { [id]: count(app.save, id) }))));
    if (c.level < cap) {
      const row = h('div', { class: 'row' });
      for (const [label, target] of [['+1', c.level + 1], ['+5', c.level + 5], [`${cap}까지`, cap]] as const) {
        row.append(
          button(String(label), () => {
            const r = levelUp(app.save, charId, Number(target));
            if (r.to > r.from) done(`Lv ${r.from} → ${r.to}`);
            else showMissing(r.missing);
          }, label.toString().includes('까지') ? 'primary' : ''),
        );
      }
      box.append(row);
    } else {
      const chk = canAscend(app.save, charId);
      if (chk.ok || chk.reason !== 'max') {
        box.append(h('h3', { text: `${c.asc + 1}차 돌파` }), h('div', { class: 'muted', text: `최대 레벨 ${levelCap(c.asc + 1)}, 회로도 ${c.asc + 1}단 열림, 기본 스탯이 크게 오른다.` }));
        if (chk.ok || chk.cost) box.append(rewardList(app, chk.ok ? chk.cost : chk.cost!, { have: true }));
        if (!chk.ok && chk.reason === 'rank') box.append(h('div', { class: 'muted', text: `러너 등급 ${chk.need} 이상 필요 (지금 ${app.save.rank.level})` }));
        box.append(button('돌파', () => (ascend(app.save, charId) ? done('돌파 성공!') : !chk.ok && chk.missing ? showMissing(chk.missing) : app.toast('아직 돌파할 수 없어')), 'primary big'));
      } else box.append(h('div', { class: 'muted', text: '최대 돌파 완료' }));
    }
    const batch = h('div', { class: 'section panel' }, h('h3', { text: '일괄 성장' }), h('div', { class: 'muted', style: 'font-size:13px', text: '목표 레벨을 고르면 필요한 재료를 계산해서 레벨업과 돌파를 한 번에 한다.' }));
    const targets = [20, 30, 40, 50, 60].filter((t) => t > c.level);
    let target = targets[0] ?? 60;
    const costBox = h('div');
    const seg = h('div', { class: 'seg' });
    const drawCost = () => {
      clear(seg);
      for (const t of targets) {
        const sb = h('button', { class: t === target ? 'on' : '', text: `Lv${t}` });
        onPress(sb, () => ((target = t), drawCost()));
        seg.append(sb);
      }
      clear(costBox);
      const total = totalCostToLevel(app.save, charId, target);
      const exp = total.exp ?? 0;
      delete total.exp;
      costBox.append(h('div', { class: 'muted', style: 'font-size:13px', text: `경험치 ${fmt(exp)} (데이터 팩으로 자동 계산)` }), rewardList(app, total, { have: true }));
    };
    drawCost();
    if (targets.length) {
      batch.append(seg, costBox, button('일괄 성장', () => {
        const r = batchGrow(app.save, charId, target);
        if (r.to > r.from || r.ascended) done(`Lv ${r.from} → ${r.to}${r.ascended ? ` (돌파 ${r.ascended}번)` : ''}`);
        if (r.to < target) {
          if (r.blocked === 'rank') app.toast(`러너 등급이 더 필요해 (돌파 조건)`);
          else showMissing(r.missing);
        }
      }, 'primary big'));
      b.append(box, batch);
    } else b.append(box);
  };

  const showMissing = (lack: Record<string, number>) => {
    if (!Object.keys(lack).length) return app.toast('재료가 부족해');
    const m = modal([h('h2', { text: '재료가 부족해' }), h('div', { class: 'muted', text: '아이콘을 누르면 얻는 곳과 이동 버튼이 나와.' }), rewardList(app, lack)]);
    void m;
  };

  // ───── 카트리지
  const cartTab = (b: HTMLElement) => {
    const c = app.save.chars[charId];
    const proto = protocolOf(app.save, charId);
    const cur = c.cart !== null ? app.save.carts.find((x) => x.uid === c.cart) : undefined;
    const box = h('div', { class: 'section panel' });
    if (cur) {
      const d = cartDef(cur);
      const st = cartridgeStats(d, cur.level, cur.asc);
      const match = d.protocol === proto;
      box.append(
        h('div', { class: 'row' }, cartIcon(d.rarity, d.protocol), h('div', null, h('h3', { text: `${d.name} ${'★'.repeat(d.rarity)}` }), h('div', { class: 'muted', text: `Lv${cur.level}/${levelCap(cur.asc)} · 중첩 ${cur.rank} · ${PROTOCOL_INFO[d.protocol].name}` }))),
        h('div', { class: 'muted', style: 'font-size:14px', text: `체력 +${fmt(st.hp)} · 공격력 +${fmt(st.atk)} · 방어력 +${fmt(st.def)}` }),
        h('div', { style: `font-size:14px;${match ? '' : 'opacity:.45'}`, text: `「${d.effect.name}」 ${d.effect.desc}${match ? '' : ' (프로토콜이 달라서 꺼져 있어)'}` }),
      );
      const row = h('div', { class: 'row' });
      const cap = levelCap(cur.asc);
      if (cur.level < cap) {
        const need = cartExpToNext(cur.level, d.rarity);
        row.append(button(`강화 (데이터 ${fmt(count(app.save, 'cart_data'))})`, () => {
          const r = cartLevelUp(app.save, cur.uid, cap);
          if (r.to > r.from || r.used.cart_data) done(`카트리지 Lv ${r.to}`);
          else showMissing({ cart_data: need });
        }, 'primary'));
      } else {
        const cost = cartAscensionCost(cur);
        if (cost) {
          row.append(rewardList(app, cost, { have: true, small: true }), button('카트리지 돌파', () => (cartAscend(app.save, cur.uid) ? done('카트리지 돌파!') : showMissing(missing(app.save, cost))), 'primary'));
        }
      }
      row.append(button('해제', () => (equip(app.save, charId, null), done())));
      box.append(row);
    } else box.append(h('div', { class: 'muted', text: '장착한 카트리지가 없어. 아래에서 골라 줘.' }));
    const list = h('div', { class: 'section panel' }, h('h3', { text: '보유 카트리지' }));
    const carts = [...app.save.carts].sort((x, y) => Number(cartDef(y).protocol === proto) - Number(cartDef(x).protocol === proto) || cartDef(y).rarity - cartDef(x).rarity);
    if (!carts.length) list.append(h('div', { class: 'muted', text: '아직 카트리지가 없어. 챕터 보상과 다이브로 얻을 수 있어.' }));
    for (const x of carts) {
      const d = cartDef(x);
      const who = equippedBy(app.save, x.uid);
      const row = h('div', { class: `cart-card${x.uid === c.cart ? ' sel' : ''}` }, cartIcon(d.rarity, d.protocol), h('div', null, h('div', { text: `${d.name} ${'★'.repeat(d.rarity)}` }), h('div', { class: 'sub', text: `${PROTOCOL_INFO[d.protocol].name}${d.protocol === proto ? ' · 효과 발동' : ''} · Lv${x.level} · 중첩 ${x.rank}${who ? ` · ${DATA.characters[who].name} 장착 중` : ''}` })), h('span', { text: x.uid === c.cart ? '장착 중' : '장착' }));
      onPress(row, () => {
        if (x.uid === c.cart) return;
        equip(app.save, charId, x.uid);
        done(`${d.name} 장착`);
      }, { tip: () => `「${d.effect.name}」 ${d.effect.desc}` });
      list.append(row);
    }
    b.append(box, list);
  };

  // ───── 회로도
  const circuitTab = (b: HTMLElement) => {
    const c = app.save.chars[charId];
    const kit = kitFor(def, charId === 'runner' ? app.save.runnerForm : undefined);
    const box = h('div', { class: 'section panel' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { text: '스킬 레벨' }), button('추천 순서로 일괄 해금', () => {
      const n = applyRecommended(app.save, charId);
      if (n) done(`${n}개 해금`);
      else app.toast('지금 열 수 있는 게 없어');
    }, 'primary')));
    const slots: [SkillSlot, SkillDef | { name: string; desc: string }][] = [
      ['basic', kit.skills.basic],
      ['skill', kit.skills.skill],
      ['overclock', kit.skills.overclock],
      ['trait', kit.trait],
    ];
    for (const [slot, sk] of slots) {
      const lv = c.skills[slot];
      const cap = skillCap(slot, c.asc);
      const chk = canSkillUp(app.save, charId, slot);
      const row = h('div', { class: 'skill-row' }, h('div', null, h('span', { class: 'muted', style: 'font-size:12px', text: `${KIND_NAME[slot]} ` }), h('span', { class: 'sk-name', text: sk.name })), h('div', { class: 'row' }, h('span', { text: `Lv ${lv}/${cap}` })), h('div', { class: 'sk-desc', text: sk.desc + (lv > 1 ? `  (레벨 보정: 배율 +${(lv - 1) * 10}%)` : '') }));
      if (chk.ok || chk.reason === 'items') {
        const cost = chk.ok ? chk.cost : chk.cost!;
        row.append(h('div', { class: 'row', style: 'grid-column:1/-1' }, rewardList(app, cost, { have: true, small: true }), button('레벨업', () => (skillUp(app.save, charId, slot) ? done(`${sk.name} Lv${lv + 1}`) : showMissing(missing(app.save, cost))), chk.ok ? 'primary' : '')));
        if (chk.ok) row.append(h('span', { class: 'red-dot' }));
      } else if (chk.reason === 'cap') row.append(h('div', { class: 'muted', style: 'grid-column:1/-1;font-size:13px', text: '돌파하면 더 올릴 수 있어' }));
      box.append(row);
    }
    const nodes = h('div', { class: 'section panel' }, h('h3', { text: '패시브 노드' }));
    const grid = h('div', { class: 'node-grid' });
    const nodeBtn = (type: 'big' | 'small', i: number, title: string, desc: string) => {
      const on = (type === 'big' ? c.big : c.small).includes(i);
      const chk = canUnlockNode(app.save, charId, type, i);
      const { cost, asc } = nodeCost(app.save, charId, type, i);
      const n = h('div', { class: `node ${type}${on ? ' on' : ''}${!on && c.asc < asc ? ' lock' : ''}` }, h('b', { text: title }), desc, !on && c.asc < asc ? h('div', { class: 'muted', text: `${asc}차 돌파 후` }) : null);
      if (chk.ok) n.append(h('span', { class: 'red-dot' }));
      onPress(n, () => {
        if (on) return;
        if (unlockNode(app.save, charId, type, i)) done(`${title} 해금`);
        else if (!chk.ok && chk.reason === 'asc') app.toast(`${asc}차 돌파가 필요해`);
        else {
          const m = modal([h('h2', { text: title }), h('div', { text: desc }), rewardList(app, cost, { have: true })]);
          m.el.append(button('해금', () => (m.close(), unlockNode(app.save, charId, type, i) ? done(`${title} 해금`) : showMissing(missing(app.save, cost))), 'primary big'));
        }
      }, { tip: () => desc });
      grid.append(n);
    };
    def.circuit.big.forEach((p, i) => nodeBtn('big', i, `★ ${p.name}`, p.desc));
    def.circuit.small.forEach((p, i) => nodeBtn('small', i, `노드 ${i + 1}`, p.desc));
    nodes.append(grid);
    b.append(box, nodes);
  };

  // ───── 동기화
  const syncTab = (b: HTMLElement) => {
    const c = app.save.chars[charId];
    const box = h('div', { class: 'section panel' });
    if (!def.sync) {
      box.append(h('h3', { text: '동기화 없음' }), h('div', { class: 'muted', text: '러너는 다이브에 나오지 않아서 동기화가 없어. 대신 챕터를 깰 때마다 새 형태가 열려.' }));
      return b.append(box);
    }
    box.append(h('h3', { text: `동기화 ${c.sync} / 6` }), h('div', { class: 'muted', style: 'font-size:13px', text: '다이브에서 같은 캐릭터를 다시 만나면 한 단계씩 오른다. 6단계를 넘긴 중복은 신호 조각으로 바뀐다.' }));
    const list = h('div', { class: 'sync-list' });
    for (const k of ['1', '2', '3', '4', '5', '6'] as const) {
      const s = def.sync[k];
      list.append(h('div', { class: `sync-item${c.sync >= Number(k) ? ' on' : ''}` }, h('b', { text: `${k}단계 「${s.name}」` }), h('div', { class: 'muted', style: 'font-size:14px', text: s.desc })));
    }
    box.append(list);
    b.append(box);
  };

  const skillInfoList = () => {
    const kit = kitFor(def);
    const box = h('div', { class: 'section panel' });
    for (const [k, sk] of [['basic', kit.skills.basic], ['skill', kit.skills.skill], ['overclock', kit.skills.overclock], ['trait', kit.trait]] as const) {
      box.append(h('div', { class: 'skill-row' }, h('div', null, h('span', { class: 'muted', style: 'font-size:12px', text: `${KIND_NAME[k]} ` }), h('span', { class: 'sk-name', text: sk.name })), h('div'), h('div', { class: 'sk-desc', text: sk.desc })));
    }
    return box;
  };

  redraw();
  return { el };
}

export function cartIcon(rarity: number, protocol: keyof typeof PROTOCOL_INFO): HTMLElement {
  const color = rarity === 5 ? '#ffd166' : rarity === 4 ? '#b07cff' : '#4fa3ff';
  return h('div', { class: 'cart-ic', style: `--cc:${color}`, text: PROTOCOL_INFO[protocol].glyph });
}
