// 스테이지 진행: 대본 → 전투 → 대본 → 결과. 결과 화면의 가장 큰 버튼은 "다음 스테이지".
import { DATA } from '../../engine/data';
import type { StageDef } from '../../engine/defs';
import { allyFromSave, power } from '../../engine/growth';
import { storyParty, validParty } from '../../engine/party';
import { recordBattle } from '../../engine/record';
import { applyStageClear, nextStageId, stageStars, type ClearOutcome } from '../../engine/progress';
import { randomSeed } from '../../engine/rng';
import type { AllySetup, BattleSetup } from '../../engine/battle/types';
import type { Battle } from '../../engine/battle/battle';
import type { App, Screen } from '../app';
import { BattleView } from '../battle/view';
import { button, itemName, modal, portrait, rewardList } from '../common';
import { clear, h } from '../dom';
import { ELEMENT_INFO } from '../labels';
import { onPress } from '../press';
import { playScript } from '../story';
import { nestScreen } from './nest';
import { sfx } from '../audio';

const TUTORIALS: Record<string, string> = {
  timeline: '위쪽(왼쪽)의 순서대로 행동해. 스킬을 고르면 순서가 어떻게 바뀌는지 미리 보여 줘!',
  weakness: '적 머리 위의 속성이 약점이야. "약점!" 표시를 누르면 방화벽이 깎이고, 0이 되면 시스템 다운!',
  cpOverclock: '일반공격으로 CP를 모아서 스킬에 써. 카드가 빛나면 눌러서 오버클럭!',
};

export function stageAvailable(app: App, id: string): boolean {
  const i = DATA.stageOrder.indexOf(id);
  if (i <= 0) return true;
  return !!app.save.story.cleared[DATA.stageOrder[i - 1]];
}

export { nextStageId };

/** 전투에 나갈 아군: 내 편성 + 빈 자리는 체험 캐릭터 */
export function stageAllies(app: App, st: StageDef): AllySetup[] {
  return storyParty(app.save, st, app.save.settings.difficulty).allies;
}

export { validParty };

/** 지도에서 나가는 입구. 선공이면 아군 행동 거리가 30% 짧아진다 */
export async function startStage(app: App, stageId: string, ambush = false, fromBattle = false) {
  const st = DATA.stages[stageId];
  if (!st) return;
  if (st.pre) await playScript(app, st.pre, st.chapter);
  // 결과 화면에서 바로 다음 스테이지로 갈 때는 전투 화면을 교체해서 뒤로 가기 기록이 쌓이지 않게 한다
  app.go((a) => battleScreen(a, st, ambush), { replace: fromBattle });
}

function battleScreen(app: App, st: StageDef, ambush: boolean): Screen {
  const el = h('div', { class: 'bvhost' });
  app.bgm(st.boss ? 'boss' : 'battle');
  let hinted = false;
  const view: BattleView = new BattleView(el, {
    title: st.name,
    boss: !!st.boss,
    makeSetup: (): BattleSetup => ({
      allies: stageAllies(app, st),
      enemies: st.enemies.map((id) => ({ defId: id, level: st.enemyLevel })),
      seed: randomSeed(),
      difficulty: app.save.settings.difficulty,
      ambush,
    }),
    settings: app.save.settings,
    saveSettings: () => app.persist(),
    seenCutins: new Set(app.save.seenCutins),
    markCutin: (id) => {
      if (!app.save.seenCutins.includes(id)) app.save.seenCutins.push(id);
      app.persist();
    },
    hooks: {
      onInput: async () => {
        if (hinted || !st.tutorial || app.save.tutorials.includes(`${st.tutorial}`)) return;
        hinted = true;
        const id = st.tutorial;
        app.save.tutorials.push(id);
        const tip = h('div', { class: 'tutorial-tip panel' }, h('div', { text: TUTORIALS[id] }), h('small', { class: 'muted', text: '눌러서 닫기' }));
        onPress(tip, () => tip.remove());
        view.root.append(tip);
        setTimeout(() => tip.remove(), 9000);
      },
    },
    onWin: (b) => void finishStage(app, st, b, view),
    onFinish: (b, seconds) => {
      recordBattle(app.save, b, { stage: true, boss: !!st.boss, speed: app.save.settings.speed, seconds });
      app.persist();
    },
    onChangeParty: st.forcedParty ? undefined : () => partyModal(app, st, () => view.restart()),
    onQuit: () => app.back(),
  });
  return { el, destroy: () => view.destroy() };
}

type Outcome = ClearOutcome;

