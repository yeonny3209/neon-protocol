// 시뮬레이션 루프: 준비(난이도·패치 계열·파티) → 노드 고르기 → 전투·이벤트·상점·휴식 → 패치 → 결과
import type { Battle } from '../../engine/battle/battle';
import { DATA } from '../../engine/data';
import {
  afterBattle, chooseNode, choosePatch, claimLoopWeekly, currentChoices, difficultyOpen, ensureLoopWeek, familyCounts, finishRun, leaveShop, loopSetup, resolveEvent, rest, shopBuy, startRun, type LoopNode, type LoopRun,
} from '../../engine/loop';
import { randomSeed } from '../../engine/rng';
import type { App, Screen } from '../app';
import { button, confirmBox, modal, portrait, rewardList, topBar } from '../common';
import { clear, h } from '../dom';
import { onPress } from '../press';
import { sfx } from '../audio';
import { battleHostScreen } from './battlehost';
import { pickTeam } from './deep';

const NODE_INFO: Record<string, { name: string; ic: string; desc: string }> = {
  battle: { name: '전투', ic: '⚔', desc: '이기면 패치 3개 중 1개' },
  elite: { name: '정예 전투', ic: '☠', desc: '강한 적, 코인을 더 준다' },
  event: { name: '이벤트', ic: '?', desc: '동료의 신호가 기다린다' },
  shop: { name: '상점', ic: '¤', desc: '코인으로 패치·회복' },
  rest: { name: '휴식', ic: '☾', desc: '체력 회복, 쓰러진 동료도 일어난다' },
  boss: { name: '구역 보스', ic: '♛', desc: '이기면 다음 구역으로' },
};

let pickFamily = 'firewall';
let pickDiff = 1;

export function loopScreen(app: App): Screen {
  ensureLoopWeek(app.save);
  const run = app.save.loop.run as LoopRun | null;
  const el = h('div', { class: 'scr' }, topBar(app, '시뮬레이션 루프', { currencies: ['shard', 'credit'] }));
  const body = h('div', { class: 'scr-body' });
  el.append(body);
  if (run) drawRun(app, run, body);
  else drawSetup(app, body);
  return { el };
}

