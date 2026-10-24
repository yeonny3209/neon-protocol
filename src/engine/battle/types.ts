// 전투 중 상태와, 화면 쪽으로 넘기는 이벤트.
import type { BossPhase, CondMod, Element, EnemyAction, EnemyRank, Mods, Passive, Protocol, SkillDef, SkillKind, Stats, Trigger } from '../defs';

export type Side = 'ally' | 'enemy';
export type Difficulty = 'story' | 'normal' | 'fixed';

export interface StatusInst {
  id: string;
  value: number;
  turns: number;
  src: string;
  /** 자기 차례 중에 받은 효과는 그 차례 끝에 줄지 않는다 */
  fresh: boolean;
  element?: Element;
  /** 지속 피해 한 번의 기본값(방어 계수 적용 전) */
  dot?: number;
}

export interface TriggerInst {
  t: Trigger;
  name: string;
  used: boolean;
  usedBattle: boolean;
}

export interface Unit {
  uid: string;
  side: Side;
  slot: number;
  defId: string;
  name: string;
  element: Element;
  protocol?: Protocol;
  rank?: EnemyRank;
  level: number;
  color: string;
  base: Stats;
  mods: Mods;
  condMods: CondMod[];
  triggers: TriggerInst[];
  skills: Partial<Record<SkillKind, SkillDef>>;
  hp: number;
  maxHp: number;
  av: number;
  heat: number;
  heatMax: number;
  firewall: number;
  firewallMax: number;
  weaknesses: Element[];
  down: boolean;
  statuses: StatusInst[];
  alive: boolean;
  trial?: boolean;
  actions?: EnemyAction[];
  cooldowns?: number[];
  phases?: BossPhase[];
  phaseIdx: number;
  charge?: { every: number; line: string; skill: SkillDef };
  chargeCount: number;
  charging: boolean;
}

/** 아군 한 명. 레벨·돌파·카트리지·회로도·동기화는 이미 반영된 값 */
export interface AllySetup {
  defId: string;
  name: string;
  element: Element;
  protocol: Protocol;
  level: number;
  color: string;
  stats: Stats;
  heatMax: number;
  skills: Record<SkillKind, SkillDef>;
  passives: Passive[];
  /** 이어지는 체력(0~1). 없으면 가득 */
  hpFrac?: number;
  heat?: number;
  trial?: boolean;
}

export interface EnemySetup {
  defId: string;
  level: number;
}

export interface BattleSetup {
  allies: AllySetup[];
  enemies: EnemySetup[];
  seed: number;
  difficulty: Difficulty;
  ambush?: boolean;
  /** 딥 서버 환경·루프 패치 등 전투 전체 보정 */
  allyMods?: Mods;
  enemyMods?: Mods;
  allyPassives?: Passive[];
  /** 난이도 설정 대신 쓰는 고정 배율(딥 서버·루프) */
  diffMult?: { enemyHp: number; enemyAtk: number; enemyFirewall: number };
  /** 아군 속성별 피해 보정(딥 서버 환경) */
  elementBonus?: Partial<Record<Element, number>>;
}

export type DamageKind = 'hit' | 'dot' | 'break' | 'counter' | 'freeze';

export type BattleEvent =
  | { t: 'start' }
  | { t: 'turn'; uid: string }
  | { t: 'action'; uid: string; kind: SkillKind | 'counter' | 'charge'; name: string; targets: string[] }
  | { t: 'damage'; src?: string; uid: string; amount: number; crit: boolean; weak: boolean; kind: DamageKind; element: Element; hp: number; absorbed: number }
  | { t: 'heal'; uid: string; amount: number; hp: number }
  | { t: 'shield'; uid: string; amount: number }
  | { t: 'firewall'; uid: string; amount: number; value: number }
  | { t: 'down'; uid: string; element: Element; by: string }
  | { t: 'recover'; uid: string }
  | { t: 'status'; uid: string; id: string; add: boolean; turns: number }
  | { t: 'resist'; uid: string; id: string }
  | { t: 'av'; uid: string; pct: number }
  | { t: 'cp'; value: number; delta: number }
  | { t: 'heat'; uid: string; value: number }
  | { t: 'death'; uid: string }
  | { t: 'revive'; uid: string; hp: number }
  | { t: 'skip'; uid: string }
  | { t: 'charge'; uid: string; line: string }
  | { t: 'chargeCancel'; uid: string }
  | { t: 'phase'; uid: string; line: string; weaknesses: Element[] }
  | { t: 'weakAdd'; uid: string; element: Element }
  | { t: 'end'; result: 'won' | 'lost' };

export interface BattleStats {
  downs: number;
  maxDownAtOnce: number;
  overclocks: number;
  kills: number;
  crits: number;
  maxHit: number;
  allyActions: number;
  enemyActions: number;
  koAllies: number;
  skillsUsed: number;
}