function finishStage(app: App, st: StageDef, b: Battle, view: BattleView): Promise<void> {
  const save = app.save;
  const out: Outcome = applyStageClear(save, st, stageStars(b, st));
  const first = out.first;
  // 보통 난이도는 체력이 일부만 회복된 채로 다음 전투로 이어진다
  if (save.settings.difficulty === 'normal' && !st.forcedParty) {
    const heal = DATA.balance.difficulty.normal.postBattleHeal;
    for (const u of b.allies(false)) save.story.hp[u.defId] = Math.min(1, (u.alive ? u.hp / u.maxHp : 0) + heal);
  } else save.story.hp = {};
  app.persist();

  return (async () => {
    let ending: string | undefined;
    if (st.post && first) ending = (await playScript(app, st.post, st.chapter)).ending;
    if (ending) {
      await playEnding(app, ending);
      return;
    }
    showResult(app, st, out, view);
  })();
}

function showResult(app: App, st: StageDef, out: Outcome, view: BattleView) {
  sfx('reward');
  const nextId = nextStageId(st.id);
  const nextOk = !!nextId && DATA.stages[nextId] !== undefined;
  const starRow = h('div', { class: 'stars' }, ...[1, 2, 4].map((bit) => h('span', { class: out.stars & bit ? 'on' : 'off', text: '★' })));
  const conds = h('div', { class: 'muted', style: 'font-size:13px', text: `별: 클리어${out.stars & 2 ? ' · 전원 생존' : ''}${out.stars & 4 ? ' · 빠른 클리어' : ''}` });
  const panel = h('div', { class: 'modal panel result' }, h('div', { class: 'headline win', text: out.chapterDone ? `${DATA.chapters[st.chapter].title} 클리어!` : '승리' }), starRow, conds);
  if (out.first) panel.append(h('div', { class: 'muted', text: '처음 클리어한 보상' }));
  panel.append(rewardList(app, { ...out.got.items, ...(out.got.rank ? {} : {}) }));
  if (out.got.rank) panel.append(h('div', { class: 'r5', text: `러너 등급 ${out.got.rank.from} → ${out.got.rank.to}!` }));
  if (out.chapterGot) panel.append(h('div', { class: 'r4', text: '챕터 완료 보상' }), rewardList(app, out.chapterGot.items));
  if (out.forms.length) panel.append(h('div', { class: 'r5', text: `러너 새 형태: ${out.forms.join(', ')}` }));
  const goNext = button(nextOk ? '다음 스테이지' : '지도로', () => {
    back.remove();
    if (nextOk) void startStage(app, nextId!, false, true);
    else app.back();
  }, 'primary big');
  panel.append(goNext);
  if (nextOk) panel.append(button('지도', () => app.back(), ''));
  panel.append(button('한 번 더', () => (back.remove(), view.restart()), 'ghost'));
  const back = h('div', { class: 'modal-back' }, panel);
  view.root.append(back);
}

// ───────────────────────── 편성

