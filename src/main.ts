import './ui/styles/base.css';
import './ui/styles/battle.css';
import './ui/styles/screens.css';
import { App } from './ui/app';
import { watchOrient } from './ui/layout';
import { showProto } from './ui/proto';
import { charsScreen } from './ui/screens/chars';
import { devScreen } from './ui/screens/dev';
import { diveScreen } from './ui/screens/dive';
import { button, topBar } from './ui/common';
import { h } from './ui/dom';

watchOrient();
const root = document.getElementById('app')!;

if (location.hash === '#proto') showProto(root);
else {
  const app = new App(root);
  const hub = (a: App) => ({
    el: h(
      'div',
      { class: 'scr' },
      topBar(a, '둥지', { back: false }),
      h('div', { class: 'scr-body' }, h('div', { class: 'nest-menu' }, button('캐릭터', () => a.go(charsScreen)), button('다이브', () => a.go(diveScreen)), button('전투 프로토타입', () => ((location.hash = '#proto'), location.reload())), button('테스트 도구', () => a.go(devScreen)))),
    ),
  });
  app.go(location.hash === '#dev' ? devScreen : hub, { reset: true });
}
