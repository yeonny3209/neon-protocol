// 전투 계산. 화면이 없어도 돌아가고, 같은 시드·같은 입력이면 항상 같은 결과가 나온다.
// 화면은 advance/act/overclock가 돌려주는 이벤트를 받아 연출만 한다. 배속·연출 스킵은 여기 들어오지 않는다.
import type { Cond, CondMod, Effect, Element, EnemyAction, ModKey, Passive, SkillDef, SkillKind, TargetMode, Who } from '../defs';
import { DATA, type Balance, type GameData } from '../data';
import { createRng, fixedRng, pickWeighted, type Rng } from '../rng';
import { ascForLevel, statMult } from '../loadout';
import type { AllySetup, BattleEvent, BattleSetup, BattleStats, DamageKind, Side, StatusInst, TriggerInst, Unit } from './types';

export type Phase = 'idle' | 'input' | 'won' | 'lost';
type ActKind = SkillKind | 'counter' | 'enemy';

interface Ctx {
  src: Unit;
  kind: ActKind;
  mode: TargetMode;
  targets: Unit[];
  main?: Unit;
  firewallDone: Set<string>;
  /** 트리거로 실행될 때 관련 유닛(반격 대상 등) */
  related?: Unit;
}

interface PendingTrigger {
  owner: Unit;
  inst: TriggerInst;
  related?: Unit;
}

const DOT_IDS = new Set(['bleed', 'overheat', 'shock', 'virus']);

export class Battle {
  units: Unit[] = [];
  cp = 0;
  cpMax = 0;
  phase: Phase = 'idle';
  active: string | null = null;
  time = 0;
  seed = 0;
  stats: BattleStats = { downs: 0, maxDownAtOnce: 0, overclocks: 0, kills: 0, crits: 0, maxHit: 0, allyActions: 0, enemyActions: 0, koAllies: 0, skillsUsed: 0 };
  elementBonus: Partial<Record<Element, number>> = {};
  private events: BattleEvent[] = [];
  private pending: PendingTrigger[] = [];
  private rng!: Rng;
  private D!: GameData;
  private B!: Balance['battle'];
  private started = false;

  constructor(setup: BattleSetup, data: GameData = DATA) {
    this.D = data;
    this.B = data.balance.battle;
    this.seed = setup.seed;
    this.rng = createRng(setup.seed);
    this.cpMax = this.B.cp.max;
    this.cp = this.B.cp.start;
    this.elementBonus = setup.elementBonus ?? {};
    setup.allies.forEach((a, i) => this.units.push(this.makeAlly(a, i, setup)));
    setup.enemies.forEach((e, i) => this.units.push(this.makeEnemy(e.defId, e.level, i, setup)));
    for (const u of this.units) {
      u.av = this.fullDist(u);
      if (setup.ambush && u.side === 'ally') u.av *= 1 - this.B.ambushPct;
    }
  }

  // ───────────────────────── 만들기

  private makeAlly(a: AllySetup, slot: number, setup: BattleSetup): Unit {
    const passives: Passive[] = [...a.passives, ...(setup.allyPassives ?? [])];
    const mods: Record<string, number> = { ...(setup.allyMods ?? {}) };
    const condMods: CondMod[] = [];
    const triggers: TriggerInst[] = [];
    const skills: Record<SkillKind, SkillDef> = {
      basic: { ...a.skills.basic, effects: [...a.skills.basic.effects] },
      skill: { ...a.skills.skill, effects: [...a.skills.skill.effects] },
      overclock: { ...a.skills.overclock, effects: [...a.skills.overclock.effects] },
    };
    for (const p of passives) {
      for (const [k, v] of Object.entries(p.mods ?? {})) mods[k] = (mods[k] ?? 0) + (v as number);
      condMods.push(...(p.condMods ?? []));
      for (const t of p.triggers ?? []) triggers.push({ t, name: p.name ?? '', used: false, usedBattle: false });
      for (const add of p.skillAdds ?? []) skills[add.kind].effects.push(...add.effects);
    }
    const base = { ...a.stats };
    const maxHp = Math.round(base.hp * (1 + (mods.hpPct ?? 0)));
    return {
      uid: `a${slot}`, side: 'ally', slot, defId: a.defId, name: a.name, element: a.element, protocol: a.protocol,
      level: a.level, color: a.color, base, mods, condMods, triggers, skills,
      hp: Math.max(1, Math.round(maxHp * (a.hpFrac ?? 1))), maxHp, av: 0,
      heat: a.heat ?? 0, heatMax: a.heatMax,
      firewall: 0, firewallMax: 0, weaknesses: [], down: false, statuses: [],
      alive: (a.hpFrac ?? 1) > 0, trial: a.trial, phaseIdx: 0, chargeCount: 0, charging: false,
    };
  }

  private makeEnemy(defId: string, level: number, slot: number, setup: BattleSetup): Unit {
    const def = this.D.enemies[defId];
    if (!def) throw new Error(`없는 적: ${defId}`);
    const diff = setup.diffMult ?? (setup.difficulty === 'fixed' ? { enemyHp: 1, enemyAtk: 1, enemyFirewall: 1 } : this.D.balance.difficulty[setup.difficulty]);
    const mult = statMult(level, ascForLevel(level, this.D), this.D);
    const mods: Record<string, number> = { ...(setup.enemyMods ?? {}) };
    const hp = Math.round(def.stats.hp * mult * diff.enemyHp * (1 + (mods.hpPct ?? 0)));
    const fw = Math.round(def.firewall * diff.enemyFirewall);
    return {
      uid: `e${slot}`, side: 'enemy', slot, defId, name: def.name, element: def.element, rank: def.rank,
      level, color: def.color,
      base: { hp, atk: def.stats.atk * mult * diff.enemyAtk, def: def.stats.def, spd: def.stats.spd, critRate: 0, critDmg: 0.5, effHit: def.stats.effHit ?? 0, effRes: def.stats.effRes ?? 0 },
      mods, condMods: [], triggers: [], skills: {},
      hp, maxHp: hp, av: 0, heat: 0, heatMax: 0,
      firewall: fw, firewallMax: fw, weaknesses: [...def.weaknesses], down: false, statuses: [], alive: true,
      actions: def.actions, cooldowns: def.actions.map(() => 0),
      phases: def.phases ? [...def.phases].sort((x, y) => y.hpBelow - x.hpBelow) : undefined, phaseIdx: 0,
      charge: def.charge, chargeCount: 0, charging: false,
    };
  }

