// 대본 파서. 형식은 docs/SCRIPT.md. 대본 파일은 읽기 쉬운 텍스트이고, 여기서 실행 가능한 명령 목록으로 바꾼다.
import { FACTIONS, type Faction } from '../defs';

export type EndingId = 'A' | 'B' | 'C';

export interface ChoiceOpt {
  text: string;
  trust: Partial<Record<Faction, number>>;
  set: Record<string, number>;
  /** 엔딩 선택지 조건: 이 엔딩이 열려 있어야 고를 수 있다 */
  needs?: EndingId;
  ending?: EndingId;
}

export type Op =
  | { op: 'line'; who: string; face: string; text: string; narr: boolean }
  | { op: 'bg'; name: string }
  | { op: 'bgm'; name: string }
  | { op: 'cg'; name: string }
  | { op: 'summary'; text: string }
  | { op: 'choice'; id: string; big: boolean; options: ChoiceOpt[] }
  | { op: 'if'; cond: string; elseAt: number }
  | { op: 'jump'; to: number }
  | { op: 'end' };

export interface Script {
  id: string;
  ops: Op[];
  errors: string[];
}

const LINE_RE = /^([^:\[\]@*#\-][^:\[\]]*?)(?:\[([^\]]*)\])?\s*:\s*(.+)$/;

export function parseScript(id: string, text: string): Script {
  const ops: Op[] = [];
  const errors: string[] = [];
  const ifStack: { ifAt: number; jumpAt: number }[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let choice: Extract<Op, { op: 'choice' }> | null = null;

  const err = (n: number, msg: string) => errors.push(`${id}:${n + 1}: ${msg}`);

  lines.forEach((raw, n) => {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) return;

    if (choice && line.startsWith('- ')) {
      const parts = line.slice(2).split('|').map((s) => s.trim());
      const opt: ChoiceOpt = { text: parts[0], trust: {}, set: {} };
      for (const tok of parts.slice(1)) {
        const t = /^(nox|white|loop)\s*([+-]\d+)$/.exec(tok);
        if (t) opt.trust[t[1] as Faction] = Number(t[2]);
        else if (tok.startsWith('set:')) {
          const [k, v] = tok.slice(4).split('=');
          opt.set[k.trim()] = v === undefined ? 1 : Number(v);
        } else if (tok.startsWith('needs:')) opt.needs = tok.slice(6).trim() as EndingId;
        else if (tok.startsWith('ending:')) opt.ending = tok.slice(7).trim() as EndingId;
        else err(n, `알 수 없는 선택지 표시 "${tok}"`);
      }
      if (!opt.text) err(n, '선택지 글이 비어 있음');
      choice.options.push(opt);
      return;
    }
    if (choice) {
      if (choice.options.length < 2) err(n, `선택지 "${choice.id}"는 선택지가 2개 이상이어야 함`);
      choice = null;
    }

    if (line.startsWith('@')) {
      const [cmd, ...rest] = line.slice(1).split(/\s+/);
      const arg = rest.join(' ');
      switch (cmd) {
        case 'bg':
        case 'bgm':
        case 'cg':
          ops.push({ op: cmd, name: arg });
          break;
        case 'summary':
          if (!arg) err(n, '@summary에 글이 없음');
          ops.push({ op: 'summary', text: arg });
          break;
        case 'choice': {
          const [cid, flag] = rest;
          if (!cid) return err(n, '@choice에 id가 없음');
          choice = { op: 'choice', id: cid, big: flag === 'big', options: [] };
          ops.push(choice);
          break;
        }
        case 'if':
          ops.push({ op: 'if', cond: arg, elseAt: -1 });
          ifStack.push({ ifAt: ops.length - 1, jumpAt: -1 });
          break;
        case 'else': {
          const top = ifStack[ifStack.length - 1];
          if (!top) return err(n, '@else 앞에 @if가 없음');
          ops.push({ op: 'jump', to: -1 });
          top.jumpAt = ops.length - 1;
          (ops[top.ifAt] as Extract<Op, { op: 'if' }>).elseAt = ops.length;
          break;
        }
        case 'endif': {
          const top = ifStack.pop();
          if (!top) return err(n, '@endif 앞에 @if가 없음');
          if (top.jumpAt >= 0) (ops[top.jumpAt] as Extract<Op, { op: 'jump' }>).to = ops.length;
          else (ops[top.ifAt] as Extract<Op, { op: 'if' }>).elseAt = ops.length;
          break;
        }
        case 'end':
          ops.push({ op: 'end' });
          break;
        default:
          err(n, `알 수 없는 명령 @${cmd}`);
      }
      return;
    }

    if (line.startsWith('* ')) {
      ops.push({ op: 'line', who: '', face: '', text: line.slice(2), narr: true });
      return;
    }
    const m = LINE_RE.exec(line);
    if (m) {
      ops.push({ op: 'line', who: m[1].trim(), face: (m[2] ?? '').trim(), text: m[3].trim(), narr: false });
      return;
    }
    err(n, `읽을 수 없는 줄 "${line.slice(0, 30)}"`);
  });

  if (choice && (choice as Extract<Op, { op: 'choice' }>).options.length < 2) errors.push(`${id}: 마지막 선택지가 2개 미만`);
  if (ifStack.length) errors.push(`${id}: @if가 닫히지 않음`);
  if (!ops.length || ops[ops.length - 1].op !== 'end') ops.push({ op: 'end' });
  return { id, ops, errors };
}

export function isFaction(x: string): x is Faction {
  return (FACTIONS as readonly string[]).includes(x);
}
