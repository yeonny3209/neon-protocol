// 8단계: 본편을 처음부터 끝까지 화면 없이 돌려서 재화·재료·성장·전투 길이를 확인한다.
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/engine/battle/battle';
import { autoPlay, DEFAULT_TIMING, type Policy, type Timing } from '../src/engine/battle/autoplay';
import { DATA } from '../src/engine/data';
import { checkAchievements, claimAchievements } from '../src/engine/achievements';
import { applyRecommended, batchGrow } from '../src/engine/growth';
import { storyParty } from '../src/engine/party';
import { applyStageClear, stageStars } from '../src/engine/progress';
import { newCharState, newSave, type SaveData } from '../src/engine/save';

const out = (s: string) => process.stderr.write(s + '\n');

interface RunReport {
  save: SaveData;
  shardsBy: Record<string, number>;
  keysBy: Record<string, number>;
  losses: string[];
  chapterLines: string[];
  seconds: number[];
  stuck: string[];
}

/** 3배속에서 화면 연출은 1/3, 손으로 누르는 시간은 그대로(빨리 누른다고 봄) */
const fast3x: Timing = { think: 1.3, allyAnim: DEFAULT_TIMING.allyAnim / 3, enemyAnim: DEFAULT_TIMING.enemyAnim / 3, overclock: DEFAULT_TIMING.overclock / 3, down: DEFAULT_TIMING.down / 3, kill: DEFAULT_TIMING.kill / 3 };

