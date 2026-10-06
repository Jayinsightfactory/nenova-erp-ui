# 주문 commit 후 재고 CALC 트랜잭션 계약 (2026-10-06)

범위는 `pages/api/orders/index.js`의 공용 `runStockCalculation`과 내 업체 주문 전용 CALC 제외 조건이다.
주문 저장 트랜잭션의 commit 위치, 생성/수정 응답과 경고 의미를 바꾸지 않는다.
2026-10-06 사용자 요구에 따라 `my-customer` ADD도 주문 전용으로 수정한다.
`my-customer` 절대수량 및 `source=order-import-final` 최종본 경로의 CALC
건너뛰기를 보존한다. `isMyCustomerOrderSource`는 두 소스를 모두 포함하고
`isAbsoluteOrderMode`는 FINAL_SNAPSHOT도 포함한다. final 인접 로그만으로 해당
요청이 CALC/RUN의 원인이라고 단정하지 않는다. 배포 SHA 확인은 메인 책임이다.

## 근거와 한계

- 실제 DB 정의: `../china-order-customer-matrix/output/stock-gate-2026-10-06-procedures.json`.
  CALC는 GateEnter(CALC/V2)를 **내부 BEGIN TRANSACTION 전에** 호출한다.
  정상 내부 COMMIT 뒤 GateLeave(success=1), 오류 내부 ROLLBACK 뒤 토큰 조건부
  GateLeave(success=0)를 실행한다. 외부 트랜잭션 없이 timeout되면 RUN이 남을 수 있다.
- 메인이 제공한 현재 실제 CLI `FormOrderAdd.btnSave_Click` 확인: 주문 transaction
  commit 후 native CALC를 실행하고 returneditem!=0을 검사한다. 신규 EditMode=1은
  ProdKey=0을 사용한다. 이번 변경은 기존 웹의 변경 품목별 계산 범위를 보존한다.
- `lib/stockGateOperation.js`의 원래 트랜잭션 marker와
  `lib/estimateDirectionalQuantity.js`의 V2/결과 검증을 참고한다.
  FIX/CANCEL 전용 operation/clear helper를 CALC에 재사용하지 않는다.
- 현재 운영 RUN 소유자 311의 생존/commit 여부는 메인도 입증하지 못했다.
  이 코드는 해당 RUN을 복구하거나 시간 만료로 인수하지 않는다.

## 부작용 및 downstream

| 동작 | OrderMaster/Detail/History | ShipmentDetail/Date/Farm·Amount/Vat/isFix | StockMaster/ProductStock | Product.Stock/StockHistory | Estimate/WebProfitReport |
|---|---|---|---|---|---|
| 주문 commit 후 CALC 성공 | 이미 저장된 주문 보존 | 보존 | 변경 품목의 native 현재/후속 차수 cascade | 보존(읽기만) | 직접 변경 없음; 재고 snapshot 소비자는 native 결과 사용 |
| timeout/결과 실패/두 번째 품목 실패 | 주문 commit 보존, 응답 경고 | 보존 | 계산 배치 전체 rollback | 보존 | 보존 |
| RUN/WAIT_CALC/고아·불완전 IDLE/준비 미달 | 보존, 응답 경고 | 보존 | CALC 실행 금지 | 보존 | 보존 |
| my-customer ADD/절대수량/최종본 또는 변경품목 없음 | 기존 저장 정책 | 보존 | CALC 없음 | 보존 | 보존 |

## 기준 ledger → 구현/검증

| 기준 | 권위 근거 | 소비자 |
|---|---|---|
| OrderYear/OrderWeek, 중복 제거된 양수 Int ProdKey | API의 기존 명시 범위, native signature | helper 입력/SQL 바인딩/교차연도 fixture |
| OrderYear > 2025 | native 과거연도 return -1이 output=0 및 열린 내부 transaction을 남김 | helper 선검증, SQL/CALC 호출 전 거부 |
| 하나의 외부 transaction, retries=0 | 이번 제한된 안전 계약 | helper/실행형 fake transaction |
| GateKey=1 UPDLOCK,HOLDLOCK,NOWAIT가 native보다 먼저 | 실제 GateEnter의 선행 RUN 갱신 | preflight lock/SQL fixture |
| 완전 IDLE | V2 state 계약 | Mode/LockedAt/Action/OrderYear/OrderWeek/OwnerSessionID/OwnerToken/CalcProdKey 모두 NULL, PendingCalc=0, ProtocolVersion=2 |
| capability ProtocolVersion=2, IsReady=1 | V2 capability module/hash/state check | 잠금 이후 capability 검사; legacy fallback 금지 |
| native 입력/출력 signature 확인 | 실제 DB 정의 | sys.parameters의 6개 이름·타입·output 속성 검사 |
| 성공은 returnCode=0 AND output result=0, 누락/NULL 실패 | native signature 및 현재 CLI 결과 검사 | SQL 각 품목 직후 검사 + JS 결과 검사 |
| 원래 transaction 생존 | 외부 rollback 시 native 오류 경로 | SPID/TRANCOUNT/XACT_STATE 및 transaction-owned applock marker, 각 native 전후 |
| 계산 timeout은 품목 수로 늘리지 않음 | 기존 lib/db.js 60000ms requestTimeout | 모든 native 호출을 단일 SQL 요청에 묶음; Promise.race/background 재시도 없음 |

현재 드라이버 근거: `node_modules/mssql/lib/tedious/connection-pool.js`의
`cfg.options.requestTimeout = cfg.options.requestTimeout ?? this.config.requestTimeout ?? this.config.timeout ?? 15000`
는 `lib/db.js`의 nested options.requestTimeout=60000을 유지한다. helper 자체는
timeout을 늘리거나 global DB 설정을 수정하지 않고 주입된 request의 실제 제한을 따른다.

`runOrderStockCalculationBatch({withTransactionFn,types,orderYear,orderWeek,uid,prodKeys})`
는 DB/환경/인증을 import하지 않는다. 성공 시 품목별 검증 결과 배열, 빈 품목은
`[]`, 실패는 throw한다. API만 오류를 기존 로그·재고 재계산 경고로 바꾼다.
잠금은 batch commit/rollback까지 유지하며 웹 직접 gate UPDATE/clear/steal은 없다.

기본 테스트는 운영 DB 연결 없는 executing fake transaction이다. 실제 SQL lock,
attention/timeout rollback 및 V2 native 동작 검증은 메인이 준비하는 격리 fixture에서
실행해야 한다. 실제 EXE 업무·운영 recovery·배포 완료로 표시하지 않는다.
