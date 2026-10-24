// 전투 프로토타입 화면(#proto). 5성 4명 vs 적 3종을 바로 붙어 볼 수 있다.
import type { Battle } from '../engine/battle/battle';
import { buildAlly, standardLoadout } from '../engine/loadout';
import { randomSeed } from '../engine/rng';
import { loadSave, writeSave } from '../engine/save';
import { BattleView } from './battle/view';
import { clear, h } from './dom';
import { onPress } from './press';
import { unlockAudio } from './audio';

const PARTY = ['kai', 'seraphine', 'zero', 'luna'];
const FOES = ['sec_drone', 'heavy_mech', 'street_thug'];
const LEVEL = 20;

export function showProto(root: HTMLElement) {
  const save = loadSave();
  const persist = () => writeSave(save);
  const seen = new Set(save.seenCutins);
  let plays = 0;
  let view: BattleView | null = null;

  const startBattle = () => {
    clear(root);
    view?.destroy();
    view = new BattleView(root, {
      makeSetup: () => ({
        allies: PARTY.map((id) => buildAlly(standardLoadout(id, LEVEL))),
        enemies: FOES.map((id) => ({ defId: id, level: LEVEL })),
        seed: randomSeed(),
        difficulty: save.settings.difficulty,
        ambush: true,
      }),
      settings: save.settings,
      saveSettings: persist,
      seenCutins: seen,
      markCutin: (id) => {
        seen.add(id);
        save.seenCutins = [...seen];
        persist();
      },
      onWin: (b) => showResult(b),
    });
  };

  const showResult = (b: Battle) => {
    plays++;
    const secs = view!.elapsedSeconds();
    const again = h('button', { class: 'btn primary big', text: '한 판 더' });
    const toTitle = h('button', { class: 'btn', text: '처음 화면' });
    const stat = (k: string, v: string | number) => h('div', null, k, h('b', { text: String(v) }));
    const panel = h(
      'div',
      { class: 'modal panel result' },
      h('div', { class: 'headline win', text: '승리' }),
      h('div', { class: 'muted', text: `${plays}판째 · ${save.settings.difficulty === 'story' ? '스토리' : '보통'} 난이도` }),
      h(
        'div',
        { class: 'stats' },
        stat('걸린 시간', `${Math.floor(secs / 60)}분 ${Math.round(secs % 60)}초`),
        stat('라운드', b.round()),
        stat('시스템 다운', b.stats.downs),
        stat('오버클럭', b.stats.overclocks),
        stat('최대 피해', b.stats.maxHit.toLocaleString('ko-KR')),
        stat('쓰러진 아군', b.stats.koAllies),
      ),
      again,
      toTitle,
    );
    const back = h('div', { class: 'modal-back' }, panel);
    view!.root.append(back);
    onPress(again, () => {
      back.remove();
      view!.restart();
    });
    onPress(toTitle, () => title());
  };

  const title = () => {
    view?.destroy();
    view = null;
    clear(root);
    const go = h('button', { class: 'btn primary big', text: '전투 시작' });
    const diff = h('div', { class: 'seg' });
    const drawDiff = () => {
      clear(diff);
      for (const [v, label] of [['story', '스토리'], ['normal', '보통']] as const) {
        const b = h('button', { class: save.settings.difficulty === v ? 'on' : '', text: label });
        onPress(b, () => {
          save.settings.difficulty = v;
          persist();
          drawDiff();
        });
        diff.append(b);
      }
    };
    drawDiff();
    root.append(
      h(
        'div',
        { class: 'screen', style: 'display:flex;align-items:center;justify-content:center' },
        h(
          'div',
          { class: 'modal panel', style: 'text-align:center' },
          h('h2', { text: '전투 프로토타입' }),
          h('div', { class: 'muted', text: '카이 · 세라핀 · 제로 · 루나 (Lv20) vs 경비 드론 · 진압 기갑병 · 개조 불량배' }),
          h('div', { class: 'row', style: 'justify-content:center' }, '난이도', diff),
          go,
          h('div', { class: 'muted', style: 'font-size:13px;text-align:left;line-height:1.7' }, '조작: 적을 누르면 공격 · 스킬 버튼으로 바꾼 뒤 적/아군을 누르면 발동 · 빛나는 카드를 누르면 오버클럭 · 길게 누르거나 마우스를 올리면 설명', h('br'), '키보드: Q 일반공격 · E 전투스킬 · 1~4 오버클럭 · ←/→ 대상 · Space 확인 · F 배속 · Esc 일시정지'),
        ),
      ),
    );
    onPress(go, () => {
      unlockAudio();
      startBattle();
    });
  };

  title();
}
