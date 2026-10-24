// 데일리 루틴: 일일 4개 + 주간 3개, 밀린 루틴
import { DATA } from '../../engine/data';
import { allDailyDone, claimBacklog, claimDaily, claimWeekly, ensureDaily, isDone, missionDef } from '../../engine/missions';
import type { App, Screen } from '../app';
import { button, rewardList, topBar } from '../common';
import { h } from '../dom';
import { sfx } from '../audio';

export function missionsScreen(app: App): Screen {
  const save = app.save;
  ensureDaily(save);
  const body = h('div', { class: 'scr-body' });
  const done = (msg: string, items: Record<string, number>) => {
    sfx('reward');
    app.persist();
    app.toast(`${msg}: ${Object.entries(items).map(([k, v]) => `${DATA.items[k]?.name ?? k} ${v}`).join(', ')}`);
    app.refresh();
  };

  const daily = h('div', { class: 'section panel' }, h('h3', { text: '오늘의 루틴' }), h('div', { class: 'muted', style: 'font-size:13px', text: '4개를 모두 끝내면 보상을 받아. 소탕만으로 끝나는 미션도 섞여 있어.' }));
  for (const m of save.daily.list) {
    const def = missionDef(m.id)!;
    daily.append(h('div', { class: `mission${isDone(m) ? ' done' : ''}` }, h('span', { text: def.text }), h('span', { class: 'muted', text: `${m.p} / ${def.n}` }), h('div', { class: 'bar' }, h('i', { style: `width:${(m.p / def.n) * 100}%` }))));
  }
  daily.append(rewardList(app, DATA.balance.daily.allReward, { small: true }));
  const all = button(save.daily.allClaimed ? '오늘 보상을 받았어' : '보상 받기', () => {
    const g = claimDaily(save);
    if (g) done('일일 보상', g.items);
  }, 'primary big');
  all.disabled = save.daily.allClaimed || !allDailyDone(save);
  daily.append(all);
  body.append(daily);

  if (save.daily.backlog > 0) {
    body.append(
      h('div', { class: 'section panel' }, h('h3', { text: `밀린 루틴 ${save.daily.backlog}일치` }), h('div', { class: 'muted', style: 'font-size:13px', text: '못 들어온 날의 보상을 최대 3일치까지 모아 둬. 그냥 받기만 하면 돼.' }), button('한 번에 받기', () => {
        const g = claimBacklog(save);
        if (g) done('밀린 루틴', g.items);
      }, 'cyan big')),
    );
  }

  const weekly = h('div', { class: 'section panel' }, h('h3', { text: '이번 주 미션' }));
  for (const m of save.daily.weekly) {
    const def = missionDef(m.id)!;
    const row = h('div', { class: `mission${isDone(m) ? ' done' : ''}` }, h('span', { text: def.text }), h('span', { class: 'muted', text: `${m.p} / ${def.n}` }), h('div', { class: 'bar' }, h('i', { style: `width:${(m.p / def.n) * 100}%` })));
    const b = button(m.claimed ? '받음' : '받기', () => {
      const g = claimWeekly(save, m.id);
      if (g) done('주간 보상', g.items);
    }, isDone(m) && !m.claimed ? 'primary' : '');
    b.disabled = m.claimed || !isDone(m);
    row.append(b);
    weekly.append(row);
  }
  weekly.append(rewardList(app, DATA.balance.daily.weeklyReward, { small: true }));
  body.append(weekly);

  return { el: h('div', { class: 'scr' }, topBar(app, '데일리 루틴'), body) };
}
