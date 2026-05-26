# nenovaweb 페이지 데이터/입력/DB parity 감사

작성일: 2026-05-26

## 목적

이 문서는 메뉴 존재 여부가 아니라 각 메뉴가 실제 업무 화면으로서 `nenova.exe`와 같은 의미로 동작하는지 검증하기 위한 기준 문서이다.

검증 범위는 다음 네 가지이다.

1. 화면에 어떤 데이터를 어떤 기준으로 보여주는가
2. 사용자가 어떤 방식으로 입력/수정/삭제하는가
3. 어떤 API가 호출되는가
4. 어떤 DB 테이블, SP, 파일, 외부 ERP에 기록되는가

운영 사이트 검증 원칙:

- 운영 사이트에서는 조회, 화면 구조 확인, 버튼/링크 존재 확인만 한다.
- 저장, 삭제, 수정, 송금 입력, 출고분배 실행, 이카운트 전송 같은 데이터 변경 동작은 사용자 허락 전에는 하지 않는다.
- 코드 기준으로 DB 쓰기 경로를 먼저 확인한 뒤, 운영 화면에서는 읽기 전용으로 화면과 데이터 표시 방식을 비교한다.

## 현재 결론

아직 `100% 동일`이라고 판단하면 안 된다.

현재까지 확인된 상태는 다음과 같다.

- 메뉴 구성 감사는 1차 완료되었지만, 업무 동작 parity 감사는 별도 진행이 필요하다.
- 주문, 출고, 재고, 견적, 입고, 송금, 운송기준원가, 구매/판매/채권/세금계산서 화면은 모두 서로 다른 DB 쓰기 경로를 가진다.
- 특히 출고분배/확정/취소/견적/재고 관련 메뉴는 `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentHistory`, `ProductStock`, `StockHistory`, `Product.Stock`, `usp_ShipmentFix`, `usp_ShipmentFixCancel`, `usp_StockCalculation`가 얽혀 있어 최우선 충돌 검증 대상이다.
- 웹 전용 테이블/파일을 쓰는 메뉴는 `nenova.exe`와 같은 업무명이어도 실제 ERP 저장 구조와 다를 수 있다.

## 메뉴별 1차 매트릭스

