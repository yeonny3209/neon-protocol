// 전투가 끝나면 통계(미션·업적용)를 남긴다. 스토리·재료·딥 서버·루프 전투가 모두 여기를 지난다.
import type { Battle } from './battle/battle';
import { noteEnemies } from './achievements';
import type { SaveData } from './save';
import { setMaxStat, track } from './state';

export interface RecordCtx {
  boss?: boolean;
  /** 스토리 스테이지(전원 생존 업적용) */
  stage?: boolean;
  speed?: number;
  seconds?: number;
  now?: Date;
}

export function recordBattle(save: SaveData, b: Battle, ctx: RecordCtx = {}) {
  const won = b.phase === 'won';
  const s = b.stats;
  noteEnemies(save, b.enemies(false).map((e) => e.defId));
  if (s.overclocks) track(save, 'overclock', s.overclocks);
  if (s.downs) track(save, 'downs', s.downs);
  if (s.crits) track(save, 'crits', s.crits);
  setMaxStat(save, 'maxDownAtOnce', s.maxDownAtOnce);
  setMaxStat(save, 'maxHit', s.maxHit);
  setMaxStat(save, 'maxOcInBattle', s.overclocks);
  if (!won) {
    track(save, 'battleLose');
    return;
  }
  track(save, 'battleWin');
  const allies = b.allies(false);
  if (ctx.stage && allies.every((u) => u.alive)) track(save, 'noKoClear');
  if (ctx.speed === 3) track(save, 'speed3Win');
  if (ctx.boss) {
    track(save, 'bossClear');
    if (s.downs === 0) setMaxStat(save, 'bossNoDown', 1);
    if (s.skillsUsed === 0 && s.overclocks === 0) setMaxStat(save, 'basicOnlyBoss', 1);
  }
  if ((ctx.now ?? new Date()).getHours() === 3) setMaxStat(save, 'nightWin', 1);
  if (ctx.seconds !== undefined && ctx.seconds < 60 && ctx.stage) setMaxStat(save, 'fastWin', 1);
  if (allies.some((u) => u.alive && u.hp / u.maxHp <= 0.05)) setMaxStat(save, 'closeWin', 1);
}
