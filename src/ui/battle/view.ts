// 전투 화면. 계산은 Battle이 하고, 여기는 이벤트를 받아 보여 주고 입력을 넘길 뿐이다.
// 배속은 연출 시간만 나눈다. 연출 스킵은 컷인·보스 등장·승리 연출에만 적용된다.
import { Battle } from '../../engine/battle/battle';
import type { BattleEvent, BattleSetup, Unit } from '../../engine/battle/types';
import { DATA } from '../../engine/data';
import type { SkillKind } from '../../engine/defs';
import type { Settings } from '../../engine/save';
import { clear, fmt, h, sleep } from '../dom';
import { ELEMENT_INFO, KIND_NAME, PROTOCOL_INFO } from '../labels';
import { hideTip, onPress } from '../press';
import { sfx } from '../audio';

export type EndChoice = 'retry' | 'lower' | 'party' | 'quit';

export interface BattleViewOptions {
  makeSetup: () => BattleSetup;
  settings: Settings;
  saveSettings: () => void;
  seenCutins: Set<string>;
  markCutin: (defId: string) => void;
  title?: string;
  boss?: boolean;
  /** 이기면 호출. 결과 화면은 부르는 쪽이 띄운다 */
  onWin: (b: Battle) => void;
  /** 패배 화면의 "편성 바꾸기" */
  onChangeParty?: () => void;
  /** 일시정지의 "그만두기" */
  onQuit?: () => void;
  /** 전투 중 특정 시점에 튜토리얼을 띄우는 훅 */
  hooks?: BattleHooks;
}

export interface BattleHooks {
  onInput?: (view: BattleView) => void | Promise<void>;
  onEvent?: (view: BattleView, e: BattleEvent) => void | Promise<void>;
}

const SHAPES: Record<string, string> = {
  drone: 'circle(48% at 50% 50%)',
  thug: 'polygon(15% 0, 85% 0, 100% 20%, 100% 100%, 0 100%, 0 20%)',
  mech: 'polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)',
  boss: 'polygon(50% 0, 63% 32%, 98% 35%, 72% 58%, 80% 95%, 50% 76%, 20% 95%, 28% 58%, 2% 35%, 37% 32%)',
};

interface EnemyEls {
  root: HTMLElement;
  hp: HTMLElement;
  hpLag: HTMLElement;
  hpText: HTMLElement;
  fw: HTMLElement;
  weak: HTMLElement;
  status: HTMLElement;
}

interface CardEls {
  root: HTMLElement;
  hp: HTMLElement;
  hpLag: HTMLElement;
  heat: HTMLElement;
  status: HTMLElement;
}

type Mode = 'wait' | 'input' | 'armed';

export class BattleView {
  b!: Battle;
  readonly root: HTMLElement;
  private opts: BattleViewOptions;
  private tl!: HTMLElement;
  private enemiesEl!: HTMLElement;
  private partyEl!: HTMLElement;
  private actionsEl!: HTMLElement;
  private fx!: HTMLElement;
  private roundEl!: HTMLElement;
  private speedBtn!: HTMLButtonElement;
  private enemyEls = new Map<string, EnemyEls>();
  private cardEls = new Map<string, CardEls>();
  private mode: Mode = 'wait';
  private kind: 'basic' | 'skill' = 'basic';
  private cursor: string | undefined;
  private armed: string | null = null;
  private armedCursor: string | undefined;
  private queue: BattleEvent[] = [];
  private pumping: Promise<void> | null = null;
  private hold = false;
  private menuOpen = false;
  private waiters: (() => void)[] = [];
  private destroyed = false;
  private skipCutin = false;
  private lastOrder: string[] = [];
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private startedAt = 0;
  /** 재시작할 때마다 바뀐다. 이전 판의 연출 루프가 새 판을 건드리지 못하게 한다 */
  private run = 0;

  constructor(container: HTMLElement, opts: BattleViewOptions) {
    this.opts = opts;
    this.root = h('div', { class: 'bv' });
    container.append(this.root);
    window.addEventListener('keydown', this.keyHandler);
    this.start();
  }

  destroy() {
    this.destroyed = true;
    window.removeEventListener('keydown', this.keyHandler);
    hideTip();
    this.release();
    this.root.remove();
  }

  get speed(): number {
    return this.opts.settings.speed;
  }

  /** 전투 시작(재시작 포함) */
  start() {
    this.run++;
    this.b = new Battle(this.opts.makeSetup());
    this.queue = [];
    this.mode = 'wait';
    this.armed = null;
    this.hold = false;
    this.menuOpen = false;
    this.release();
    this.build();
    this.startedAt = performance.now();
    void this.loop(this.run);
  }