| 구분 | 메뉴/페이지 | 화면 표시 데이터 | 입력 방식 | 저장/API | DB/파일 쓰기 | 전산 parity 상태 | 위험도 |
|---|---|---|---|---|---|---|---|
| 주문 | 주문등록 `/orders/new` | 거래처 검색, 품목 그룹/품목 목록, 기존 주문, 주문 이력 | 거래처/차수 선택 후 품목별 박스/단/송이 입력 | `GET /api/customers/search`, `GET /api/products/search`, `GET/POST /api/orders`, `GET /api/orders/history` | `OrderMaster`, `OrderDetail`, `OrderHistory`, `usp_StockCalculation` | 전산 주문 구조와 같은 핵심 테이블 사용. 삭제 버튼은 화면상 초기화인지 실제 삭제인지 추가 확인 필요 | 높음 |
| 주문 | 붙여넣기 주문등록 `/orders/paste` | 붙여넣기 분석 결과, 고객/품목 매칭 후보, 기존 주문/출고 수량 | 카톡 문장 붙여넣기, 고객/품목 수동 선택, 단위 조정, 주문등록, 출고 조정 | `POST /api/orders/parse-paste`, `POST /api/orders`, `POST /api/shipment/adjust`, 매핑 API들 | `OrderMaster`, `OrderDetail`, `OrderHistory`, `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentHistory`, 매핑 JSON/API 저장 | 매칭 시도 자체가 히스토리를 바꾸면 안 되고, 실제 저장/분배 성공 후 학습되어야 한다. 최근 보완됨. 실제 카톡 샘플 추가 검증 필요 | 최상 |
| 주문 | 주문관리 `/orders` | 주문 목록/상세 | 조회/수정 가능성 있음 | `GET/PUT /api/orders` | `OrderMaster`, `OrderDetail`, `OrderHistory` | 전산 주문 수정 흐름과 화면 필드 단위 비교 필요 | 높음 |
| 입고/발주 | 발주관리 `/warehouse` | 입고/발주 목록과 상세 | 차수/업체/품목별 입고 수량, 가격, 운송 관련 입력 | `GET/POST/PATCH/DELETE /api/warehouse` | `WarehouseMaster`, `WarehouseDetail`, `StockHistory`, `usp_StockCalculation` | 전산 입고등록이 재고 cascade를 어떻게 호출하는지와 비교 필요 | 최상 |
| 입고/발주 | 입고관리 `/incoming` | 입고 데이터 화면 | 팝업형 입고 관리 | `GET/POST/PATCH/DELETE /api/warehouse` 계열 가능성 | `WarehouseMaster`, `WarehouseDetail`, `StockHistory` 가능성 | 화면/코드 세부 매핑 추가 확인 필요 | 높음 |
| 입고/송금 | 입고단가/송금 `/incoming-price` | 입고 원가, 업체별 합계, 저장된 송금/메모, 우측 탭의 미송금/입력 있음 분리 | 업체+차수별 송금액/메모 입력, 삭제 | `GET/PUT/DELETE /api/incoming-price` | `FarmCredit` | 기존 입고 데이터는 조회, 송금 입력은 `FarmCredit` 별도 기록. 전산에 동일 송금 테이블/화면이 있는지 추가 확인 필요 | 중간 |
| 운송원가 | 운송기준원가 `/freight` | AWB/차수 기준 운송원가, 품목/화종/관세/스냅샷 | 기준값/품목별 단가/분류 override 입력, 엑셀 | `GET/POST /api/freight`, `POST /api/freight/category-override`, `PUT /api/master?entity=flower`, `POST /api/freight/excel` | `FreightCost`, `FreightCostDetail`, `Flower`, `data/category-overrides.json` | 전산 직접 기능보다는 웹 산출 기능 성격. 운송기준원가 산식과 원천 데이터 검증이 필요 | 높음 |
| 출고 | 출고분배 `/shipment/distribute` | 품목별 고객 주문/출고 후보, 고객별 품목 목록, 출고일 분배, 이력 | 품목/고객 선택, 수량/출고일 입력, 저장, 확정/취소 | `GET/POST /api/shipment/distribute`, `GET/POST /api/shipment/fix`, `GET/POST /api/shipment/ship-days`, `GET /api/shipment/history` | `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentHistory`, `KeyNumbering`, `_new_ShipDayConfig`, SP 호출 | 웹 분배 저장은 전산 `usp_DistributeTotal/One/Clear`와 완전 동일 구조가 아니다. 확정/취소는 SP 사용. 출고일, 단가, 부분확정, 키 충돌 최우선 검증 필요 | 최상 |
| 출고 | 차수 확정 현황 `/shipment/fix-status` | 차수/품목군별 확정 상태 | 확정 취소/상태 확인성 기능 | `GET/POST /api/shipment/fix-status` | `usp_ShipmentFixCancel`, `usp_StockCalculation` | 전산 확정 취소 SP와 연결되어 있으나 화면 조작 영향 범위 추가 확인 필요 | 최상 |
| 출고/재고 | 출고,재고상황 `/shipment/stock-status` | 차수 범위별 주문/출고/재고 상태 | 출고수량 수정, 주문 추가, 비고 편집, 시작재고 저장 | `GET/PATCH/POST/DELETE/PUT /api/shipment/stock-status` | `ShipmentDetail`, `ShipmentDate`, `OrderMaster`, `OrderDetail`, `OrderHistory`, `StockMaster`, `ProductStock` | 전산 수동 수정과 충돌 위험이 매우 높음. ProductStock 스냅샷과 Product.Stock 의미를 분리해서 검증해야 함 | 최상 |
| 출고/재고 | 차수피벗 `/shipment/week-pivot` | 차수별 피벗 재고/출고/주문 | 피벗에서 주문/출고 조정, 시작재고 가능성 | `GET /api/shipment/stock-status`, `POST /api/shipment/adjust`, 시작재고 API | `OrderMaster`, `OrderDetail`, `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentAdjustment`, `ShipmentHistory`, `ProductStock` | 편리 기능이지만 DB 영향은 핵심 출고/주문과 동일. 전산 메뉴와 1:1 비교 필요 | 최상 |
| 출고 | 출고조회 `/shipment/view` | 출고 목록/상세 | 조회 중심, 상세 수정 가능성 확인 필요 | `GET /api/shipment`, `GET/PATCH /api/shipment/[id]` | PATCH 시 `ShipmentDetail` 가능성 | 전산 `ViewShipment` 필터와 웹 쿼리 차이 확인 필요 | 높음 |
| 출고 | 출고내역조회 `/shipment/history` | 출고 변경 이력 | 조회 | `GET /api/shipment/history` | 없음 | 이력 기록은 다른 저장 API가 책임진다. 전산 이력 표시 방식과 비교 필요 | 낮음 |
| 견적 | 견적서관리 `/estimate` | 출고 기반 견적서, 단가, 품목, 불량/누락, 확정 상태 | 수량/단가 수정, 단가 적용, 견적 저장/출력/엑셀 | `GET/POST/PATCH/DELETE /api/estimate`, `POST /api/estimate/update-quantity`, `POST /api/estimate/update-cost`, `POST /api/shipment/fix`, `GET/POST /api/shipment/fix-status` | `Estimate`, `ShipmentDetail`, `ShipmentDate`, `CustomerProdCost`, `WeekProdCost`, `ShipmentHistory`, SP 확정/취소 | 단가가 견적서에 보이는 구조와 직접 연결됨. 출고분배 저장 시 업체별 품목단가 불러오기 검증 필요 | 최상 |
| 구매 | 구매현황 `/purchase/status` | 수입/외화 구매 목록 | 구매 상세, 금액, 결제일, 메모 입력, 이카운트 전송 | `GET/POST/DELETE /api/purchase`, `POST /api/ecount/purchase-push` | `ImportOrder`, `ImportOrderDetail`, `EcountSyncLog`, 외부 Ecount 가능 | 웹 전용 구매 테이블 성격. 전산 또는 Ecount 원본과 어느 쪽이 기준인지 확정 필요 | 높음 |
| 판매 | 판매현황 `/sales/status` | 출고 기반 판매 목록 | 조회, 선택 후 Ecount 판매 전송 | `GET /api/sales/status`, `POST /api/ecount/sales-push` | `EcountSyncLog`, 외부 Ecount 가능 | 판매 원천은 출고 DB, 전송은 외부 ERP. Ecount와 DB의 양방향 일치 여부 미검증 | 높음 |
| 채권 | 거래처별 채권 `/sales/ar` | 거래처별 매출/입금/잔액, 원장 | 입금 등록 | `GET/POST /api/sales/ar` | `ReceivableLedger` | 전산 채권/입금 관리와 동일 테이블인지 확인 필요. 판매 단가 반영 방식도 비교 필요 | 높음 |
| 세금 | 세금계산서 진행금액 `/sales/tax-invoice` | 세금계산서 목록/진행 상태 | 생성/수정/삭제, Ecount 회계 전송 | `GET/POST/PATCH/DELETE /api/sales/tax-invoice`, `POST /api/ecount/accounting` | `TaxInvoice`, `EcountSyncLog`, 외부 Ecount 가능 | 웹 전용 테이블 가능성 큼. 전산/이카운트 기준 확정 필요 | 높음 |
| 재무 | 입출금 계좌 조회 `/finance/bank` | 계좌 입출금 | 거래 등록/삭제 | `GET/POST/DELETE /api/finance/bank` | `BankTransaction` | 전산과 동일 기능인지, 웹 보조장인지 확인 필요 | 중간 |
| 재무 | 외화/환율 관리 `/finance/exchange` | 통화/환율 목록 | 환율 등록/수정 | `GET/POST /api/finance/exchange` | `CurrencyMaster` | 운송/구매 산식에 영향. 전산 환율 관리와 입력 단위 비교 필요 | 중간 |
| 재고 | 재고관리 `/stock` | 차수/품목별 재고, 재고 이력 | 조정 수량/사유 입력, 엑셀 | `GET/POST /api/stock`, `/api/stock/excel` | `StockHistory`, `usp_StockCalculation` | 전산 재고 본체 SP 사용. 조정 이력이 ProductStock/Product.Stock에 반영되는 순서 검증 필요 | 최상 |
| 통계 | 월별/피벗/지역/분석/영업사원 통계 | 출고/매출/품목 통계 | 조회 조건 | `GET /api/stats/*` | 없음 | 표시 공식이 전산 보고서와 같은지 별도 샘플 비교 필요 | 중간 |
| 마스터 | 거래처관리 `/master/customers` | 거래처 목록/상세 | 거래처 생성/수정/삭제 | `GET/POST/PATCH/DELETE /api/master?entity=customers` | `Customer` | 전산 거래처 필수 필드/삭제 플래그/검색명 기준 비교 필요 | 높음 |
| 마스터 | 품목관리 `/master/products` | 품목 목록/상세 | 품목 생성/수정/삭제 | `GET/POST/PATCH/DELETE /api/master?entity=products` | `Product`, 일부 `Flower`/분류 관련 | 품목명/화종/국가/단위가 주문/출고/운송 전체에 영향. 전산과 필드 parity 필수 | 최상 |
| 마스터 | 업체별 품목단가관리 `/master/pricing` | 고객/품목별 단가 매트릭스 | 단가 입력/수정 | `GET/POST /api/master/pricing-matrix` | `CustomerProdCost` | 출고분배/견적 단가의 원천. 분배 저장 시 자동 단가 입력 여부와 직접 연결 | 최상 |
| 마스터 | 코드관리 `/master/codes` | 코드/화종/국가 등 | 코드 입력/수정 | `GET/POST/PATCH/DELETE /api/master?entity=codes` 계열 | 코드성 테이블 | 전산 코드 테이블과 직접 비교 필요 | 중간 |
| 관리 | 사용자관리 `/admin/users` | 사용자 목록 | 사용자 생성/수정/권한 | `/api/admin/users` 계열 | `UserInfo` 가능성 | 권한 체계가 전산과 다를 수 있음 | 중간 |
| 관리 | 작업내역 `/master/activity`, 액션로그 `/dev/action-log`, 작업/기획 현황 `/dev/project-plan` | 웹 작업/액션 로그 | 조회 중심 | `GET /api/master/activity`, `GET /api/dev/*` | `SystemActionLog`, 문서/로그성 데이터 | 웹 운영감사용. 전산 parity 대상보다는 변경 추적 대상 | 낮음 |
| 모바일 | `/m/*` | 모바일 주문/출고/견적/거래처/챗봇 | 모바일 조회/일부 입력 가능성 | `/api/m/*`, 기존 업무 API 일부 | 업무 테이블 및 `_chat_audit` 등 | 모바일 루트 `/m` 레이아웃 차이는 확인됨. 모바일 입력 가능 메뉴는 별도 쓰기 감사 필요 | 높음 |

