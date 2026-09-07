# 신라 손익 품목 매칭·통합 매입단가 표시 설계

## 작업 경계

- 역할/등급: `ARCHITECT`, high-performance design, `P0_LOCAL`, 승인 요청 없음.
- 기준: branch `codex/shilla-product-matching`, base `f3aff785`.
- 이 문서는 구현 전 확정 계약이다. 이번 단계에서는 코드·DB·git·외부 시스템을 변경하지 않는다.
- 메인 작업이 별도로 준비하는 dnSpy/reference/browser 근거는 중복 수집하지 않는다.
- 기존 dirty 파일 `docs/work-reports/2026-09-07_pnl-upload-413.md`는 건드리지 않는다.

## 결론

신라 매칭은 **이미 저장된 `WebRaumPnlItem` 한 행의 `ProdKey`만 명시적으로 변경**한다. 기존의 전역 `WebRaumItemMap`은 이름 하나가 모든 거래처·연도·단위에 영향을 주므로 신라에서 읽거나 쓰지 않는다. 신라 업로드 미리보기에는 매칭 기능을 넣지 않고, 저장 후 상세에서만 검색·연결·해제한다.

재업로드 시에는 기존 `mergePnlImportedItems`의 신라 규칙을 그대로 사용한다. canonical incoming의 `prodKey:null`보다 기존 행의 `ProdKey`를 우선하며, exact `정규화 이름 + Unit + SalePrice + IsConsigned` 또는 유일한 fallback `정규화 이름 + Unit + IsConsigned`일 때만 보존한다. 후보 충돌은 추측하지 않고 기존처럼 전체 저장을 거부한다.

차수별 매입단가 화면은 동일한 양수 `ProdKey + 정규화 Unit + IsCustom`의 신라 행을 라움·초이문 행과 **같은 제품 행에 배치**한다. 다만 단가 입력과 저장은 계속 분리한다.

- 라움+초이문: 기존 공통 단가 셀, 기존 `/api/raum/purchase-costs`, 기존 2-partner transaction.
- 신라: 같은 표시 행 안의 별도 단가 셀, 기존 `/api/raum/shilla-purchase-costs`, 신라 전용 transaction.
- 신라를 `SHARED_PARTNERS`, `raumPnlSharedCostSnapshot`, `LOCKED_SHARED_MASTERS_SQL`, `saveRaumSharedPurchaseCosts`에 추가하지 않는다.

실제 저장본 positive fixture는 2026년 신라 35차 6행이다.

| 원본 표시명 | Unit | Qty | CostPrice |
|---|---:|---:|---:|
| 안시리움 · 화이트 | 단 | 227 | 5,600 |
| 백합 · 화이트 | 단-5스팀 | 170 | 21,500 |
| 시네신스 · 화이트 | 단 | 209 | 5,600 |
| 장미 · 핑크몬디알 | 단 | 30 | 11,400 |
| 장미 · 쉬머 | 단 | 16 | 10,800 |
| 호접 · 화이트 | 8스팀 | 324 | 11,233 |

저장 합계는 매입 10,250,892원, 매출 13,145,120원, 이익 2,894,228원, 배분율 80:20이다. 매칭 전후 이 수치와 여섯 source row가 동일해야 한다. 특히 `단`, `단-5스팀`, `8스팀`은 문자열 정리(공백 축약) 외에는 서로 다른 Unit이다. 수량/가격으로 환산계수를 추정하거나 `단`으로 합치지 않는다.

## 현재 코드에서 확인한 위험