  elapsedSeconds(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  // ───────────────────────── 화면 만들기

  private build() {
    clear(this.root);
    this.enemyEls.clear();
    this.cardEls.clear();
    this.tl = h('div', { class: 'bv-tl panel' });
    this.roundEl = h('span', { class: 'round-chip' });
    this.speedBtn = h('button', { class: 'btn', 'aria-label': '배속' }) as HTMLButtonElement;
    onPress(this.speedBtn, () => this.cycleSpeed(), { tip: () => '배속 바꾸기 (F)' });
    const pauseBtn = h('button', { class: 'btn', 'aria-label': '일시정지', text: 'Ⅱ' });
    onPress(pauseBtn, () => this.openMenu(), { tip: () => '일시정지 (Esc)' });
    const sys = h('div', { class: 'bv-sys' }, this.roundEl, this.speedBtn, pauseBtn);
    this.enemiesEl = h('div', { class: 'bv-enemies' });
    this.partyEl = h('div', { class: 'bv-party' });
    this.actionsEl = h('div', { class: 'bv-actions waiting' });
    this.fx = h('div', { class: 'fx' });
    this.root.append(this.tl, sys, this.enemiesEl, this.partyEl, this.actionsEl, this.fx);

    for (const u of this.b.enemies(false)) this.enemiesEl.append(this.buildEnemy(u));
    for (const u of this.b.allies(false)) this.partyEl.append(this.buildCard(u));
    this.renderSpeed();
    this.renderAll();
    this.renderActions();
  }

  private buildEnemy(u: Unit): HTMLElement {
    const def = DATA.enemies[u.defId];
    const shape = u.rank === 'boss' ? SHAPES.boss : SHAPES[def?.family ?? ''];
    const hp = h('i');
    const hpLag = h('i', { class: 'lag' });
    const fw = h('i');
    const els: EnemyEls = {
      root: h('div', { class: `enemy ${u.rank ?? ''}`, 'data-uid': u.uid, style: `--ecolor:${u.color};${shape ? `--shape:${shape}` : ''}` }),
      hp,
      hpLag,
      hpText: h('div', { class: 'bar-text' }),
      fw,
      weak: h('div', { class: 'weak-row' }),
      status: h('div', { class: 'status-row' }),
    };
    els.root.append(
      els.weak,
      h('div', { class: 'body' }, u.name.slice(0, 1)),
      h('span', { class: 'tag down-tag', text: 'DOWN' }),
      h('span', { class: 'tag charge-tag', text: '충전 중' }),
      h('div', { class: 'nm' }, u.name, h('small', { text: `Lv${u.level}` })),
      h('div', { class: 'bar' }, hpLag, hp),
      els.hpText,
      h('div', { class: 'bar fw' }, fw),
      els.status,
    );
    onPress(els.root, () => this.tapEnemy(u.uid), { tip: () => this.enemyTip(u.uid), hover: () => this.hoverEnemy(u.uid) });
    this.enemyEls.set(u.uid, els);
    return els.root;
  }

  private buildCard(u: Unit): HTMLElement {
    const el = ELEMENT_INFO[u.element];
    const hp = h('i');
    const hpLag = h('i', { class: 'lag' });
    const heat = h('i');
    const els: CardEls = {
      root: h('div', { class: 'card panel', 'data-uid': u.uid, style: `--elc:${el.color}` }),
      hp,
      hpLag,
      heat,
      status: h('div', { class: 'status-row' }),
    };
    els.root.append(
      h('div', { class: 'pf', style: `background:${u.color}` }, u.name.slice(0, 1)),
      h('div', { class: 'nm' }, h('span', { class: 'el-chip', style: `background:${el.color};width:18px;height:18px;font-size:11px` }, el.glyph), h('span', { text: u.name }), h('span', { class: 'key', text: String(u.slot + 1) })),
      h('div', { class: 'bar' }, hpLag, hp),
      h('div', { class: 'bar heat' }, heat),
      els.status,
      h('div', { class: 'oc-hint', text: '오버클럭!' }),
    );
    onPress(els.root, () => this.tapCard(u.uid), { tip: () => this.cardTip(u.uid) });
    this.cardEls.set(u.uid, els);
    return els.root;
  }

  // ───────────────────────── 그리기

  private renderAll() {
    for (const u of this.b.units) this.renderUnit(u.uid);
    this.renderCp();
    this.renderTimeline(this.b.order());
    this.roundEl.textContent = `${this.b.round()}라운드`;
  }

  private renderUnit(uid: string) {
    const u = this.b.unit(uid);
    if (u.side === 'enemy') {
      const els = this.enemyEls.get(uid);
      if (!els) return;
      els.root.classList.toggle('dead', !u.alive);
      els.root.classList.toggle('down', u.down);
      els.root.classList.toggle('charging', u.charging);
      this.setHp(els.hp, els.hpLag, u.hp / u.maxHp);
      els.hpText.textContent = `${fmt(u.hp)} / ${fmt(u.maxHp)}`;
      els.fw.style.width = `${u.firewallMax ? (u.firewall / u.firewallMax) * 100 : 0}%`;
      clear(els.weak);
      const base = new Set(u.weaknesses);
      for (const w of this.b.allWeaknesses(u)) {
        const info = ELEMENT_INFO[w];
        els.weak.append(h('span', { class: `el-chip${base.has(w) ? '' : ' added'}`, style: `background:${info.color};color:#0b0a1f`, title: info.name }, info.glyph));
      }
      this.renderStatus(els.status, u);
    } else {
      const els = this.cardEls.get(uid);
      if (!els) return;
      els.root.classList.toggle('dead', !u.alive);
      els.root.classList.toggle('ready', u.alive && u.heat >= u.heatMax);
      els.root.classList.toggle('active', this.b.active === uid && this.mode !== 'wait');
      this.setHp(els.hp, els.hpLag, u.hp / u.maxHp);
      els.heat.style.width = `${(u.heat / u.heatMax) * 100}%`;
      this.renderStatus(els.status, u);
    }
  }

  private setHp(bar: HTMLElement, lag: HTMLElement, frac: number) {
    const w = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    bar.style.width = w;
    lag.style.width = w;
  }

  private renderStatus(el: HTMLElement, u: Unit) {
    clear(el);
    for (const s of u.statuses) {
      if (s.id === 'weakAdd') continue;
      const def = DATA.statuses[s.id];
      if (!def) continue;
      const chip = h('span', { class: `st ${def.kind}`, text: `${def.icon}${s.id === 'shield' ? ` ${fmt(s.value)}` : ''}` });
      chip.title = `${def.name} (${s.turns}턴)`;
      el.append(chip);
    }
  }

  private renderCp() {
    let box = this.actionsEl.querySelector('.cp-box');
    if (!box) return;
    const pips = box.querySelectorAll('.cp-pip');
    pips.forEach((p, i) => p.classList.toggle('on', i < this.b.cp));
  }

  private renderTimeline(order: string[], preview = false) {
    const prev = this.lastOrder;
    clear(this.tl);
    this.tl.append(h('div', { class: 'tl-title', text: '순서' }));
    order.forEach((uid, i) => {
      const u = this.b.unit(uid);
      const slot = h('div', { class: `tl-slot side-${u.side}${i === 0 && this.b.phase === 'input' ? ' now' : ''}`, style: `background:${u.color}` }, u.name.slice(0, 1));
      if (preview) {
        const before = prev.indexOf(uid);
        if (before >= 0 && before !== i) slot.classList.add(before > i ? 'moved-up' : 'moved-down', 'preview');
      }
      slot.title = u.name;
      this.tl.append(slot);
    });
    if (!preview) this.lastOrder = order;
  }

  private renderSpeed() {
    this.speedBtn.textContent = `${this.speed}x`;
  }

  /** 행동 버튼 영역 */
  private renderActions() {
    const a = this.actionsEl;
    clear(a);
    const cp = h('div', { class: 'cp-box' }, h('span', { class: 'lbl', text: 'CP' }), ...Array.from({ length: this.b.cpMax }, (_, i) => h('span', { class: `cp-pip${i < this.b.cp ? ' on' : ''}` })));
    a.append(cp);
    a.classList.toggle('waiting', this.mode === 'wait');
    if (this.mode === 'armed' && this.armed) {
      const u = this.b.unit(this.armed);
      const sk = u.skills.overclock!;
      const go = h('button', { class: 'act-btn oc skill' }, h('span', { class: 'k', text: `${u.name} 오버클럭` }), h('span', { class: 'n', text: sk.name }), h('span', { class: 'kb', text: 'Space' }));
      onPress(go, () => this.fireOverclock(), { tip: () => sk.desc });
      const cancel = h('button', { class: 'act-btn basic' }, h('span', { class: 'k', text: '되돌리기' }), h('span', { class: 'n', text: '취소' }), h('span', { class: 'kb', text: 'Esc' }));
      onPress(cancel, () => this.disarm());
      a.append(cancel, go, h('div', { class: 'hint', text: this.isEnemyMode(sk.target) && sk.target !== 'allEnemies' ? '적을 눌러 발동' : '한 번 더 눌러 발동' }));
      return;
    }
    const u = this.b.activeUnit;
    const actor = u && u.side === 'ally' && this.mode === 'input' ? u : null;
    for (const k of ['basic', 'skill'] as const) {
      const sk = actor?.skills[k];
      const btn = h('button', { class: `act-btn ${k}${actor && this.kind === k ? ' sel' : ''}` }) as HTMLButtonElement;
      btn.append(
        h('span', { class: 'k', text: KIND_NAME[k] }),
        h('span', { class: 'n', text: sk?.name ?? '—' }),
        h('span', { class: `cost ${k === 'basic' ? 'plus' : 'minus'}`, text: k === 'basic' ? 'CP +1' : 'CP −1' }),
        h('span', { class: 'kb', text: k === 'basic' ? 'Q' : 'E' }),
      );
      if (actor && sk && this.b.hitsWeakness(actor.uid, k, this.kind === k ? this.cursor : this.b.defaultTarget(actor.uid, k))) btn.append(h('span', { class: 'weak-badge', text: '약점!' }));
      if (actor && k === 'skill' && (!this.b.canUseSkill() || !this.b.validTargets(actor.uid, 'skill').length)) btn.disabled = true;
      onPress(btn, () => this.tapKind(k), { tip: () => (sk ? `${sk.name}\n${sk.desc}` : null) });
      a.append(btn);
    }
    a.append(h('div', { class: 'hint', text: actor ? this.hintText() : '' }));
  }

  private hintText(): string {
    const u = this.b.activeUnit!;
    const mode = u.skills[this.kind]!.target;
    if (mode === 'ally' || mode === 'allyOther') return '아군 카드를 눌러 대상 선택';
    if (mode === 'allEnemies' || mode === 'allAllies' || mode === 'self') return '버튼을 한 번 더 누르거나 적을 눌러 발동';
    return '적을 눌러 공격';
  }

  private renderCursor() {
    for (const [uid, els] of this.enemyEls) {
      els.root.classList.remove('cursor', 'area-cursor');
      els.root.querySelector('.weak-badge')?.remove();
      void uid;
    }
    for (const els of this.cardEls.values()) els.root.classList.remove('cursor', 'armed');
    let actorUid: string | null = null;
    let kind: SkillKind | null = null;
    let cur: string | undefined;
    if (this.mode === 'armed' && this.armed) {
      actorUid = this.armed;
      kind = 'overclock';
      cur = this.armedCursor;
      this.cardEls.get(this.armed)?.root.classList.add('armed');
    } else if (this.mode === 'input' && this.b.activeUnit) {
      actorUid = this.b.activeUnit.uid;
      kind = this.kind;
      cur = this.cursor;
    }
    if (!actorUid || !kind) return;
    const actor = this.b.unit(actorUid);
    const mode = actor.skills[kind]!.target;
    const mark = (uid: string, cls: string) => {
      const u = this.b.unit(uid);
      const root = u.side === 'enemy' ? this.enemyEls.get(uid)?.root : this.cardEls.get(uid)?.root;
      if (!root) return;
      root.classList.add(cls);
      if (u.side === 'enemy' && this.b.isWeak(u, actor.element) && actor.skills[kind!]!.effects.some((e) => e.type === 'damage')) root.append(h('span', { class: 'weak-badge', text: '약점!' }));
    };
    if (mode === 'allEnemies') this.b.enemies().forEach((e) => mark(e.uid, 'area-cursor'));
    else if (mode === 'allAllies') this.b.allies().forEach((e) => mark(e.uid, 'cursor'));
    else if (mode === 'blast' && cur) {
      mark(cur, 'cursor');
      const row = this.b.enemies().sort((x, y) => x.slot - y.slot);
      const i = row.findIndex((x) => x.uid === cur);
      [row[i - 1], row[i + 1]].filter(Boolean).forEach((x) => mark(x!.uid, 'area-cursor'));
    } else if (cur) mark(cur, 'cursor');
  }

  private updatePreview() {
    if (this.mode === 'input') this.renderTimeline(this.b.previewAct(this.kind, this.cursor), true);
    else if (this.mode === 'armed' && this.armed) this.renderTimeline(this.b.previewOverclock(this.armed, this.armedCursor), true);
  }

  // ───────────────────────── 진행

  private async loop(run = this.run) {
    while (!this.destroyed && run === this.run) {
      await this.drain();
      if (this.destroyed || run !== this.run) return;
      if (this.b.ended) return this.finish();
      if (this.hold || this.menuOpen) {
        await this.gate();
        continue;
      }
      if (this.b.phase === 'idle') {
        this.enqueue(this.b.advance());
        continue;
      }
      if (this.b.phase === 'input') {
        await this.enterInput();
        return;
      }
    }
  }

  private enqueue(events: BattleEvent[]) {
    this.queue.push(...events);
    if (!this.pumping) {
      const run = this.run;
      this.pumping = this.pump(run).finally(() => (this.pumping = null));
    }
  }

  private async drain() {
    while (this.pumping) await this.pumping;
  }

  private async pump(run: number) {
    while (this.queue.length && !this.destroyed && run === this.run) {
      await this.gate();
      if (run !== this.run) return;
      const e = this.queue.shift()!;
      const ms = await this.apply(e);
      await this.opts.hooks?.onEvent?.(this, e);
      if (ms > 0) await sleep(ms / this.speed);
    }
    if (!this.destroyed && run === this.run) this.renderAll();
  }

  private async gate() {
    while ((this.hold || this.menuOpen) && !this.destroyed) await new Promise<void>((r) => this.waiters.push(r));
  }

  private release() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((r) => r());
  }

