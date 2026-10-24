// 대화 화면. 오른쪽 위 스킵은 항상 있고, 스킵하면 "지난 이야기" 요약을 보여 준다. 선택지에서는 스킵이 멈춘다.
import { DATA } from '../engine/data';
import { getScript, StoryRunner, type Step } from '../engine/story/runner';
import type { App } from './app';
import { sfx } from './audio';
import { button } from './common';
import { clear, h } from './dom';
import { onPress } from './press';

const BG: Record<string, string> = {
  dump: 'linear-gradient(180deg,#0b1118,#1d2a2a 70%,#0e1512)',
  undertown: 'linear-gradient(180deg,#120a33,#2a0f4a 60%,#ff3e9a22)',
  market: 'linear-gradient(180deg,#2b1a05,#5a3a0e 60%,#2a1a05)',
  academy: 'linear-gradient(180deg,#0b2038,#1f4f7a 60%,#7fd6ff33)',
  garden: 'linear-gradient(180deg,#07240f,#1a6a3a 60%,#3dff8b22)',
  tower: 'linear-gradient(180deg,#d9dce8,#9fa4b8 60%,#ffffff)',
  core: 'linear-gradient(180deg,#05020f,#2a0f6a 55%,#40e8ff33)',
  black: '#000',
};

const FACE_NAME: Record<string, string> = { smile: '웃음', angry: '화남', sad: '슬픔' };

function charByName(name: string) {
  return Object.values(DATA.characters).find((c) => c.name === name);
}

export interface PlayOptions {
  /** 챕터 선택으로 다시 고르는 중: 대사는 건너뛰고 선택지에서만 멈춘다 */
  replay?: boolean;
}