## 최우선 검증 대상

1. 출고분배
   - 전산 `일괄출고분배`, `개별출고분배`, `분배취소` 버튼이 쓰는 `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear`와 웹 `/api/shipment/distribute`, `/api/shipment/adjust` 결과가 같은지 확인해야 한다.
   - 특히 `ShipmentDate`가 비어 있거나 출고일이 지정되지 않은 상태로 저장되는지 확인해야 한다.
   - 부분확정은 차수 전체가 아니라 품목군 기준으로 막히는지 계속 검증해야 한다.
   - 단가는 `CustomerProdCost`에서 자동으로 들어가고, 이후 견적서관리에서 같은 값이 보여야 한다.

2. 견적서관리
   - 견적서 단가 수정이 `ShipmentDetail`과 `CustomerProdCost`/`WeekProdCost`에 어떤 순서로 반영되는지 확인해야 한다.
   - 확정된 출고를 임시 취소하고 다시 확정하는 흐름이 전산 SP와 누적 재고를 깨지 않는지 검증해야 한다.

3. 재고/출고재고상황/차수피벗
   - `Product.Stock`과 `ProductStock.Stock`은 의미가 다르다.
   - 웹이 `ProductStock`만 바꾸는 경우와 SP가 `Product.Stock`까지 바꾸는 경우를 혼동하면 전산 잔량이 튈 수 있다.
   - `usp_StockCalculation` 호출 범위와 후속 차수 cascade를 샘플 차수로 확인해야 한다.

