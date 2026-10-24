// 대본 실행기. 대사를 한 줄씩 내보내고, 선택지를 만나면 멈추고, 선택 결과(신뢰도·플래그)를 저장 데이터에 반영한다.
import { DATA, type GameData } from '../data';
import type { Faction } from '../defs';
import type { SaveData } from '../save';
import { parseScript, type ChoiceOpt, type EndingId, type Op, type Script } from './script';

export interface SceneState {
  bg: string;
  bgm: string;
  cg: string;
}

export type Step =
  | { t: 'line'; who: string; face: string; text: string; narr: boolean; scene: SceneState }
  | { t: 'choice'; id: string; big: boolean; options: { opt: ChoiceOpt; ok: boolean; idx: number }[]; scene: SceneState }
  | { t: 'end'; ending?: EndingId; scene: SceneState };

const cache = new Map<string, Script>();

export function getScript(id: string, data: GameData = DATA): Script {
  let s = cache.get(id);
  if (!s) {
    const raw = data.scripts[id];
    if (raw === undefined) throw new Error(`없는 대본: ${id}`);
    s = parseScript(id, raw);
    cache.set(id, s);
  }
  return s;
}

export function allScripts(data: GameData = DATA): Script[] {
  return Object.keys(data.scripts).map((id) => getScript(id, data));
}

// ───────────────────────── 조건과 엔딩

export function trueEndingOpen(save: SaveData, data: GameData = DATA): boolean {
  const t = save.story.trust;
  const need = data.balance.story.trueTrust;
  return t.nox >= need && t.white >= need && t.loop >= need && !!save.story.flags.true_ch2 && !!save.story.flags.true_ch4 && !!save.story.flags.true_ch5;
}

/** 지금 신뢰도로 이 엔딩 선택지를 고를 수 있는가 */
export function endingOpen(save: SaveData, e: EndingId, data: GameData = DATA): boolean {
  const t = save.story.trust;
  if (e === 'A') return t.nox >= t.white;
  if (e === 'B') return t.white >= t.nox;
  return trueEndingOpen(save, data);
}

export function evalCond(expr: string, save: SaveData, data: GameData = DATA): boolean {
  const t = save.story.trust;
  return expr.split('&&').every((raw) => {
    let term = raw.trim();
    let neg = false;
    if (term.startsWith('!')) {
      neg = true;
      term = term.slice(1).trim();
    }
    let v = false;
    let m: RegExpExecArray | null;
    if (term === 'true') v = true;
    else if (term === 'trueEnding') v = trueEndingOpen(save, data);
    else if (term.startsWith('flag:')) v = (save.story.flags[term.slice(5)] ?? 0) > 0;
    else if (term.startsWith('ending:')) v = save.story.endings.includes(term.slice(7));
    else if ((m = /^(highest|lowest):(nox|white|loop)$/.exec(term))) {
      const f = m[2] as Faction;
      const vals = Object.values(t);
      v = m[1] === 'highest' ? t[f] >= Math.max(...vals) : t[f] <= Math.min(...vals);
    } else if ((m = /^(nox|white|loop)\s*(>=|<=|>|<|==)\s*(\d+)$/.exec(term))) {
      const a = t[m[1] as Faction];
      const b = Number(m[3]);
      v = m[2] === '>=' ? a >= b : m[2] === '<=' ? a <= b : m[2] === '>' ? a > b : m[2] === '<' ? a < b : a === b;
    }
    return neg ? !v : v;
  });
}

// ───────────────────────── 선택 결과 반영

function applyOpt(save: SaveData, opt: ChoiceOpt) {
  for (const [f, n] of Object.entries(opt.trust)) save.story.trust[f as Faction] = Math.max(0, save.story.trust[f as Faction] + (n ?? 0));
  for (const [k, v] of Object.entries(opt.set)) save.story.flags[k] = v;
}

export function choiceIndex(data: GameData = DATA): Record<string, { opts: ChoiceOpt[]; scriptId: string }> {
  const out: Record<string, { opts: ChoiceOpt[]; scriptId: string }> = {};
  for (const s of allScripts(data)) for (const op of s.ops) if (op.op === 'choice') out[op.id] = { opts: op.options, scriptId: s.id };
  return out;
}

