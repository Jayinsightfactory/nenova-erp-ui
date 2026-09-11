# 카톡 요청·실제 분배·전산 저장 잔량 비교 계약

## 목표와 범위

기존 `POST /api/orders/distribution-live-history`에 품목별 읽기 전용 비교를 additive하게 추가한다. 요청 변화량, 분배 이력 변화량, 현재 분배 총량, `ProductStock` 저장 스냅샷을 구분해 표시한다.

기본 필터는 `미확인·부분·불일치·모호·스냅샷 미확인`이다. 일치 근거 행은 `일치 포함`에서만 보인다. 어떤 숫자도 과거 요청의 완료·미처리나 실제 재고 부족을 증명하지 않는다.

허용 구현 범위는 **새 pure helper + 기존 distribution-live-history API**다. `stock-status`를 포함한 기존 쓰기 가능 API, ERP 원장, 별칭 저장, UI 구조, 자동 LLM, 자동 적용은 변경하지 않는다.

## 권위와 재사용

- 실제 `FormShipmentDistribution.GetProductList` 178~257행이 최우선 근거다. `stockns`는 선택된 `StockMaster + ProductStock`, 기준 차수는 `GetBeforeOrderYearWeek`, `ViewWarehouse/ViewShipment.OutQuantity`는 `Product.OutUnit` 단위다.
- 운영 읽기 실측:
  - `/stock?popup=1`, `2026-37-01`, SALAL: 전차수 44, 현입고 0, 현출고 7, 조정 0, 저장 재고수량 44.
  - `/shipment/stock-status`, 같은 범위: SALAL 계산잔량 37.
  - 저장 스냅샷 44와 계산잔량 37이 다르므로 v1은 계산잔량이나 둘 사이 projection을 만들지 않는다.
- `lib/distributionLiveHistory.js`의 scope, 정확 매핑, OutUnit 환산, 원문 시각, 주문/분배 이력 분리, 이벤트 claim을 유지한다.
- `lib/distributionChangeCompare.js`의 부분 반영, 중복 요청, 복수 후보, 동일 이벤트 경쟁 규칙을 재사용한다.
- `lib/shipmentFixReconcile.js:isDoubleCountStaleSnapshot`이 보여주듯 저장 스냅샷에서 미확정 분배를 다시 차감하지 않는다.
- 실제 스키마에 없는 `ShipmentDetail.isDeleted`, `WarehouseDetail.isDeleted` 조건을 추가하지 않는다. 일반 문서와 실제 decompiled/DB 근거가 충돌하면 실제 근거가 우선한다.

## 부작용 계약

| 동작 | Order/Shipment/Stock/Estimate/WebProfitReport | 기존 수동·AI 기능 |
|---|---|---|
| 요청·이력·현재값 조회 | SELECT only, 전부 보존 | 호출·변경 없음 |
| 예외/일치 필터 | DB 접근 없음 | 변경 없음 |

응답은 항상 `advisoryOnly:true`, `erpAction:"NONE"`이다. INSERT, UPDATE, DELETE, MERGE, EXEC, 런타임 DDL을 두지 않는다.

## 수량과 원천

모든 값은 유일하게 확정된 `ProdKey + Product.OutUnit` 기준 유한 숫자다.

| 필드 | 정의 |
|---|---|
| `requestedSignedDelta` | 요청 분배 순변동: ADD `+qty`, CANCEL `-qty` |
| `observedSignedDelta` | 요청에 유일하게 claim된 `ShipmentHistory.after-before` 합계 |
| `expectedBalanceImpact` | 요청의 잔량 방향 설명: `-requestedSignedDelta` |
| `actualDistributionTotal` | 정확한 연도·전체 차수의 `ViewShipment.OutQuantity` 품목별 합계 |
| `storedStockSnapshot` | 실제 선택 기준으로 유일한 `StockMaster + ProductStock.Stock` 저장값 |

`storedStockSnapshot`의 고정 라벨은 **전산 저장 잔량 (미확정 분배 미반영 가능)** 이고 `snapshotSource`는 `PRODUCT_STOCK_SNAPSHOT`이다. 이 값은 조회 시점의 저장값일 뿐 현재 가용재고나 요청 전후 잔량이 아니다.