4. 입고/운송원가/송금
   - 운송기준원가의 원천 데이터와 산식이 전산 또는 기존 업무 엑셀과 같은지 확인해야 한다.
   - 입고단가/송금은 우측 탭이 구현되어 있으나 `FarmCredit`가 전산 송금 원장과 동일한지 아직 확정되지 않았다.

5. 판매/채권/세금계산서/Ecount
   - 웹 DB가 원장인지, Ecount가 원장인지, 아니면 동기화 로그만 남기는 구조인지 메뉴별로 구분해야 한다.
   - 이카운트 전송 버튼은 운영에서 절대 무단 클릭하면 안 된다.

## 실제 검증 절차

다음 순서로 진행한다.

1. 각 페이지의 프론트 코드에서 조회 API, 저장 API, 입력 컴포넌트를 확인한다.
2. 각 API의 `GET`, `POST`, `PUT`, `PATCH`, `DELETE` 분기와 SQL을 확인한다.
3. DB 쓰기가 있는 경우 대상 테이블, 키 생성 방식, 이력 기록, SP 호출 여부를 기록한다.
4. 기존 dnSpy/전산 문서에서 같은 기능의 Form, 버튼, SP, 테이블을 대조한다.
5. 운영 사이트는 로그인 후 읽기 전용으로 화면 표시 방식만 확인한다.
6. 저장 검증이 필요한 경우 운영이 아니라 테스트 차수/테스트 거래처/명시 허가 범위에서만 수행한다.

