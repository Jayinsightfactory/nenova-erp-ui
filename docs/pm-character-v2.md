# /pm 캐릭터 v2 — 레이어 정합·자리 꾸밈·성장 연출

급여·평가와 무관한 꾸미기 기능. 포인트 규칙(lib/pmGrow)은 그대로.

## 왜 다시 만들었나
예전 아이템은 서로 다른 그림을 캐릭터 위에 CSS 퍼센트로 얹어서, 옷이 몸에 맞지 않고 겹쳐 보였다.
v2는 모든 레이어를 같은 리그(베이스 바디)와 같은 직교 카메라로 Blender에서 렌더한다. 그래서 겹쳐 놓기만 하면 맞는다.
몸 뒤로 들어가는 부분은 렌더할 때 holdout으로 잘라 낸다.

- 원본: `scripts/pm-char/spec.py`(아이템 사양) → `build.py`(블렌더 렌더) → `post.py`(webp·틴트·썸네일·manifest·정합검사·콘택트시트)
- 실행: `blender -b -P scripts/pm-char/build.py -- <raw폴더>` 다음 `python scripts/pm-char/post.py <raw폴더> <shots폴더>`. 그 뒤 `fit-report.json`을 `scripts/pm-char/`에 복사한다.
- 스타일: 소프트 클레이 3D, 무광 파스텔, 둥근 형태, 카와이 얼굴(사장님 확정 톤). 외부 에셋 서비스는 쓰지 않았다(전부 프리미티브).

## 캔버스·앵커
| 항목 | 값 |
|---|---|
| 캐릭터 캔버스 | 256×256, 2.7m 화각, 고도 12° |
| 서기 발 기준점 | (128, 238) |
| 앉기 엉덩이 기준점 | `layers.sit.anchors.hip` |
| 자리 캔버스 | 384×384, 같은 px/m |
| 책상 앵커 | (192, 294.6) |
| 레이어 순서(뒤→앞) | kindBack · hairBack · body · bottom · top · badge · face · hairFront · kindFront · glasses · hat · hand |

포즈는 두 가지다.
- stand: 정면으로 서 있는 포즈.
- sit: 의자에 앉아 타이핑하는 포즈, 3/4 시점(-30°). 반대 방향은 화면에서 scaleX(-1)로 뒤집어 쓴다. 모든 옷·모자·소품을 두 포즈로 모두 렌더했다.

## 자리(책상) 슬롯 — `lib/pmDeskSlots.js`
값은 책상 앵커 기준 상대 px(scale 1)다. z가 작을수록 뒤에 그린다.

| 슬롯 | z | at | 비고 |
|---|---|---|---|
| rug | 0 | (0, -13.8) | 성장 2단계에서 열림 |
| shelf | 1 | (-147, -31.5) | 성장 3단계에서 열림 |
| chair | 2 | (0, -30.6) | |
| seat | 3 | (0, -68.3) | 앉은 캐릭터 엉덩이(hip 128,195.7) |
| desk | 4 | (0, 0) | 책상 스킨 |
| deskL / deskM / deskR | 5 | dx −61.6 / 0 / +61.6 | 상판 소품, 가운데 렌더를 평행이동 |
| pet | 6 | (128, 4.9) | 2프레임 idle 스프라이트 |

자리끼리는 앵커 y 오름차순으로 그린다(`sortDesks`).

### 장면 연결 인터페이스(장면 쪽 feat/pm-bg-scene이 제공)
`seatAnchor = { x, y, dir: 'left'|'right', scale, z }`
- x, y: 장면 화면 px 기준, 앉은 엉덩이 위치.
- scale: 자리 세트 배율. 1이면 384 캔버스.

```jsx
import { SeatedCharacter, DeskDecor } from 'components/pm/Character';
<DeskDecor cfg={avatar} seat={seatAnchor} />       // 의자·러그(z) · 책상 스킨·상판 소품(z+2) · 펫(z+3)
<SeatedCharacter cfg={avatar} seat={seatAnchor} /> // 캐릭터(z+1), 하반신은 hideBelowHip 으로 잘라 책상 뒤에 숨김
```
배경에 그려진 책상 위에 산 책상 스킨을 덮어 그린다. 테마별 크기는 scale로 맞춘다. 좌표 변환식은 `deskPlacement`와 같다.

