# /pm 키우기 미니게임 설계 (2026-11-03)

업무를 하면 직원 책상의 캐릭터가 저절로 자라는 미니게임. **급여·평가와 무관**(꾸미기·재미 전용), 전체 랭킹 비공개, 손지윤·Luke 제외.
토큰 구조는 `docs/pm-theme-brainstorm.md` §토큰·상점·효율 보상과 하나다 — 같은 "업무시간·효율" 신호에서 **토큰(소비 재화)** 과 **성장치(누적, 소비 안 됨)** 를 동시에 만든다. 상점 구매로 성장치가 줄지 않는다.

## 1. 레퍼런스 리서치 (무엇을 가져오고 무엇을 버렸나)

| 레퍼런스 | 가져온 것 | 버린 것 |
|---|---|---|
| [Window Box](https://alexserediuc.itch.io/window-box) | 상태 막대 대신 **식물 모습으로 상태를 보여줌**(졸기·시듦 = 외형) | 열어둘 때만 자람 |
| [Potted Plant Simulator](https://dylanwolf.itch.io/potted-plant-simulator) | 생존 자원(물)과 성장 자원(양분) 분리 → 우리: 돌봄(외형 회복) vs 업무(성장) | 물 안 주면 죽음 |
| [Plant Balance](https://ngrh.itch.io/plant-balance) | — | 자원 감소→시들어 죽음 (**반례**: 측정 오차로 불이익 금지 원칙에 위배) |
| MovieStarPlanet 식물([위키](https://moviestarplanet.fandom.com/wiki/File:Plants-MeatEaterExtra.png)) | **단계는 절대 내려가지 않음**, 방치 시 보너스만 소멸 | 죽음 아이콘 |
| [Pet Care Game](https://skcreation.itch.io/pet-care-game) | 기분→성장 속도 연결 → 우리: 품질 관문 통과 = 가속 | 기분 하락 패널티 |
| [My Plant Room](https://apps.apple.com/app/id6760250155) · [Plan T](https://personal-site-48p.pages.dev/works/plan-t) | 타이머·스트레스 없음, 작은 외형 변화의 반가움 | — |
| 다마고치 / 동물의 숲 | 단계마다 **실루엣이 확 바뀌는** 진화, 둥근 점토 질감·파스텔 | 돌보지 않으면 떠남 |

## 2. 성장 단계

| 단계 | 꽃 계열 | 필요 누적 성장치 | 모습·동작 |
|---|---|---|---|
| 1 | 씨앗 | 0 | 화분 속 씨앗, 졸린 눈 |
| 2 | 새싹 | 60 | 잎 2장, 큰 눈 |
| 3 | 꽃봉오리 | 240 | 잎 팔 |
| 4 | 만개 | 600 | 활짝 핀 꽃, 잎 팔·뿌리 발 |
| 5 | 전설 꽃 | 1500 | 금빛 꽃잎 왕관·반짝임 |

다른 계열(동물 등)은 manifest `lines[]` 로 추가(같은 단계 임계값). 이번 PR 은 꽃 계열만 에셋 포함.

## 3. 성장 재료 (서버 계산만)

1분 피드(`pm-office` ingest) 를 받을 때마다 **서버**가 직원별 상태를 갱신한다. 클라이언트가 보내는 값은 쓰지 않는다.

- 기본 성장: `status=working` 1분 = 1/6 점 (= 1시간 10점, 토큰 '업무 특정 1h=10' 과 같은 비율). 활성만(`idle` 이 아닌 그 외) 1시간 3점.
- 가속(효율 보상, 토큰 PR④ 와 같은 식): work-feature-timesave 의 업무별 기준시간 대비 단축분 × 품질계수. 품질 관문 = 재수정·무결성 오류·반려 0 일 때만 1, 아니면 0(감점 아님). 측정 불가 = '판정 불가'(가속 0, 감점 0). **기본 OFF 플래그**(`PM_GROW_BOOST=1`) — 처음 2주 기록만.
- 하루 상한 60점(토큰 상한과 동일). 단계는 **절대 내려가지 않음**.

## 4. 상태

| 상태 | 조건 | 표현 |
|---|---|---|
| 작업 | 피드 status=working | 작업 모션(통통 튐) |
| 대기 | 그 외 | 숨쉬기 |
| 졸기 | 마지막 활동 90분+ | 눈 감고 기울어짐 |
| 시듦(외형만) | 업무일 기준 3일+ 무활동 | 고개 숙임·채도↓, 성장치 그대로 |

회복: 다시 일하면 즉시 대기/작업. 돌봄 아이템(물뿌리개)은 시듦 외형만 되돌림 — 성장치 변화 없음. 죽음·후퇴 없음.

## 5. 팀 정원

부서별 정원 = 부서원 성장치 합의 단계(임계값 ×인원). 팀 퀘스트(차수 발주→견적 지연 없이)는 토큰 PR④ 에서 신호가 생기면 연결, 지금은 자리만.

## 6. 저장·API

- 저장: 웹 전용 파일 `data/runtime/work-feature-pm-grow.json`(다른 /pm API 와 같은 런타임 파일 방식, nenova 전산 테이블 무관). 토큰 테이블(PmTokenLedger) 이 MSSQL 로 들어올 때 함께 이관.
- 계산: `lib/pmGrow.js` `advanceGrow(state, office, nowMs)` — 순수 함수, 단위 테스트.
- 갱신 시점: `feature-data-ingest` 가 `pm-office` 를 저장한 직후 서버에서 호출.
- 읽기: `GET /api/pm/grow` (게이트 = /api/pm/office 와 동일). 계약 `docs/contracts/pm-office.json` 에 PM_GROW_READ 등록.

## 7. 에셋

`public/pm-grow/manifest.json` — 단계·동작·프레임·출처(모델·프롬프트·크레딧). 생성 = Higgsfield, 3D 처리·스프라이트 렌더 = Blender. reduced-motion 이면 첫 프레임 정지. 서랍 '키우기' 탭을 열 때만 로드(첫 화면 무게 없음).
