# 저장·확정·단가 공용 기능 전수검증 (2026-08-10)

## 근거와 범위

- `AGENTS.md`, `ERP_CHANGE_GUARD.md`, `ERP_FEATURE_CHANGE_CHECKLIST.md`, `ERP_COMPAT_INVARIANTS_2026-06-04.md`, `WEB_VS_ERP_CONFLICTS.md`, `DB_STRUCTURE.md`를 기준으로 검사했다.
- dnSpy golden은 `FormEstimateView`, `FormShipmentDistribution`, `FormRaumPnl`, `FormQuantityPivot`, `FormProfitReport` 기록을 사용했다. 운영 원장 쓰기나 외부 개인 폴더 접근은 하지 않았다.
- 호출처는 파일명 추측이 아니라 `runEditWithFixCycle`, `fix-status`, `/api/shipment/fix`, `/api/shipment/adjust`, `/api/estimate/update-*`, `WeekProdCost`, `ShipmentDetail/ShipmentDate Cost·Amount·Vat`의 `rg` 호출 그래프로 찾았다.

## 메뉴 → API → 원장 → 확정사이클 전수표

| 메뉴/사용자 행동 | 호출 API | 쓰는 테이블 | 확정사이클 | 업무키 | 결과 |
|---|---|---|---|---|---|
| 견적서관리 조회·출력 | `GET /api/estimate`, `GET /api/estimate/order-statement-rows` | 없음(읽기: ViewOrder, ViewShipment, ShipmentMaster/Detail/Date, Estimate) | 없음 | OrderYear + 대차수 + CustKey | 선택 연도 필수. 최근 생성 행으로 연도를 추정하던 경로와 GET DDL 제거 |
| 견적 수량 수정 | `POST /api/estimate/update-quantity`, `update-date-quantity` | Estimate 또는 ShipmentDetail + ShipmentDate + ShipmentHistory | 확정행만 unfix→save→refix | OrderYear + CustKey + ShipmentKey + SdetailKey/SdateKey | 트랜잭션 잠금 후 실제 Master 연도·거래처 대조 |
| 견적 단가 수정 | `POST /api/estimate/update-cost` | ShipmentDetail.Cost/EstQuantity/Amount/Vat, ShipmentDate.Cost/Amount/Vat, 선택 시 CustomerProdCost/WeekProdCost | 확정행만 unfix→save→refix | OrderYear + OrderWeek + CustKey + ShipmentKey + SdetailKey | 자동 `force=false`, WeekProdCost 연도 분리 및 명시 migration |
| 견적 품목정보 수정 | `POST /api/estimate/update-entry` 및 위 수량/단가 API | Estimate만 또는 정상출고 수량/단가 범위 | 정상출고 확정행만 사이클 | OrderYear + CustKey + EstimateKey/ShipmentKey | Estimate 부호·EstimateType 보존, Master 스코프 대조 추가 |
| 기존 불량/검역등록 | `POST /api/estimate` | Estimate | 없음(Estimate-only) | OrderYear + OrderWeek + CustKey + ProdKey + ShipmentKey | 기존 EstimateType 선택, 음수 수량, VAT/인쇄 표시 보존 |
| 불량차감·판매요청 | `POST /api/estimate` | Estimate | 없음(Estimate-only) | 동일 | 불량차감 음수/판매요청 양수, 기존 기능과 상태 분리 |
| 추가 품목등록 | `GET additional-product-context`, `POST /api/shipment/adjust` | 조건에 따라 OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, History/Log | 확정행은 공용 unfix→save→refix | OrderYear + `NN-02` + CustKey + ProdKey + ShipmentDate | 자동 강제해제 제거, 농장·단가출처·02차·PIVOT_DISTRIBUTION 보존 |
| 라움 손익 ERP 정렬 | `update-quantity`, `update-cost`, `/api/shipment/adjust`, `/api/stock/adjust-batch`, fix/status | 출고 수량/단가, 필요 시 Order/Shipment, StockHistory | 공용 사이클 | OrderYear + OrderWeek + CustKey + ProdKey | 모든 호출에 연도 전달. 입고/재고 부족 자동 force 재시도 제거 |
| 주문 붙여넣기 등록·분배 | `/api/orders`, `/api/shipment/adjust`, fix-status/fixCheck | OrderMaster/Detail, ShipmentMaster/Detail/Date, Adjustment | 확정이면 저장 전 차단 | OrderYear + OrderWeek + CustKey + ProdKey | 일괄 자동 force 제거. 단건은 서버 경고 뒤 사용자가 다시 확인한 경우만 override |
| 주문 Excel 업로드 | `/api/orders` | OrderMaster/Detail, 라움 소스만 빈 ShipmentMaster 준비 | 없음(확정 출고 편집 아님) | OrderYear + OrderWeek + CustKey + ProdKey | 저장 연도 기본값 제거, 명시 연도 없으면 중단 |
| 차수피벗·출고분배 | `/api/shipment/stock-status`, `/api/shipment/adjust`, `/api/shipment/distribute`, SP 경로 | Order 정책에 따라 OrderDetail, ShipmentDetail/Date/Farm/History | 확정이면 차단 또는 사용자의 별도 확정취소 | OrderYear + OrderWeek + CustKey + ProdKey | 자동 재고부족 force 제거, 화면 연도를 GET/POST에 명시 |
| 재고관리 일괄수정 | `/api/stock/adjust-batch`, `/api/shipment/fix` | StockHistory, Product.Stock, ProductStock | 공용 unfix→save→refix | OrderYear + OrderWeek + ProdKey | 확정해제 뒤에도 `force`로 상태검사를 건너뛰지 않음 |
| 차수 확정현황 | `GET/POST /api/shipment/fix-status`, `/api/shipment/fix` | POST만 Shipment/Stock 확정 원장과 로그 | 수동 작업 | OrderYear + OrderWeek | 뒤 차수 경고를 처음부터 우회하지 않고 2차 명시 확인 때만 force |
| 영업수입 불량차감·지원 등록 | `/api/sales/defect-deductions`, `/api/estimate` | WebSalesDefectDeduction/History, Estimate | Estimate-only | OrderYear + 원차수 + 적용차수 + CustKey + ProdKey | 기존 이월·단가 fallback·음수 부호 계약 보존 |
| 거래명세표/견적 인쇄 | `GET /api/estimate`, `order-statement-rows` | 없음 | 없음 | OrderYear + 대차수 + CustKey | 인쇄도 선택 연도 전달. EstimateType fallback 보존 |
| 모바일 견적 목록 | `GET /api/m/biz`, `GET /api/estimate` | 없음 | 없음 | 자동 판정된 최근 활성 OrderYear + 대차수 | 최근 차수 조회 자체를 한 연도로 제한하고 그 연도를 견적 조회에 명시 |
| Ecount 판매 전송 | `/api/ecount/sales-push` | 외부 Ecount + EcountSyncLog | 없음 | ShipmentKey 또는 OrderYear + 조건 | PK 목록이 아닌 전체/조건 전송은 선택 연도 필수 |
| 견적 보정용 dev API | `estimate-cost-date-sync`, `estimate-print-descr-cleanup` | ShipmentDetail/Date/Estimate | 수동 보정 | PK 또는 OrderYear + 조건 | 차수/거래처 조건만으로 교차연도 쓰지 못하게 연도 필수화 |