  private async enterInput() {
    this.mode = 'input';
    const u = this.b.activeUnit!;
    this.kind = 'basic';
    this.cursor = this.b.defaultTarget(u.uid, 'basic');
    this.renderAll();
    this.renderActions();
    this.renderCursor();
    this.updatePreview();
    await this.opts.hooks?.onInput?.(this);
  }

  /** 지금 차례의 행동 실행 */
  doAct(kind: 'basic' | 'skill', target?: string) {
    if (this.mode !== 'input' || this.destroyed) return;
    const u = this.b.activeUnit!;
    if (kind === 'skill' && !this.b.canUseSkill()) return;
    const valid = this.b.validTargets(u.uid, kind);
    if (target && !valid.includes(target)) return;
    if (!target && !valid.length) return;
    this.mode = 'wait';
    hideTip();
    this.renderCursor();
    this.renderActions();
    sfx('confirm');
    this.enqueue(this.b.act(kind, target ?? this.b.defaultTarget(u.uid, kind)));
    void this.loop(this.run);
  }

  private finish() {
    this.mode = 'wait';
    this.renderAll();
    this.renderActions();
    if (this.b.phase === 'won') void this.showWin();
    else this.showLose();
  }

  // ───────────────────────── 입력

  private isEnemyMode(mode: string) {
    return mode === 'enemy' || mode === 'blast' || mode === 'allEnemies';
  }

