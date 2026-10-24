// 데이터 파일(src/data)의 모양. 새 캐릭터·적·스테이지는 이 타입에 맞춰 JSON만 추가하면 된다.

export const ELEMENTS = ['kinetic', 'plasma', 'cryo', 'volt', 'glitch', 'void'] as const;
export type Element = (typeof ELEMENTS)[number];

export const PROTOCOLS = ['strike', 'blitz', 'hack', 'amp', 'shield', 'reboot'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const FACTIONS = ['nox', 'white', 'loop'] as const;
export type Faction = (typeof FACTIONS)[number];

export type StatKey = 'hp' | 'atk' | 'def' | 'spd' | 'critRate' | 'critDmg' | 'effHit' | 'effRes';
export type Stats = Record<StatKey, number>;

/** 스탯·피해에 더해지는 보정값. 버프·패시브·카트리지·회로도가 모두 이 키를 쓴다. */
export type ModKey =
  | 'hpPct' | 'atkPct' | 'defPct' | 'spdPct' | 'spdFlat'
  | 'critRate' | 'critDmg' | 'effHit' | 'effRes'
  | 'dmgBonus'      // 주는 피해 증가
  | 'dmgTaken'      // 받는 피해 증가 (디버프)
  | 'dmgReduce'     // 받는 피해 감소
  | 'defReduction'  // 방어 감소율 (피해 공식의 방어 감소)
  | 'defIgnore'     // 공격자가 무시하는 방어 비율
  | 'heatGain'      // 열량 획득량 증가
  | 'breakEff'      // 방화벽 감소량 증가
  | 'breakDmg'      // 다운 추가 피해 증가
  | 'dotBonus'      // 지속 피해 증가
  | 'healBonus'     // 주는 회복량 증가
  | 'shieldBonus'   // 주는 보호막 증가
  | 'basicDmg' | 'skillDmg' | 'overclockDmg'; // 종류별 피해 증가
export type Mods = Partial<Record<ModKey, number>>;

export type SkillKind = 'basic' | 'skill' | 'overclock';

/** 스킬이 고르는 대상. blast = 대상 + 양옆 */
export type TargetMode = 'enemy' | 'blast' | 'allEnemies' | 'ally' | 'allyOther' | 'allAllies' | 'self';

/** 효과가 적용될 유닛. target = 스킬이 고른 대상(광역이면 전부) */
export type Who = 'target' | 'main' | 'adjacent' | 'self' | 'allAllies' | 'otherAllies' | 'allEnemies' | 'lowestHpAlly';

export interface Cond {
  targetDown?: boolean;
  targetWeak?: boolean;
  targetHasDebuff?: boolean;
  targetHpBelow?: number;
  selfHpAbove?: number;
  selfHpBelow?: number;
  enemiesAtLeast?: number;
  selfHasShield?: boolean;
  skillKind?: SkillKind;
}

/** 조건부 보정. 조건을 만족하면 그 공격에만 적용된다. */
export interface CondMod {
  if?: Cond;
  mods: Mods;
}

export type Effect =
  | { type: 'damage'; scale: number; adjScale?: number; hits?: number; stat?: 'atk' | 'def' | 'hp'; bonus?: CondMod[]; who?: Who }
  | { type: 'firewall'; amount: number; who?: Who; ignoreWeakness?: boolean }
  | { type: 'status'; status: string; value?: number; turns: number; chance?: number; who?: Who; fixed?: boolean }
  | { type: 'advance'; pct: number; who?: Who } // +당기기, -밀기
  | { type: 'heal'; scale: number; stat?: 'atk' | 'hp' | 'def'; flat?: number; who?: Who }
  | { type: 'shield'; scale: number; stat?: 'atk' | 'hp' | 'def'; flat?: number; turns: number; who?: Who }
  | { type: 'cleanse'; count: number; who?: Who }
  | { type: 'revive'; hpPct: number }
  | { type: 'cp'; amount: number }
  | { type: 'heat'; amount: number; who?: Who }
  | { type: 'addWeakness'; element: Element; turns: number; chance?: number; who?: Who }
  | { type: 'breakEffect'; element: Element; chance?: number; who?: Who }
  | { type: 'counter'; scale: number };

export interface SkillDef {
  name: string;
  kind: SkillKind;
  target: TargetMode;
  desc: string;
  effects: Effect[];
  /** 사용 시 얻는 열량. 없으면 밸런스 기본값 */
  heat?: number;
}

export type TriggerOn =
  | 'battleStart'
  | 'turnStart'      // 자기 차례 시작
  | 'afterBasic' | 'afterSkill' | 'afterOverclock'
  | 'allyHit'        // 아군(자신 포함)이 적에게 피격
  | 'selfHit'
  | 'enemyDebuffed'  // 적에게 디버프가 걸림
  | 'kill'           // 자신이 적 처치
  | 'enemyDown';     // 누구든 적을 시스템 다운

export interface Trigger {
  on: TriggerOn;
  effects: Effect[];
  limit?: 'perOwnTurn' | 'perBattle';
  chance?: number;
}

/** 특성·회로도 노드·동기화·카트리지 효과의 공통 모양 */
export interface Passive {
  name?: string;
  desc: string;
  mods?: Mods;
  condMods?: CondMod[];
  triggers?: Trigger[];
  /** 특정 스킬에 효과를 덧붙인다 (예: 전투스킬이 추가로 방어 감소) */
  skillAdds?: { kind: SkillKind; effects: Effect[] }[];
  /** 스킬 레벨 보너스 (동기화 3·5단계) */
  skillLevels?: Partial<Record<SkillKind | 'trait', number>>;
}

export type StatRange = [lv1: number, lv60: number];

export interface CharacterLook {
  hair: string;
  eyes: string;
  accents: string[];
  /** 임시 그래픽에 쓰는 대표 색 */
  color: string;
}

export interface ArtPaths {
  full?: string;
  icon?: string;
  cutin?: string;
  faces?: Partial<Record<'default' | 'smile' | 'angry' | 'sad', string>>;
}

export interface CharacterKit {
  element: Element;
  protocol: Protocol;
  heatMax: number;
  skills: { basic: SkillDef; skill: SkillDef; overclock: SkillDef };
  trait: Passive & { name: string };
}

export interface RunnerForm extends CharacterKit {
  id: string;
  name: string;
  /** 이 챕터를 깨면 열림. 'start'면 처음부터 */
  unlockAfter: string;
}

export interface CharacterDef extends CharacterKit {
  id: string;
  name: string;
  /** 0 = 무료(러너) */
  rarity: 0 | 4 | 5;
  faction: Faction | 'neutral' | 'helix' | 'protagonist';
  firstAppear: string;
  concept: string;
  profile: string;
  look: CharacterLook;
  art?: ArtPaths;
  stats: { hp: StatRange; atk: StatRange; def: StatRange; spd: number; critRate: number; critDmg: number; effHit: number; effRes: number };
  circuit: {
    big: (Passive & { name: string })[]; // 3개
    small: { mods: Mods; desc: string }[]; // 10개
  };
  /** 1~6단계. 3·5단계는 skillLevels로 스킬 레벨 +2 */
  sync: Record<'1' | '2' | '3' | '4' | '5' | '6', Passive & { name: string }>;
  exclusiveCartridge?: string;
  lines: { nest: string[]; dive: string; overclock: string; victory: string };
  /** 러너 전용: 형태 목록. 있으면 위의 element/protocol/skills/trait는 첫 형태와 같아야 한다 */
  forms?: RunnerForm[];
}

export type EnemyRank = 'normal' | 'elite' | 'boss';

export interface EnemyAction {
  skill: SkillDef;
  weight: number;
  /** 이 행동 후 다시 쓰기까지 쉬는 차례 수 */
  cooldown?: number;
}

export interface BossPhase {
  hpBelow: number;
  line: string;
  weaknesses?: Element[];
  actions?: EnemyAction[];
}

export interface EnemyDef {
  id: string;
  name: string;
  rank: EnemyRank;
  family: string;
  desc: string;
  element: Element;
  color: string;
  art?: string;
  /** 레벨 1 기준. 체력·공격은 레벨에 따라 커지고 방어·속도는 그대로 */
  stats: { hp: number; atk: number; def: number; spd: number; effHit?: number; effRes?: number };
  weaknesses: Element[];
  firewall: number;
  actions: EnemyAction[];
  phases?: BossPhase[];
  charge?: { every: number; line: string; skill: SkillDef };
  intro?: string;
}

export type ItemId = string;
export type Reward = Record<ItemId, number>;

export interface ItemDef {
  id: ItemId;
  name: string;
  kind: 'currency' | 'exp' | 'part' | 'core' | 'chip' | 'weekly' | 'other';
  rarity: number;
  desc: string;
  /** "어디서 얻는지" 안내 */
  sources: string[];
  /** 이동 버튼이 가리키는 재료 스테이지 id */
  stage?: string;
  element?: Element;
  protocol?: Protocol;
  exp?: number;
}

export interface CartridgeDef {
  id: string;
  name: string;
  rarity: 3 | 4 | 5;
  protocol: Protocol;
  exclusiveFor?: string;
  desc: string;
  art?: string;
  stats: { hp: StatRange; atk: StatRange; def: StatRange };
  /** 같은 프로토콜 캐릭터가 끼면 발동. 숫자는 중첩 1단계 기준 */
  effect: Passive & { name: string };
}

export interface StageDef {
  id: string;
  chapter: string;
  index: number;
  name: string;
  recLevel: number;
  enemyLevel: number;
  enemies: string[];
  pre?: string;
  post?: string;
  trial?: string[];
  forcedParty?: string[];
  boss?: boolean;
  tutorial?: 'timeline' | 'weakness' | 'cpOverclock';
  /** 별 3번째 조건: 이 라운드 안에 클리어 */
  starRounds?: number;
  firstReward: Reward;
  reward: Reward;
  bg?: string;
}

export interface ChapterDef {
  id: string;
  order: number;
  title: string;
  zone: string;
  floors: string;
  summary: string;
  completeReward: Reward;
  bgm: string;
  bg: string;
  color: string;
}

export interface MaterialStageDef {
  id: string;
  name: string;
  kind: 'exp' | 'credit' | 'part' | 'chip' | 'core' | 'weekly';
  element?: Element;
  protocol?: Protocol;
  tiers: { rank: number; level: number; enemies: string[]; reward: Reward }[];
}

export interface StatusDef {
  id: string;
  name: string;
  kind: 'buff' | 'debuff' | 'special';
  icon: string;
  desc: string;
  mod?: ModKey;
  /** 값이 음수 방향인 보정(예: 공격력 감소)이면 -1 */
  sign?: 1 | -1;
  dispellable?: boolean;
}