## 사용자 행동별 side-effect matrix

| 행동 | OrderDetail | ShipmentDetail | ShipmentDate | ShipmentFarm | Estimate | Stock/Profit |
|---|---|---|---|---|---|---|
| 정상 견적 단가 수정 | 보존 | Cost/EstQuantity/Amount/Vat | Cost/Amount/Vat 동기화 | 보존 | 보존 | 확정 사이클 재계산 외 직접 변경 없음 |
| 정상 견적 출고일 수량 수정 | 보존 | 수량·환산·금액 합계 갱신 | 해당 날짜 수량·금액 갱신 | 보존 | 보존 | 재확정 시 재고 계산, WebProfitReport 직접 쓰기 없음 |
| Estimate 행 수량/정보 수정 | 보존 | 보존 | 보존 | 보존 | 기존 부호·타입 유지 UPDATE | 보존 |
| 불량/검역·불량차감·판매요청 | 보존 | 보존 | 보존 | 보존 | 음수/양수 Estimate INSERT | 보존 |
| 추가 품목등록(PIVOT_DISTRIBUTION) | 활성 주문 없을 때만 신규, 있으면 보존 | 증가 | 동기화 | 신규/미배정이면 필수 | 직접 생성 안 함 | 재확정 영향만, Profit 직접 쓰기 없음 |
| 피벗 ADD/CANCEL | 계약 표대로 신규/보존 | 증가/감소 | 동기화 | 신규 활성출고에 필수 | 직접 생성 안 함 | 음수재고는 자동 우회 안 함 |
| 재고관리 조정 | 보존 | 보존 | 보존 | 보존 | 보존 | StockHistory + Product.Stock + ProductStock 재계산 |
| 조회·인쇄·운영 smoke | 보존 | 보존 | 보존 | 보존 | 보존 | 모두 읽기 전용 |

