// 둥지(메인 화면). 대표 캐릭터를 세워 두고, 모든 화면은 여기서 두 번 안에 닿는다.
import { DATA } from '../../engine/data';
import { growable } from '../../engine/growth';
import { currentBanners } from '../../engine/gacha';
import { count, track } from '../../engine/state';
import { nextStageId } from './stage';
import type { App, Screen } from '../app';
import { button, dot, modal, portrait, topBar } from '../common';
import { h } from '../dom';
import { onPress } from '../press';
import { sfx } from '../audio';
import { charsScreen } from './chars';
import { diveScreen } from './dive';
import { mapScreen } from './map';
import { settingsModal } from './settings';
import { archiveScreen } from './archive';
import { dailyUnlocked, ensureDaily, isDone, missionsClaimable } from '../../engine/missions';
import { achClaimable, codexClaimable } from '../../engine/achievements';
import { deepUnlocked } from '../../engine/deep';
import { loopUnlocked } from '../../engine/loop';
import { missionsScreen } from './missions';
import { materialScreen } from './materials';
import { codexScreen } from './codex';
import { deepScreen } from './deep';
import { loopScreen } from './loop';

export function diveUnlocked(app: App): boolean {
  return app.save.story.chapters.includes('prologue');
}

export function nestScreen(app: App): Screen {
  const save = app.save;
  save.story.hp = {}; // 둥지에 돌아오면 모두 회복
  app.bgm('nest');
  const repId = save.chars[save.rep] ? save.rep : 'runner';
  const def = DATA.characters[repId];
  const speech = h('div', { class: 'speech', text: '…어서 와.' });
  const fig = h('div', { class: 'rep-figure', style: `--pc:${def.look.color}` });
  if (def.art?.full) fig.append(h('img', { src: def.art.full, alt: def.name }));
  else fig.textContent = def.name.slice(0, 1);
  onPress(fig, () => {
    const l = def.lines.nest;
    speech.textContent = l[Math.floor(Math.random() * l.length)];
    save.repTouches++;
    track(save, 'repTouch');
    sfx('select');
  });
  const stage = h('div', { class: 'stage-rep' }, speech, fig, h('div', { class: 'muted', text: `둥지 대표: ${def.name} (캐릭터 화면에서 바꿀 수 있어)` }));

  const first = !Object.keys(save.story.cleared).length;
  const nextId = save.story.next && DATA.stages[save.story.next] ? save.story.next : DATA.stageOrder.find((id) => !save.story.cleared[id]);
  const nextSt = nextId ? DATA.stages[nextId] : undefined;
  void nextStageId;
  const menu = h('div', { class: 'nest-menu' });
  const mb = (ic: string, label: string, fn: () => void, extra: { main?: boolean; locked?: boolean; dot?: boolean; sub?: string } = {}) => {
    const b = h('div', { class: `menu-btn${extra.main ? ' main' : ''}${extra.locked ? ' locked' : ''}` }, h('span', { class: 'ic', text: ic }), h('div', null, label, extra.sub ? h('small', { text: extra.sub }) : null), extra.dot ? h('span', { class: 'red-dot' }) : null);
    onPress(b, () => {
      sfx('tap');
      fn();
    });
    menu.append(b);
  };
  mb('▶', first ? '이야기 시작' : '이야기 이어하기', () => app.go(mapScreen), { main: true, sub: nextSt ? `${DATA.chapters[nextSt.chapter].title} · ${nextSt.name}` : '모든 스테이지를 깼어' });
  const anyGrow = Object.keys(save.chars).some((id) => growable(save, id).any);
  mb('◈', '캐릭터', () => app.go(charsScreen), { dot: anyGrow });
  const keys = count(save, 'key');
  mb('✦', '다이브', () => (diveUnlocked(app) ? app.go(diveScreen) : app.toast('프롤로그를 클리어하면 열려')), { locked: !diveUnlocked(app), dot: diveUnlocked(app) && keys > 0 });
  ensureDaily(save);
  const daily = dailyUnlocked(save);
  mb('☑', '데일리 루틴', () => (daily ? app.go(missionsScreen) : app.toast('1장을 클리어하면 열려')), { locked: !daily, dot: missionsClaimable(save) });
  mb('⛏', '재료 스테이지', () => app.go((a) => materialScreen(a)));
  const codexOpen = save.story.chapters.includes('prologue');
  mb('✎', '도감·업적', () => (codexOpen ? app.go(codexScreen) : app.toast('프롤로그를 클리어하면 열려')), { locked: !codexOpen, dot: codexOpen && (achClaimable(save).length > 0 || codexClaimable(save).length > 0) });
  mb('▼', '딥 서버', () => (deepUnlocked(save) ? app.go(deepScreen) : app.toast('3장을 클리어하면 열려')), { locked: !deepUnlocked(save) });
  mb('∞', '시뮬레이션 루프', () => (loopUnlocked(save) ? app.go(loopScreen) : app.toast('4장을 클리어하면 열려')), { locked: !loopUnlocked(save), dot: loopUnlocked(save) && !!save.loop.run });
  mb('▣', '기록 보관소', () => app.go(archiveScreen));
  mb('⚙', '설정', () => settingsModal(app));
  mb('▤', '도움말', () => (track(save, 'helpOpen'), help()));

  const todo = h('div', { class: 'todo panel' }, h('b', { text: '오늘 할 일' }));
  const items: string[] = [];
  if (nextSt) items.push(`이야기: ${nextSt.name}`);
  if (anyGrow) items.push('캐릭터 성장 가능 (빨간 점)');
  if (diveUnlocked(app) && keys > 0) items.push(`다이브 키 ${keys}개`);
  if (diveUnlocked(app)) {
    const b = currentBanners(save).find((x) => x.kind === 'character');
    if (b?.pickup5) items.push(`이번 배너: ${DATA.characters[b.pickup5]?.name ?? ''}`);
  }
  if (daily) {
    const left = save.daily.list.filter((m) => !isDone(m)).length;
    items.push(left ? `데일리 루틴 ${left}개 남음` : save.daily.allClaimed ? '데일리 루틴 완료' : '데일리 루틴 보상을 받아!');
    if (save.daily.backlog) items.push(`밀린 루틴 ${save.daily.backlog}일치`);
  }
  if (save.loop.run) items.push('진행 중인 시뮬레이션 루프가 있어');
  if (!items.length) items.push('오늘은 푹 쉬어도 돼');
  items.forEach((t) => todo.append(h('div', { text: `· ${t}` })));
  menu.append(todo);

  const help = () =>
    modal([
      h('h2', { text: '도움말' }),
      h('ul', { class: 'src-list' }, ...[
        '전투: 순서대로 행동해. 일반공격으로 CP를 모으고 전투스킬에 써.',
        '적 머리 위 속성이 약점이야. "약점!" 표시를 누르면 방화벽이 깎이고, 0이 되면 시스템 다운!',
        '카드가 빛나면 눌러서 오버클럭. 누구 차례든 끼어들 수 있어.',
        '지면 전투 직전부터 다시 해. 잃는 건 없어.',
        '길게 누르거나 마우스를 올리면 설명이 나와.',
        '키보드: Q 일반공격, E 전투스킬, 1~4 오버클럭, ←/→ 대상, Space 확인, F 배속, Esc 일시정지',
      ].map((t) => h('li', { text: t }))),
    ]);

  const el = h('div', { class: 'scr' }, topBar(app, '둥지', { back: false, currencies: diveUnlocked(app) ? ['shard', 'key', 'credit'] : ['credit'] }), h('div', { class: 'nest' }, stage, menu));
  void dot;
  void portrait;
  void button;
  return { el, isNest: true };
}