  /** 미리보기용 복제. rng를 주면 그걸 쓴다 */
  clone(rng?: Rng): Battle {
    const b = Object.create(Battle.prototype) as Battle;
    b.D = this.D;
    b.B = this.B;
    b.units = structuredClone(this.units);
    b.cp = this.cp;
    b.cpMax = this.cpMax;
    b.phase = this.phase;
    b.active = this.active;
    b.time = this.time;
    b.seed = this.seed;
    b.stats = { ...this.stats };
    b.elementBonus = this.elementBonus;
    b.events = [];
    b.pending = [];
    b.rng = rng ?? createRng(this.rng.state());
    b.started = this.started;
    return b;
  }

  // ───────────────────────── 조회

  unit(uid: string): Unit {
    const u = this.units.find((x) => x.uid === uid);
    if (!u) throw new Error(`없는 유닛: ${uid}`);
    return u;
  }

  allies(alive = true): Unit[] {
    return this.units.filter((u) => u.side === 'ally' && (!alive || u.alive));
  }

  enemies(alive = true): Unit[] {
    return this.units.filter((u) => u.side === 'enemy' && (!alive || u.alive));
  }

  get ended(): boolean {
    return this.phase === 'won' || this.phase === 'lost';
  }

  get activeUnit(): Unit | null {
    return this.active ? this.unit(this.active) : null;
  }

  round(): number {
    const r = this.B.rounds;
    return this.time < r.first ? 1 : 2 + Math.floor((this.time - r.first) / r.next);
  }

  mod(u: Unit, key: ModKey): number {
    let v = u.mods[key] ?? 0;
    for (const s of u.statuses) {
      const def = this.D.statuses[s.id];
      if (def?.mod === key) v += s.value * (def.sign ?? 1);
      if (s.id === 'overheat' && key === 'defReduction') v += this.B.downEffects.overheat.defReduction;
      if (s.id === 'erase' && key === 'dmgTaken') v += this.B.downEffects.erase.dmgTaken;
      if (s.id === 'erase' && key === 'spdPct') v += this.B.downEffects.erase.spdPct;
    }
    return v;
  }

  atk(u: Unit): number {
    return u.base.atk * Math.max(0.1, 1 + this.mod(u, 'atkPct'));
  }

  def(u: Unit): number {
    return u.base.def * Math.max(0, 1 + this.mod(u, 'defPct'));
  }

  spd(u: Unit): number {
    return Math.max(10, u.base.spd * (1 + this.mod(u, 'spdPct')) + this.mod(u, 'spdFlat'));
  }

  fullDist(u: Unit): number {
    return this.B.distanceBase / this.spd(u);
  }

  isWeak(u: Unit, el: Element): boolean {
    return u.weaknesses.includes(el) || u.statuses.some((s) => s.id === 'weakAdd' && s.element === el);
  }

  allWeaknesses(u: Unit): Element[] {
    const extra = u.statuses.filter((s) => s.id === 'weakAdd' && s.element).map((s) => s.element!) ;
    return [...new Set([...u.weaknesses, ...extra])];
  }

  canOverclock(uid: string): boolean {
    const u = this.units.find((x) => x.uid === uid);
    return !!u && u.side === 'ally' && u.alive && !this.ended && u.heat >= u.heatMax && (this.phase === 'idle' || this.phase === 'input');
  }

  canUseSkill(): boolean {
    return this.cp >= this.B.cp.skillCost;
  }

  /** 지금 차례인 아군(또는 오버클럭 쓰는 아군)이 고를 수 있는 대상 */
  validTargets(uid: string, kind: SkillKind): string[] {
    const u = this.unit(uid);
    const mode = u.skills[kind]?.target;
    switch (mode) {
      case 'enemy':
      case 'blast':
      case 'allEnemies':
        return this.opponents(u).map((x) => x.uid);
      case 'ally':
      case 'allAllies':
        return this.friends(u).map((x) => x.uid);
      case 'allyOther':
        return this.friends(u).filter((x) => x.uid !== uid).map((x) => x.uid);
      case 'self':
        return [uid];
      default:
        return [];
    }
  }