  tapKind(k: 'basic' | 'skill') {
    if (this.mode !== 'input') return;
    const u = this.b.activeUnit!;
    if (k === 'skill' && (!this.b.canUseSkill() || !this.b.validTargets(u.uid, 'skill').length)) return;
    if (this.kind === k) {
      this.doAct(k, this.cursor);
      return;
    }
    sfx('select');
    this.kind = k;
    const valid = this.b.validTargets(u.uid, k);
    if (!this.cursor || !valid.includes(this.cursor)) this.cursor = this.b.defaultTarget(u.uid, k);
    const mode = u.skills[k]!.target;
    if ((mode === 'enemy' || mode === 'blast') && this.cursor && this.b.unit(this.cursor).side !== 'enemy') this.cursor = this.b.defaultTarget(u.uid, k);
    if ((mode === 'ally' || mode === 'allyOther') && this.cursor && !valid.includes(this.cursor)) this.cursor = this.b.defaultTarget(u.uid, k);
    if (this.isEnemyMode(mode) && this.cursor && this.b.unit(this.cursor).side !== 'enemy') this.cursor = this.b.defaultTarget(u.uid, k);
    this.renderActions();
    this.renderCursor();
    this.updatePreview();
  }

  private tapEnemy(uid: string) {
    if (!this.b.unit(uid).alive) return;
    if (this.mode === 'armed' && this.armed) {
      const mode = this.b.unit(this.armed).skills.overclock!.target;
      if (this.isEnemyMode(mode)) {
        this.armedCursor = uid;
        this.fireOverclock();
      }
      return;
    }
    if (this.mode !== 'input') return;
    const u = this.b.activeUnit!;
    const mode = u.skills[this.kind]!.target;
    if (this.isEnemyMode(mode)) this.doAct(this.kind, uid);
    else {
      this.kind = 'basic';
      this.cursor = uid;
      this.renderActions();
      this.renderCursor();
      this.updatePreview();
    }
  }