1. `WebRaumItemMap`의 PK는 정규화 `ItemName` 하나뿐이다. PartnerCode, OrderYear, Unit, Color가 없어 신라에 재사용하면 라움·초이문 확정매핑까지 바뀔 수 있다.
2. 현재 `pages/raum/pnl.js`의 `applyMatch`는 전역 map을 저장하고 같은 이름의 모든 상세행을 바꾼다. 신라에 그대로 노출하면 행 단위·거래처 단위 격리가 깨진다.
3. 신라 일반 whole-document save는 의도적으로 막혀 있다. 화면 state만 바꾸는 매칭은 저장되지 않으므로 전용 즉시저장 API가 필요하다.
4. 신라 재업로드는 품목행을 삭제·재삽입한다. 매칭 저장 시 부모 `WebRaumPnl.UpdatedAt`도 갱신해야 이미 열린 import preview token이 stale 처리되어 새 매칭을 덮지 않는다.
5. 현재 매입단가 화면의 별도 하단 신라 섹션은 같은 ProdKey+Unit도 라움·초이문과 나란히 보이지 않는다. 단순 섹션 유지가 아니라 순수 display join이 필요하다.

## 사용자 흐름

### 1. 저장된 신라 품목 연결/해제

1. 사용자가 신라 결산 상세를 연다.
2. 저장된 일반행(`pnlKey`, `itemKey` 존재)의 전산 매칭 열에서 검색 모달을 연다.
3. 검색은 기존 `GET /api/raum/item-mapping?q=...`를 읽기 전용으로 재사용한다.
4. 선택 또는 해제는 신규 신라 행 전용 API에 explicit scope와 화면 snapshot을 보낸다.
5. 서버는 신라 master와 정확한 item을 transaction에서 잠그고 snapshot을 비교한 뒤 `ProdKey`만 변경한다.
6. 성공 후 상세와 목록을 재조회한다. 신라 ERP 대조·도착원가·주문등록은 여전히 실행하지 않는다.

업로드 미리보기/저장 전 draft에는 매칭 버튼을 제공하지 않는다. 먼저 검증된 신라 차수를 저장한 뒤 매칭하도록 안내한다.

### 2. 차수별 매입단가 통합 표시

1. 선택 연도의 기존 라움+초이문 rows와 신라 rows를 기존 두 GET으로 각각 읽는다.
2. 순수 helper가 양수 ProdKey와 Unit이 같은 항목을 한 제품 행으로 조합한다.
3. 각 대차수 블록에는 `라움+초이문 공통`과 `신라 별도` subcell을 독립적으로 표시한다.
4. 두 draft 집합과 저장 버튼을 분리한다. 한 저장 요청이 다른 가격 체계를 변경하지 않는다.
5. 한쪽 GET 실패를 `자료 없음`으로 표시하지 않고 해당 영역의 조회 실패로 표시한다.

## 신라 행 매칭 API 계약

신규 endpoint 제안: `POST /api/raum/shilla-item-mapping`

요청:

```json
{
  "partnerCode": "shilla",
  "orderYear": "2026",
  "major": 35,
  "pnlKey": 123,
  "itemKey": 456,
  "prodKey": 3170,
  "expected": {
    "itemKey": 456,
    "name": "호접 · 화이트",
    "unit": "개",
    "qty": 324,
    "salePrice": 20000,
    "saleAmount": 6480000,
    "prodKey": null,
    "isCustom": false
  }
}
```

- 해제는 `prodKey:null`; `0`, 음수, 소수, 숫자가 아닌 값은 거부한다.
- `partnerCode`는 생략/default하지 않고 정확히 `shilla`여야 한다.
- `orderYear`는 네 자리 명시값, `major/pnlKey/itemKey`는 양의 정수다.
- snapshot 숫자 정규화는 `0`과 `null`을 구분한다. `CostPrice`는 독립 cost 편집과 충돌하지 않도록 snapshot에서 제외한다.
- snapshot은 현재 source row의 `ItemName/Unit/Qty/SalePrice/SaleAmount/ProdKey/IsCustom`을 비교한다. 이름과 단위는 저장값을 바꾸지 않으며 비교에만 사용한다.
- target Product는 `Product.ProdKey`가 일치하고 `isDeleted=0`인 행만 허용한다.
- no-op은 성공(`changed:false`)하되 부모 timestamp를 갱신하지 않는다.
- scope/snapshot 불일치는 `409 STALE_SCOPE` 또는 `409 STALE_ITEM`; 잘못된 요청/제품은 400 계열로 반환한다.