## force 의미 분리

| API | 의미 | 허용 정책 |
|---|---|---|
| `/api/shipment/fix` unfix의 `force` | 뒤 차수 확정 경고(`LATER_FIXED_EXISTS`) 우회 | 자동 편집 사이클 금지. 수동 화면의 경고 후 2차 확인만 허용 |
| `/api/shipment/adjust`의 `force` | 입고 0/초과·음수잔량 경고 override | 일괄/라움/피벗 자동 재시도 금지. 붙여넣기 단건에서 서버 경고를 본 사용자의 명시 확인만 허용 |
| `/api/stock/adjust-batch`의 과거 `force` | 확정 상태 검사 자체 우회 | 제거. 공용 사이클이 정상 해제하지 못했으면 저장 중단 |
| 주문 품목 매칭의 `force` | 매칭 사전값 덮어쓰기 | ERP 확정/재고 force와 무관하므로 유지 |
| 파일 삭제의 `force` | 임시폴더 정리 | ERP 원장과 무관 |

## 원자성·실사용 경계

- `update-cost`, `update-date-quantity`, `update-entry`, 개별 `shipment/adjust`, 재고 한 품목 적용은 각 서버 트랜잭션 안에서 성공/롤백한다.
- 여러 HTTP 작업을 묶는 라움 이동과 붙여넣기 일괄 작업은 행별 성공/실패를 사용자에게 남기는 기존 부분성공 계약이다. 자동 강제 재시도는 제거했고 실패 행은 대기 상태로 남긴다. 여러 메뉴를 하나의 분산 트랜잭션으로 묶었다고 주장하지 않는다.
- 운영에서는 쓰기 시험을 하지 않는다. 저장 payload, 교차연도, 확정/미확정, 뒤 차수 확정, 음수재고, 농장/출고일/중복은 fixture와 정적 계약으로 검증한다.

## WeekProdCost DDL 결정

- `GET /api/estimate`의 `ensureWeekProdCostTable()`은 읽기 요청에서 DDL을 실행하므로 제거했다.
- `POST update-cost`도 런타임 DDL을 실행하지 않는다. `weekFav` 저장은 스키마 probe만 하고 미적용이면 구체적으로 중단한다.
- 생성/연도 컬럼/복합 고유키 변경은 `docs/migrations/2026-08-10_week_prod_cost_order_year.sql`로 분리했다. 기존 연도 미상 행은 현재연도로 추정하지 않는다.

## 자동검사와 운영 확인

- 자동 회귀: `__tests__/erpEditFixScopeAudit.test.js`가 실제 호출처, force 정책, 저장 스코프, 2025/2026 동일 `32-02`, 네 등록 버튼을 검사한다.
- 전체 ERP 계약·manifest·write guard·dnSpy evidence·build 결과와 운영 read-only probe 결과는 같은 작업의 최종 보고에 기록한다.
