# 잔량분배 게시판 — 업체 최종분배 흐름 부작용 행렬 (2026-08-11)

대상 화면: `/sales/shilla-miu-board` (메뉴 이름 `잔량분배`)
대상 API: `/api/sales/shilla-miu-board`
계약: `docs/contracts/shilla-miu-board.json`
근거: `docs/exe-golden/FormShipmentDistribution.md`

## 1. 업무 정의 (ERP 확정상태와 무관)

이 화면의 `업체 최종분배`는 `nenova.exe`의 `isFix`/차수 확정 상태가 **아니다.**
최초 예상한 물량 중 각 업체가 실제로 최종 납품·사용한 수량이며, 사용자가 웹에 직접
입력·저장하는 웹 전용 값이다. 화면 문구도 `확정분배`가 아니라 `최종분배`로 고정한다.

품목별 흐름은 아래 순서로만 계산한다.

| 단계 | 이름 | 원천 | 계산식 |
|---|---|---|---|
| 1 | 예상물량 | ERP `OrderMaster + OrderDetail` (읽기) | 선택 연도 + 대차수 prefix + 원천업체 `CustKey` + `ProdKey`의 활성 주문 합계 |
| 2 | 현재분배 | ERP `ShipmentMaster + ShipmentDetail` (읽기) | 같은 업무키의 활성 양수 `OutQuantity` 합계 |
| 3 | 업체 최종분배 | 웹 전용 `WebShillaMiuBoardAllocation.FinalQty` | 사용자가 입력·저장. 미입력이면 현재분배를 임시 표시값으로 사용 |
| 4 | 업체 잔량 | 계산 | `예상물량 − 업체 최종분배` (음수면 `초과`로 표시) |
| 5 | 미우 이관량 | 계산 | `max(0, 업체 잔량)` — 음수 물량은 이관하지 않는다 |
| 6 | 미우 자체수량 | ERP (읽기) | 수령업체 `CustKey`가 직접 주문·분배한 수량 |
| 7 | 기타 업체 잔량 합계 | 계산 | 모든 활성 원천 그룹의 `미우 이관량` 합계 |
| 8 | 미우 총수량 | 계산 | `미우 자체수량 + 기타 업체 잔량 합계` |

예: 신라 20 + 라움 10 + 초이문 5 + 미우 자체 15 = 미우 총수량 50.

모든 중간값과 합계는 0.001 단위로 정규화한다(`roundQty`). 원천업체는 신라·라움·초이문
하드코딩이 아니라 `WebShillaMiuBoardGroup`의 활성 그룹 전체이며, 업체관리에서 추가한
업체도 같은 계산에 자동 포함된다.

## 2. 사용자 동작별 부작용 행렬

| 사용자 동작 | OrderMaster/OrderDetail | ShipmentMaster/Detail | ShipmentDate/Farm | ProductStock/StockHistory | Estimate/WebProfitReport | 웹 전용 원장 |
|---|---|---|---|---|---|---|
| 전체 탭 조회 | 읽기 | 읽기 | 접근 없음 | 접근 없음 | 보존 | 읽기 |
| 업체 탭 조회 | 읽기 | 읽기 | 접근 없음 | 접근 없음 | 보존 | 읽기 |
| 차수 스피너 ▲▼·휠·키보드 조회 | 읽기 | 읽기 | 접근 없음 | 접근 없음 | 보존 | 읽기 |
| 업체 최종분배 입력 후 저장 | 보존 | 보존 | 보존 | 보존 | 보존 | `WebShillaMiuBoardAllocation` upsert + `WebShillaMiuBoardAllocationHistory` INSERT |
| 완료 체크 저장 | 보존 | 보존 | 보존 | 보존 | 보존 | 위와 동일 |
| 업체관리 저장(관리자) | 보존 | 보존 | 보존 | 보존 | 보존 | `WebShillaMiuBoardGroup` upsert |
| 업체관리 기존 그룹 수정(관리자) | 보존 | 보존 | 보존 | 보존 | 보존 | `WebShillaMiuBoardGroup` UPDATE(GroupKey 지정) |
| 기준업체 연결 진단 표시 | 읽기 | 읽기 | 접근 없음 | 접근 없음 | 보존 | 접근 없음 |

- GET 경로에서는 DDL(`CREATE`/`ALTER`)을 실행하지 않는다. 웹 전용 테이블이 아직 없으면
  `OBJECT_ID` 가드로 빈 결과를 반환하고, 스키마 보정은 POST(저장) 경로에서만 수행한다.
- 저장 API는 `withActionLog`로 `SystemActionLog`에 남고, 값 변경 전후는
  `WebShillaMiuBoardAllocationHistory`에 행 단위로 남는다.
- ERP 원장(`Order*`, `Shipment*`, `ProductStock`, `StockHistory`, `Estimate`,
  `WebProfitReport`)에 대한 INSERT/UPDATE/DELETE는 이 기능 전체에서 금지이며
  `__tests__/shillaMiuBoard.test.js`와 `npm run guard:erp-writes`가 검사한다.

## 3. 업무키와 교차연도 격리