## 다음 작업 메모

- `/incoming`, `/warehouse`, `/orders`, `/shipment/view`, `/master/*`, `/admin/users`는 개별 파일을 더 읽어 세부 입력 필드와 API를 확정해야 한다.
- `nenova.exe` dnSpy에서 `FormShipmentDistribution`, `FormEstimate`, `FormOrderAdd`, `FormWarehouseAdd`, 재고 관련 Form의 버튼 이벤트를 다시 대조해야 한다.
- 전산 SP 정의 중 `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear`, `usp_ShipmentFix`, `usp_ShipmentFixCancel`, `usp_StockCalculation` 원문/파라미터/테이블 영향을 별도 표로 빼야 한다.
- 운영 사이트 읽기 전용 화면 확인 결과를 메뉴별로 이어 붙일 예정이다.

## 2026-05-26 추가 검증 기록

운영 사이트를 읽기 전용으로 열어 다음 화면의 버튼/입력/표시 구조를 확인했다. 저장, 삭제, 수정, 전송 버튼은 누르지 않았다.

확인한 화면:

- `/incoming-price`
- `/shipment/distribute?popup=1`
- `/shipment/week-pivot?popup=1`
- `/master/pricing?popup=1`
- `/estimate?popup=1`

확인 결과:

- 운영 배포 버전은 `v1.0.2·8bc7fa6`로 표시되었다.
- `/shipment/distribute?popup=1`에는 조회, 확정, 확정취소, 저장, 내역 조회, 엑셀, `일괄 출고분배`, `개별 출고분배`, `개별 초기화` 버튼이 실제로 보인다.
- `/shipment/distribute`의 저장 API는 `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentHistory`, `KeyNumbering`을 직접 쓴다. 단가는 `CustomerProdCost` 우선, 없으면 `Product.Cost` fallback이고, 출고일은 명시값이 없으면 `Customer.BaseOutDay` 기준으로 계산한다.
- `/shipment/adjust`는 붙여넣기 주문등록 후 분배 조정에서 `OrderMaster`, `OrderDetail`, `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentAdjustment`, `OrderHistory`, `ShipmentHistory`를 함께 쓴다. 따라서 단순 주문 저장이 아니라 출고/주문 동시 변경 경로이다.
- `/master/pricing?popup=1`은 업체 선택, 국가/품종/품목 검색, 저장 버튼 구조이며 API는 `CustomerProdCost`를 `MERGE`한다. 견적 단가와 출고분배 단가의 기준 원천이다.
- `/estimate?popup=1`은 출고 기반 견적 목록, 수량 수정, 단가 수정, 공급가액, 부가세를 표시한다. `update-cost`는 `ShipmentDetail.Cost`, `Amount`, `Vat`를 바꾸고 모드에 따라 `CustomerProdCost` 또는 `WeekProdCost`를 추가 갱신한다.
- `/incoming-price`는 `WarehouseMaster`, `WarehouseDetail`을 조회하고, 송금/차감 입력은 `FarmCredit`에만 저장한다. 우측 탭은 `송금 필요`와 `입력 있음`을 `FarmCredit` 저장값 존재 여부로 분리한다.

추가 발견:

- `/incoming-price` 운영 화면에서 사이드 메뉴가 중복으로 렌더링되는 구조가 확인되었다. 원인은 `pages/incoming-price.js`가 내부에서 `Layout`을 직접 사용하고 있는데, `_app.js`의 공통 `Layout`에서도 다시 감싸고 있었기 때문이다.
- 같은 구조의 자체 Layout 페이지는 `/orders/paste`, `/orders/mapping-status`, `/orders/kakao-audit`, `/admin/category-overrides`에도 존재한다.
- 모바일 루트 `/m`은 `_app.js`에서 `/m/` 하위만 레이아웃 제외하고 exact `/m`은 제외하지 않아 데스크톱 Layout이 섞일 수 있다.

적용한 구조 보정:

- `pages/_app.js`의 `NO_LAYOUT`에 자체 Layout 페이지를 추가했다.
- `router.pathname === '/m'`도 레이아웃 제외 조건에 추가했다.
- 이 변경은 화면 wrapper 중복 제거이며, 업무 DB 쓰기 로직은 변경하지 않았다.

배포 후 확인:

- 운영 `git-log`에서 `f63c53a fix: avoid nested layouts on self-wrapped pages` 반영을 확인했다.
- `/incoming-price` 운영 화면에서 `.sidebar=1`, `.topbar=1`로 중복 Layout이 사라진 것을 확인했다.
- `/m` 운영 화면에서 데스크톱 `.sidebar=0`, `.topbar=0`으로 레이아웃 혼입은 제거되었다.
- `/m` 본문이 `로딩 중...`에 머무는 현상은 별도 모바일 루트 동작 이슈로 남긴다.

남은 검증:

- 출고분배의 `일괄 출고분배`, `개별 출고분배` 버튼이 현재 프론트에서 실제 저장 함수와 어떻게 연결되는지 추가 확인해야 한다. 운영에서는 클릭하지 않는다.
- 전산 `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear`와 웹 직접 저장 결과의 차이는 별도 샘플 DB 조회 또는 테스트 환경에서만 검증한다.
- `FarmCredit`는 송금 완료 원장이라기보다 차감/메모 입력값으로 보인다. 정확한 송금 완료/미완료 관리를 하려면 전산 원장 기준 또는 별도 완료 필드가 필요하다.

## 2026-05-26 출고분배 버튼 추가 검증

확인 대상:

- `pages/shipment/distribute.js`
- `pages/api/shipment/distribute.js`
- `pages/api/shipment/distribute-diagnose.js`
- 기존 기록 `WEB_VS_ERP_CONFLICTS.md`, `work_history.md`

확인 결과:

- 웹 `/shipment/distribute`의 `일괄 출고분배`, `개별 출고분배` 버튼은 DB 저장 버튼이 아니다.
- 웹 버튼은 화면의 출고수량 입력값을 채우는 계산 버튼이고, 실제 DB 반영은 상단 `저장` 버튼이 `/api/shipment/distribute` POST를 호출할 때 이루어진다.
- 반면 `nenova.exe`의 일괄/개별 출고분배 버튼은 `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear` 같은 전산 SP를 통해 DB에 직접 반영되는 구조로 기록되어 있다.
- 따라서 이름은 같지만 현재 웹과 exe의 버튼 의미가 다르다. 사용자가 “버튼이 작동하지 않는다”고 느낄 수 있는 지점은 웹 버튼이 값을 채우기만 하고 저장까지 하지 않기 때문이다.

적용한 보완:

- 웹 `일괄 출고분배`, `개별 출고분배` 버튼에 선택 품목/거래처 분배 데이터가 없으면 비활성화되도록 했다.
- 버튼 실행 후 “입력값만 채웠고 실제 DB 저장은 상단 저장 버튼을 눌러야 한다”는 안내 메시지를 표시하도록 했다.
- `개별 출고분배` 버튼은 기존에 `outInputs`만 바꾸고 `outQty` 상태는 갱신하지 않았는데, 합계 상태도 같이 갱신하도록 보완했다.

read-only 진단 보강:

- `/api/shipment/distribute-diagnose`에 `KeyNumbering` 상태를 추가했다.
- `ShipmentMasterKey`, `ShipmentDetailKey`, `OrderMasterKey`, `OrderDetailKey`의 `KeyNumbering.LastKeyNo`와 실제 테이블 최대 PK를 비교한다.
- `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear`, `usp_ShipmentFix`, `usp_ShipmentFixCancel`, `usp_StockCalculation` 존재 여부를 같이 반환한다.
- 이 API는 조회만 수행하며 운영 데이터를 변경하지 않는다.

전산 exe 관련 결론:

- 기존 21-01 국내왁스 일괄출고분배 실패는 `ShipmentDetailKey` 채번값이 실제 `ShipmentDetail.SdetailKey` 최대값보다 낮아서 `usp_DistributeOne`이 이미 존재하는 PK로 INSERT를 시도한 것이 원인으로 기록되어 있다.
- 이번 보강으로 같은 유형의 실패는 운영 데이터 수정 없이 진단 API에서 먼저 확인할 수 있다.

배포/검증:

- `next build` 성공.
- 운영 `git-log`에서 `d0d6ddb fix: clarify shipment distribute controls` 반영 확인.
- 운영 `/api/shipment/distribute-diagnose?week=2026-21-01` 직접 호출은 인증 필요 응답으로 막혔다. 운영 데이터 변경은 없었다.
- 실제 진단 JSON 확인은 로그인 세션 또는 API 토큰이 있는 상태에서 조회 전용으로 다시 수행한다.
