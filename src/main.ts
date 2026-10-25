import './ui/styles/base.css';
import './ui/styles/battle.css';
import './ui/styles/screens.css';
import { App } from './ui/app';
import { watchOrient } from './ui/layout';
import { titleScreen } from './ui/screens/title';

watchOrient();
// 브라우저가 저장 공간을 마음대로 지우지 않게 요청한다(Safari 홈 화면 앱에서 특히 도움이 된다)
void navigator.storage?.persist?.().catch(() => undefined);
const root = document.getElementById('app')!;

// 테스트용 화면(#proto 전투 시험대, #dev 테스트 도구)은 개발 서버에서만 열린다. 배포판에는 들어가지 않는다.
if (import.meta.env.DEV && location.hash === '#proto') {
  void import('./ui/proto').then((m) => m.showProto(root));
} else {
  const app = new App(root);
  if (import.meta.env.DEV && location.hash === '#dev') void import('./ui/screens/dev').then((m) => app.go(m.devScreen, { reset: true }));
  else app.go(titleScreen, { reset: true });
  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