/** 대본 하나를 끝까지 재생한다. 끝나면 resolve */
export function playScript(app: App, scriptId: string, chapter: string, opts: PlayOptions = {}): Promise<{ ending?: string }> {
  return new Promise((resolve) => {
    const save = app.save;
    const runner = new StoryRunner(getScript(scriptId), save, chapter);
    const log: { who: string; text: string }[] = [];
    const name = (w: string) => (w === '러너' ? save.name : w);
    const fill = (t: string) => t.replace(/\{name\}/g, save.name);
    const cast: string[] = [];
    let step = null as unknown as Step;
    let typing = 0;
    let full = '';
    let auto = 0;
    let busy = false;
    let closed = false;
    let lastBgm = '';

    const root = h('div', { class: 'story' });
    const bg = h('div', { class: 'st-bg' });
    const cg = h('div', { class: 'st-cg' });
    const figs = h('div', { class: 'st-figs' });
    const nameEl = h('div', { class: 'st-name' });
    const textEl = h('div', { class: 'st-text' });
    const next = h('div', { class: 'st-next', text: '▼' });
    const box = h('div', { class: 'st-box panel' }, nameEl, textEl, next);
    const choices = h('div', { class: 'st-choices' });

    const skipBtn = h('button', { class: 'btn st-skip', text: '스킵 ▶▶' });
    const autoBtn = h('button', { class: 'btn st-mini', text: '자동' });
    const logBtn = h('button', { class: 'btn st-mini', text: '기록' });
    const top = h('div', { class: 'st-top' }, logBtn, autoBtn, skipBtn);
    root.append(bg, cg, figs, top, box, choices);
    app.root.append(root);

    const finish = (ending?: string) => {
      if (closed) return;
      closed = true;
      clearInterval(typing);
      clearTimeout(auto);
      window.removeEventListener('keydown', key);
      root.remove();
      if (!save.story.seen.includes(scriptId)) save.story.seen.push(scriptId);
      app.persist();
      resolve({ ending });
    };

    const applyScene = (s: Step['scene']) => {
      bg.style.background = BG[s.bg] ?? BG.black;
      cg.style.display = s.cg ? 'flex' : 'none';
      cg.textContent = s.cg ? `[ CG: ${s.cg} ]` : '';
      if (s.bgm && s.bgm !== lastBgm) {
        lastBgm = s.bgm;
        app.bgm(s.bgm);
      }
    };

    const drawFigs = (who: string, face: string) => {
      clear(figs);
      cast.slice(-2).forEach((nm, i) => {
        const def = charByName(nm);
        if (!def) return;
        const on = nm === who;
        figs.append(
          h('div', { class: `st-fig ${i === 0 ? 'l' : 'r'}${on ? ' on' : ''}`, style: `--pc:${def.look.color}` }, h('span', { text: def.name.slice(0, 1) }), on && face && FACE_NAME[face] ? h('small', { text: FACE_NAME[face] }) : null),
        );
      });
    };

    const typeText = (text: string) => {
      clearInterval(typing);
      full = text;
      next.style.visibility = 'hidden';
      if (save.settings.instantText) {
        textEl.textContent = text;
        next.style.visibility = 'visible';
        schedAuto();
        return;
      }
      let i = 0;
      textEl.textContent = '';
      typing = window.setInterval(() => {
        i += 2;
        textEl.textContent = text.slice(0, i);
        if (i >= text.length) {
          clearInterval(typing);
          typing = 0;
          next.style.visibility = 'visible';
          schedAuto();
        }
      }, 28);
    };

    const schedAuto = () => {
      clearTimeout(auto);
      if (save.settings.autoText && step?.t === 'line') auto = window.setTimeout(() => advance(), 1600 + full.length * 25);
    };

    const show = (s: Step) => {
      step = s;
      applyScene(s.scene);
      clear(choices);
      if (s.t === 'end') return finish(s.ending);
      if (s.t === 'line') {
        box.style.display = '';
        if (!s.narr && !cast.includes(s.who)) cast.push(s.who);
        drawFigs(s.narr ? '' : s.who, s.face);
        nameEl.textContent = s.narr ? '' : name(s.who);
        nameEl.style.display = s.narr ? 'none' : '';
        textEl.classList.toggle('narr', s.narr);
        const t = fill(s.text);
        log.push({ who: s.narr ? '' : name(s.who), text: t });
        typeText(t);
        return;
      }
      // 선택지
      box.style.display = 'none';
      nameEl.textContent = '';
      s.options.forEach(({ opt, ok, idx }) => {
        const b = h('button', { class: `btn st-choice${s.big ? ' big-choice' : ''}`, text: opt.text }) as HTMLButtonElement;
        if (!ok) {
          b.disabled = true;
          b.append(h('small', { text: '조건이 부족해' }));
        }
        onPress(b, () => {
          if (b.disabled) return;
          sfx('confirm');
          runner.choose(s, idx);
          app.persist(); // 선택 직후 저장
          log.push({ who: '선택', text: opt.text });
          if (opts.replay || save.settings.storyAlwaysSkip) return void skip();
          show(runner.next());
        });
        choices.append(b);
      });
    };

    const advance = () => {
      if (busy || closed || step.t !== 'line') return;
      if (typing) {
        clearInterval(typing);
        typing = 0;
        textEl.textContent = full;
        next.style.visibility = 'visible';
        schedAuto();
        return;
      }
      sfx('page');
      show(runner.next());
    };

    const skip = async () => {
      if (busy || closed) return;
      busy = true;
      clearInterval(typing);
      clearTimeout(auto);
      const r = runner.skip();
      if (r.summaries.length && !opts.replay) {
        await new Promise<void>((done) => {
          const m = h('div', { class: 'modal-back' });
          const p = h('div', { class: 'modal panel' }, h('h2', { text: '지난 이야기' }), h('ul', { class: 'src-list' }, ...r.summaries.map((s) => h('li', { text: s }))));
          p.append(button('계속', () => (m.remove(), done()), 'primary big'));
          m.append(p);
          root.append(m);
        });
      }
      busy = false;
      show(r.step);
    };

    onPress(box, () => advance());
    onPress(bg, () => advance());
    onPress(skipBtn, () => void skip());
    onPress(autoBtn, () => {
      save.settings.autoText = !save.settings.autoText;
      autoBtn.classList.toggle('on', save.settings.autoText);
      app.persist();
      if (save.settings.autoText) schedAuto();
    });
    autoBtn.classList.toggle('on', save.settings.autoText);
    onPress(logBtn, () => {
      const m = h('div', { class: 'modal-back' });
      const list = h('div', { class: 'history-list' }, ...log.map((l) => h('div', null, h('b', { text: l.who }), h('span', { text: l.text }))));
      const p = h('div', { class: 'modal panel wide' }, h('h2', { text: '대화 기록' }), list, button('닫기', () => m.remove(), 'primary'));
      m.append(p);
      root.append(m);
      list.scrollTop = list.scrollHeight;
    });

    const key = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        if (root.querySelector('.modal-back')) return;
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', key);

    show(runner.next());
    if ((opts.replay || save.settings.storyAlwaysSkip) && step.t === 'line') void skip();
  });
}