읽기·쓰기 모두 `OrderYear + OrderWeek(대차수 prefix) + CustKey + ProdKey`를 사용한다.
`OrderWeek`는 매년 반복되므로 연도 없이 조회·집계·저장하지 않는다. 2025년과 2026년의
같은 `32`차는 서로 다른 행이며 화면 선택 연도가 모든 GET/POST payload에 전달된다.

## 4. 기존 저장값(이동입력/완료) 호환

- 2026-08-10까지 저장된 `WebShillaMiuBoardAllocation.Qty`는 **이전 정의의 이동입력**이다.
  당시 잔량 공식은 `기준업체 실제분배 − 수령업체 실제분배`였고, 새 공식
  `예상물량 − 업체 최종분배`와 의미가 다르다.
- 따라서 기존 `Qty`를 새 `업체 최종분배`로 자동 변환하지 않는다. 값은 그대로 보존하고,
  화면에서는 참고용 `이전 이동입력`으로만 표시한다(행 툴팁과 세부 펼침).
- 새 값은 nullable 신규 컬럼 `FinalQty`에 저장한다. `FinalQty IS NULL`은 "아직 최종분배를
  입력하지 않음"을 뜻하며, 이 경우 화면은 현재분배를 임시값으로 표시하고
  `사용자 입력 아님`으로 구분한다.
- `Matched`(완료)의 의미는 그대로 유지한다: 담당자가 해당 품목 처리를 끝냈다는 웹 표시값.

## 5. 단위 처리

- 수량은 모두 `Product.OutUnit` 기준 단일값(`OutQuantity`)이다. 주문 측 레거시 행이
  `OrderDetail.OutQuantity`를 갖지 않으면 `OutUnit` CASE(Box/Bunch/Steam)로만 대체한다.
- 같은 `ProdKey`는 단위가 하나이므로 그룹 간 합산이 가능하다. 그럼에도 서로 다른 단위
  문자열이 보고되면 합산하지 않고 `prodKey|unit`으로 행을 분리해 표시한다.

## 6. 차수 스피너 입력 계약 (2026-08-11 휠 회귀 수정)

`대차수` 입력칸의 이동 수단은 ▲▼ 클릭 · 키보드 `ArrowUp`/`ArrowDown` · 입력칸 위 휠
세 가지이며 모두 같은 `stepWeek` 경로를 쓴다. 조회만 하고 저장은 하지 않는다.

| 입력 | 결과 |
|---|---|
| 휠 아래 1회(gesture) | 정확히 1차 감소 |
| 휠 위 1회(gesture) | 정확히 1차 증가 |
| 한 gesture 안의 wheel 이벤트 burst | 첫 이벤트만 이동, 나머지는 삼킴(`preventDefault`는 유지) |
| gesture 간격(`WHEEL_GESTURE_MS`=200ms) 이상 쉰 뒤의 휠 | 새 gesture 로 각각 1차씩 이동 |
| `deltaY=0` 휠 | 처리하지 않음 — 입력칸 밖 페이지 스크롤은 정상 동작 |
| 1차에서 아래로 | 이동·재조회 없음(1 미만 금지, 상한 52) |

- 브라우저·트랙패드는 한 번 굴려도 wheel 이벤트를 여러 개 보낸다. 이벤트마다 1차씩
  움직이면 한 번에 2차 이상 건너뛴다(2026-08-11 운영 재현: 33→31). burst 합치기는
  `lib/shillaMiuBoard.js`의 `createWheelGesture()` 순수 게이트가 담당한다.
- 차수 계산 기준은 React 렌더 상태가 아니라 `weekRef`(가장 최근 의도값)이다. 렌더 전에
  다음 휠·키 입력이 들어와도 이전 값(stale closure)으로 계산하지 않는다.
- 조회 응답은 일련번호(`reqRef`)로 최신 요청만 반영하고, 표시 차수·URL·선택 그룹은
  `resolveBoardView()`가 만든 한 벌에서만 갱신한다. 늦게 도착한 이전 응답이 입력칸 값과
  `?year=&week=` URL 을 서로 다르게 만드는 경쟁 상태를 구조적으로 막는다.
- URL 에는 항상 연도가 함께 남아 2025/2026 의 같은 차수가 섞이지 않는다.

## 7. 기준업체 CustKey 연결 계약 (2026-08-11 신라 공백 사고)

### 증상과 원인

운영 `/sales/shilla-miu-board?year=2026&week=33` 에서 전체 탭 36개 품목의 `신라잔량`이 전부
`-`, 신라 그룹은 `기준 업체 주문·분배 품목 없음` 이었다. 라움·초이문·미우는 정상이었다.

읽기 전용 probe(`scripts/probe-shilla-board-scope*.mjs`) 결과:

| CustKey | CustName | OrderCode | 생애 OrderMaster | 생애 ShipmentMaster | 2026 마지막 차수 |
|---|---|---|---:|---:|---|
| 444 | 신라상사 | (없음) | **0** | **0** | 없음 |
| 445 | 신라상사2 | (없음) | 0 | 0 | 없음 |
| **446** | **신라호텔** | **CLS** | 82 | 81 | 주문 34차 · 분배 32차 |
| 680 | 주식회사 트라움에스앤씨 (라움) | CLR | — | — | 주문 34차 · 분배 33차 |
| 683 | 초이문(센스앤센서빌러티) | CLC | — | — | 주문 33차 · 분배 33차 |
| 456 | 아이엠（미우） | CL11 | — | — | 주문 32차 · 분배 32차 |

`WebShillaMiuBoardGroup` 의 신라 그룹은 `BaseCustKey=444`(신라상사)를 가리키고 있었다.
2026-08-10 자동 seed 가 `CustName=N'신라상사'` 라는 **이름 문자열**로 거래처를 골랐고, 그
이름의 거래처가 유일했기 때문에 검사도 통과했지만 실제 원장 거래처는 `신라호텔`(446)이다.
게시판은 `CustKey` 로만 ERP 를 읽으므로 결과는 모든 차수·연도에서 조용한 빈 화면이었다.
즉 **데이터가 없던 것이 아니라 그룹 연결이 잘못돼 있었다.**

### 계약

- 원천·수령 업체는 **이름이 아니라 `CustKey`** 로만 식별한다. 이름 `LIKE` 매칭으로 되돌리지
  않는다(2026-07 이전 방식은 신라호텔·신라상사·신라상사2를 한 덩어리로 합쳐 읽었다).
- 자동 seed 는 ① 활성 Customer 이름이 정확히 한 건이고 ② 그 `CustKey` 에 실제
  `OrderMaster` 실적이 있을 때만 그룹을 만든다. 실적이 없는 껍데기 거래처는 seed 대상이 아니다.
- 조회 응답은 그룹마다 **선택 연도의 기준업체 주문·분배 합계**를 함께 돌려준다. 이 값은
  표시 안내에만 쓰고 예상물량·잔량 계산식에는 절대 넣지 않는다.
- 화면은 두 상태를 구분한다.

| 상태 | 조건 | 표시 |
|---|---|---|
| 이 차수만 없음 | 연도 실적 > 0, 이 차수 행 0 | `기준 업체 주문·분배 품목 없음` |
| 연결 오류 의심 | 연도 실적 = 0 | `⚠ 연결확인` + `…(CustKey N)는 YYYY년 주문·분배 실적이 없습니다. 업체관리에서 기준 Customer 연결을 확인하세요.` |

- `업체관리` 는 기존 그룹을 **GroupKey 로 수정**할 수 있어야 한다. 잘못 연결된 기준업체를
  화면에서 되돌릴 수 없으면 같은 사고가 SQL 없이는 복구되지 않는다.
- `업체관리` 의 Customer 검색 결과에는 최근 주문·분배 차수를 함께 표시해 실적 0 인 거래처를
  고르는 실수를 막는다.
- 활성 그룹의 기준 `CustKey` 는 유일해야 한다(`UX_WebShillaMiuBoardGroup_BaseActive`).
  중복 저장은 400 과 안내 문구로 막는다.
- 운영 복구는 웹 전용 설정 원장만 바꾸는
  `docs/migrations/2026-08-11_web_board_group_custkey_repair.sql` 또는 `업체관리` 화면으로
  수행한다. 잘못된 쪽 생애 실적 0 + 올바른 쪽 실적 존재를 모두 만족할 때만 갱신되는
  idempotent 문이다.

### 기본 차수

`latestScope` 는 이 게시판에 **등록된 활성 그룹의 CustKey(원천+수령)** 중 최신 분배 차수를
쓴다. 게시판과 무관한 거래처가 먼저 분배됐다는 이유로 참여 업체가 비어 있는 차수를 기본값으로
보여주지 않기 위해서다. 등록 업체 분배가 하나도 없으면 전체 최신 분배 차수로 되돌아간다.

2026-33차는 라움·초이문 분배가 있는 차수여서 수정 전후 기본값이 모두 `33`으로 같다. 즉 이번
사고의 원인은 기본 차수가 아니라 CustKey 연결이었다.

### 33차 신라 실제 데이터 (2026, 읽기 전용 확인)

| 품목 | 단위 | 예상물량(주문) | 현재분배 |
|---|---|---:|---:|
| Anthurium Graciosa 15cm | 송이 | 540 | 0 |
| CHINA / 리모늄 시네신스 화이트 500g | 단 | 460 | 0 |
| Lily Oriental Double Roselily Aisha 2+ | 송이 | 560 | 0 |
| 합계 | | **1,560** | **0** |

33차 신라(신라호텔)는 주문만 등록되고 분배는 아직 없다. 계약대로 주문 또는 분배 중 하나만
있어도 행을 만들며, 최종분배 미입력 상태에서는 현재분배(0)를 임시값으로 써 잔량 1,560 전량이
미우 이관 대상으로 표시된다. 32차는 주문·분배가 모두 200 으로 이관 0 이다.

## 8. 검증

```powershell
npm run test:board
npm run verify:erp-change
```

운영 DB는 읽기 전용 조회(GET)로만 확인하고, 이 화면에서 ERP 원장 보정은 수행하지 않는다.