  private hoverEnemy(uid: string) {
    if (!this.b.unit(uid).alive) return;
    if (this.mode === 'input') {
      const mode = this.b.activeUnit!.skills[this.kind]!.target;
      if (mode === 'enemy' || mode === 'blast') {
        this.cursor = uid;
        this.renderCursor();
        this.renderActions();
        this.updatePreview();
      }
    } else if (this.mode === 'armed' && this.armed) {
      const mode = this.b.unit(this.armed).skills.overclock!.target;
      if (mode === 'enemy' || mode === 'blast') {
        this.armedCursor = uid;
        this.renderCursor();
        this.updatePreview();
      }
    }
  }

  private tapCard(uid: string) {
    const u = this.b.unit(uid);
    if (this.mode === 'input') {
      const actor = this.b.activeUnit!;
      const mode = actor.skills[this.kind]!.target;
      if (mode === 'ally' || mode === 'allyOther') {
        if (this.b.validTargets(actor.uid, this.kind).includes(uid)) this.doAct(this.kind, uid);
        return;
      }
    }
    if (this.mode === 'armed' && this.armed) {
      const mode = this.b.unit(this.armed).skills.overclock!.target;
      if (uid === this.armed) return this.fireOverclock();
      if ((mode === 'ally' || mode === 'allyOther') && u.alive) {
        this.armedCursor = uid;
        return this.fireOverclock();
      }
    }
    if (this.b.canOverclock(uid)) this.arm(uid);
  }

  arm(uid: string) {
    if (!this.b.canOverclock(uid) || this.destroyed) return;
    sfx('select');
    this.armed = uid;
    this.armedCursor = this.b.defaultTarget(uid, 'overclock');
    const prev = this.mode;
    this.mode = 'armed';
    if (prev === 'wait') this.hold = true;
    this.armedFrom = prev;
    this.renderAll();
    this.renderActions();
    this.renderCursor();
    this.updatePreview();
  }

  private armedFrom: Mode = 'wait';

  private disarm() {
    if (this.mode !== 'armed') return;
    this.armed = null;
    this.mode = this.armedFrom;
    this.hold = false;
    this.release();
    this.renderActions();
    this.renderCursor();
    if (this.mode === 'input') this.updatePreview();
    else this.renderTimeline(this.b.order());
  }

  private fireOverclock() {
    if (this.mode !== 'armed' || !this.armed) return;
    const uid = this.armed;
    const target = this.armedCursor;
    const from = this.armedFrom;
    this.armed = null;
    this.mode = 'wait';
    hideTip();
    this.renderCursor();
    this.renderActions();
    if (!this.b.canOverclock(uid)) {
      this.mode = from;
      this.hold = false;
      this.release();
      return;
    }
    this.enqueue(this.b.overclock(uid, target));
    this.hold = false;
    this.release();
    const run = this.run;
    if (from === 'input') {
      void (async () => {
        await this.drain();
        if (this.destroyed || run !== this.run) return;
        if (this.b.ended) return this.finish();
        if (this.b.phase === 'input') await this.enterInput();
        else void this.loop(run);
      })();
    }
  }

  private moveCursor(dir: 1 | -1) {
    const isArmed = this.mode === 'armed' && this.armed;
    const actor = isArmed ? this.b.unit(this.armed!) : this.b.activeUnit;
    if (!actor) return;
    const kind: SkillKind = isArmed ? 'overclock' : this.kind;
    const list = this.b.validTargets(actor.uid, kind).map((x) => this.b.unit(x)).sort((a, b) => a.slot - b.slot).map((x) => x.uid);
    if (!list.length) return;
    const cur = isArmed ? this.armedCursor : this.cursor;
    const i = Math.max(0, list.indexOf(cur ?? ''));
    const next = list[(i + dir + list.length) % list.length];
    if (isArmed) this.armedCursor = next;
    else this.cursor = next;
    this.renderCursor();
    this.renderActions();
    this.updatePreview();
  }

