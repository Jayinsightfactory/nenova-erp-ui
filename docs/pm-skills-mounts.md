# /pm 스킬 이펙트 · 탈것 설계

연출 전용 기능입니다. 급여·평가와 무관하며, 토큰 적립은 기존 `lib/pmGrow` 성장 점수를 그대로 씁니다.

- 데이터·판정: `lib/pmSkills.js`, `lib/pmMounts.js` (순수 데이터 + 순수 함수, import 없음 → 2D·3D·서버 공용)
- 상점 연결: `lib/pmFxShop.js` (`withFx(manifest)`로 상점 manifest에 품목 추가, `fxStageLocked`로 성장 단계 해금 검사)
- 2D 렌더러: `components/pm/SkillFx.js` (SVG + SMIL `animateMotion`, 새 라이브러리 없음)
- 테스트: `__tests__/pmSkills.test.js` (`npm run test:pm`에 포함)

## 1. 스킬 이펙트

### 트리거 규칙

| 등급(tier) | 언제 | 근거 데이터 | 기본 지속 |
|---|---|---|---|
| 기본공격 `basic` | 작업 시작(새 연결선) · 단계 전환(같은 사람, 다른 스테이션) | `layoutScene().lines` 중 `kind==='current'` | 1.4초 |
| 스킬 `skill` | 같은 단계를 연속 20분 할 때마다 1회 (`FX_RULES.comboMin`) | 같은 선이 이어진 시간 | 2.0초 |
| 궁극기 `ult` | 오늘 목표 달성(`jump`) · 요청 배포됨(`spin`) · 성장 승급(`cheer`) | BgScene `danceEvents` 결과 그대로 재사용 | 2.8초 |

- 화면을 처음 열 때는 기준만 잡고 발사하지 않습니다(열자마자 한꺼번에 터지는 것 방지).
- 작업이 끝나면(선이 사라지면) 연속 시간은 0부터 다시 셉니다.

### 쿨다운 (`FX_RULES`)

| 규칙 | 값 |
|---|---|
| 화면에 동시에 떠 있는 시전 상한 | 4 |
| 같은 사람 최소 간격 (기본공격·스킬) | 8초 |
| 같은 사람 최소 간격 (궁극기) | 3초 |
| 상한이 찼을 때 | 더 높은 등급만 들어오고, 가장 낮은 등급 시전을 밀어냅니다(궁극기 > 스킬 > 기본공격) |

### 접근성
`prefers-reduced-motion`이면 발사체·궤적 없이 스테이션에 정적 하이라이트 원만 표시합니다(`castSpec(..., reduced=true)` → `count:0, hit:'highlight'`).

### 구성 요소 (정의 필드)
`id, name, rarity, tier, cast(시전 동작 클립), shape(발사체), trail(line|curve|bounce), count, hit(피격 효과), palette(테마 토큰 이름), emoji(2D 임시 아이콘), stage?`

색은 토큰 이름(`stage`, `link`, `accent`, `accent2`, `surface`, `plate`, `muted`, `ink`, `ok`)만 씁니다. `fxColor()`가 `var(--pm-*)`로 바꾸고, `stage`는 그 시전 단계의 `var(--pm-stage-N)`입니다. #hex 색은 쓰지 않습니다(`pmNoHexColor` CI).

### 업무 단계별 기본 이펙트 (무료, 장착이 없을 때 자동)
발주=종이비행기 · 입고=상자 굴리기 · 분배=꽃잎 흩뿌리기 · 현장출고=미니 트럭 · 견적=계산기 번개 · 거래처전달=편지 배달 · 입금=동전 튕기기 · 해외송금=지구 한 바퀴 · 이익=상승 그래프

### 구매형 24종
- 일반: 비눗방울 · 나뭇잎 휘리릭 · 하트 뿅 · 별똥별 · 클립 새총 · 포스트잇 날리기
- 희귀: 사탕 폭죽 · 음표 퐁퐁 · 눈송이 · 붕어빵 투척 · 장난감 로켓(스킬) · 무지개 다리(스킬) · 고양이 발도장(스킬)
- 영웅: 종이학 떼(스킬) · 등불 띄우기(스킬) · 용 연(스킬) · 유성우(궁극기) · 불꽃놀이(궁극기) · 만개 꽃비(궁극기)
- 전설: 하늘 고래 · 불사조 · 은하수 폭발 · 황금 꽃 소환 · 오로라 커튼 (모두 궁극기)

장착 슬롯은 2개입니다.
- `skillBasic`: 기본공격을 대체합니다. 비어 있으면 단계 기본 이펙트가 나갑니다.
- `skillUlt`: 스킬과 궁극기에 씁니다. 비어 있으면 `skillBasic`을 쓰고, 그것도 없으면 단계 기본 이펙트를 강화해 재생합니다(발사체 2배).