## 공용 렌더 props
`<CharacterAvatar cfg state size pose dir hideBelowHip stage vibe emote dance />`
- 장면, 직원상세, 상점이 모두 이 컴포넌트를 쓴다.
- 기존 `<Avatar cfg state size name>`은 이 컴포넌트를 감싼 래퍼다. name을 주면 성장 단계와 작업 분위기를 자동으로 붙인다.
- 움직임은 합성된 캐릭터 전체에 CSS 변형을 건다. 그래서 옷이 항상 몸과 같이 움직인다.
- `prefers-reduced-motion`이면 정지 이미지로 보인다.

## 작업 분위기(lib/pmMood, 외형 전용)
| 상태 | 조건 | 연출 |
|---|---|---|
| 몰입 끝판 blaze | 작업 중 + 오늘 업무 특정 6h+ | 불꽃 오라 ✨ |
| 집중 focus | 연속 작업 60분+ | 💭 차분한 호흡 |
| 바쁨 busy | 30분 안에 작업 전환 4회+ | 💪 빠른 타이핑 |
| 작업중 work | 작업 중 | 타이핑 |
| 휴식 break | 15분 무활동 | ☕ |
| 꿀잠 doze | 90분+ 무활동 | 💤 |
| 대기 idle | 그 밖 | 성격별 대기 동작 |

## 성격·이모트·춤
- 성격(대기 동작): 차분, 활발, 장난꾸러기, 꼼꼼, 느긋, 수줍음
- 이모트 14종: 기쁨, 놀람, 하트, 땀, 반짝, 생각중, 화이팅, 별, 흥얼, 아이디어, 커피, 꿀잠, 꽃, 축하
- 춤 6종: 통통, 빙글, 살랑, 점프, 꿈틀, 만세. 상점 미리보기에서 수동으로 재생한다. 승급 등 이벤트 때 `dance` prop을 넘기면 된다.

## 성장 연출(포인트 규칙 유지)
- 단계별 외형: 2단계 새싹 핀, 3단계 반짝이, 4단계 후광, 5단계 전설 오라.
- 자리 해금: 러그는 2단계, 책장은 3단계(서버에서 검증).
- 일일 물주기(출석): `POST /api/pm/grow {action:'water', name}`. 하루 한 번, 연속일을 기록한다. 포인트와는 무관하고 시듦만 회복한다.

## 1주일 자유이용권(lib/pmFreePass)
- 기본: 전 직원에게 2026-11-04부터 7일. 저장 파일은 `data/runtime/pm-freepass.json`이다.
- 관리자: `POST /api/pm/freepass {name|'*', start, days}`로 재지급하거나 기간을 조정한다.
- 이용권 기간에는 모든 품목을 토큰 없이 장착하고 배치할 수 있다. 상점에 D-n 배지가 보인다.
- 만료되면 산 적 없는 유료 품목만 화면에서 빠진다(`view`). 저장된 꾸미기 데이터는 보존하고 "구매하면 계속 사용" 안내를 띄운다.
- 토큰 잔액과 구매 기록은 건드리지 않는다.

## 아이템 id 호환
- 옛 품목 id는 전부 유지한다.
- 책상 소품 `desk.<소품>`은 상판 `top.<소품>`으로 이동했다(`PM_ITEM_ALIASES`). 예전에 산 품목은 새 id로도 보유로 인정한다. 화면에서는 deskM 칸에 보인다.
- 슬롯 `desk`는 이제 책상 스킨(테이블)을 뜻한다.

## 장면용 아이소 세트(public/pm-char/iso/, layers.json `iso`)
- 배경 클레이 일러스트와 같은 시점(직교, 고도 30°·방위 45°)에서 다시 렌더: 책상 스킨 10 · 상판 소품 16(1.7배, 장면에서 디테일 보이게) · 펫 10(앉음/대기 2프레임, 1.3배).
- 앵커(384 캔버스): top=상판 중심, floor=책상 앞(사람 쪽) 바닥, deskL/M/R=상판 칸, pet — `lib/pmDeskSlots.PM_DESK_ISO`.
- 장면 사용: `<DeskDecor view="iso" cfg anchor={{x,y}} scale dir z />` (anchor = 상판 중심 px). 상판 중심은 장면 `frontMasks` 사각형 중심(`isoDeskTop`), 배율은 `PM_DESK_ISO_SCALE[테마] × 장면폭/1600`.
- 재생성: `blender -b -P scripts/pm-char/build.py -- <raw-iso> "" iso` → `python scripts/pm-char/post_iso.py <raw-iso> <shots>` → `fit-report-iso.json` 복사.