v1은 `currentCalculatedBalance`, `projectedBalance`, `beforeBalance`, `afterBalance`, `hypotheticalAfterUnmatched`를 반환하지 않는다. `expectedBalanceImpact`를 저장 스냅샷에 적용하지 않는다.

## 조회 규칙

- 기존 입력과 한도를 유지한다: 정확한 `OrderYear`, 하나의 `WW-SS`, 최대 7일, 최대 50개 메시지.
- 현재 분배 총량은 exact `OrderYear + full OrderWeek`의 `ViewShipment`를 `ProdKey`로 GROUP BY한다. `Product.OutUnit`과 다른 단위는 합산하지 않는다.
- `ShipmentDate`와 조인해 한 `SdetailKey`를 중복 합산하지 않는다.
- 저장 스냅샷은 decompiled/운영 실측과 동일한 선택 기준으로 읽고, 선택 근거 키를 응답 내부 사실에 보존한다.
- 대상 StockMaster 또는 ProductStock 행이 없으면 `storedStockSnapshot:null`, `snapshotStatus:"UNKNOWN"`이다. 실제 행의 `Stock=0`은 유효한 0이다.
- 같은 선택 기준에 스냅샷 후보가 둘 이상이면 TOP 1, 최신, 최대값으로 추정하지 않는다. `storedStockSnapshot:null`, `snapshotStatus:"AMBIGUOUS"`, `DUPLICATE_STOCK_SNAPSHOT`을 반환한다.
- 조회 상한이나 불완전 범위에서는 부분 합계를 현재값으로 내지 않고 null과 고정 reason code를 반환한다.
- 새 사실 조회는 기존 scope-key in-flight 병합, 30초 TTL, 실패 미캐시, 8초 SQL 제한 안에 포함한다. 메시지·품목별 N+1 조회를 금지한다.

## 요청·이력 비교

1. 정확한 `OrderYear + full OrderWeek + CustKey + ProdKey + OutUnit`과 원문 시각을 통과한 요청만 비교한다.
2. 주문 이력은 별도 참고이며 `observedSignedDelta`에는 `ShipmentHistory`만 포함한다.
3. 요청별 후보 0개는 `UNCONFIRMED`, 2개 이상은 `AMBIGUOUS`다. 여러 이벤트를 임의 합산하지 않는다.
4. 같은 이벤트를 둘 이상의 요청이 claim하면 모두 `AMBIGUOUS`이며 관측 합계 확정값에서 제외한다.
5. 유일 이벤트가 요청과 같으면 `CONSISTENT`, 같은 방향의 일부면 `PARTIAL`, 반대·초과·다른 값이면 `MISMATCH`다.
6. 모든 요청이 개별적으로 정확히 일치할 때만 품목 `CONSISTENT`다. 순합계 숫자만 같아서는 안 된다.
7. 일부만 확인되면 `observedSignedDelta`와 `observedComplete:false`를 함께 반환한다. 하나도 없으면 0이 아니라 null이다.
8. 현재 분배 총량과 저장 스냅샷은 보조 사실이며 evidence status를 승격시키지 않는다.

같은 품목의 `A CANCEL 1 + B ADD 1`은 `requestedSignedDelta=0`이다. 서로 다른 정확 이벤트가 각각 있으면 `observedSignedDelta=0`, `CONSISTENT`이며 순잔량 영향 0이 정상이다. 한쪽 이력이 없거나 이벤트가 경쟁하면 순변동 0이어도 예외다.

## additive 응답

기존 요청과 `items`는 변경하지 않고 다음을 추가한다.

```json
{
  "balanceComparison": {
    "version": 1,
    "defaultFilter": "EXCEPTIONS",
    "summary": { "productCount": 4, "visibleCount": 2, "consistentHiddenCount": 2, "unresolvedRequestCount": 1 },
    "products": [{
      "prodKey": 1718,
      "prodName": "SALAL TIPS",
      "unit": "박스",
      "requestCount": 2,
      "requestedSignedDelta": 0,
      "observedSignedDelta": 0,
      "observedComplete": true,
      "expectedBalanceImpact": 0,
      "actualDistributionTotal": 7,
      "storedStockSnapshot": 44,
      "snapshotSource": "PRODUCT_STOCK_SNAPSHOT",
      "snapshotStatus": "AVAILABLE",
      "evidenceStatus": "CONSISTENT",
      "visibleByDefault": false,
      "reasonCodes": [],
      "sourceIdentities": ["message-a", "message-b"],
      "requestIds": ["message-a:3", "message-b:3"]
    }]
  }
}
```

