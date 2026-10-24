// 딥 서버: 층 목록, 서버 환경, 파티 두 개(7층부터), 별 보상
import type { Battle } from '../../engine/battle/battle';
import { DATA } from '../../engine/data';
import { deepEnv, deepPeriodEnd, deepSetup, ensureDeep, floorEnemies, floorOpen, floorStars, needsTwoTeams, noteDeepAttempt, partStars, recordFloor, totalStars } from '../../engine/deep';
import { allyFromSave, power } from '../../engine/growth';
import { randomSeed } from '../../engine/rng';
import type { App, Screen } from '../app';
import { button, elementChip, modal, portrait, rewardList, topBar } from '../common';
import { clear, h } from '../dom';
import { onPress } from '../press';
import { sfx } from '../audio';
import { battleHostScreen } from './battlehost';

/** 4명 고르기. exclude에 있는 캐릭터는 고를 수 없다 */
export function pickTeam(app: App, title: string, current: string[], exclude: string[], onDone: (ids: string[]) => void) {
  let team = current.filter((id) => app.save.chars[id] && !exclude.includes(id)).slice(0, 4);
  const m = modal([h('h2', { text: title })], { wide: true });
  const slots = h('div', { class: 'row' });
  const grid = h('div', { class: 'char-grid' });
  const draw = () => {
    clear(slots);
    clear(grid);
    for (let i = 0; i < 4; i++) slots.append(h('div', { class: 'char-card panel', style: 'min-height:90px;width:96px' }, team[i] ? portrait(team[i], 48) : h('span', { class: 'muted', text: '비었음' }), team[i] ? h('small', { text: DATA.characters[team[i]].name }) : null));
    for (const id of Object.keys(app.save.chars)) {
      const used = exclude.includes(id);
      const on = team.includes(id);
      const c = h('div', { class: `char-card panel${on || used ? ' locked' : ''}` }, portrait(id, 52), h('div', { class: 'nm', text: DATA.characters[id].name }), h('div', { class: 'meta', text: used ? '다른 파티' : `Lv${app.save.chars[id].level} · 전투력 ${power(allyFromSave(app.save, id))}` }));
      onPress(c, () => {
        if (used) return;
        if (on) team = team.filter((x) => x !== id);
        else if (team.length < 4) team.push(id);
        draw();
      });
      grid.append(c);
    }
  };
  draw();
  m.el.append(slots, grid, button('확인', () => {
    if (!team.length) return app.toast('최소 1명은 넣어야 해');
    m.close();
    onDone(team);
  }, 'primary big'));
}

export function deepScreen(app: App): Screen {
  const save = app.save;
  ensureDeep(save);
  const env = deepEnv(new Date());
  const end = deepPeriodEnd(new Date());
  const list = h('div', { class: 'map-nodes' });
  for (const f of [...DATA.deep.floors].reverse()) {
    const stars = floorStars(save, f.floor);
    const open = floorOpen(save, f.floor);
    const node = h('div', { class: `map-node${stars ? ' done' : ''}${open && !stars ? ' current' : ''}${open ? '' : ' lock'}`, style: '--cc:#40e8ff' }, h('b', { text: String(f.floor) }), h('div', { class: 'nm' }, h('div', { text: f.name }), h('small', { text: `Lv${f.level}${needsTwoTeams(f.floor) ? ' · 파티 두 개' : ''} · ${f.rounds}라운드 안에 클리어` })), h('span', { class: 'ns' }, ...[1, 2, 4].map((b) => h('i', { class: stars & b ? 'on' : '', text: '★' }))));
    onPress(node, () => (open ? floorModal(app, f.floor) : app.toast('앞 층을 먼저 깨야 해')));
    list.append(node);
  }
  const next = DATA.balance.deep.starRewards.find((r) => !save.deep.claimed.includes(r.stars));
  const head = h(
    'div',
    { class: 'section panel' },
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h3', { text: `서버 환경: ${env.name}` }), h('span', { class: 'muted', text: `${end.getMonth() + 1}월 ${end.getDate()}일 초기화` })),
    h('div', { class: 'muted', text: env.desc }),
    h('div', { text: `별 ${totalStars(save)} / 36${next ? ` · 다음 보상: 별 ${next.stars}개에 데이터 샤드 ${next.shard}` : ' · 이번 기간 보상을 다 받았어'}` }),
  );
  return { el: h('div', { class: 'scr' }, topBar(app, '딥 서버', { currencies: ['shard'] }), head, h('div', { class: 'scr-body' }, list)) };
}

