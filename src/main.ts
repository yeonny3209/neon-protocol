import './ui/styles/base.css';
import './ui/styles/battle.css';
import './ui/styles/screens.css';
import { App } from './ui/app';
import { watchOrient } from './ui/layout';
import { showProto } from './ui/proto';
import { devScreen } from './ui/screens/dev';
import { titleScreen } from './ui/screens/title';

watchOrient();
const root = document.getElementById('app')!;

if (location.hash === '#proto') showProto(root);
else {
  const app = new App(root);
  app.go(location.hash === '#dev' ? devScreen : titleScreen, { reset: true });
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
