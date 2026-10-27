// 설정. 어디서나 열 수 있고, 저장 내보내기·불러오기가 여기 있다(iPad 데이터 삭제 대비).
import { pruneUnknown } from '../../engine/state';
import { exportSave, importSave, newSave } from '../../engine/save';
import { applyDisplay, type App } from '../app';
import { setVolumes } from '../audio';
import { setGender } from '../labels';
import { button, confirmBox, modal } from '../common';
import { clear, h } from '../dom';
import { onPress } from '../press';

export function seg<T extends string | number | boolean>(vals: [T, string][], cur: () => T, set: (v: T) => void): HTMLElement {
  const box = h('div', { class: 'seg' });
  const draw = () => {
    clear(box);
    for (const [v, label] of vals) {
      const b = h('button', { class: cur() === v ? 'on' : '', text: label });
      onPress(b, () => (set(v), draw()));
      box.append(b);
    }
  };
  draw();
  return box;
}

export function settingsModal(app: App) {
  const s = app.save.settings;
  const save = () => app.persist();
  const slider = (get: () => number, set: (v: number) => void) => {
    const r = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(get() * 100)), style: 'width:160px;min-height:44px' }) as HTMLInputElement;
    r.addEventListener('input', () => {
      set(Number(r.value) / 100);
      setVolumes({ sfx: s.sfx, bgm: s.bgm });
    });
    r.addEventListener('change', save);
    return r;
  };
  const row = (label: string, ctl: HTMLElement) => h('div', { class: 'row', style: 'justify-content:space-between' }, h('span', { text: label }), ctl);
  const m = modal(
    [
      h('h2', { text: '설정' }),
      row('난이도', seg<'story' | 'normal'>([['story', '스토리'], ['normal', '보통']], () => s.difficulty, (v) => ((s.difficulty = v), save()))),
      h('div', { class: 'muted', style: 'font-size:12px', text: '언제든 바꿀 수 있고, 보상은 똑같아.' }),
      row('배속', seg<1 | 2 | 3>([[1, '1x'], [2, '2x'], [3, '3x']], () => s.speed, (v) => ((s.speed = v), save()))),
      row('오버클럭 컷인', seg<'first' | 'always' | 'never'>([['first', '첫 1회'], ['always', '항상'], ['never', '끄기']], () => s.cutin, (v) => ((s.cutin = v), save()))),
      row('보스 등장 연출', seg<boolean>([[false, '보기'], [true, '건너뛰기']], () => s.skipBossIntro, (v) => ((s.skipBossIntro = v), save()))),
      row('승리 연출', seg<boolean>([[false, '보기'], [true, '건너뛰기']], () => s.skipVictory, (v) => ((s.skipVictory = v), save()))),
      row('처음부터 스토리 항상 스킵', seg<boolean>([[false, '끄기'], [true, '켜기']], () => s.storyAlwaysSkip, (v) => ((s.storyAlwaysSkip = v), save()))),
      row('글자 즉시 표시', seg<boolean>([[false, '끄기'], [true, '켜기']], () => s.instantText, (v) => ((s.instantText = v), save()))),
      row('자동 넘기기', seg<boolean>([[false, '끄기'], [true, '켜기']], () => s.autoText, (v) => ((s.autoText = v), save()))),
      row('주인공 모습', seg<'male' | 'female'>([['male', '남자'], ['female', '여자']], () => app.save.gender, (v) => ((app.save.gender = v), setGender(v), save()))),
      row('글자 크기', seg<boolean>([[false, '보통'], [true, '크게']], () => s.bigText, (v) => ((s.bigText = v), applyDisplay(s), save()))),
      row('동작 줄이기', seg<boolean>([[false, '끄기'], [true, '켜기']], () => s.calm, (v) => ((s.calm = v), applyDisplay(s), save()))),
      h('div', { class: 'muted', style: 'font-size:12px', text: '화면 흔들림, 번쩍임, 화면 전환 효과를 꺼. 눈이 피곤하거나 멀미가 날 때 써.' }),
      row('배경음', slider(() => s.bgm, (v) => (s.bgm = v))),
      row('효과음', slider(() => s.sfx, (v) => (s.sfx = v))),
      h('h3', { text: '저장 관리' }),
      h('div', { class: 'muted', style: 'font-size:12px', text: '저장은 자동이야. 아이패드에서 Safari 데이터를 지우면 사라지니까, 가끔 파일로 내보내 두면 좋아.' }),
    ],
    { wide: true },
  );
  const files = h('div', { class: 'row' });
  files.append(
    button('저장 파일로 내보내기', () => {
      const blob = new Blob([exportSave(app.save)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `neon-protocol-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      app.save.stats.lastBackup = Date.now();
      app.persist();
      app.toast('저장 파일을 내보냈어');
    }),
    button('파일에서 불러오기', () => {
      const input = h('input', { type: 'file', accept: '.json,application/json' }) as HTMLInputElement;
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        try {
          app.save = pruneUnknown(importSave(await f.text()));
          applyDisplay(app.save.settings);
          setVolumes({ sfx: app.save.settings.sfx, bgm: app.save.settings.bgm });
          app.persist();
          m.close();
          app.toast('불러왔어');
          app.refresh();
        } catch (e) {
          app.toast(`불러오지 못했어: ${(e as Error).message}`);
        }
      });
      input.click();
    }),
    button('처음부터 다시', () => confirmBox('처음부터 다시?', '지금 저장이 모두 지워져. 되돌릴 수 없어.', '지우기', () => {
      app.save = newSave();
      app.persist();
      m.close();
      location.hash = '';
      location.reload();
    }), 'ghost'),
  );
  m.el.append(files);
}