서버 transaction 순서:

1. `WebRaumPnl`을 `PnlKey + OrderYear + MajorWeek + PartnerCode='shilla' + isDeleted=0`으로 `UPDLOCK,HOLDLOCK` 조회.
2. `WebRaumPnlItem`을 `PnlKey + ItemKey`로 `UPDLOCK,HOLDLOCK` 조회.
3. shared pure snapshot helper로 expected/current 완전 일치 확인.
4. 연결이면 활성 `Product` 존재 확인; 해제면 Product 조회 생략.
5. `WebRaumPnlItem.ProdKey`만 update.
6. 변경된 경우에만 같은 scoped master의 `UpdatedBy/UpdatedAt` update.

API는 `WebRaumItemMap`, `WebRaumCostPrice`, `Product` 또는 ERP 원장을 update/insert/delete하지 않는다.

## Criteria ledger

| 항목 | 확정 기준 | 정규화/기본값 | 권위/소비자 |
|---|---|---|---|
| 매칭 대상 | 저장된 active 신라 master의 정확한 item | draft fallback 없음; `pnlKey/itemKey` 필수 | 신라 상세 UI, 신규 API |
| Partner | 요청과 DB 모두 `shilla` | 누락 시 거부; Raum fallback 금지 | API preflight/lock/update |
| 연도/차수 | 화면 detail meta의 `OrderYear/MajorWeek` | year 4자리; major 양의 정수 | API master predicate |
| 현재행 | itemKey + source snapshot 완전 일치 | 0/null 보존; cost 제외 | UI payload, pure helper, transaction revalidation |
| Product | 활성 Product의 양수 ProdKey | 해제만 null 허용 | 기존 검색 GET, 신규 API |
| 원본 필드 | name/color가 합쳐진 ItemName, Unit, Qty, SalePrice, SaleAmount, 분배율 모두 보존 | 어떠한 자동 보정/단위 변환도 없음 | import/detail/cost 계산 |
| 재업로드 | old ProdKey 우선 | existing exact 또는 unique fallback만; 충돌 거부 | `mergePnlImportedItems` preview/save |
| 표시 결합 | 같은 양수 ProdKey + normalized Unit + IsCustom | Partner 제외는 표시 결합에만 적용 | combined matrix/UI |
| Unit 경계 | `단`, `단-5스팀`, `8스팀`은 별도 unit group | 공백 축약 외 변환·환산·suffix 제거 없음 | combined matrix/UI |
| 미매칭 표시 | 신라는 R+C의 이름 fallback과 결합하지 않음 | `shilla:name...` 별도 행 | combined matrix/UI |
| 신라 매칭 상태 | 저장된 양수 ProdKey가 있을 때만 matched | ERP 수량/가격 대조 결과나 verification 통과를 매칭으로 간주하지 않음 | P&L 상세 UI |
| R+C 단가 | 기존 두 partner 공통 | 0 유효, empty=null | 기존 shared API/saver |
| 신라 단가 | 신라 전용 | 0 유효, empty=null | 기존 Shilla API/saver |
| 매칭 중 scope 전환 | 완료 전 partner/detail 변경 차단 또는 응답 폐기 | live partner+pnlKey+itemKey 검증 | P&L UI |
| 조회 실패 | 실패한 partner 영역을 unavailable로 표시 | 빈 rows로 위장 금지 | purchase-cost UI |

## Action side-effect matrix

