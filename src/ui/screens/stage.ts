// 스테이지 진행: 대본 → 전투 → 대본 → 결과. 결과 화면의 가장 큰 버튼은 "다음 스테이지".
import { DATA } from '../../engine/data';
import type { StageDef } from '../../engine/defs';
import { allyFromSave, power } from '../../engine/growth';
import { buildAlly, standardLoadout } from '../../engine/loadout';
import { randomSeed } from '../../engine/rng';
import { grant, track, type Granted } from '../../engine/state';
import type { AllySetup, BattleSetup } from '../../engine/battle/types';
import type { Battle } from '../../engine/battle/battle';
import type { App, Screen } from '../app';
import { BattleView } from '../battle/view';
import { button, itemName, modal, portrait, rewardList } from '../common';
import { clear, h } from '../dom';
import { ELEMENT_INFO } from '../labels';
import { onPress } from '../press';
import { playScript } from '../story';
import { mapScreen } from './map';
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

export function nextStageId(id: string): string | undefined {
  const i = DATA.stageOrder.indexOf(id);
  return DATA.stageOrder[i + 1];
}

/** 전투에 나갈 아군 */
export function stageAllies(app: App, st: StageDef): AllySetup[] {
  if (st.forcedParty) return st.forcedParty.map((id) => buildAlly(standardLoadout(id, st.recLevel, { trial: true })));
  const hp = app.save.settings.difficulty === 'normal' ? app.save.story.hp : {};
  return validParty(app).map((id) => ({ ...allyFromSave(app.save, id), hpFrac: hp[id] }));
}

export function validParty(app: App): string[] {
  let party = app.save.party.filter((id) => app.save.chars[id]).slice(0, 4);
  if (!party.length) party = Object.keys(app.save.chars).slice(0, 4);
  app.save.party = party;
  return party;
}

/** 지도에서 나가는 입구. 선공이면 아군 행동 거리가 30% 짧아진다 */
export async function startStage(app: App, stageId: string, ambush = false) {
  const st = DATA.stages[stageId];
  if (!st) return;
  if (st.pre) await playScript(app, st.pre, st.chapter);
  app.go((a) => battleScreen(a, st, ambush));
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
    onChangeParty: st.forcedParty ? undefined : () => partyModal(app, st, () => view.restart()),
    onQuit: () => app.go(mapScreen, { replace: true }),
  });
  return { el, destroy: () => view.destroy() };
}

interface Outcome {
  stars: number;
  first: boolean;
  got: Granted;
  chapterDone: boolean;
  chapterGot?: Granted;
  forms: string[];
}

function finishStage(app: App, st: StageDef, b: Battle, view: BattleView): Promise<void> {
  const save = app.save;
  const first = !save.story.cleared[st.id];
  const alive = b.allies(false).every((u) => u.alive);
  const rounds = b.round();
  let stars = 1;
  if (alive) stars |= 2;
  if (rounds <= (st.starRounds ?? DATA.balance.story.defaultStarRounds)) stars |= 4;
  save.story.cleared[st.id] = (save.story.cleared[st.id] ?? 0) | stars;
  save.story.next = nextStageId(st.id);

  const reward = first ? { ...st.reward, ...st.firstReward } : { ...st.reward };
  if (!first) delete reward.rankExp;
  reward.rankExp = (reward.rankExp ?? 0) + DATA.balance.economy.rankExp.battleWin;
  if (first) reward.rankExp += st.boss ? DATA.balance.economy.rankExp.storyBossFirstClear : DATA.balance.economy.rankExp.storyFirstClear;
  const got = grant(save, reward);
  // 보통 난이도는 체력이 일부만 회복된 채로 다음 전투로 이어진다
  if (save.settings.difficulty === 'normal' && !st.forcedParty) {
    const heal = DATA.balance.difficulty.normal.postBattleHeal;
    for (const u of b.allies(false)) save.story.hp[u.defId] = Math.min(1, (u.alive ? u.hp / u.maxHp : 0) + heal);
  } else save.story.hp = {};
  track(save, 'battleWin');
  track(save, 'stageClear');

  const out: Outcome = { stars, first, got, chapterDone: false, forms: [] };
  const ch = DATA.chapters[st.chapter];
  const chapterStages = DATA.stageOrder.filter((id) => DATA.stages[id].chapter === st.chapter);
  if (first && !save.story.chapters.includes(st.chapter) && chapterStages.every((id) => save.story.cleared[id])) {
    save.story.chapters.push(st.chapter);
    out.chapterDone = true;
    out.chapterGot = grant(save, ch.completeReward);
    for (const f of DATA.characters.runner.forms ?? []) {
      if (f.unlockAfter === st.chapter && !save.runnerForms.includes(f.id)) {
        save.runnerForms.push(f.id);
        out.forms.push(f.name);
      }
    }
    track(save, 'chapterClear');
  }
  app.persist();

  return (async () => {
    if (st.post && first) await playScript(app, st.post, st.chapter);
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
    if (nextOk) void startStage(app, nextId!);
    else app.go(mapScreen, { replace: true });
  }, 'primary big');
  panel.append(goNext);
  if (nextOk) panel.append(button('지도', () => app.go(mapScreen, { replace: true }), ''));
  panel.append(button('한 번 더', () => (back.remove(), view.restart()), 'ghost'));
  const back = h('div', { class: 'modal-back' }, panel);
  view.root.append(back);
}

// ───────────────────────── 편성

/** 4인 편성. 적의 약점을 미리 보여 주고, 추천 편성 버튼이 있다 */
export function partyModal(app: App, st: StageDef | null, onDone: () => void) {
  const save = app.save;
  let party = [...validParty(app)];
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