  private onKey(e: KeyboardEvent) {
    if (this.destroyed || e.repeat) return;
    if (document.querySelector('.modal-back') && e.key !== 'Escape') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      if (this.mode === 'armed') this.disarm();
      else if (this.menuOpen) this.closeMenu();
      else this.openMenu();
      e.preventDefault();
      return;
    }
    if (this.menuOpen) return;
    if (k === 'f') this.cycleSpeed();
    else if (k === 'q') this.tapKind('basic');
    else if (k === 'e') this.tapKind('skill');
    else if (k === 'arrowleft') this.moveCursor(-1);
    else if (k === 'arrowright') this.moveCursor(1);
    else if (k === ' ' || k === 'enter') {
      if (this.mode === 'armed') this.fireOverclock();
      else if (this.mode === 'input') this.doAct(this.kind, this.cursor);
    } else if (/^[1-5]$/.test(k)) {
      const uid = `a${Number(k) - 1}`;
      if (this.mode === 'armed' && this.armed === uid) this.fireOverclock();
      else if (this.b.units.some((x) => x.uid === uid)) {
        if (this.mode === 'armed') this.disarm();
        this.arm(uid);
      }
    } else return;
    e.preventDefault();
  }

  private cycleSpeed() {
    const s = this.opts.settings;
    s.speed = s.speed === 1 ? 2 : s.speed === 2 ? 3 : 1;
    this.opts.saveSettings();
    this.renderSpeed();
    sfx('select');
  }

  // ───────────────────────── 이벤트 연출

  private pos(uid: string): { x: number; y: number } {
    const u = this.b.unit(uid);
    const el = u.side === 'enemy' ? this.enemyEls.get(uid)?.root.querySelector('.body') : this.cardEls.get(uid)?.root;
    const r = (el ?? this.root).getBoundingClientRect();
    const base = this.root.getBoundingClientRect();
    return { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
  }

  private float(uid: string, text: string, cls: string, color?: string) {
    const p = this.pos(uid);
    const jitter = (Math.random() - 0.5) * 36;
    const n = h('div', { class: `num ${cls}`, style: `left:${p.x + jitter}px;top:${p.y}px;${color ? `--numc:${color}` : ''}`, text });
    this.fx.append(n);
    setTimeout(() => n.remove(), 950);
  }

  private banner(text: string, enemy = false, ms = 900, line = false) {
    this.fx.querySelectorAll('.banner').forEach((b) => b.remove());
    const b = h('div', { class: `banner${enemy ? ' enemy' : ''}${line ? ' line' : ''}`, text });
    this.fx.append(b);
    setTimeout(() => b.remove(), ms / this.speed + 200);
  }

  private flashClass(el: HTMLElement | undefined, cls: string, ms: number) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  /** 이벤트 하나를 보여 주고, 1배속 기준 기다릴 시간(ms)을 돌려준다 */
  private async apply(e: BattleEvent): Promise<number> {
    switch (e.t) {
      case 'start':
        if (this.opts.boss && !this.opts.settings.skipBossIntro) {
          const boss = this.b.enemies().find((x) => x.rank === 'boss');
          const intro = boss ? DATA.enemies[boss.defId]?.intro : undefined;
          if (boss) this.banner(intro ? `${boss.name}: ${intro}` : `${boss.name} 등장`, true, 1800, true);
          return boss ? 1600 : 0;
        }
        return 200;
      case 'turn': {
        this.roundEl.textContent = `${this.b.round()}라운드`;
        this.renderTimeline(this.b.order());
        const u = this.b.unit(e.uid);
        if (u.side === 'enemy') this.flashClass(this.enemyEls.get(e.uid)?.root, 'acting', 450);
        return u.side === 'enemy' ? 250 : 0;
      }
      case 'action': {
        const u = this.b.unit(e.uid);
        if (e.kind === 'overclock') {
          await this.cutin(u);
          sfx('overclock');
          this.banner(`${u.name} — ${e.name}`, false, 900);
          return 500;
        }
        if (e.kind === 'counter') {
          this.float(e.uid, '반격!', 'info');
          this.flashClass(this.cardEls.get(e.uid)?.root, 'active', 350);
          return 300;
        }
        if (u.side === 'enemy') {
          this.banner(e.name, true, 700);
          this.flashClass(this.enemyEls.get(e.uid)?.root, 'acting', 500);
          sfx('enemy');
          return 550;
        }
        this.banner(e.name, false, 600);
        const card = this.cardEls.get(e.uid)?.root;
        if (card) {
          card.style.transform = 'translateY(-22px) scale(1.04)';
          setTimeout(() => (card.style.transform = ''), 320 / this.speed);
        }
        sfx('attack');
        return 420;
      }
      case 'damage': {
        const u = this.b.unit(e.uid);
        const info = ELEMENT_INFO[e.element];
        const cls = e.kind === 'dot' || e.kind === 'freeze' ? 'dot' : e.kind === 'break' ? 'break' : e.crit ? 'crit' : e.weak ? 'weak' : '';
        this.float(e.uid, `${fmt(e.amount)}${e.crit ? '!' : ''}`, cls, info.color);
        if (e.absorbed) this.float(e.uid, `보호막 ${fmt(e.absorbed)}`, 'info small');
        this.flashClass(u.side === 'enemy' ? this.enemyEls.get(e.uid)?.root : this.cardEls.get(e.uid)?.root, 'hit', 340);
        if (u.side === 'enemy') {
          const els = this.enemyEls.get(e.uid)!;
          els.hp.style.width = `${(e.hp / u.maxHp) * 100}%`;
          els.hpText.textContent = `${fmt(e.hp)} / ${fmt(u.maxHp)}`;
          setTimeout(() => (els.hpLag.style.width = els.hp.style.width), 80);
        } else {
          const els = this.cardEls.get(e.uid)!;
          els.hp.style.width = `${(e.hp / u.maxHp) * 100}%`;
          setTimeout(() => (els.hpLag.style.width = els.hp.style.width), 80);
        }
        sfx(e.crit ? 'crit' : 'hit', e.element);
        return e.kind === 'dot' ? 260 : 150;
      }
      case 'heal':
        if (e.amount > 0) this.float(e.uid, `+${fmt(e.amount)}`, 'heal');
        this.renderUnit(e.uid);
        if (e.amount > 0) sfx('heal');
        return e.amount > 0 ? 160 : 0;
      case 'shield':
        this.float(e.uid, `보호막 +${fmt(e.amount)}`, 'info small');
        this.renderUnit(e.uid);
        sfx('shield');
        return 140;
      case 'firewall': {
        const u = this.b.unit(e.uid);
        const els = this.enemyEls.get(e.uid);
        if (els) els.fw.style.width = `${u.firewallMax ? (e.value / u.firewallMax) * 100 : 0}%`;
        sfx('firewall');
        return 90;
      }
      case 'down': {
        const els = this.enemyEls.get(e.uid);
        els?.root.classList.add('down');
        const fx = h('div', { class: 'down-fx' }, h('span', { text: 'SYSTEM DOWN' }));
        this.fx.append(fx);
        setTimeout(() => fx.remove(), 760);
        sfx('down', e.element);
        return 720;
      }
      case 'recover':
        this.renderUnit(e.uid);
        this.float(e.uid, '방화벽 복구', 'info small');
        return 300;
      case 'status':
        this.renderUnit(e.uid);
        return 30;
      case 'resist':
        this.float(e.uid, '저항', 'info small');
        return 120;
      case 'av':
        this.float(e.uid, e.pct > 0 ? '▲ 행동 당김' : '▼ 행동 밀림', 'info small');
        this.renderTimeline(this.b.order());
        return 160;
      case 'cp':
        this.renderCp();
        return 40;
      case 'heat':
        this.renderUnit(e.uid);
        return 0;
      case 'death': {
        const u = this.b.unit(e.uid);
        this.renderUnit(e.uid);
        sfx(u.side === 'enemy' ? 'kill' : 'ko');
        return 380;
      }
      case 'revive':
        this.renderUnit(e.uid);
        this.float(e.uid, '부활', 'heal');
        return 300;
      case 'skip':
        this.float(e.uid, '동결 — 행동 불가', 'info');
        this.renderUnit(e.uid);
        return 520;
      case 'charge':
        this.renderUnit(e.uid);
        this.banner(`⚡ ${e.line}`, true, 1400, true);
        sfx('charge');
        return 900;
      case 'chargeCancel':
        this.float(e.uid, '충전 취소!', 'break');
        this.renderUnit(e.uid);
        return 400;
      case 'phase':
        this.renderUnit(e.uid);
        this.banner(`${this.b.unit(e.uid).name}: ${e.line}`, true, 2000, true);
        return 1400;
      case 'weakAdd':
        this.renderUnit(e.uid);
        this.float(e.uid, `약점 추가: ${ELEMENT_INFO[e.element].name}`, 'info small');
        return 220;
      case 'end':
        return 300;
    }
  }

  private async cutin(u: Unit) {
    const s = this.opts.settings.cutin;
    const seen = this.opts.seenCutins.has(u.defId);
    if (s === 'never' || (s === 'first' && seen)) return;
    this.opts.markCutin(u.defId);
    const def = DATA.characters[u.defId];
    const el = ELEMENT_INFO[u.element];
    this.skipCutin = false;
    const box = h(
      'div',
      { class: 'cutin', style: `--elc:${el.color}` },
      h('div', { class: 'strip' }, h('div', { class: 'face', style: `background:${u.color}` }, u.name.slice(0, 1)), h('div', { class: 'txt' }, h('div', { class: 'sk', text: u.skills.overclock?.name ?? '' }), h('div', { class: 'ln', text: def?.lines.overclock ?? '' }))),
      h('div', { class: 'skip', text: '눌러서 넘기기' }),
    );
    box.addEventListener('pointerdown', () => (this.skipCutin = true));
    this.root.append(box);
    const total = 1500 / this.speed;
    const t0 = performance.now();
    while (!this.skipCutin && performance.now() - t0 < total && !this.destroyed) await sleep(40);
    box.remove();
  }

  // ───────────────────────── 툴팁

  private enemyTip(uid: string): HTMLElement {
    const u = this.b.unit(uid);
    const def = DATA.enemies[u.defId];
    const box = h('div');
    box.append(h('b', { text: `${u.name} Lv${u.level}` }), '\n');
    box.append(`약점: ${this.b.allWeaknesses(u).map((w) => ELEMENT_INFO[w].name).join(', ')}\n`);
    box.append(`방화벽 ${Math.ceil(u.firewall)} / ${u.firewallMax}${u.down ? ' (시스템 다운)' : ''}\n`);
    if (u.charging) box.append('⚡ 충전 중: 다운시키면 취소된다\n');
    for (const s of u.statuses) {
      const sd = DATA.statuses[s.id];
      if (sd && s.id !== 'weakAdd') box.append(`· ${sd.name} ${s.turns}턴\n`);
    }
    if (def?.desc) box.append(def.desc);
    return box;
  }

  private cardTip(uid: string): HTMLElement {
    const u = this.b.unit(uid);
    const box = h('div');
    const p = u.protocol ? PROTOCOL_INFO[u.protocol] : null;
    box.append(h('b', { text: `${u.name} Lv${u.level}` }), ` ${ELEMENT_INFO[u.element].name}${p ? ` · ${p.name}` : ''}\n`);
    box.append(`체력 ${fmt(u.hp)} / ${fmt(u.maxHp)} · 열량 ${Math.floor(u.heat)} / ${u.heatMax}\n`);
    const oc = u.skills.overclock;
    if (oc) box.append(`오버클럭 「${oc.name}」 ${oc.desc}\n`);
    for (const s of u.statuses) {
      const sd = DATA.statuses[s.id];
      if (sd) box.append(`· ${sd.name} ${s.turns}턴\n`);
    }
    if (u.heat >= u.heatMax) box.append('카드를 눌러 바로 발동!');
    return box;
  }

  // ───────────────────────── 메뉴·결과

  private modal(content: HTMLElement): HTMLElement {
    const back = h('div', { class: 'modal-back' }, content);
    this.root.append(back);
    return back;
  }

  private openMenu() {
    if (this.menuOpen || this.b.ended) return;
    this.menuOpen = true;
    hideTip();
    const s = this.opts.settings;
    const seg = <T extends string | number>(vals: [T, string][], cur: () => T, set: (v: T) => void) => {
      const box = h('div', { class: 'seg' });
      const draw = () => {
        clear(box);
        for (const [v, label] of vals) {
          const b = h('button', { class: cur() === v ? 'on' : '', text: label });
          onPress(b, () => {
            set(v);
            this.opts.saveSettings();
            draw();
          });
          box.append(b);
        }
      };
      draw();
      return box;
    };
    const resume = h('button', { class: 'btn primary big', text: '계속하기' });
    const restart = h('button', { class: 'btn', text: '처음부터 다시' });
    const panel = h(
      'div',
      { class: 'modal panel' },
      h('h2', { text: '일시정지' }),
      h('div', { class: 'muted', text: '난이도는 언제든 바꿀 수 있고, 보상은 똑같아. 바꾼 난이도는 다음 전투(또는 다시 시작)부터 적용돼.' }),
      h('div', { class: 'row' }, h('span', { text: '난이도' }), seg<'story' | 'normal'>([['story', '스토리'], ['normal', '보통']], () => s.difficulty, (v) => (s.difficulty = v))),
      h('div', { class: 'row' }, h('span', { text: '배속' }), seg<1 | 2 | 3>([[1, '1x'], [2, '2x'], [3, '3x']], () => s.speed, (v) => ((s.speed = v), this.renderSpeed()))),
      h('div', { class: 'row' }, h('span', { text: '오버클럭 컷인' }), seg<'first' | 'always' | 'never'>([['first', '첫 1회'], ['always', '항상'], ['never', '끄기']], () => s.cutin, (v) => (s.cutin = v))),
      h('div', { class: 'row' }, h('span', { text: '승리 연출' }), seg<'on' | 'off'>([['on', '보기'], ['off', '건너뛰기']], () => (s.skipVictory ? 'off' : 'on'), (v) => (s.skipVictory = v === 'off'))),
      h('div', { class: 'row' }, h('span', { text: '보스 등장 연출' }), seg<'on' | 'off'>([['on', '보기'], ['off', '건너뛰기']], () => (s.skipBossIntro ? 'off' : 'on'), (v) => (s.skipBossIntro = v === 'off'))),
      resume,
      restart,
    );
    if (this.opts.onQuit) {
      const quit = h('button', { class: 'btn ghost', text: '그만두기' });
      onPress(quit, () => {
        this.closeMenu();
        this.opts.onQuit!();
      });
      panel.append(quit);
    }
    const back = this.modal(panel);
    onPress(resume, () => this.closeMenu());
    onPress(restart, () => {
      back.remove();
      this.menuOpen = false;
      this.restart();
    });
  }

  private closeMenu() {
    this.root.querySelector('.modal-back')?.remove();
    this.menuOpen = false;
    this.release();
  }

  restart() {
    this.queue = [];
    this.start();
  }

  private async showWin() {
    sfx('win');
    if (!this.opts.settings.skipVictory) {
      const fx = h('div', { class: 'down-fx' }, h('span', { text: 'MISSION CLEAR', style: 'color:var(--cyan)' }));
      this.fx.append(fx);
      await sleep(1100 / this.speed);
      fx.remove();
    }
    this.opts.onWin(this.b);
  }

  private showLose() {
    sfx('lose');
    const retry = h('button', { class: 'btn primary big', text: '다시 도전' });
    const lower = h('button', { class: 'btn big cyan', text: '난이도 낮춰서 다시 도전' });
    const party = h('button', { class: 'btn', text: '편성 바꾸기' });
    const panel = h('div', { class: 'modal panel result' }, h('div', { class: 'headline lose', text: '작전 실패' }), h('div', { class: 'muted', text: '잃은 건 없어. 전투 직전부터 다시 할 수 있어.' }), retry);
    if (this.opts.settings.difficulty !== 'story') panel.append(lower);
    if (this.opts.onChangeParty) panel.append(party);
    const back = this.modal(panel);
    onPress(retry, () => {
      back.remove();
      this.restart();
    });
    onPress(lower, () => {
      back.remove();
      this.opts.settings.difficulty = 'story';
      this.opts.saveSettings();
      this.restart();
    });
    onPress(party, () => {
      back.remove();
      this.opts.onChangeParty?.();
    });
  }
}