| 사용자 동작 | Product | WebRaumPnlItem | WebRaumPnl | WebRaumItemMap | WebRaumCostPrice | Order/Shipment/Stock/Estimate/WebProfitReport |
|---|---|---|---|---|---|---|
| 품목 검색 | SELECT | preserve | preserve | preserve | preserve | preserve |
| 신라 행 연결/해제 | 활성 여부 SELECT | 해당 item의 `ProdKey`만 UPDATE | 해당 scoped parent의 `UpdatedBy/UpdatedAt`만 UPDATE | preserve | preserve | preserve |
| 신라 재업로드 | preserve | 기존 import transaction대로 source rows 재작성, 매칭 보존 | 기존 import transaction대로 source metadata 갱신 | preserve | preserve | preserve |
| 통합 단가 조회 | 이름 표시용 SELECT | SELECT | SELECT | preserve | preserve | preserve |
| R+C 공통 단가 저장 | preserve | 기존 R+C `CostPrice/CostSource`만 UPDATE | 기존 touched parent timestamp만 UPDATE | preserve | preserve | preserve |
| 신라 별도 단가 저장 | preserve | 기존 신라 `CostPrice/CostSource`만 UPDATE | 기존 touched parent timestamp만 UPDATE | preserve | preserve | preserve |

`OrderMaster`, `OrderDetail`, `OrderHistory`, `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentFarm`, `Warehouse*`, `ProductStock`, `StockHistory`, `Estimate`, `WebProfitReport`는 모든 신규 동작에서 읽기·쓰기 모두 추가하지 않는다.

## 통합 매입단가 matrix 계약

순수 helper 제안:

```js
buildRaumPnlCombinedPurchaseCostMatrix(sharedRows, shillaRows, { orderYear })
```

- 내부에서 기존 `buildRaumPnlSharedPurchaseCostMatrix`와 `buildRaumPnlPurchaseCostMatrix(..., partnerCode:'shilla')` 결과를 조합한다.
- 제품 수준 parent는 양수 ProdKey로 묶을 수 있지만, 그 아래에 `정규화 Unit + IsCustom`별 독립 unit group을 둔다. 실제 R+C/Shilla co-location은 같은 parent 안에서도 unit group까지 같을 때만 일어난다.
- 양쪽에 양수 ProdKey가 있을 때만 `raumPnlCostIdentity`의 `prod:<key>|unit:<unit>|ordinary/custom`이 같은 unit group으로 합쳐진다.
- 같은 ProdKey라도 `단`, `단-5스팀`, `8스팀`처럼 Unit이 다르면 독립 group/cell이다. custom과 ordinary도 분리한다. 제품 parent를 공유해도 수량·단가·snapshot은 unit group 사이에서 합산하지 않는다.
- ProdKey가 없는 신라행은 R+C의 이름 fallback과 절대 합치지 않고 신라 전용 표시행으로 둔다.
- R+C 기존 행 순서를 유지하고, 신라-only 항목을 뒤에 안정적으로 추가한다.
- 대차수는 union으로 만들되 각 cell은 `{ shared, shilla }`를 따로 가진다. 가격·snapshot·상태를 합치거나 평균하지 않는다.
- shared subcell의 snapshot에는 Raum/Choimun만, Shilla subcell snapshot에는 Shilla만 포함한다.
- 같은 연도·차수에 신라 결산번호가 둘 이상이면 `conflicts`에 표시하고 해당 차수의 신라 셀은 제외한다. 한 결산을 조용히 선택하지 않으며 라움·초이문 자료는 유지한다.
- 하나의 제품 행에서 원본 업체별 이름, 수량, 판매가, 매입액, 매출액을 구분해 표시한다.

## 구현 파일 소유권

### API/library/contract worker (UI 파일 수정 금지)

- 신규 `lib/shillaPnlProductMatch.js`
  - `normalizeShillaPnlProductMatchRequest`
  - `shillaPnlProductMatchSnapshot`
  - `sameShillaPnlProductMatchSnapshot`
  - `saveShillaPnlProductMatch`
  - 허용 SQL 상수
- 신규 `pages/api/raum/shilla-item-mapping.js`
  - auth, POST-only, status/code mapping, actor 전달
- `lib/raumPnlCostComparison.js`
  - `buildRaumPnlCombinedPurchaseCostMatrix`만 추가; 기존 identity/snapshot/saver 의미 변경 금지
