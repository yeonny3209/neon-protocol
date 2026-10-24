// 타이틀. 아이패드는 한 번 터치해야 소리가 나서 "화면을 터치하세요" 단계가 있다.
import { newSave } from '../../engine/save';
import { unlockAudio } from '../audio';
import type { App, Screen } from '../app';
import { button } from '../common';
import { clear, h } from '../dom';
import { onPress } from '../press';
import { nestScreen } from './nest';
import { settingsModal } from './settings';

export function titleScreen(app: App): Screen {
  app.bgm('title');
  const body = h('div', { class: 'title-body' });
  const el = h('div', { class: 'scr title-scr' }, h('div', { class: 'title-logo' }, h('div', { class: 'sub', text: 'LUMEN CITY' }), h('h1', { text: '네온 프로토콜' }), h('div', { class: 'sub', text: 'NEON PROTOCOL' })), body);

  const touch = () => {
    clear(body);
    body.append(h('div', { class: 'touch-hint', text: '화면을 터치하세요' }));
    const go = () => {
      unlockAudio();
      el.removeEventListener('pointerdown', go);
      menu();
    };
    el.addEventListener('pointerdown', go);
  };

  const menu = () => {
    clear(body);
    app.bgm('title');
    if (app.save.started) body.append(button('이어하기', () => app.go(nestScreen, { reset: true }), 'primary big'));
    body.append(
      button(app.save.started ? '새로 시작' : '시작하기', () => {
        if (app.save.started && !confirm('지금 저장이 지워져. 새로 시작할까?')) return;
        askName();
      }, app.save.started ? '' : 'primary big'),
      button('설정', () => settingsModal(app)),
    );
  };

  const askName = () => {
    clear(body);
    const input = h('input', { class: 'name-input', maxlength: '8', placeholder: '러너', value: '' }) as HTMLInputElement;
    body.append(h('div', { class: 'muted', text: '이름을 정해 줘 (비워 두면 "러너")' }), input, button('확인', () => {
      const name = input.value.trim() || '러너';
      app.save = newSave();
      app.save.name = name;
      app.save.started = true;
      app.persist();
      app.go(nestScreen, { reset: true });
    }, 'primary big'));
    onPress(input, () => input.focus());
  };

  touch();
  return { el };
}