function drawSetup(app: App, body: HTMLElement) {
  const save = app.save;
  const L = DATA.balance.loop;
  const week = h('div', { class: 'section panel' }, h('h3', { text: '이번 주 루프 점수' }), h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, (save.loop.score / L.weeklyScoreTarget) * 100)}%` })), h('div', { class: 'muted', text: `${save.loop.score} / ${L.weeklyScoreTarget} — 목표를 채우면 데이터 샤드 ${L.weeklyShards}개 (한 번 완주하면 거의 채워져)` }));
  if (!save.loop.weeklyClaimed && save.loop.score >= L.weeklyScoreTarget) {
    week.append(button('주간 보상 받기', () => {
      const g = claimLoopWeekly(save);
      if (g) {
        sfx('reward');
        app.persist();
        app.toast(`데이터 샤드 +${g.items.shard}`);
        app.refresh();
      }
    }, 'primary'));
  }
  body.append(week);

  const diff = h('div', { class: 'section panel' }, h('h3', { text: '난이도' }));
  const drow = h('div', { class: 'row' });
  for (let d = 1; d <= 5; d++) {
    const open = difficultyOpen(save, d);
    const b = button(`${d}단계${save.loop.firstClear.includes(d) ? ' ✓' : ''}`, () => {
      if (!open) return app.toast(`러너 등급 ${L.difficultyRank[d - 1]} 이상, 앞 단계 완주가 필요해`);
      pickDiff = d;
      app.refresh();
    }, pickDiff === d ? 'cyan' : '');
    if (!open) b.style.opacity = '0.4';
    drow.append(b);
  }
  diff.append(drow, h('div', { class: 'muted', style: 'font-size:13px', text: '1단계는 스토리 난이도 수준, 5단계는 동기화가 있어야 편한 수준이야. 단계마다 처음 완주하면 다이브 키와 보스 코어를 줘.' }));
  if (!difficultyOpen(save, pickDiff)) pickDiff = 1;
  body.append(diff);

  const fam = h('div', { class: 'section panel' }, h('h3', { text: '패치 계열' }));
  const grid = h('div', { class: 'node-grid' });
  for (const f of Object.values(DATA.families)) {
    const n = h('div', { class: `node big${pickFamily === f.id ? ' on' : ''}` }, h('b', { text: f.name }), f.theme, h('div', { class: 'muted', text: `어울리는 파티: ${f.fit}` }));
    onPress(n, () => ((pickFamily = f.id), app.refresh()), { tip: () => `3개: ${f.set3.desc}\n6개: ${f.set6.desc}` });
    grid.append(n);
  }
  fam.append(grid, h('div', { class: 'muted', style: 'font-size:13px', text: '고른 계열의 패치가 더 자주 나와. 같은 계열 3개·6개를 모으면 세트 효과가 켜져.' }));
  body.append(fam);

  const party = save.party.filter((id) => save.chars[id]);
  const prow = h('div', { class: 'row' }, ...party.map((id) => portrait(id, 44)), button('파티 바꾸기', () => pickTeam(app, '루프 파티', save.party, [], (ids) => ((save.party = ids), app.persist(), app.refresh()))));
  body.append(h('div', { class: 'section panel' }, h('h3', { text: '파티' }), prow, h('div', { class: 'muted', style: 'font-size:13px', text: '체력은 루프가 끝날 때까지 이어져. 휴식 노드에서 회복해.' })));
  body.append(button('루프 시작', () => {
    if (!party.length) return app.toast('파티를 정해 줘');
    startRun(save, pickDiff, pickFamily, party, randomSeed());
    app.persist();
    sfx('confirm');
    app.refresh();
  }, 'primary big'));
}

function drawRun(app: App, run: LoopRun, body: HTMLElement) {
  const save = app.save;
  if (run.result) return endModal(app, run);
  const zoneLen = run.map[run.zone].length;
  const head = h('div', { class: 'section panel' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { text: `구역 ${run.zone + 1} / 3 · ${run.step + 1}번째 노드 / ${zoneLen}` }), h('span', { text: `코인 ${run.coins} · 점수 ${run.score}` })));
  const hp = h('div', { class: 'row' });
  for (const id of run.party) {
    const v = run.hp[id] ?? 0;
    hp.append(h('div', { class: 'loop-hp' }, portrait(id, 40), h('div', { class: 'bar' }, h('i', { style: `width:${v * 100}%` })), h('small', { text: v > 0 ? `${Math.round(v * 100)}%` : '쓰러짐' })));
  }
  head.append(hp);
  const counts = familyCounts(run);
  const pat = h('div', { class: 'row', style: 'gap:4px' });
  for (const id of run.patches) {
    const p = DATA.patches[id];
    const chip = h('span', { class: 'st', text: p.name });
    onPress(chip, () => undefined, { tip: () => `${p.name} (${DATA.families[p.family]?.name ?? '공용'})\n${p.desc}` });
    pat.append(chip);
  }
  head.append(h('div', { class: 'muted', style: 'font-size:13px', text: `패치 ${run.patches.length}개 · ${Object.entries(counts).map(([f, n]) => `${DATA.families[f]?.name ?? '공용'} ${n}${n >= 6 ? ' (세트6)' : n >= 3 ? ' (세트3)' : ''}`).join(' · ')}` }), pat);
  body.append(head);

  const choices = h('div', { class: 'node-grid' });
  currentChoices(run).forEach((node, i) => {
    const info = NODE_INFO[node.type];
    const card = h('div', { class: `node big loop-node t-${node.type}` }, h('b', { text: `${info.ic} ${info.name}` }), info.desc, node.enemies ? h('div', { class: 'muted', text: [...new Set(node.enemies)].map((e) => DATA.enemies[e].name).join(', ') }) : null);
    onPress(card, () => {
      sfx('select');
      const p = chooseNode(save, run, i);
      app.persist();
      handlePending(app, run, p.kind === 'battle' ? p.node : undefined);
    });
    choices.append(card);
  });
  body.append(h('div', { class: 'muted', text: '다음으로 갈 곳을 골라.' }), choices);
  body.append(button('루프 포기하기', () => confirmBox('포기할까?', '지금까지의 점수로 보상을 받고 끝나.', '포기', () => {
    run.result = 'fail';
    app.persist();
    app.refresh();
  }), 'ghost'));
  if (run.pending) setTimeout(() => handlePending(app, run, run.pending?.kind === 'battle' ? run.pending.node : undefined), 30);
}

function handlePending(app: App, run: LoopRun, node?: LoopNode) {
  const save = app.save;
  const p = run.pending;
  if (!p) return app.refresh();
  if (p.kind === 'battle' && node) {
    const lv = DATA.balance.loop.difficultyLevel[run.difficulty - 1];
    app.go((a) =>
      battleHostScreen(a, {
        title: `루프 ${NODE_INFO[node.type].name}`,
        boss: node.type === 'boss',
        bgm: node.type === 'boss' ? 'boss2' : 'battle2',
        makeSetup: () => loopSetup(a.save, run, node, randomSeed()),
        onWin: (b: Battle) => {
          afterBattle(a.save, run, b);
          a.persist();
          a.back();
        },
        onLose: (b: Battle) => {
          afterBattle(a.save, run, b);
          a.persist();
          a.back();
        },
        onQuit: () => a.back(),
      }),
    );
    void lv;
    return;
  }
  if (p.kind === 'patch') {
    const m = modal([h('h2', { text: '패치 고르기' }), h('div', { class: 'muted', text: '하나를 골라. 같은 계열을 모으면 세트 효과가 켜져.' })], { noClose: true, wide: true });
    const grid = h('div', { class: 'node-grid' });
    for (const id of p.options) {
      const pt = DATA.patches[id];
      const fam = DATA.families[pt.family];
      const n = h('div', { class: `node big${pt.family === run.family ? ' on' : ''}` }, h('b', { text: pt.name }), pt.desc, h('div', { class: 'muted', text: fam ? `${fam.name} (${(familyCounts(run)[pt.family] ?? 0) + 1}개째)` : '공용' }));
      onPress(n, () => {
        choosePatch(save, run, id);
        sfx('reward');
        app.persist();
        m.close();
        app.refresh();
      });
      grid.append(n);
    }
    m.el.append(grid);
    return;
  }
  if (p.kind === 'event') {
    const ev = DATA.loopEvents[p.id];
    const m = modal([h('h2', { text: ev.title }), h('div', { text: ev.text })], { noClose: true });
    ev.options.forEach((o, i) => {
      m.el.append(button(o.text, () => {
        const res = resolveEvent(save, run, i);
        app.persist();
        clear(m.el);
        m.el.append(h('h2', { text: ev.title }), h('div', { text: res }), button('계속', () => (m.close(), app.refresh()), 'primary big'));
      }, i === 0 ? 'primary' : ''));
    });
    return;
  }
  if (p.kind === 'shop') {
    const m = modal([h('h2', { text: '상점' })], { noClose: true, wide: true });
    const draw = () => {
      clear(m.el);
      m.el.append(h('h2', { text: '상점' }), h('div', { class: 'muted', text: `코인 ${run.coins}` }));
      if (run.pending?.kind !== 'shop') return;
      run.pending.items.forEach((it, i) => {
        const label = it.kind === 'patch' ? `${DATA.patches[it.id!].name} — ${DATA.patches[it.id!].desc}` : it.kind === 'heal' ? '수리 키트: 모두 체력 30% 회복(쓰러진 동료도)' : '패치 목록 새로고침';
        const b = button(`${label} (${it.price}코인)${it.sold ? ' · 판매 완료' : ''}`, () => {
          if (!shopBuy(save, run, i)) return app.toast('코인이 부족해');
          sfx('reward');
          app.persist();
          draw();
        });
        b.disabled = !!it.sold || run.coins < it.price;
        m.el.append(b);
      });
      m.el.append(button('상점 나가기', () => (leaveShop(run), app.persist(), m.close(), app.refresh()), 'primary big'));
    };
    draw();
    return;
  }
  if (p.kind === 'rest') {
    const m = modal([h('h2', { text: '휴식' }), h('div', { text: `잠시 숨을 고른다. 모두 체력 ${Math.round(DATA.balance.loop.restHealPct * 100)}% 회복, 쓰러진 동료도 일어난다.` })], { noClose: true });
    m.el.append(button('쉬기', () => (rest(run), sfx('heal'), app.persist(), m.close(), app.refresh()), 'primary big'));
  }
}

function endModal(app: App, run: LoopRun) {
  const save = app.save;
  const end = finishRun(save, run);
  app.persist();
  sfx(run.result === 'clear' ? 'win' : 'lose');
  const m = modal([h('div', { class: `headline ${run.result === 'clear' ? 'win' : 'lose'}`, text: run.result === 'clear' ? '루프 완주!' : '루프 종료' }), h('div', { text: `루프 점수 ${end.score}` }), rewardList(app, end.got.items)], { noClose: true });
  m.el.classList.add('result');
  if (end.firstClear) m.el.append(h('div', { class: 'r5', text: `난이도 ${run.difficulty} 최초 완주 보상!` }));
  if (end.weeklyReady) m.el.append(h('div', { class: 'r4', text: '주간 점수 목표 달성! 루프 화면에서 보상을 받아.' }));
  m.el.append(button('확인', () => (m.close(), app.refresh()), 'primary big'));
}