function floorModal(app: App, floor: number) {
  const save = app.save;
  const f = DATA.deep.floors[floor - 1];
  const two = needsTwoTeams(floor);
  const now = new Date();
  const m = modal([h('h2', { text: `${f.name}` }), h('div', { class: 'muted', text: '별: 클리어 / 아군 전원 생존 / 제한 라운드 안에 클리어. 난이도 설정과 상관없는 고정 난이도야.' })], { wide: true });
  const foes = (part: 'A' | 'B') => {
    const ids = floorEnemies(f, part, now);
    return h('div', { class: 'row' }, h('b', { text: two ? `${part === 'A' ? '전반' : '후반'}` : '적' }), ...ids.map((id) => h('span', { class: 'foe-chip panel', style: `--ecolor:${DATA.enemies[id].color}` }, h('small', { text: DATA.enemies[id].name }), h('div', { class: 'row', style: 'gap:2px' }, ...DATA.enemies[id].weaknesses.map((w) => elementChip(w))))));
  };
  m.el.append(foes('A'));
  if (two) m.el.append(foes('B'));
  const teamRow = h('div', { class: 'row' });
  const drawTeams = () => {
    clear(teamRow);
    const names = (ids: string[]) => ids.map((id) => DATA.characters[id]?.name).filter(Boolean).join(', ') || '비었음';
    teamRow.append(button(`${two ? '전반 파티' : '파티'}: ${names(save.party)}`, () => pickTeam(app, two ? '전반 파티' : '파티', save.party, two ? save.partyB : [], (ids) => ((save.party = ids), app.persist(), drawTeams()))));
    if (two) teamRow.append(button(`후반 파티: ${names(save.partyB)}`, () => pickTeam(app, '후반 파티', save.partyB, save.party, (ids) => ((save.partyB = ids), app.persist(), drawTeams()))));
  };
  drawTeams();
  m.el.append(teamRow, button('도전', () => {
    if (two && !save.partyB.filter((id) => save.chars[id] && !save.party.includes(id)).length) return app.toast('후반 파티를 정해 줘');
    m.close();
    noteDeepAttempt(save);
    runPart(app, floor, 'A', 7);
  }, 'primary big'));
}

function runPart(app: App, floor: number, part: 'A' | 'B', starsSoFar: number) {
  const f = DATA.deep.floors[floor - 1];
  const two = needsTwoTeams(floor);
  const party = part === 'A' ? app.save.party : app.save.partyB.filter((id) => !app.save.party.includes(id));
  app.go(
    (a) =>
      battleHostScreen(a, {
        title: `${f.name}${two ? (part === 'A' ? ' 전반' : ' 후반') : ''}`,
        boss: floor >= 11,
        bgm: floor >= 9 ? 'boss2' : 'battle2',
        makeSetup: () => deepSetup(a.save, floor, part, party, randomSeed()),
        onWin: (b: Battle) => {
          const stars = starsSoFar & partStars(b, floor);
          if (two && part === 'A') {
            a.toast('전반 클리어! 후반 파티로 이어 가.');
            setTimeout(() => runPart(a, floor, 'B', stars), 800);
            return;
          }
          const r = recordFloor(a.save, floor, stars);
          a.persist();
          sfx('reward');
          const panel = modal([h('div', { class: 'headline win', text: `${f.name} 클리어` }), h('div', { class: 'stars' }, ...[1, 2, 4].map((bit) => h('span', { class: stars & bit ? 'on' : 'off', text: '★' }))), rewardList(a, r.got.items)], { noClose: true });
          panel.el.classList.add('result');
          panel.el.append(button('딥 서버로', () => (panel.close(), a.back()), 'primary big'));
        },
        onQuit: () => a.back(),
      }),
    { replace: part === 'B' },
  );
}