function playStory(opts: { difficulty: 'story' | 'normal'; policy: Policy; grow: boolean; timing: Timing; party?: string[] }): RunReport {
  const save = newSave();
  save.started = true;
  save.settings.difficulty = opts.difficulty;
  const rep: RunReport = { save, shardsBy: {}, keysBy: {}, losses: [], chapterLines: [], seconds: [], stuck: [] };
  const add = (by: Record<string, number>, k: string, n = 0) => (by[k] = (by[k] ?? 0) + n);

  for (const id of DATA.stageOrder) {
    const st = DATA.stages[id];
    // 1장을 깨면 다이브로 동료가 생겼다고 본다(초보자 배너 5성 확정 + 4성)
    if (opts.party && save.story.chapters.includes('ch1')) {
      for (const c of opts.party) if (!save.chars[c]) save.chars[c] = newCharState(c);
      save.party = ['runner', ...opts.party].slice(0, 4);
    }
    if (opts.grow && !st.forcedParty) {
      for (const c of save.party) {
        const r = batchGrow(save, c, st.recLevel);
        if (save.chars[c].level < st.recLevel - 3 && !rep.stuck.includes(st.chapter)) rep.stuck.push(`${st.id}:${c} Lv${save.chars[c].level}<${st.recLevel}(${r.blocked ?? '-'} ${Object.entries(r.missing).map(([k, v]) => `${k}${v}`).join(',')})`);
        // 성장 화면의 "추천대로 올리기"(스킬과 회로도 노드)
        applyRecommended(save, c);
      }
    }
    let won: Battle | null = null;
    for (let seed = 1; seed <= 3 && !won; seed++) {
      const b = new Battle({ allies: storyParty(save, st, opts.difficulty).allies, enemies: st.enemies.map((e) => ({ defId: e, level: st.enemyLevel })), seed, difficulty: opts.difficulty });
      const r = autoPlay(b, opts.policy, opts.timing);
      if (r.result === 'won') {
        won = b;
        rep.seconds.push(r.seconds);
      } else rep.losses.push(`${id}#${seed}`);
    }
    if (!won) continue;
    const s0 = save.wallet.shard ?? 0;
    const k0 = save.wallet.key ?? 0;
    const o = applyStageClear(save, st, stageStars(won, st));
    const stageShard = o.first ? st.firstReward.shard ?? 0 : 0;
    add(rep.shardsBy, '스테이지 첫 클리어', stageShard);
    const chShard = o.chapterGot?.items.shard ?? 0;
    const chKey = o.chapterGot?.items.key ?? 0;
    add(rep.shardsBy, '챕터 완료(+시작 선물)', chShard);
    add(rep.keysBy, '챕터 완료(+시작 선물)', chKey);
    const rankS = (save.wallet.shard ?? 0) - s0 - stageShard - chShard;
    const rankK = (save.wallet.key ?? 0) - k0 - chKey;
    add(rep.shardsBy, '러너 등급', rankS);
    add(rep.keysBy, '러너 등급', rankK);
    if (o.chapterDone) {
      checkAchievements(save);
      const ach = DATA.achievements.filter((a) => a.cat === 'story' && save.ach.done[a.id] && !save.ach.claimed.includes(a.id)).map((a) => a.id);
      const before = save.wallet.shard ?? 0;
      claimAchievements(save, ach);
      add(rep.shardsBy, '스토리 업적', (save.wallet.shard ?? 0) - before);
      const lv = save.party.map((c) => `${DATA.characters[c].name}${save.chars[c].level}`).join(' ');
      rep.chapterLines.push(`${st.chapter}(권장 ${st.recLevel}) 등급${save.rank.level} 샤드${save.wallet.shard ?? 0} 키${save.wallet.key ?? 0} | ${lv}`);
    }
  }
  return rep;
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

describe('8단계: 본편 전체 진행 시뮬레이션', () => {
  it('동생 모드(스토리 난이도, 육성 없음, "약점!"만 누름, 3배속): 멈추지 않고 끝까지 간다', () => {
    const r = playStory({ difficulty: 'story', policy: 'weakOnly', grow: false, timing: fast3x });
    out(`[동생 모드] 클리어 ${Object.keys(r.save.story.cleared).length}/69 · 패배 ${r.losses.length}회 ${r.losses.slice(0, 8).join(' ')} · 한 판 중앙값 ${median(r.seconds).toFixed(0)}초(3배속)`);
    expect(Object.keys(r.save.story.cleared)).toHaveLength(69);
  });

  it('누나 모드(보통 난이도, 스토리 보상만으로 육성, 소탕 없음): 권장 레벨을 따라가고 재화가 7.4 표대로 들어온다', () => {
    const r = playStory({ difficulty: 'normal', policy: 'smart', grow: true, timing: DEFAULT_TIMING, party: ['kai', 'mio', 'luna'] });
    out('[누나 모드] 챕터별');
    for (const l of r.chapterLines) out('  ' + l);
    out(`  막힌 곳: ${r.stuck.slice(0, 12).join(' | ') || '없음'}`);
    out(`  패배 ${r.losses.length}회 ${r.losses.slice(0, 10).join(' ')} · 한 판 중앙값 ${median(r.seconds).toFixed(0)}초(1배속)`);
    const shards = sum(r.shardsBy);
    const keys = sum(r.keysBy);
    out(`  샤드 ${JSON.stringify(r.shardsBy)} = ${shards}`);
    out(`  키 ${JSON.stringify(r.keysBy)} = ${keys}`);
    out(`  환산 ${Math.round(shards / 160 + keys)}회 (기획서 7.4: 약 190회) · 러너 등급 ${r.save.rank.level} (기획서: 30)`);
    const party = r.save.party;
    out(`  최종 파티 ${party.map((c) => { const s = r.save.chars[c]; return `${c} Lv${s.level} 스킬${s.skills.basic}/${s.skills.skill}/${s.skills.overclock}/${s.skills.trait} 노드${s.big.length}+${s.small.length}`; }).join(', ')}`);
    const w = r.save.wallet;
    out(`  남은 재료 크레딧${w.credit ?? 0} 주간${w.weekly ?? 0} 칩 ${['strike', 'blitz', 'hack', 'reboot'].map((p) => `${p}${w['chip_' + p] ?? 0}`).join(' ')}`);
    expect(Object.keys(r.save.story.cleared)).toHaveLength(69);
    expect(r.stuck).toEqual([]);
    expect(r.losses.length).toBeLessThanOrEqual(3);
    // 기획서 6.5: 스토리 보상만으로 4명 50레벨 + 주요 스킬 6레벨
    for (const c of party) {
      const s = r.save.chars[c];
      expect(s.level).toBe(50);
      expect(Math.min(s.skills.skill, s.skills.overclock, s.skills.trait)).toBeGreaterThanOrEqual(6);
    }
    // 기획서 7.4: 본편 끝까지 약 190회(엔딩 업적은 시뮬레이션에서 빠짐)
    const pulls = shards / 160 + keys;
    expect(pulls).toBeGreaterThan(170);
    expect(pulls).toBeLessThan(210);
    expect(median(r.seconds)).toBeLessThan(100);
  });
});
