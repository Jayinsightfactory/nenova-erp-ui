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

## 7. 검증

```powershell
npm run test:board
npm run verify:erp-change
```

운영 DB는 읽기 전용 조회(GET)로만 확인하고, 이 화면에서 ERP 원장 보정은 수행하지 않는다.