## 2. 탈것 (15종, 슬롯 `mount` 1개)
- 일반: 킥보드 · 꽃 수레 · 롤러스케이트 · 세발자전거
- 희귀: 미니 지게차 · 풍선 · 구름 · 오리 튜브
- 영웅: 거북이 · 마법 양탄자
- 전설: 유니콘
- 테마 전용: 한옥=가마(영웅) · 해변=서핑보드(희귀) · 우주=호버보드(영웅) · 겨울=썰매(희귀)

자세(`mountPose`)
- 3D: 자리→스테이션으로 이동할 때 걷기 대신 `ride`, 작업·대기 중에는 옆에 세워 두는 `park`, PC가 꺼져 있으면 `hidden`
- 2D: 캐릭터 엉덩이 오른쪽 아래에 스프라이트(`public/pm/mounts/<id>.png`, 실패 시 이모지 폴백)로 표시합니다.
- 3D 에셋(2026-11-04): `public/pm3d/mounts.glb`(모듈 `mount_<id>`, extras `seatZ`·`pose`) — `scripts/pm3d/build_mounts.py`. 썸네일 `public/pm/mounts/thumb/<id>.webp`(256px).
- 3D 주행 경로: `lib/pm3dRide.js`(자리↔스테이션 폴리라인·둘레 링), 충돌 0 테스트 `__tests__/pm3dRide.test.js`. 동시 3명 상한·`prefers-reduced-motion` 정지.

## 3. 경제 (기존 규칙 재사용)

| 등급 | 스킬 가격 | 탈것 가격 | 해금 성장 단계 |
|---|---|---|---|
| 일반 | 30 | 40 | 1 씨앗 |
| 희귀 | 80 | 100 | 2 새싹 |
| 영웅 | 180 | 220 | 3 꽃봉오리 |
| 전설 | 400 | 450 | 4 만개 |

- 구매는 `/api/pm/shop`의 `buy`로 합니다. 잔액은 서버에서 검증하고, 가격은 서버 lib 데이터 기준입니다. 품목 id는 `skill.<id>`, `mount.<id>`입니다.
- 장착은 `/api/pm/avatars`(`pm-avatars.json`의 `items.skillBasic`, `items.skillUlt`, `items.mount`)에 저장합니다. 서버가 `lockedOf`(산 것만)와 `fxStageLocked`(성장 단계)를 검증합니다.
- 자유이용권(`lib/pmFreePass`, 기본 2026-11-04부터 7일 = 11/10까지)이 활성이면 구매 잠금과 단계 잠금이 모두 풀립니다. 만료 후 산 적 없는 품목은 화면에서만 해제되고, 저장된 데이터는 보존합니다.

## 4. 3D 호환 인터페이스 (components/pm3d가 나중에 읽을 것)
`components/pm3d`는 이번 작업에서 건드리지 않았습니다. 3D 쪽은 아래 함수만 쓰면 됩니다.

```js
import { nextCasts, pickSkill, castSpec, FX_RULES } from 'lib/pmSkills';
import { mountById, mountPose } from 'lib/pmMounts';
// 매 갱신: state 를 보관하고 lines=[{name, stage, kind:'current'}], dances={name:'jump'|'spin'|'cheer'}
const { casts, state: next } = nextCasts(state, { lines, dances }, Date.now());
for (const c of casts) {
  const spec = castSpec(pickSkill(c.tier, c.stage, avatar.items), c, reducedMotion);
  // spec = { id, tier, clip:'cast.throw', projectile:'paperPlane', trail:'curve', count, hit, colors:[CSS var], durMs, emoji }
  // 3D: clip → 캐릭터 애니메이션 클립, projectile → fx_<shape>.glb, hit → 파티클 프리셋, colors → getComputedStyle 로 실제 색
}
const m = mountById(avatar.items.mount); // { model:'mount_kickboard.glb', ride:'stand'|'sit'|'hang'|'ride', speed }
mountPose(status, moving); // 'ride' | 'park' | 'hidden'
```

## 5. 내일 Blender 렌더 목록 (오늘은 렌더 금지)
- 캐릭터 시전 클립 10개: `cast.throw` · `push` · `scatter` · `point` · `flick` · `spin` · `raise` · `blow` · `stamp` (+ 기본 `idle` 연결)
- 발사체 모델 `fx_<shape>.glb`: paperPlane, box, petal, truck, bolt, envelope, coin, globe, arrowUp, bubble, leaf, heart, star, clip, sticky, candy, note, snowflake, fishBread, rocket, rainbow, paw, crane, lantern, kite, spark, whale, phoenix, orb, flower, ribbon (31종, 클레이 카와이 톤, 저폴리)
- 피격 파티클 프리셋: sparkle, thud, petalBurst, dust, flash, stamp, coinRain, ring, pop, confetti, smoke, glow, shockwave, fireworks, splash
- 탈것 15종 `mount_<id>.glb` + 탑승 자세 4종(stand/sit/hang/ride). 2D용 3/4 스프라이트 PNG(투명, 128px)도 같이 렌더합니다.
- 상점 썸네일: 스킬 24종과 탈것 15종, 각 256px webp