/** 4인 편성. 적의 약점을 미리 보여 주고, 추천 편성 버튼이 있다 */
export function partyModal(app: App, st: StageDef | null, onDone: () => void) {
  const save = app.save;
  let party = [...validParty(app.save)];
  const weak = new Set(st ? st.enemies.flatMap((e) => DATA.enemies[e].weaknesses) : []);
  const m = modal([h('h2', { text: '편성' })], { wide: true });
  const info = h('div', { class: 'muted', style: 'font-size:13px' });
  const slots = h('div', { class: 'row' });
  const list = h('div', { class: 'char-grid' });
  if (st) {
    const row = h('div', { class: 'row' }, h('span', { class: 'muted', text: '적 약점' }));
    for (const w of weak) row.append(h('span', { class: 'el-chip', style: `background:${ELEMENT_INFO[w].color}`, title: ELEMENT_INFO[w].name }, ELEMENT_INFO[w].glyph));
    m.el.append(row);
  }
  m.el.append(info, slots, h('div', { class: 'muted', text: '기본 편성은 "딜러 1 + 서포터 2 + 생존 1"이야.' }), list);

  const draw = () => {
    clear(slots);
    clear(list);
    for (let i = 0; i < 4; i++) {
      const id = party[i];
      const s = h('div', { class: 'char-card panel', style: 'min-height:96px;width:100px' }, id ? portrait(id, 52) : h('div', { class: 'muted', text: '비었음' }), id ? h('div', { text: DATA.characters[id].name }) : null);
      if (id) onPress(s, () => ((party = party.filter((x) => x !== id)), draw()));
      slots.append(s);
    }
    const hits = party.filter((id) => weak.has(effEl(id))).length;
    info.textContent = st ? `약점을 찌를 수 있는 아군 ${hits}명 · 캐릭터를 누르면 넣고 빼` : '캐릭터를 누르면 넣고 빼';
    for (const id of Object.keys(save.chars)) {
      const def = DATA.characters[id];
      const el = effEl(id);
      const on = party.includes(id);
      const card = h('div', { class: `char-card panel${on ? ' locked' : ''}` }, portrait(id, 56, el), h('div', { class: 'nm', text: def.name }), h('div', { class: 'meta', text: `Lv${save.chars[id].level} · ${ELEMENT_INFO[el].name}${weak.has(el) ? ' · 약점!' : ''}` }), h('div', { class: 'meta', text: `전투력 ${power(allyFromSave(save, id))}` }));
      onPress(card, () => {
        if (on) party = party.filter((x) => x !== id);
        else if (party.length < 4) party.push(id);
        else return app.toast('4명까지만 넣을 수 있어');
        sfx('select');
        draw();
      });
      list.append(card);
    }
  };
  const effEl = (id: string) => (id === 'runner' ? (DATA.characters.runner.forms?.find((f) => f.id === save.runnerForm) ?? DATA.characters.runner).element : DATA.characters[id].element);

  const recommend = () => {
    const ids = Object.keys(save.chars).sort((a, b) => power(allyFromSave(save, b)) - power(allyFromSave(save, a)));
    const pick: string[] = [];
    const add = (id?: string) => id && !pick.includes(id) && pick.length < 4 && pick.push(id);
    const prot = (id: string) => (id === 'runner' ? (DATA.characters.runner.forms?.find((f) => f.id === save.runnerForm) ?? DATA.characters.runner).protocol : DATA.characters[id].protocol);
    add(ids.find((id) => ['strike', 'blitz'].includes(prot(id)) && (!weak.size || weak.has(effEl(id)))) ?? ids.find((id) => ['strike', 'blitz'].includes(prot(id))));
    add(ids.find((id) => ['reboot', 'shield'].includes(prot(id))));
    for (const id of ids) if (weak.has(effEl(id))) add(id);
    for (const id of ids) add(id);
    party = pick;
    draw();
  };
  draw();
  const row = h('div', { class: 'row' }, button('추천 편성', recommend), button('확인', () => {
    if (!party.length) return app.toast('최소 1명은 넣어야 해');
    save.party = party;
    app.persist();
    m.close();
    onDone();
  }, 'primary big'));
  m.el.append(row);
  void itemName;
}

export const ENDING_INFO: Record<string, { title: string; hint: string }> = {
  A: { title: '정전', hint: '녹스트리트 신뢰도가 높고, 마지막에 오라클 넷을 "끄기"를 고른다.' },
  B: { title: '재부팅', hint: '화이트 노이즈 신뢰도가 높고, 마지막에 오라클 넷을 "다시 쓰기"를 고른다.' },
  C: { title: '공존 (트루 엔딩)', hint: '세 세력 신뢰도를 모두 5 이상으로 쌓고, 2장·4장·5장의 특정 선택지를 모두 고른 뒤 "함께 운영하기"를 고른다.' },
};

/** 엔딩 에필로그를 재생하고 엔딩 카드를 보여 준다 */
export async function playEnding(app: App, id: string, sandbox = false) {
  await playScript(app, `ending_${id}`, 'ch6', { sandbox });
  const info = ENDING_INFO[id];
  await new Promise<void>((done) => {
    const first = app.save.story.endings.length === 1 && app.save.story.endings[0] === id;
    const panel = h('div', { class: 'modal panel result' },
      h('div', { class: 'muted', text: 'THE END' }),
      h('div', { class: 'headline win', text: `엔딩 ${id}. ${info.title}` }),
      h('div', { class: 'muted', text: `본 엔딩 ${app.save.story.endings.length} / 3` }),
      !sandbox && first ? h('div', { class: 'r5', text: '기록 보관소에 "챕터 선택"이 열렸어. 전투 없이 선택지만 다시 골라서 다른 엔딩을 볼 수 있어.' }) : null,
    );
    panel.append(button('둥지로', () => (box.remove(), done()), 'primary big'));
    const box = h('div', { class: 'modal-back', style: 'z-index:80' }, panel);
    app.root.append(box);
    sfx('win');
  });
  app.go(nestScreen, { reset: true });
}