- `docs/contracts/raum-pnl-settlement.json`
  - `SHILLA_PNL_PRODUCT_MATCH` action/allowlist/near-miss 및 combined display 계약 추가
- `docs/DB_STRUCTURE.md`
  - 신라 row-level ProdKey와 R+C/Shilla 가격 독립성 명시
- `docs/exe-golden/FormRaumPnl.md`
  - Product SELECT + Web P&L-only write 경계 기록(메인 제공 근거 사용)
- `package.json`, `__tests__/raumPnlSettlementContract.test.js`
  - 신규 tests를 `test:shilla-pnl`, `test:raum-pnl`, ERP manifest에 연결
- 신규 `__tests__/shillaPnlProductMatch.test.js`
- 신규 `__tests__/shillaPnlCombinedPurchaseCost.test.js`
- 기존 `__tests__/shillaPnlIntegration.test.js`
  - reimport mapping preservation 회귀 추가

### UI worker: WorkerBoole 전용 (API/library/contract 파일 수정 금지)

- `pages/raum/pnl.js`
  - 저장된 신라행 match column/modal, row-scoped POST, stale response/partner-change guard
  - 신라 매칭 수는 positive saved ProdKey만 집계; 현재 보이는 허위 전산 cross-check/all-matched 표시는 신라에서 제거
  - Raum/Choimun 기존 global mapping 동작은 그대로 유지
- `pages/raum/purchase-costs.js`
  - 기존 두 GET 결과를 한 combined matrix로 렌더, R+C/Shilla drafts와 저장 버튼 분리
- `components/raum/ShillaPurchaseCosts.js`
  - 독립 하단 section을 제거하고 필요 시 controlled/presentational Shilla cell로 축소; 자체 별도 목록 렌더 금지
- `__tests__/shillaPnlUi.test.js`
  - 저장행-only matching, 즉시 persistence, combined co-location, separate saves, 실패 표시 계약

두 worker가 같은 파일을 수정하지 않는다. `pages/api/raum/item-mapping.js`, `lib/raumPnlPurchaseCost.js`, `pages/api/raum/purchase-costs.js`, `pages/api/raum/shilla-purchase-costs.js`는 기존 검색/2-partner shared save/Shilla-only save가 이미 요구를 만족하므로 원칙적으로 변경하지 않는다.

## 실행 가능한 테스트 기준

### 신라 매칭 pure/API

- positive: 정확한 shilla year+major+pnlKey+itemKey+snapshot에서 null→활성 ProdKey 변경.
- unmatch: 현재 ProdKey→null 변경.
- no-op: 같은 ProdKey는 item/parent write 없음.
- reject: missing/raum/choimun partner, invalid year/major/key, 0/negative/fractional/deleted product.
- stale near-miss: prior-year same major, 다른 partner의 같은 pnl/item 모양, deleted master, itemKey 교체, name/unit/qty/salePrice/saleAmount/current ProdKey 중 하나 변경.
- concurrency: CostPrice만 동시에 바뀐 경우는 매칭 snapshot과 독립; import 또는 다른 mapping으로 parent/item이 바뀌면 stale.
- write allowlist: UPDATE target은 `WebRaumPnlItem.ProdKey`, `WebRaumPnl.UpdatedBy/UpdatedAt`뿐. `WebRaumItemMap`, `WebRaumCostPrice`, Product, ERP 테이블 쓰기 0건.

### 재업로드

- canonical Shilla incoming `prodKey:null` + exact old name/unit/sale row의 ProdKey 보존.
- sale price가 바뀌었지만 name+unit fallback이 유일하면 ProdKey 보존.
- 동일 fallback 후보가 둘이면 추측하지 않고 `PRESERVATION_COLLISION`.
- 매칭 전후 name/color-derived ItemName, Unit, Qty, SalePrice, SaleAmount, CostPrice, NenovaPct 불변.
- mapping이 preview 뒤 저장되면 parent version 변경으로 import save 409/re-preview 요구.

