# 카카오 주문 정규화·매칭·검증·등록 계약

상태: 구현 전 계약 초안 (normative)

버전: `draft-0.1`

## 1. 불변식

1. ERP 주문 후보의 업무키는 `OrderYear + OrderWeek + CustKey + ProdKey`다.
2. `OrderWeek` 단독으로 조회·충돌검사·등록하지 않는다.
3. 연도/차수가 모호하거나 거래처/품목 ID가 없으면 등록하지 않는다.
4. 원본 표현, 정규화 값, 후보, 최종 선택은 덮어쓰지 않고 revision/event로 연결한다.
5. 품종(`FlowerName/family`), 원본 품명, 색상, 전산 품명(`Product.ProdName/DisplayName`)은 서로 다른 필드다.
6. 주문등록 action은 `OrderMaster/OrderDetail`만 쓸 수 있다. `Shipment*`, Warehouse, Stock, Estimate, WebProfitReport는 보존한다.
7. 분석/매칭만으로 Product/Customer 또는 추천 사전을 변경하지 않는다. 사용자가 학습 반영을 명시해야 한다.
8. 승인된 snapshot과 실행 payload가 byte-stable canonical hash로 동일해야 한다.

## 2. 입력 source 계약

```json
{
  "sourceId": "uuid",
  "batchId": "uuid",
  "type": "EXCEL|CSV|TSV|HTML_TABLE|PLAIN_TEXT|IMAGE|CONNECTOR",
  "displayName": "카톡 발주 1",
  "contentHash": "sha256",
  "mimeClaimed": "image/png",
  "mimeDetected": "image/png",
  "sizeBytes": 12345,
  "receivedAt": "2026-08-07T10:00:00+09:00",
  "sourceVersion": 1
}
```

- `contentHash`는 같은 원본 경고/dedupe에 쓰고 idempotency를 단독 결정하지 않는다.
- 일반 application log에는 원문/이미지/base64/OCR text를 기록하지 않는다.
- source 삭제 정책과 append-only 감사 정책이 충돌하면 content tombstone과 법적/업무 보존정책을 별도로 정의한다.

## 3. 정규화 행 계약

```json
{
  "rowId": "uuid",
  "sourceId": "uuid",
  "sourceVersion": 1,
  "locator": { "sheet": "발주", "row": 12, "line": null, "bbox": null },
  "raw": {
    "customer": "라움",
    "flower": "장미",
    "product": "몬디알",
    "color": "화이트",
    "quantity": "10단",
    "unit": "",
    "shipDate": "목요일",
    "orderWeek": "29-2"
  },
  "normalized": {
    "customerText": "라움",
    "flowerFamily": "장미",
    "productText": "몬디알",
    "colorText": "화이트",
    "quantity": 10,
    "unit": "단",
    "shipDateCandidate": null,
    "orderYearCandidate": 2026,
    "orderWeekCandidate": "29-02",
    "command": "ADD"
  },
  "match": {
    "status": "SUGGESTED",
    "custKey": 680,
    "prodKey": null,
    "score": null,
    "reasons": [],
    "candidates": []
  },
  "review": { "required": true, "codes": ["PRODUCT_CONFIRM_REQUIRED"] }
}
```

### 수량/단위

- canonical unit: `박스|단|송이`. `스팀`, `스템`, `stem(s)`, `ea`는 `송이` 후보로 정규화하되 원문 보존.
- `대`를 무조건 `박스`로 확정하지 않는다. 거래처 template/품목 unit 계약이 있을 때만 확정하고 아니면 `UNIT_AMBIGUOUS`.
- 숫자와 단위를 분리하고 decimal 허용 여부는 품목/ERP 계약으로 검증한다.
- 음수 또는 “취소/빼기”는 `command=CANCEL` 후보이며 정책 확정 전 등록 차단.
- `Math.abs(qty)`로 명령 의미를 지우지 않는다.

### 날짜/차수

- `OrderYear`와 `OrderWeek`는 별도 값으로 확정한다.
- 출고일/요일로부터 차수를 계산할 수 있어도 candidate만 생성한다. 충돌/경계 주간은 사용자 확인.
- source, batch default, 현재 화면 값이 충돌하면 `PERIOD_CONFLICT`.

## 4. 파서 출력 계약

```json
{
  "parser": { "id": "kakao-text-v1", "version": "1.0.0", "templateId": null },
  "detectedFormat": "TSV",
  "confidence": 0.94,
  "rows": [],
  "warnings": [],
  "sourceTotals": [{ "unit": "단", "quantity": 100 }]
}
```

- 형식 판별 우선순위: 명시 template → 최근 승인 template → HTML/TSV 구조 → header synonym → 자유 텍스트/OCR.
- 파서는 source의 행 순서와 locator를 잃지 않는다.
- 파싱 실패가 다른 source/기존 정상행을 제거하지 않는다.
- OCR은 provider/model/prompt version, raw OCR text hash, confidence/bbox를 기록한다.

## 5. 매칭 계약

후보:

```json
{
  "prodKey": 91,
  "displayName": "장미 몬디알",
  "prodName": "ROSE MONDIAL",
  "country": "콜롬비아",
  "flowerName": "장미",
  "outUnit": "단",
  "score": 92,
  "reasons": [
    { "code": "EXACT_ALIAS", "points": 45 },
    { "code": "CUSTOMER_USAGE", "points": 18 },
    { "code": "COUNTRY_MATCH", "points": 12 }
  ]
}
```