/** 저장된 선택들로 신뢰도·플래그를 처음부터 다시 계산한다(챕터 선택으로 다시 고를 때 쓴다) */
export function rebuildFromChoices(save: SaveData, data: GameData = DATA) {
  const idx = choiceIndex(data);
  save.story.trust = { nox: 0, white: 0, loop: 0 };
  save.story.flags = {};
  for (const [id, n] of Object.entries(save.story.choices)) {
    const opt = idx[id]?.opts[n];
    if (opt) applyOpt(save, opt);
  }
}

/** 이 챕터 이후의 선택을 지운다 */
export function resetChoicesFrom(save: SaveData, chapterOrder: Record<string, number>, fromChapter: string, data: GameData = DATA) {
  const from = chapterOrder[fromChapter] ?? 0;
  for (const id of Object.keys(save.story.choices)) {
    const ch = save.story.choiceChapter[id];
    if ((chapterOrder[ch] ?? 0) >= from) {
      delete save.story.choices[id];
      delete save.story.choiceChapter[id];
    }
  }
  rebuildFromChoices(save, data);
}

// ───────────────────────── 실행기

export class StoryRunner {
  pc = 0;
  scene: SceneState = { bg: '', bgm: '', cg: '' };
  curSummary = '';
  ending?: EndingId;
  private collected: string[] = [];

  constructor(
    readonly script: Script,
    readonly save: SaveData,
    readonly chapter: string,
    private data: GameData = DATA,
  ) {}

  private snap(): SceneState {
    return { ...this.scene };
  }

  next(): Step {
    const ops = this.script.ops;
    for (let guard = 0; guard < 5000; guard++) {
      const op: Op | undefined = ops[this.pc++];
      if (!op || op.op === 'end') {
        this.pc = ops.length;
        return { t: 'end', ending: this.ending, scene: this.snap() };
      }
      switch (op.op) {
        case 'bg':
          this.scene.bg = op.name;
          this.scene.cg = '';
          break;
        case 'bgm':
          this.scene.bgm = op.name;
          break;
        case 'cg':
          this.scene.cg = op.name;
          break;
        case 'summary':
          this.curSummary = op.text;
          this.collected.push(op.text);
          break;
        case 'if':
          if (!evalCond(op.cond, this.save, this.data)) this.pc = op.elseAt;
          break;
        case 'jump':
          this.pc = op.to;
          break;
        case 'line':
          return { t: 'line', who: op.who, face: op.face, text: op.text, narr: op.narr, scene: this.snap() };
        case 'choice': {
          const options = op.options.map((opt, idx) => ({ opt, idx, ok: !opt.needs || endingOpen(this.save, opt.needs, this.data) }));
          // 이미 고른 적이 있는 선택지는 그대로 다시 보여 준다(챕터 선택에서 다시 고를 수 있음)
          return { t: 'choice', id: op.id, big: op.big, options, scene: this.snap() };
        }
      }
    }
    throw new Error(`대본이 끝나지 않음: ${this.script.id}`);
  }

  choose(step: Extract<Step, { t: 'choice' }>, idx: number) {
    const opt = step.options[idx]?.opt;
    if (!opt || !step.options[idx].ok) throw new Error('고를 수 없는 선택지');
    applyOpt(this.save, opt);
    this.save.story.choices[step.id] = idx;
    this.save.story.choiceChapter[step.id] = this.chapter;
    if (opt.ending) {
      this.ending = opt.ending;
      if (!this.save.story.endings.includes(opt.ending)) this.save.story.endings.push(opt.ending);
    }
  }

  /** 다음 선택지나 끝까지 건너뛴다. 건너뛴 구간의 요약(세 줄 안팎)과 멈춘 자리를 돌려준다 */
  skip(): { summaries: string[]; step: Step } {
    this.collected = this.curSummary ? [this.curSummary] : [];
    let step = this.next();
    while (step.t === 'line') step = this.next();
    const summaries = [...new Set(this.collected)];
    this.collected = [];
    return { summaries, step };
  }
}