### 통합 매입단가 표시

- same ProdKey+same Unit의 Raum/Choimun/Shilla가 한 제품 행에 존재.
- same ProdKey+different Unit는 같은 product parent를 쓸 수 있으나 독립 unit group/cell이며 값은 합산되지 않음.
- 실제 35차의 `단`, `단-5스팀`, `8스팀`은 각각 독립 표시되고 환산 추정이 없음.
- Shilla null ProdKey와 같은 이름의 R+C null ProdKey는 서로 다른 행.
- R+C shared snapshot/saver 대상에 Shilla가 포함되지 않음.
- Shilla cost 변경이 R+C cost를 바꾸지 않고, R+C shared cost 변경이 Shilla cost를 바꾸지 않음.
- explicit cost 0 보존, empty→null, differing values no average.
- 같은 product/week에서 shared와 Shilla 입력·수량·판매가·금액이 각각 표시됨.
- 한 GET 실패 시 다른 partner 데이터를 유지하면서 실패 영역을 명시.

### UI

- 신라 저장행만 match button이 보이고 preview/draft에는 보이지 않음.
- 신라 선택/해제는 신규 row endpoint만 호출하며 `/api/raum/item-mapping` POST를 호출하지 않음.
- 매칭 진행 중 partner/detail 변경이 차단되거나 stale 응답이 폐기됨.
- 성공 후 상세와 목록의 matched count/name이 갱신됨; `unsaved` whole-document state를 만들지 않음.
- 35차가 아직 모두 ProdKey null이면 신라 매칭 표시는 `0/6`이어야 하며 verification/원본 합계 통과를 근거로 `6/6` 또는 all-matched를 표시하지 않음.
- 통합 화면에서 같은 ProdKey+Unit이 실제로 같은 DOM 제품 행에 있고 별도 하단 신라 목록이 남지 않음.
- 두 저장 버튼과 payload/endpoint가 교차하지 않음.

## 수용 기준

1. 신라 저장 상세에서 한 행을 전산 Product에 연결/해제하고 재조회 후 유지된다.
2. 같은 파일 재업로드에서 exact/unique fallback이면 연결이 유지되고, 모호하면 저장이 차단된다.
3. 매칭은 신라 source name/color/unit/qty/sale/cost 및 60:40/80:20 값을 변경하지 않는다.
   - 35차 기준 매입 10,250,892원, 매출 13,145,120원, 이익 2,894,228원과 여섯 행이 매칭 전후 동일하다.
4. 차수별 매입단가 화면에서 동일 ProdKey+Unit의 세 거래처가 한 제품 행에 보인다.
5. R+C 단가는 기존처럼 두 partner에만 공통 적용되고 신라 단가는 독립 저장된다.
6. 전역 `WebRaumItemMap` 및 `WebRaumCostPrice`에 신라 매칭/단가로 인한 write가 없다.
7. 주문·출고·입고·재고·견적·매출 원장 write가 없다.
8. 신규 focused tests, `npm run test:shilla-pnl`, `npm run test:raum-pnl`, `npm run test:erp-contract`, manifest/write guard, build가 통과한다.

## 보류/비범위

- 신라 이름의 전역 자동매칭 또는 다음 차수 자동추천 저장.
- 저장 전 upload preview에서 draft 매칭.
- 신라 ERP 분배 대조, 주문등록, 출고/재고/견적 동기화.
- Product master 수정/생성, 단위 자동변환, 색상·이름 정규화 재작성.
- 세 거래처 공통 매입단가 또는 R+C 값을 신라에 복사하는 기능.

## Preflight 상태

- 로컬 설계 근거와 기존 계약/코드는 확인했다.
- 운영 DB·비밀값·외부 시스템은 확인하지 않았다(요청상 금지).
- 메인 작업이 dnSpy/reference/browser preflight를 독립 수행 중이므로 `NEEDS_MAIN_PREFLIGHT` 없음.