- `evidenceStatus`: `CONSISTENT | PARTIAL | MISMATCH | UNCONFIRMED | AMBIGUOUS`.
- `snapshotStatus`: `AVAILABLE | UNKNOWN | AMBIGUOUS`. 숫자 0과 null을 구별한다.
- `visibleByDefault`는 evidence가 `CONSISTENT`가 아니거나 snapshot이 `AVAILABLE`이 아니거나 현재 분배 합계가 미확인일 때 true다.
- 유효 ProdKey가 없는 요청은 기존 `items`와 `unresolvedRequestCount`에 남긴다.
- 기존 요청별 status/event를 덮어쓰거나 raw 원문을 요약에 복제하지 않는다.
- 각 `products[].requests[]`에 `requestId`, `sourceIdentity`, `custKey`, `prodKey`, `requestedSignedDelta`, `observedSignedDelta`, `evidenceStatus`, `reasonCodes`를 추가한다. 원문 옆에서는 해당 sourceIdentity 요청만 표시한다. 50건 전체 품목 합계를 한 원문의 요청량처럼 표시하지 않는다. 전체 합계를 보일 경우 명시적으로 전체 품목 합계라고 표시한다.
- 기본 숨김은 해당 원문의 모든 요청이 개별 일치하고 snapshot이 유효할 때만 적용한다. 미매칭 요청이나 자료 미확인이 하나라도 있으면 숨기지 않는다.

## compact 표시

```text
SALAL TIPS · 박스 · A업체 취소 요청
요청 -1 | 확인된 분배 -1 | 차이 0
차수 품목 전체 분배 합계 7 | 전산 저장 잔량 44* | 요청 기준 잔량 영향 +1
* 미확정 분배 미반영 가능 · 실제 부족/완료 판정 아님
```

기본은 예외만 표시한다. `일치 포함`은 이미 받은 응답만 필터링하며 재조회·LLM·ERP POST를 발생시키지 않는다. null은 `미확인`, `observedComplete:false`는 `일부`로 표시한다. `완료`, `적용됨`, `미처리 확정`, `실제 부족` 배지는 금지한다.

## 필수 fixture와 구현 순서

1. A CANCEL 1 + B ADD 1: 개별 이벤트 모두 있으면 순변동 0/일치, 한쪽 누락·경쟁은 예외.
2. ADD 5와 이력 +2는 부분, 이력 -5는 불일치, 주문 이력만 있으면 미확인.
3. 전년도 같은 차수, 단위 불명, 조회 상한은 합산 금지.
4. snapshot 없음은 null, 실제 0은 0, 중복 snapshot은 null/AMBIGUOUS이며 TOP 1 금지.
5. 다중 ShipmentDate에도 현재 분배는 한 번만 합산.
6. 미일치 요청이 이미 현재 분배에 있어도 저장 잔량에 다시 적용하지 않음.
7. SALAL fixture는 현재 분배7/저장 snapshot44를 보존하고 계산잔량37을 v1 응답에 넣지 않음.
8. 기존 긴 별칭, 가족 우선, 미확인 업체 초기화, 비실물 품목 회귀 유지.

구현 순서는 `새 read/pure helper → 기존 live-history API additive 연결 → 예외 기본 필터 응답 → pure/API/distribution 22개/ERP guard`다. `stock-status`와 다른 기존 쓰기 가능 파일은 건드리지 않는다.

잔량 보조 조회만 실패하면 기존 이력 응답은 유지하고 비교 필드만 생략·경고한다. 실패 결과는 정상 캐시로 보존하지 않는다. StockMaster 개수는 ProductStock 존재 여부와 독립적으로 동일 연도·차수 전체에서 확인한다.
