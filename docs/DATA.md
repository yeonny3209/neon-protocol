# 데이터 구조

게임 내용은 전부 `src/data/` 아래 파일에 있다. 타입 정의는 `src/engine/defs.ts`, 검사는 `src/engine/validate.ts`(테스트가 자동으로 돌린다).

## 폴더

| 경로 | 내용 |
|---|---|
| `balance.json` | 모든 수치(전투 공식 상수, 방화벽, 난이도 배율, 성장 비용, 가챠 확률, 재화 수급). 숫자를 바꿀 때는 여기만 고친다. |
| `statuses.json` | 버프·디버프 목록. `mod`는 어떤 보정값에 더해지는지(ModKey). |
| `characters/*.json` | 캐릭터 한 명당 파일 하나. 파일을 추가하면 자동으로 게임에 들어간다. |
| `enemies/*.json` | 적 목록(배열). 구역별로 나눠 둠. |
| `cartridges.json` | 카트리지 24종. |
| `items.json` | 재료·재화 목록과 "어디서 얻는지" 안내. |
| `chapters.json`, `stages/*.json` | 챕터와 스토리 스테이지. |
| `materials.json` | 재료 스테이지. |
| `story/*.txt` | 대본. 형식은 `docs/SCRIPT.md`. |
| `loop/*.json`, `deep.json`, `missions.json`, `achievements.json` | 반복 콘텐츠. |

## 캐릭터 추가 순서

1. `characters/새이름.json`을 만든다. 기존 파일 하나를 복사해서 고치는 게 가장 빠르다.
2. 스킬은 `effects` 배열에 효과 블록을 나열한다(아래 표).
3. 전용 카트리지가 있으면 `cartridges.json`에 추가하고 `exclusiveCartridge`에 id를 적는다.
4. `npm test`를 돌린다. 오타나 없는 상태 id가 있으면 테스트가 어디가 틀렸는지 알려 준다.
5. 다이브에 나오게 하려면 `balance.json`이 아니라 배너 데이터(`banners.json`)에 넣는다.

## 효과 블록

| type | 하는 일 | 주요 값 |
|---|---|---|
| `damage` | 피해 | `scale`(공격력 배율), `hits`, `adjScale`(양옆 배율), `bonus`(조건부 보정), `stat`(atk/def/hp 기준) |
| `firewall` | 방화벽 추가 감소 | `amount`, `ignoreWeakness` |
| `status` | 버프·디버프 | `status`(statuses.json id), `value`, `turns`, `chance`, `who` |
| `advance` | 행동 당기기(+)/밀기(-) | `pct` (전체 행동 거리 대비) |
| `heal` | 회복 | `scale`, `stat`, `flat` |
| `shield` | 보호막 | `scale`, `stat`, `turns` |
| `cleanse` | 디버프 해제 | `count` |
| `revive` | 쓰러진 아군 부활 | `hpPct` |
| `cp` | 연산력 증감 | `amount` |
| `heat` | 열량 회복 | `amount` |
| `addWeakness` | 약점 속성 추가 | `element`, `turns`, `chance` |
| `breakEffect` | 다운 없이 속성 다운 효과 부여 | `element`, `chance` |
| `counter` | 반격(특성 발동용) | `scale` |

`who`: `target`(고른 대상, 광역이면 전부) · `main` · `adjacent` · `self` · `allAllies` · `otherAllies` · `allEnemies` · `lowestHpAlly`

## 패시브(특성·회로도·동기화·카트리지 공통)

```json
{
  "name": "이름", "desc": "설명",
  "mods": { "atkPct": 0.1 },
  "condMods": [{ "if": { "targetDown": true }, "mods": { "dmgBonus": 0.2 } }],
  "triggers": [{ "on": "kill", "effects": [{ "type": "heat", "amount": 10, "who": "self" }], "limit": "perOwnTurn" }],
  "skillAdds": [{ "kind": "skill", "effects": [ ... ] }],
  "skillLevels": { "skill": 2 }
}
```

- 발동 시점(`on`): `battleStart`, `turnStart`, `afterBasic`, `afterSkill`, `afterOverclock`, `allyHit`, `selfHit`, `enemyDebuffed`, `kill`, `enemyDown`
- 조건(`if`): `targetDown`, `targetWeak`, `targetHasDebuff`, `targetHpBelow`, `selfHpAbove`, `selfHpBelow`, `enemiesAtLeast`, `selfHasShield`, `skillKind`

여기 없는 새로운 종류의 효과나 발동 시점이 필요하면 `src/engine/battle/` 코드에 하나를 추가해야 한다.

## 스탯과 레벨

- 캐릭터 `stats.hp/atk/def`는 `[1레벨, 60레벨(4차 돌파)]` 값. 중간 레벨은 `balance.scaling` 곡선으로 계산한다.
- 적 `stats`는 1레벨 기준. 체력·공격력은 레벨 곡선을 따라 커지고, 방어력·속도는 그대로다.
- 난이도 배율(`balance.difficulty`)은 적 체력·공격력·방화벽에만 곱한다.

## 저장 데이터

`src/engine/save.ts`의 `SaveData`. 맨 위에 `version` 숫자가 있고, 구조가 바뀌면 `MIGRATIONS` 배열에 변환 함수를 하나 추가한다.