- 자동매칭 threshold/1·2위 margin은 tenant setting으로 version 관리한다.
- `AUTO_MATCHED`, `SUGGESTED`, `MANUAL`, `UNMATCHED`를 구분한다.
- manual correction에는 원본값, 이전/이후 target ID, actor/time/reason을 기록한다.
- 추천 사전 반영은 별도 `ACCEPT_DICTIONARY_LEARNING` event가 있어야 한다.

## 6. 중복/합산 계약

중복 그룹키는 기본적으로 `OrderYear + OrderWeek + CustKey + ProdKey + unit + command`다. source provenance는 합산 후에도 `contributions[]`로 보존한다.

```json
{
  "aggregateRowId": "uuid",
  "policy": "KEEP|SUM_WITHIN_SOURCE|SUM_ACROSS_BATCH",
  "quantity": 15,
  "contributions": [
    { "rowId": "r1", "sourceId": "s1", "quantity": 10 },
    { "rowId": "r2", "sourceId": "s2", "quantity": 5 }
  ]
}
```

정책은 preview와 승인 snapshot에 포함하며 승인 후 변경할 수 없다.

## 7. 검증 계약

행 오류 코드:

- `CUSTOMER_UNMATCHED`, `PRODUCT_UNMATCHED`, `UNIT_AMBIGUOUS`, `UNIT_MISMATCH`
- `QUANTITY_INVALID`, `CANCEL_POLICY_REQUIRED`
- `YEAR_REQUIRED`, `WEEK_REQUIRED`, `PERIOD_AMBIGUOUS`, `PERIOD_CONFLICT`
- `DUPLICATE_REVIEW_REQUIRED`, `ORDER_LEDGER_CONFLICT`
- `OCR_LOW_CONFIDENCE`, `SOURCE_PARSE_ERROR`, `APPROVAL_STALE`

전체 검증:

- source별 입력 총량과 정규화 contribution 총량이 단위별로 일치한다.
- 등록행마다 네 업무키가 존재한다.
- 동일 `OrderWeek`의 다른 연도 행은 조회 결과/합계/충돌판정에서 제외한다.
- DB read snapshot은 현재 주문량과 master/detail key를 포함한다.
- 예상 writes와 preserves가 side-effect matrix와 일치한다.
- 부분등록 정책과 제외행 reason이 명시된다.

## 8. 승인 계약

```json
{
  "batchId": "uuid",
  "revision": 7,
  "canonicalHash": "sha256",
  "approvedBy": "UserID",
  "approvedAt": "ISO-8601",
  "partialRegistration": false,
  "mergePolicy": "KEEP"
}
```

입력자와 승인자를 분리하는 기준은 tenant 정책으로 두되, 강제되는 경우 동일 `UserID` 승인 거부. 승인 후 source/row/match/정책이 바뀌면 `APPROVAL_STALE`로 폐기한다.

## 9. 등록 요청/결과 계약

```json
{
  "batchId": "uuid",
  "approvalRevision": 7,
  "approvalHash": "sha256",
  "idempotencyKey": "sha256",
  "mode": "ORDER_ONLY",
  "items": [
    { "orderYear": 2026, "orderWeek": "29-02", "custKey": 680, "prodKey": 91, "quantity": 10, "unit": "단" }
  ]
}
```

성공 결과:

```json
{
  "status": "SUCCEEDED|PARTIAL|FAILED|REPLAYED",
  "rows": [
    { "rowId": "uuid", "orderMasterKey": 1, "orderDetailKey": 2, "beforeQty": 0, "deltaQty": 10, "afterQty": 10 }
  ],
  "sideEffects": {
    "orderMaster": 1,
    "orderDetail": 1,
    "shipment": 0,
    "shipmentDate": 0,
    "shipmentFarm": 0,
    "stock": 0,
    "estimate": 0,
    "profitReport": 0
  }
}
```

- `mode`가 `ORDER_ONLY`가 아니면 거부한다.
- idempotency key에 unique constraint를 두고 transaction 시작 시 lock/acquire한다.
- 성공행을 포함한 부분 실패 재시도는 성공행을 재가산하지 않는다.
- 현재 `/api/orders`의 delta semantics를 쓸 경우 `before + delta = after`를 같은 transaction/사후 read로 확인한다.

## 10. EXE 호환/교차연도 fixture

필수 fixture:

| fixture | 2025 29-02 | 2026 29-02 | 입력 | 기대 |
|---|---:|---:|---:|---|
| prior-year-only | 주문 있음 | 없음 | +10 | 2026 master/detail 생성, 2025 보존 |
| current-existing | 주문 있음/없음 | +5 | +10 | 2026만 +10, 결과 15 |
| ambiguous-period | 있음 | 있음 | 연도 없음 | 등록 차단 |
| replay | 임의 | 임의 | 같은 idempotency key 2회 | 1회만 반영 |

구현 전 dnSpy에서 `FormOrderAdd`/저장 class의 Manager, OrderYear, OrderWeek, CustKey, ProdKey, 수량 컬럼과 저장 순서를 재확인한다. 사후 read-only 검증은 `ViewOrder` 네 키 결과와 함께 `ViewShipment`, `ShipmentDate`, `ShipmentFarm`, `ShipmentDetail.Amount/Vat/isFix`, Estimate, WebProfitReport 보존을 확인한다.
