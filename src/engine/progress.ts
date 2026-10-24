// 스토리 스테이지 클리어 처리(별, 보상, 챕터 완료, 러너 형태). 화면과 시뮬레이션이 같은 규칙을 쓴다.
import type { Battle } from './battle/battle';
import { DATA, type GameData } from './data';
import type { Reward, StageDef } from './defs';
import type { SaveData } from './save';
import { grant, track, type Granted } from './state';

export function nextStageId(id: string, data: GameData = DATA): string | undefined {
  const i = data.stageOrder.indexOf(id);
  return data.stageOrder[i + 1];
}

/** 별: 1 클리어, 2 전원 생존, 4 제한 라운드 안 */
export function stageStars(b: Battle, st: StageDef, data: GameData = DATA): number {
  let stars = 1;
  if (b.allies(false).every((u) => u.alive)) stars |= 2;
  if (b.round() <= (st.starRounds ?? data.balance.story.defaultStarRounds)) stars |= 4;
  return stars;
}

/** 이번 클리어에서 받을 보상(러너 등급 경험치 포함) */
export function stageReward(st: StageDef, first: boolean, data: GameData = DATA): Reward {
  const r: Reward = first ? { ...st.reward, ...st.firstReward } : { ...st.reward };
  const e = data.balance.economy.rankExp;
  r.rankExp = (first ? r.rankExp ?? 0 : 0) + e.battleWin + (first ? (st.boss ? e.storyBossFirstClear : e.storyFirstClear) : 0);
  return r;
}

export interface ClearOutcome {
  stars: number;
  first: boolean;
  got: Granted;
  chapterDone: boolean;
  chapterGot?: Granted;
  forms: string[];
}

export function applyStageClear(save: SaveData, st: StageDef, stars: number, data: GameData = DATA): ClearOutcome {
  const first = !save.story.cleared[st.id];
  save.story.cleared[st.id] = (save.story.cleared[st.id] ?? 0) | stars;
  save.story.next = nextStageId(st.id, data);
  const got = grant(save, stageReward(st, first, data), data);
  track(save, 'stageClear');
  const out: ClearOutcome = { stars, first, got, chapterDone: false, forms: [] };
  const chapterStages = data.stageOrder.filter((id) => data.stages[id].chapter === st.chapter);
  if (first && !save.story.chapters.includes(st.chapter) && chapterStages.every((id) => save.story.cleared[id])) {
    save.story.chapters.push(st.chapter);
    out.chapterDone = true;
    out.chapterGot = grant(save, data.chapters[st.chapter].completeReward, data);
    for (const f of data.characters.runner.forms ?? []) {
      if (f.unlockAfter === st.chapter && !save.runnerForms.includes(f.id)) {
        save.runnerForms.push(f.id);
        out.forms.push(f.name);
      }
    }
    track(save, 'chapterClear');
  }
  return out;
}