  /** 커서 기본 위치: 약점이 맞고 방화벽이 가장 적게 남은 적 */
  defaultTarget(uid: string, kind: SkillKind): string | undefined {
    const u = this.unit(uid);
    const mode = u.skills[kind]?.target;
    if (mode === 'self') return uid;
    if (mode === 'ally' || mode === 'allAllies') {
      return [...this.friends(u)].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]?.uid;
    }
    if (mode === 'allyOther') {
      return [...this.friends(u)].filter((x) => x.uid !== uid).sort((a, b) => this.atk(b) - this.atk(a))[0]?.uid;
    }
    const foes = this.opponents(u);
    const weak = foes.filter((e) => this.isWeak(e, u.element) && !e.down);
    const pool = weak.length ? weak : foes;
    return [...pool].sort((a, b) => a.firewall - b.firewall || a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot)[0]?.uid;
  }

  /** "약점!" 표시: 이 스킬을 이 대상(광역이면 아무 적)에게 쓰면 약점을 찌르는가 */
  hitsWeakness(uid: string, kind: SkillKind, targetUid?: string): boolean {
    const u = this.unit(uid);
    const skill = u.skills[kind];
    if (!skill || !skill.effects.some((e) => e.type === 'damage')) return false;
    if (skill.target === 'allEnemies') return this.opponents(u).some((e) => this.isWeak(e, u.element));
    const t = targetUid ? this.units.find((x) => x.uid === targetUid) : undefined;
    if (!t || t.side === u.side) return this.opponents(u).some((e) => this.isWeak(e, u.element));
    if (skill.target === 'blast') return this.blastGroup(t).some((e) => this.isWeak(e, u.element));
    return this.isWeak(t, u.element);
  }

  // ───────────────────────── 타임라인

  /** 앞으로 행동할 순서 n칸. 지금 차례인 유닛이 있으면 맨 앞 */
  order(n = 7): string[] {
    const out: string[] = [];
    if (this.active && this.phase === 'input') out.push(this.active);
    const sim = this.units.filter((u) => u.alive).map((u) => ({ uid: u.uid, av: u.av, dist: this.fullDist(u), side: u.side, slot: u.slot }));
    if (!sim.length) return out;
    while (out.length < n) {
      sim.sort((a, b) => a.av - b.av || (a.side === b.side ? a.slot - b.slot : a.side === 'ally' ? -1 : 1));
      const next = sim[0];
      const dt = next.av;
      for (const s of sim) s.av -= dt;
      out.push(next.uid);
      next.av = next.dist;
    }
    return out;
  }

  /** 스킬을 썼을 때의 순서 미리보기. 치명타·확률 효과는 터지지 않는다고 본다 */
  previewAct(kind: 'basic' | 'skill', target?: string, n = 7): string[] {
    if (this.phase !== 'input' || !this.active) return this.order(n);
    const actor = this.active;
    const sim = this.clone(fixedRng());
    try {
      sim.act(kind, target);
    } catch {
      return this.order(n);
    }
    return [actor, ...sim.order(n - 1)];
  }

  previewOverclock(uid: string, target?: string, n = 7): string[] {
    const sim = this.clone(fixedRng());
    try {
      sim.overclock(uid, target);
    } catch {
      return this.order(n);
    }
    return sim.order(n);
  }

  // ───────────────────────── 진행

  /** idle일 때 다음 유닛의 차례를 시작한다. 적이면 행동까지 끝내고, 아군이면 입력을 기다린다 */
  advance(): BattleEvent[] {
    this.events = [];
    if (!this.started) {
      this.started = true;
      this.emit({ t: 'start' });
      for (const u of this.allies()) this.fire(u, 'battleStart');
      this.flush();
      return this.events;
    }
    if (this.phase !== 'idle') return this.events;
    const alive = this.units.filter((u) => u.alive);
    alive.sort((a, b) => a.av - b.av || (a.side === b.side ? a.slot - b.slot : a.side === 'ally' ? -1 : 1));
    const next = alive[0];
    const dt = Math.max(0, next.av);
    for (const u of alive) u.av -= dt;
    this.time += dt;
    this.active = next.uid;
    next.av = this.fullDist(next);
    this.emit({ t: 'turn', uid: next.uid });

    const go = this.startTurn(next);
    if (this.ended) return this.events;
    if (!go) {
      this.endTurn(next);
      return this.events;
    }
    if (next.side === 'ally') {
      this.phase = 'input';
      return this.events;
    }
    this.enemyAct(next);
    this.flush();
    this.checkEnd();
    if (!this.ended) this.endTurn(next);
    this.stats.enemyActions++;
    return this.events;
  }

  /** 지금 차례인 아군의 행동 */
  act(kind: 'basic' | 'skill', target?: string): BattleEvent[] {
    if (this.phase !== 'input' || !this.active) throw new Error('지금은 행동할 차례가 아님');
    const u = this.unit(this.active);
    const skill = u.skills[kind];
    if (!skill) throw new Error('스킬 없음');
    if (kind === 'skill' && !this.canUseSkill()) throw new Error('CP 부족');
    this.events = [];
    const { targets, main } = this.resolveTargets(u, skill.target, target);
    if (kind === 'basic') this.changeCp(this.B.cp.basicGain);
    else {
      this.changeCp(-this.B.cp.skillCost);
      this.stats.skillsUsed++;
    }
    this.emit({ t: 'action', uid: u.uid, kind, name: skill.name, targets: targets.map((x) => x.uid) });
    this.runSkill(u, skill, kind, targets, main);
    if (u.alive) this.gainHeat(u, skill.heat ?? (kind === 'basic' ? this.B.heat.basic : this.B.heat.skill));
    this.fire(u, kind === 'basic' ? 'afterBasic' : 'afterSkill');
    this.flush();
    this.stats.allyActions++;
    this.checkEnd();
    if (!this.ended) this.endTurn(u);
    return this.events;
  }

  /** 오버클럭 끼어들기. 차례를 쓰지 않는다 */
  overclock(uid: string, target?: string): BattleEvent[] {
    if (!this.canOverclock(uid)) throw new Error('오버클럭을 쓸 수 없음');
    this.events = [];
    const u = this.unit(uid);
    const skill = u.skills.overclock!;
    const { targets, main } = this.resolveTargets(u, skill.target, target);
    u.heat = 0;
    this.emit({ t: 'heat', uid, value: 0 });
    this.emit({ t: 'action', uid, kind: 'overclock', name: skill.name, targets: targets.map((x) => x.uid) });
    this.runSkill(u, skill, 'overclock', targets, main);
    if (u.alive) this.gainHeat(u, this.B.heat.overclockRefund);
    this.stats.overclocks++;
    this.fire(u, 'afterOverclock');
    this.flush();
    this.checkEnd();
    return this.events;
  }

  // ───────────────────────── 차례

  /** false면 이번 차례는 행동 없이 끝난다 */
  private startTurn(u: Unit): boolean {
    for (const t of u.triggers) t.used = false;
    if (u.side === 'enemy' && u.down) {
      u.down = false;
      u.firewall = u.firewallMax;
      this.emit({ t: 'recover', uid: u.uid });
    }
    for (const s of [...u.statuses]) {
      if (!u.alive) break;
      if (s.id === 'regen') this.heal(u, s.value);
      if (!DOT_IDS.has(s.id) || !s.dot) continue;
      const src = this.units.find((x) => x.uid === s.src) ?? u;
      const amount = this.dotAmount(u, s.dot);
      this.applyRaw(src, u, amount, 'dot', this.dotElement(s.id, src), false, false);
      if (s.id === 'shock') {
        for (const adj of this.adjacent(u)) this.applyRaw(src, adj, amount * this.B.downEffects.shock.spreadPct, 'dot', 'volt', false, false);
      }
    }
    if (this.ended || !u.alive) return false;
    const frozen = u.statuses.find((s) => s.id === 'freeze');
    if (frozen) {
      this.removeStatus(u, frozen);
      if (frozen.dot) {
        const src = this.units.find((x) => x.uid === frozen.src) ?? u;
        this.applyRaw(src, u, this.dotAmount(u, frozen.dot), 'freeze', 'cryo', false, false);
      }
      this.emit({ t: 'skip', uid: u.uid });
      return false;
    }
    if (u.side === 'ally') this.fire(u, 'turnStart');
    this.flush();
    return !this.ended && u.alive;
  }

  private endTurn(u: Unit) {
    for (const s of [...u.statuses]) {
      if (s.fresh) {
        s.fresh = false;
        continue;
      }
      s.turns -= 1;
      if (s.turns <= 0) this.removeStatus(u, s);
    }
    this.active = null;
    if (!this.ended) this.phase = 'idle';
  }

  private checkEnd() {
    if (this.ended) return;
    if (!this.enemies().length) {
      this.phase = 'won';
      this.emit({ t: 'end', result: 'won' });
    } else if (!this.allies().length) {
      this.phase = 'lost';
      this.emit({ t: 'end', result: 'lost' });
    }
  }

  // ───────────────────────── 적 AI

  private enemyAct(u: Unit) {
    if (u.charge) {
      if (u.charging) {
        u.charging = false;
        u.chargeCount = 0;
        const skill = u.charge.skill;
        const { targets, main } = this.resolveTargets(u, skill.target, this.pickTarget(u)?.uid);
        this.emit({ t: 'action', uid: u.uid, kind: 'charge', name: skill.name, targets: targets.map((x) => x.uid) });
        this.runSkill(u, skill, 'enemy', targets, main);
        return;
      }
      u.chargeCount++;
      if (u.chargeCount >= u.charge.every) {
        u.charging = true;
        this.emit({ t: 'charge', uid: u.uid, line: u.charge.line });
        return;
      }
    }
    const actions = u.actions ?? [];
    const cds = u.cooldowns ?? actions.map(() => 0);
    const ready = actions.map((a, i) => ({ a, i })).filter((x) => cds[x.i] <= 0);
    const pick = ready.length ? pickWeighted(this.rng, ready, (x) => x.a.weight) : { a: actions[0], i: 0 };
    for (let i = 0; i < cds.length; i++) cds[i] = Math.max(0, cds[i] - 1);
    cds[pick.i] = (pick.a as EnemyAction).cooldown ?? 0;
    u.cooldowns = cds;
    const skill = pick.a.skill;
    const { targets, main } = this.resolveTargets(u, skill.target, this.pickTarget(u)?.uid);
    this.emit({ t: 'action', uid: u.uid, kind: skill.kind, name: skill.name, targets: targets.map((x) => x.uid) });
    this.runSkill(u, skill, 'enemy', targets, main);
  }

  private pickTarget(u: Unit): Unit | undefined {
    const foes = this.opponents(u);
    if (!foes.length) return undefined;
    const taunters = foes.filter((f) => f.statuses.some((s) => s.id === 'taunt'));
    const pool = taunters.length ? taunters : foes;
    const aggro = this.B.aggro as Record<string, number>;
    return pickWeighted(this.rng, pool, (f) => aggro[f.protocol ?? 'strike'] ?? 3);
  }

  // ───────────────────────── 스킬과 효과

  private opponents(u: Unit): Unit[] {
    return this.units.filter((x) => x.alive && x.side !== u.side);
  }

  private friends(u: Unit): Unit[] {
    return this.units.filter((x) => x.alive && x.side === u.side);
  }

  private adjacent(u: Unit): Unit[] {
    const row = this.units.filter((x) => x.side === u.side && x.alive).sort((a, b) => a.slot - b.slot);
    const i = row.findIndex((x) => x.uid === u.uid);
    return [row[i - 1], row[i + 1]].filter(Boolean) as Unit[];
  }

  private blastGroup(main: Unit): Unit[] {
    return [main, ...this.adjacent(main)];
  }

  private resolveTargets(u: Unit, mode: TargetMode, target?: string): { targets: Unit[]; main?: Unit } {
    const pick = (pool: Unit[], fallback: () => Unit | undefined) => pool.find((x) => x.uid === target) ?? fallback() ?? pool[0];
    const fallbackFoe = () => this.unitOrUndef(this.defaultTargetFor(u));
    switch (mode) {
      case 'enemy': {
        const m = pick(this.opponents(u), fallbackFoe);
        if (!m) throw new Error('대상 없음');
        return { targets: [m], main: m };
      }
      case 'blast': {
        const m = pick(this.opponents(u), fallbackFoe);
        if (!m) throw new Error('대상 없음');
        return { targets: this.blastGroup(m), main: m };
      }
      case 'allEnemies':
        return { targets: this.opponents(u), main: this.unitOrUndef(target) };
      case 'ally': {
        const m = pick(this.friends(u), () => undefined);
        return { targets: [m], main: m };
      }
      case 'allyOther': {
        const m = pick(this.friends(u).filter((x) => x.uid !== u.uid), () => undefined);
        if (!m) throw new Error('대상 없음');
        return { targets: [m], main: m };
      }
      case 'allAllies':
        return { targets: this.friends(u), main: u };
      case 'self':
        return { targets: [u], main: u };
    }
  }

  private unitOrUndef(uid?: string): Unit | undefined {
    return uid ? this.units.find((x) => x.uid === uid && x.alive) : undefined;
  }

  private defaultTargetFor(u: Unit): string | undefined {
    if (u.side === 'enemy') return this.pickTarget(u)?.uid;
    const foes = this.opponents(u);
    const weak = foes.filter((e) => this.isWeak(e, u.element) && !e.down);
    return [...(weak.length ? weak : foes)].sort((a, b) => a.firewall - b.firewall || a.slot - b.slot)[0]?.uid;
  }

  private runSkill(src: Unit, skill: SkillDef, kind: ActKind, targets: Unit[], main?: Unit) {
    const ctx: Ctx = { src, kind, mode: skill.target, targets, main, firewallDone: new Set() };
    for (const e of skill.effects) {
      if (!src.alive && kind !== 'overclock') break;
      this.applyEffect(ctx, e);
      if (this.ended) break;
    }
  }

  private who(ctx: Ctx, who: Who | undefined, dflt: Who = 'target'): Unit[] {
    const w = who ?? dflt;
    const alive = (xs: (Unit | undefined)[]) => xs.filter((x): x is Unit => !!x && x.alive);
    switch (w) {
      case 'target':
        return alive(ctx.related ? [ctx.related] : ctx.targets);
      case 'main':
        return alive([ctx.main ?? ctx.targets[0]]);
      case 'adjacent':
        return ctx.main ? this.adjacent(ctx.main) : [];
      case 'self':
        return alive([ctx.src]);
      case 'allAllies':
        return this.friends(ctx.src);
      case 'otherAllies':
        return this.friends(ctx.src).filter((x) => x.uid !== ctx.src.uid);
      case 'allEnemies':
        return this.opponents(ctx.src);
      case 'lowestHpAlly':
        return [...this.friends(ctx.src)].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, 1);
    }
  }

  private applyEffect(ctx: Ctx, e: Effect) {
    const { src } = ctx;
    switch (e.type) {
      case 'damage': {
        const list = this.who(ctx, e.who);
        for (const t of list) {
          const isMain = !ctx.main || t.uid === ctx.main.uid || ctx.mode !== 'blast';
          const scale = isMain ? e.scale : e.adjScale ?? e.scale * 0.5;
          const hits = e.hits ?? 1;
          for (let h = 0; h < hits && t.alive; h++) {
            this.hit(ctx, t, scale, e.stat ?? 'atk', e.bonus);
            if (h === 0) this.skillFirewall(ctx, t, isMain);
            if (this.ended) return;
          }
        }
        break;
      }
      case 'firewall':
        for (const t of this.who(ctx, e.who)) this.reduceFirewall(src, t, e.amount, !!e.ignoreWeakness);
        break;
      case 'status':
        for (const t of this.who(ctx, e.who)) this.applyStatus(src, t, e.status, e.value ?? 0, e.turns, e.chance ?? 1, !!e.fixed);
        break;
      case 'advance':
        for (const t of this.who(ctx, e.who)) this.shiftAv(t, e.pct);
        break;
      case 'heal':
        for (const t of this.who(ctx, e.who)) {
          const base = e.stat === 'hp' ? src.maxHp : e.stat === 'def' ? this.def(src) : this.atk(src);
          this.heal(t, (base * e.scale + (e.flat ?? 0)) * (1 + this.mod(src, 'healBonus')));
        }
        break;
      case 'shield':
        for (const t of this.who(ctx, e.who)) {
          const base = e.stat === 'hp' ? src.maxHp : e.stat === 'atk' ? this.atk(src) : this.def(src);
          const amount = Math.round((base * e.scale + (e.flat ?? 0)) * (1 + this.mod(src, 'shieldBonus')));
          this.addStatus(t, { id: 'shield', value: amount, turns: e.turns, src: src.uid, fresh: t.uid === this.active });
          this.emit({ t: 'shield', uid: t.uid, amount });
        }
        break;
      case 'cleanse':
        for (const t of this.who(ctx, e.who)) {
          const debuffs = t.statuses.filter((s) => this.D.statuses[s.id]?.kind === 'debuff' && this.D.statuses[s.id]?.dispellable);
          for (const s of debuffs.slice(-e.count)) this.removeStatus(t, s);
        }
        break;
      case 'revive':
        for (const t of this.units.filter((x) => x.side === src.side && !x.alive)) {
          t.alive = true;
          t.hp = Math.max(1, Math.round(t.maxHp * e.hpPct));
          t.av = this.fullDist(t);
          this.emit({ t: 'revive', uid: t.uid, hp: t.hp });
        }
        break;
      case 'cp':
        this.changeCp(e.amount);
        break;
      case 'heat':
        for (const t of this.who(ctx, e.who, 'self')) this.gainHeat(t, e.amount);
        break;
      case 'addWeakness':
        for (const t of this.who(ctx, e.who)) {
          if (t.side === src.side) continue;
          if (e.chance !== undefined && e.chance < 1 && this.rng.next() >= e.chance) continue;
          if (this.isWeak(t, e.element) && !t.statuses.some((s) => s.id === 'weakAdd' && s.element === e.element)) continue;
          const old = t.statuses.find((s) => s.id === 'weakAdd' && s.element === e.element);
          if (old) old.turns = Math.max(old.turns, e.turns);
          else t.statuses.push({ id: 'weakAdd', value: 0, turns: e.turns, src: src.uid, fresh: t.uid === this.active, element: e.element });
          this.emit({ t: 'weakAdd', uid: t.uid, element: e.element });
          this.onDebuffed(src, t);
        }
        break;
      case 'breakEffect':
        for (const t of this.who(ctx, e.who)) this.applyBreakEffect(src, t, e.element, e.chance ?? 1, false);
        break;
      case 'counter': {
        const t = ctx.related;
        if (!t || !t.alive) break;
        this.emit({ t: 'action', uid: src.uid, kind: 'counter', name: '반격', targets: [t.uid] });
        const cctx: Ctx = { src, kind: 'counter', mode: 'enemy', targets: [t], main: t, firewallDone: new Set() };
        this.hit(cctx, t, e.scale, 'atk');
        this.skillFirewall(cctx, t, true);
        if (src.alive) this.gainHeat(src, this.B.heat.counter);
        break;
      }
    }
  }

  // ───────────────────────── 피해

  private condOk(c: Cond | undefined, src: Unit, tgt: Unit, kind: ActKind): boolean {
    if (!c) return true;
    if (c.targetDown !== undefined && tgt.down !== c.targetDown) return false;
    if (c.targetWeak !== undefined && this.isWeak(tgt, src.element) !== c.targetWeak) return false;
    if (c.targetHasDebuff !== undefined && tgt.statuses.some((s) => this.D.statuses[s.id]?.kind === 'debuff') !== c.targetHasDebuff) return false;
    if (c.targetHpBelow !== undefined && !(tgt.hp / tgt.maxHp < c.targetHpBelow)) return false;
    if (c.selfHpAbove !== undefined && !(src.hp / src.maxHp > c.selfHpAbove)) return false;
    if (c.selfHpBelow !== undefined && !(src.hp / src.maxHp < c.selfHpBelow)) return false;
    if (c.enemiesAtLeast !== undefined && this.opponents(src).length < c.enemiesAtLeast) return false;
    if (c.selfHasShield !== undefined && src.statuses.some((s) => s.id === 'shield') !== c.selfHasShield) return false;
    if (c.skillKind !== undefined && kind !== c.skillKind) return false;
    return true;
  }

  private hitMods(src: Unit, tgt: Unit, kind: ActKind, extra?: CondMod[]): (k: ModKey) => number {
    const conds = [...src.condMods, ...(extra ?? [])].filter((c) => this.condOk(c.if, src, tgt, kind));
    return (k) => this.mod(src, k) + conds.reduce((s, c) => s + (c.mods[k] ?? 0), 0);
  }

  defFactor(tgt: Unit, reduction: number): number {
    const C = this.B.defenseConst;
    return C / (C + this.def(tgt) * Math.max(0, 1 - Math.min(1, reduction)));
  }

  private downFactor(tgt: Unit): number {
    if (tgt.side !== 'enemy') return 1;
    const f = this.B.downFactor;
    return tgt.down ? f.down : tgt.firewallMax > 0 ? f.firewallUp : f.noFirewall;
  }

  private hit(ctx: Ctx, tgt: Unit, scale: number, stat: 'atk' | 'def' | 'hp', bonus?: CondMod[]) {
    const src = ctx.src;
    const m = this.hitMods(src, tgt, ctx.kind, bonus);
    const base = stat === 'hp' ? src.maxHp : stat === 'def' ? this.def(src) : this.atk(src);
    const kindKey = ctx.kind === 'skill' ? 'skillDmg' : ctx.kind === 'overclock' ? 'overclockDmg' : ctx.kind === 'basic' || ctx.kind === 'counter' ? 'basicDmg' : undefined;
    const dmgBonus = m('dmgBonus') + (kindKey ? m(kindKey) : 0) + this.mod(tgt, 'dmgTaken') + (src.side === 'ally' ? this.elementBonus[src.element] ?? 0 : 0);
    const defF = this.defFactor(tgt, this.mod(tgt, 'defReduction') + m('defIgnore'));
    const critRate = src.base.critRate + m('critRate');
    const crit = src.side === 'ally' && this.rng.next() < critRate;
    const critF = crit ? 1 + src.base.critDmg + m('critDmg') : 1;
    const reduce = 1 - Math.min(0.9, this.mod(tgt, 'dmgReduce'));
    const amount = base * scale * Math.max(0, 1 + dmgBonus) * defF * critF * this.downFactor(tgt) * reduce;
    if (crit) this.stats.crits++;
    this.applyRaw(src, tgt, amount, ctx.kind === 'counter' ? 'counter' : 'hit', src.element, crit, this.isWeak(tgt, src.element));
  }

  private dotAmount(tgt: Unit, dot: number): number {
    return dot * this.defFactor(tgt, this.mod(tgt, 'defReduction')) * Math.max(0, 1 + this.mod(tgt, 'dmgTaken'));
  }

  private dotElement(id: string, src: Unit): Element {
    return id === 'bleed' ? 'kinetic' : id === 'overheat' ? 'plasma' : id === 'shock' ? 'volt' : src.element;
  }

  /** 계산이 끝난 피해를 실제로 넣는다(보호막, 처치, 페이즈, 피격 반응) */
  private applyRaw(src: Unit, tgt: Unit, raw: number, kind: DamageKind, element: Element, crit: boolean, weak: boolean) {
    if (!tgt.alive) return;
    let amount = Math.max(1, Math.round(raw));
    let absorbed = 0;
    const sh = tgt.statuses.find((s) => s.id === 'shield');
    if (sh && kind !== 'dot') {
      absorbed = Math.min(sh.value, amount);
      sh.value -= absorbed;
      amount -= absorbed;
      if (sh.value <= 0) this.removeStatus(tgt, sh);
    }
    tgt.hp = Math.max(0, tgt.hp - amount);
    if (src.side === 'ally') this.stats.maxHit = Math.max(this.stats.maxHit, amount + absorbed);
    this.emit({ t: 'damage', src: src.uid, uid: tgt.uid, amount, crit, weak, kind, element, hp: tgt.hp, absorbed });
    if (tgt.side === 'ally' && src.side === 'enemy' && kind !== 'dot') {
      this.gainHeat(tgt, this.B.heat.hit);
      for (const a of this.allies()) this.queue(a, 'allyHit', src);
      this.queue(tgt, 'selfHit', src);
    }
    if (tgt.hp <= 0) {
      tgt.alive = false;
      tgt.statuses = [];
      tgt.down = false;
      tgt.charging = false;
      this.emit({ t: 'death', uid: tgt.uid });
      if (tgt.side === 'enemy') {
        this.stats.kills++;
        if (src.side === 'ally' && src.alive) {
          this.gainHeat(src, this.B.heat.kill);
          this.queue(src, 'kill', tgt);
        }
      } else {
        this.stats.koAllies++;
      }
      this.checkEnd();
      return;
    }
    if (tgt.phases && tgt.phaseIdx < tgt.phases.length && tgt.hp / tgt.maxHp < tgt.phases[tgt.phaseIdx].hpBelow) {
      const ph = tgt.phases[tgt.phaseIdx++];
      if (ph.weaknesses) tgt.weaknesses = [...ph.weaknesses];
      if (ph.actions) {
        tgt.actions = ph.actions;
        tgt.cooldowns = ph.actions.map(() => 0);
      }
      tgt.down = false;
      tgt.firewall = tgt.firewallMax;
      this.emit({ t: 'phase', uid: tgt.uid, line: ph.line, weaknesses: [...tgt.weaknesses] });
    }
  }

  private heal(t: Unit, raw: number) {
    if (!t.alive) return;
    const amount = Math.max(0, Math.round(Math.min(raw, t.maxHp - t.hp)));
    t.hp += amount;
    this.emit({ t: 'heal', uid: t.uid, amount, hp: t.hp });
  }

  // ───────────────────────── 방화벽과 시스템 다운

  private skillFirewall(ctx: Ctx, t: Unit, isMain: boolean) {
    if (ctx.firewallDone.has(t.uid) || ctx.src.side !== 'ally') return;
    ctx.firewallDone.add(t.uid);
    const f = this.B.firewall;
    let amount = 0;
    if (ctx.kind === 'basic') amount = f.basic;
    else if (ctx.kind === 'counter') amount = f.counter;
    else if (ctx.kind === 'overclock') amount = f.overclock;
    else if (ctx.kind === 'skill') {
      if (ctx.mode === 'blast') amount = isMain ? f.blastMain : f.blastAdj;
      else if (ctx.mode === 'allEnemies') amount = f.skillAoe;
      else amount = f.skillSingle;
    }
    if (amount > 0) this.reduceFirewall(ctx.src, t, amount, false);
  }

  private reduceFirewall(src: Unit, t: Unit, amount: number, ignoreWeak: boolean) {
    if (!t.alive || t.side !== 'enemy' || t.firewallMax <= 0 || t.down) return;
    if (!ignoreWeak && !this.isWeak(t, src.element)) return;
    const amt = amount * (1 + this.mod(src, 'breakEff'));
    t.firewall = Math.max(0, t.firewall - amt);
    this.emit({ t: 'firewall', uid: t.uid, amount: amt, value: t.firewall });
    if (t.firewall <= 0) this.systemDown(src, t, src.element);
  }

  private systemDown(src: Unit, t: Unit, el: Element) {
    t.down = true;
    t.firewall = 0;
    this.stats.downs++;
    this.stats.maxDownAtOnce = Math.max(this.stats.maxDownAtOnce, this.enemies().filter((e) => e.down).length);
    this.emit({ t: 'down', uid: t.uid, element: el, by: src.uid });
    const d = this.B.down;
    const rankMult = (d.rankMult as Record<string, number>)[t.rank ?? 'normal'] ?? 1;
    const raw = this.atk(src) * (d.breakScale as Record<string, number>)[el] * rankMult * (1 + this.mod(src, 'breakDmg')) * this.defFactor(t, this.mod(t, 'defReduction')) * (1 + this.mod(t, 'dmgTaken'));
    this.applyRaw(src, t, raw, 'break', el, false, true);
    if (!t.alive) return;
    this.shiftAv(t, -d.pushPct);
    this.applyBreakEffect(src, t, el, 1, true);
    if (t.charging) {
      t.charging = false;
      t.chargeCount = 0;
      this.emit({ t: 'chargeCancel', uid: t.uid });
    }
    for (const a of this.allies()) this.queue(a, 'enemyDown', t);
  }

  /** 속성별 다운 효과. 다운이면 확정, 스킬 효과면 효과 적중 판정 */
  private applyBreakEffect(src: Unit, t: Unit, el: Element, chance: number, guaranteed: boolean) {
    if (!t.alive || t.side === src.side) return;
    const de = this.B.downEffects;
    const atk = this.atk(src);
    const dotMul = 1 + this.mod(src, 'dotBonus');
    const put = (id: string, turns: number, extra: Partial<StatusInst>) => this.applyStatus(src, t, id, 0, turns, chance, guaranteed, extra);
    switch (el) {
      case 'kinetic': {
        const pct = (de.bleed.pctMaxHp as Record<string, number>)[t.rank ?? 'normal'] ?? 0.05;
        put('bleed', de.bleed.turns, { dot: Math.min(t.maxHp * pct, atk * de.bleed.capAtkScale) * dotMul });
        break;
      }
      case 'plasma':
        put('overheat', de.overheat.turns, { dot: atk * de.overheat.atkScale * dotMul });
        break;
      case 'cryo':
        put('freeze', de.freeze.turns, { dot: atk * de.freeze.atkScale });
        break;
      case 'volt':
        put('shock', de.shock.turns, { dot: atk * de.shock.atkScale * dotMul });
        break;
      case 'glitch':
        if (guaranteed || this.rng.next() < chance) {
          this.shiftAv(t, -de.glitch.extraPushPct);
          this.applyRaw(src, t, atk * de.glitch.atkScale * this.defFactor(t, 0), 'dot', 'glitch', false, false);
          this.onDebuffed(src, t);
        }
        break;
      case 'void':
        put('erase', de.erase.turns, {});
        break;
    }
  }

  // ───────────────────────── 상태

  private applyStatus(src: Unit, t: Unit, id: string, value: number, turns: number, chance: number, fixed: boolean, extra: Partial<StatusInst> = {}) {
    if (!t.alive) return;
    const def = this.D.statuses[id];
    if (!def) throw new Error(`없는 상태: ${id}`);
    let p = chance;
    if (def.kind === 'debuff' && src.side !== t.side && !fixed) {
      p = chance * (1 + this.mod(src, 'effHit') + src.base.effHit) * (1 - Math.min(1, t.base.effRes + this.mod(t, 'effRes')));
    }
    if (p < 1 && this.rng.next() >= p) {
      this.emit({ t: 'resist', uid: t.uid, id });
      return;
    }
    if (id === 'virus' && extra.dot === undefined) extra = { ...extra, dot: this.atk(src) * value * (1 + this.mod(src, 'dotBonus')) };
    if (id === 'regen') value = src.maxHp * value * (1 + this.mod(src, 'healBonus'));
    this.addStatus(t, { id, value, turns, src: src.uid, fresh: t.uid === this.active, ...extra });
    if (def.kind === 'debuff' && t.side === 'enemy') this.onDebuffed(src, t);
  }

  private addStatus(t: Unit, s: StatusInst) {
    const before = this.spd(t);
    const old = t.statuses.find((x) => x.id === s.id);
    if (old) {
      old.value = Math.max(old.value, s.value);
      old.turns = Math.max(old.turns, s.turns);
      old.dot = Math.max(old.dot ?? 0, s.dot ?? 0) || undefined;
      old.src = s.src;
      old.fresh = old.fresh || s.fresh;
    } else {
      t.statuses.push(s);
    }
    this.rescaleAv(t, before);
    this.emit({ t: 'status', uid: t.uid, id: s.id, add: true, turns: s.turns });
  }

  private removeStatus(t: Unit, s: StatusInst) {
    const before = this.spd(t);
    t.statuses = t.statuses.filter((x) => x !== s);
    this.rescaleAv(t, before);
    this.emit({ t: 'status', uid: t.uid, id: s.id, add: false, turns: 0 });
  }

  private rescaleAv(t: Unit, spdBefore: number) {
    const after = this.spd(t);
    if (after !== spdBefore && t.alive && t.uid !== this.active) t.av = t.av * (spdBefore / after);
  }

  private onDebuffed(src: Unit, t: Unit) {
    if (t.side !== 'enemy') return;
    for (const a of this.allies()) this.queue(a, 'enemyDebuffed', t);
    void src;
  }

  private shiftAv(t: Unit, pct: number) {
    if (!t.alive) return;
    t.av = Math.max(0, t.av - pct * this.fullDist(t));
    this.emit({ t: 'av', uid: t.uid, pct });
  }

  private changeCp(delta: number) {
    const before = this.cp;
    this.cp = Math.max(0, Math.min(this.cpMax, this.cp + delta));
    if (this.cp !== before) this.emit({ t: 'cp', value: this.cp, delta: this.cp - before });
  }

  private gainHeat(u: Unit, amount: number) {
    if (u.side !== 'ally' || !u.alive || u.heatMax <= 0) return;
    const before = u.heat;
    u.heat = Math.min(u.heatMax, u.heat + amount * (1 + this.mod(u, 'heatGain')));
    if (u.heat !== before) this.emit({ t: 'heat', uid: u.uid, value: u.heat });
  }

  // ───────────────────────── 패시브 발동

  private fire(owner: Unit, on: string, related?: Unit) {
    this.queue(owner, on, related);
    this.flush();
  }

  private queue(owner: Unit, on: string, related?: Unit) {
    for (const inst of owner.triggers) if (inst.t.on === on) this.pending.push({ owner, inst, related });
  }

  private flush() {
    let guard = 0;
    while (this.pending.length && guard++ < 200 && !this.ended) {
      const { owner, inst, related } = this.pending.shift()!;
      if (!owner.alive) continue;
      if (inst.t.limit === 'perOwnTurn' && inst.used) continue;
      if (inst.t.limit === 'perBattle' && inst.usedBattle) continue;
      if (inst.t.chance !== undefined && this.rng.next() >= inst.t.chance) continue;
      if (inst.t.effects.some((e) => e.type === 'counter') && (!related || !related.alive)) continue;
      inst.used = true;
      inst.usedBattle = true;
      const ctx: Ctx = { src: owner, kind: 'counter', mode: 'self', targets: [owner], main: owner, firewallDone: new Set(), related };
      for (const e of inst.t.effects) {
        const scoped = e.type === 'heat' || e.type === 'status' || e.type === 'shield' || e.type === 'heal' ? { ...e, who: ('who' in e && e.who) || 'self' } : e;
        this.applyEffect(ctx, scoped as Effect);
      }
    }
    this.pending = [];
  }

  private emit(e: BattleEvent) {
    this.events.push(e);
  }

  /** 테스트·저장용: 아군 상태 요약 */
  allySummary(): { defId: string; hpFrac: number; heat: number }[] {
    return this.allies(false).map((u) => ({ defId: u.defId, hpFrac: u.alive ? u.hp / u.maxHp : 0, heat: u.heat }));
  }

  /** 아군 쪽에서 본 사이드 */
  static sideOf(uid: string): Side {
    return uid.startsWith('a') ? 'ally' : 'enemy';
  }
}
