// 화면 전환과 저장을 맡는 앱 껍데기.
import { loadSave, writeSave, type SaveData } from '../engine/save';
import { setVolumes, sfx, unlockAudio } from './audio';
import { clear, h } from './dom';
import { hideTip } from './press';
import { playBgm } from './bgm';

export interface Screen {
  el: HTMLElement;
  destroy?: () => void;
  /** 둥지로 돌아가면 체력 회복 같은 처리를 할지 */
  isNest?: boolean;
}

export type ScreenFactory = (app: App) => Screen;

export class App {
  readonly root: HTMLElement;
  save: SaveData;
  private current: Screen | null = null;
  private history: ScreenFactory[] = [];
  private toastEl: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.save = loadSave();
    setVolumes({ sfx: this.save.settings.sfx, bgm: this.save.settings.bgm });
    document.addEventListener('pointerdown', () => unlockAudio(), { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.persist();
    });
  }

  persist() {
    writeSave(this.save);
  }

  /** 새 화면으로 이동(뒤로 가기 기록에 남김) */
  go(factory: ScreenFactory, opts: { replace?: boolean; reset?: boolean } = {}) {
    if (opts.reset) this.history = [];
    else if (!opts.replace && this.currentFactory) this.history.push(this.currentFactory);
    this.mount(factory);
  }

  back() {
    const prev = this.history.pop();
    sfx('cancel');
    if (prev) this.mount(prev);
  }

  private currentFactory: ScreenFactory | null = null;

  private mount(factory: ScreenFactory) {
    hideTip();
    this.current?.destroy?.();
    clear(this.root);
    this.currentFactory = factory;
    this.current = factory(this);
    this.root.append(this.current.el);
    this.persist();
  }

  /** 지금 화면을 다시 그린다 */
  refresh() {
    if (this.currentFactory) this.mount(this.currentFactory);
  }

  toast(text: string, ms = 1800) {
    this.toastEl?.remove();
    const t = h('div', { class: 'toast', text });
    this.toastEl = t;
    document.body.append(t);
    setTimeout(() => t.remove(), ms);
  }

  bgm(name: string) {
    playBgm(name);
  }
}
