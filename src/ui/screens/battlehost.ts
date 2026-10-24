// 스토리 밖 전투(재료·딥 서버·루프)를 띄우는 공통 화면.
import type { Battle } from '../../engine/battle/battle';
import type { BattleSetup } from '../../engine/battle/types';
import { recordBattle } from '../../engine/record';
import type { App, Screen } from '../app';
import { BattleView } from '../battle/view';
import { h } from '../dom';

export interface HostConfig {
  title: string;
  boss?: boolean;
  bgm?: string;
  makeSetup: () => BattleSetup;
  onWin: (b: Battle, view: BattleView) => void | Promise<void>;
  /** 진 뒤 "다시 도전" 대신 따로 처리할 때(루프는 지면 끝) */
  onLose?: (b: Battle, view: BattleView) => void;
  onQuit: () => void;
  onChangeParty?: (view: BattleView) => void;
}

export function battleHostScreen(app: App, cfg: HostConfig): Screen {
  const el = h('div', { class: 'bvhost' });
  app.bgm(cfg.bgm ?? (cfg.boss ? 'boss' : 'battle2'));
  const view: BattleView = new BattleView(el, {
    title: cfg.title,
    boss: cfg.boss,
    makeSetup: cfg.makeSetup,
    settings: app.save.settings,
    saveSettings: () => app.persist(),
    seenCutins: new Set(app.save.seenCutins),
    markCutin: (id) => {
      if (!app.save.seenCutins.includes(id)) app.save.seenCutins.push(id);
      app.persist();
    },
    onWin: (b) => void cfg.onWin(b, view),
    onFinish: (b, seconds) => {
      recordBattle(app.save, b, { boss: cfg.boss, speed: app.save.settings.speed, seconds });
      app.persist();
      if (b.phase === 'lost' && cfg.onLose) {
        // 루프처럼 지면 끝나는 전투: 패배 화면 대신 바로 넘긴다
        setTimeout(() => {
          el.querySelector('.modal-back')?.remove();
          cfg.onLose!(b, view);
        }, 900);
      }
    },
    onChangeParty: cfg.onChangeParty ? () => cfg.onChangeParty!(view) : undefined,
    onQuit: cfg.onQuit,
  });
  return { el, destroy: () => view.destroy() };
}
