# 인보이스 재시도 실패 보수 설계

- 작성일: 2026-10-09
- 역할: ARCHITECT (`gpt5.6-sol`, high)
- 권한: `P0_LOCAL`, approval-free child
- 상태: 구현 계약 확정, 앱 코드는 이 문서에서 변경하지 않음
- 판정 기준: `FINAL_NOT_ALL_PASS`를 유지하며, 각 실패 원인을 독립적으로 닫은 뒤에만 해당 범위의 통과를 선언한다.

## 1. 목적과 경계

이번 보수는 다음 네 문제만 해결한다.

1. 날짜 원문 근거를 보존하고 연도·날짜 의미를 추정하지 않는다.
2. CO의 상품 외 비용과 송장 총액 산식을 일관되게 정의한다.
3. 유료 재시도는 사용자가 승인한 정확한 범위와 호출 예산 안에서만 한 번씩 실행한다.
4. 구형 중국 6열 Invoice와 CL 비교 시트를 손실 없이 읽되, 통화·단위·Box/Bunch/Steam을 추정하지 않고 검토 전용 결과로 격리한다.

이 작업은 새 입고 writer, 자동 ERP 품목 매칭, 자동 원가 적용, 운영 DB/ERP 저장을 만들지 않는다. 주문·출고·입고·재고·견적·매출 원장은 모두 보존한다.

## 2. 확인된 근거와 정정된 사실

- 최종 감사는 49개 파싱 송장/344개 상품행의 수량·금액 원본 대조와 메모리 내 생성기 산술을 확인했다. ERP 품목 매칭·입고 가능성·저장·재고·원가는 확인하지 않았다.
- CO 원본 71페이지의 처리 상태는 모두 기록됐지만 파싱 범위는 66/71페이지다. CO15 p10~14의 4개 송장(3882, 273811, 127922, 127929)은 원본만 확인됐고 HTTP 502 때문에 파싱 결과가 없다.
- 승인된 유료 호출은 누적 30/30회 소진됐다. 새 승인 없이는 추가 호출 수가 0이다.
- FGD32189, 274399, EC-5353에는 실제 날짜 오류가 있다. 106255는 Invoice Date와 Ship Date 중 무엇을 쓸지 기존 CO 프롬프트가 정하지 않은 계약 모호성이다.
- FC01191의 36.34는 기존 프롬프트 정의상 항공운임만이 아니라 서류·검역 등을 포함한 모든 상품 외 비용 합계이므로 추출 오류가 아니다.
- CO 프롬프트의 `invoice_total`은 부대비 포함 총액인데 마지막 검사는 `sum(t_price) == invoice_total`을 요구해 서로 모순된다.
- 중국 구형 원본 3개/상품 109행은 독립 산술이 맞지만 현재 `parseChinaInvoiceWorkbook`은 모두 거부한다. 통화는 원본 셀에서 확인되지 않았고, `10pcs`/`20pcs`/`500g`는 원문 포장 규격이지 native Box/Bunch/Steam 변환값이 아니다.
- CL 시트별 합계가 서로 다른 사례가 있다. CL은 비교 자료이며 Invoice 상품/비용에 더하거나 임의로 권위 시트를 선택하지 않는다.
- native `ExcelLoadingPackingList`는 변환된 고정 레이아웃의 첫 테이블을 읽고 Box/Bunch/Steam, UPrice/TPrice를 별도 열에서 각각 가져온다. 이는 공급사 원본의 첫 시트를 고르거나 `TPrice = Steam × UPrice`를 강제하는 근거가 아니다.
- `FormWarehouseAdd`의 `SteamQuantity × UPrice`는 수동 상세 입력 경로다. 원본 송장 파서의 보편 산식으로 확장하지 않는다.

## 3. 단계별 작업 범위

### Phase A — 기존 PDF 흐름의 폐쇄형 보수

Phase A는 기존 CO 및 공통 PDF 계약만 수정한다.

1. 날짜 후보마다 원문 문자열, 라벨 의미, 페이지와 인용문을 보존한다.
2. CO의 `freight_total` 레거시 이름은 유지하되 의미를 `additional charges total`로 명시한다.
3. 총액 검사는 상품 소계와 상품 외 비용을 분리한다.
4. 유료 요청은 호출 전에 확정된 단일 계획 항목만 실행한다. 실패가 새 호출을 자동 생성하지 않는다.
5. 응답이 날짜·금액 검증에 실패하면 파싱 결과를 버리지는 않되 `REVIEW_REQUIRED`로 격리하고 생성/다운로드/입고 준비를 차단한다.

### Phase B — 중국 구형 XLSX 검토와 제한적 수동 승격

Phase B는 원본을 구조화해 검토 화면에 보여 주고, 원문 수량의 업무 단위가 **단**임을 사용자가 확인한 행만 제한적으로 패킹 생성 후보로 승격한다.

- `Invoice` 또는 `Invoice 日报表` 후보를 이름과 6열 헤더 시그니처로 식별한다. 후보가 0개 또는 2개 이상이면 실패한다.
- 상품행, 비용행, 소계, 총액, 수식과 캐시값을 원본 셀 좌표와 함께 보존한다.
- 모든 CL 계열 시트를 각각 별도 비교 자료로 보존한다.
- 최초 결과 상태는 항상 `LEGACY_CN_REVIEW_REQUIRED`다.
- 사용자가 행별 원문 수량 단위가 단임을 확인하고, 박스 수와 총 송이 수를 명시하며, 통화와 원문 산술을 확인한 경우에만 `LEGACY_CN_MANUALLY_RESOLVED`로 전환할 수 있다.
- 단 이외의 원문 수량 단위는 이번 구현에서 `LEGACY_CN_UNIT_UNSUPPORTED`로 남기며 생성·다운로드·입고 준비를 허용하지 않는다.
- 수동 해결 전에는 `genChina`, 패킹 다운로드, `adaptPackingReceipts`, ERP 품목 매칭/저장 입력으로 전달하지 않는다.
- 이 단계에서 현대식 중국 스키마를 완화하거나 현대식 결과 객체로 가장하지 않는다.

## 4. 데이터 계약

### 4.1 날짜 증거

송장 날짜는 단일 문자열만 저장하지 않고 다음 증거를 함께 가진다.

```json
{
  "date": null,
  "date_status": "REVIEW_REQUIRED",
  "date_evidence": [
    {
      "raw": "17/04/26",
      "semantic": "INVOICE_DATE",
      "page": 3,
      "quote": "Invoice Date 17/04/26",
      "bbox": null,
      "normalized": null
    }
  ]
}
```

`semantic`은 `INVOICE_DATE`, `SHIP_DATE`, `ARRIVAL_DATE`, `PRINT_DATE`, `UNKNOWN`만 허용한다.

- 4자리 연도가 원문에 있고 일/월 순서가 라벨·서식으로 명확할 때만 `YYYY/MM/DD`로 정규화한다.
- 2자리 연도는 현재 연도, 파일명, 차수, 송장번호로 확장하지 않는다. 같은 송장 범위에 명시적인 4자리 연도 근거가 있거나 사람이 확인하지 않으면 `normalized:null`이다.
- 서로 다른 날짜 의미가 둘 이상이면 모두 보존한다. CO의 canonical date는 명시된 `INVOICE_DATE`를 우선한다. Invoice Date가 없고 Ship Date만 있으면 `date_status=REVIEW_REQUIRED`로 유지하며 자동 승격하지 않는다.
- 기존 국가별 계약(NL Arrivaldate, TH Arrival/Shipment, EC Shipment Date)은 해당 국가 규칙으로 유지하되 원문 증거 필드는 동일하게 요구한다.
- 잘못된 날짜를 그럴듯하게 보정하지 않는다. FGD32189, 274399, EC-5353은 회귀 fixture로 고정한다.

### 4.2 CO 상품 외 비용과 총액

내부 canonical 이름은 `additional_charges_total`이다. 기존 소비자 호환을 위해 `freight_total`을 읽고 쓸 수 있지만, UI와 증거에는 “상품 외 비용 합계”로 표시한다. 순수 항공운임으로 원가에 자동 분류하지 않는다.

```text
product_subtotal = sum(product.t_price)
additional_charges_total = sum(explicit non-product charge lines)
invoice_total = product_subtotal + additional_charges_total
```

- 각 비용행은 `raw_label`, `amount`, `currency`, `page`, `quote`를 보존한다.
- 비용 없음이 명시적으로 확인된 경우만 0이다. 누락·빈칸·불명확은 null이다.
- `invoice_total`이 상품만의 소계라면 의미를 `PRODUCT_SUBTOTAL`로 기록하고 grand total로 취급하지 않는다.
- 1센트 허용오차 안에서 위 산식이 맞아야 `AMOUNT_VERIFIED`다. 맞지 않거나 필요한 항목이 null이면 `AMOUNT_REVIEW_REQUIRED`다.
- FC01191은 36.34를 유지하는 양성 fixture다. `sum(t_price) == invoice_total`만 검사해 실패시키거나 36.34를 상품행에 분배하면 안 된다.

### 4.3 중국 구형 Invoice

구형 상품행의 최소 원문 계약은 다음과 같다.

```json
{
  "source_sheet": "Invoice 日报表",
  "source_row": 7,
  "name_zh": "원문",
  "name_en": "printed English name",
  "raw_qty": 20,
  "unit_price": 10.5,
  "printed_amount": 210,
  "unit_spec_raw": "20pcs",
  "currency": null,
  "box_quantity": null,
  "bunch_quantity": null,
  "stem_quantity": null
}
```

- `raw_qty × unit_price == printed_amount`를 독립 검산한다. 수식 셀은 formula와 cached value를 모두 보존한다.
- 통화 기호/ISO 코드가 셀에 명시되지 않으면 `currency:null`이다. CNY를 기본값으로 넣지 않는다.
- `unit_spec_raw`는 문자열 그대로 보존한다. `10pcs`, `20pcs`, `500g`를 Box/Bunch/Steam 또는 ERP Out/Est 단위로 변환하지 않는다.
- 빈 수량/금액은 null이며 0이 아니다. 명시적인 0만 0이다.
- 비용행(예: BOX, Documents, Short transfer, Air freight)은 상품과 분리해 원문 라벨·수량·단가·금액을 보존한다.
- 상품 소계, 비용 합계, grand total을 각각 검산한다. 서로 다른 의미의 합계를 덮어쓰지 않는다.
- 공급사 allowlist가 아니라 인쇄된 supplier 영역과 원본 좌표를 보존한다. 중복 후보는 검토 대상으로 막는다.

#### 4.3.1 제한적 수동 해결 계약

수동 해결은 모든 native 단위를 임의 입력하는 범용 변환기가 아니다. 다음 조건을 모두 만족하는 행만 지원한다.

```json
{
  "source_sheet": "Invoice 日报表",
  "source_row": 7,
  "raw_qty": 20,
  "raw_unit_resolution": "BUNCH",
  "total_bunch": 20,
  "boxes": 2,
  "total_stems": 200,
  "bunch_st": 10,
  "steam_box": 100,
  "u_price": 10.5,
  "t_price": 210,
  "confirmed": true,
  "reason": "원본 및 공급사 포장 기준 확인"
}
```

- `raw_unit_resolution`은 이번 범위에서 `BUNCH`만 허용한다. `BOX`, `STEM`, 중량, pcs 묶음 또는 의미 미확인은 명시적 미지원이다.
- `total_bunch`는 변환하거나 재계산하지 않고 `raw_qty`와 정확히 같아야 한다.
- `boxes`와 `total_stems`는 사용자가 원문/공급사 근거를 보고 명시한다. 누락, 음수, 묵시적 기본값은 허용하지 않는다.
- `bunch_st = total_stems / total_bunch`, `steam_box = total_stems / boxes`만 계산한다. 나누어떨어질 필요는 없지만 유한 양수여야 하며 결과를 화면에 표시해 다시 확인한다.
- `u_price`와 `t_price`는 원문 값을 그대로 보존한다. `raw_qty × u_price == t_price`가 0.01 이내에서 성립해야만 해결된다.
- 이번 경로는 사용자가 임의의 native UPrice/TPrice 조합을 새로 만드는 기능이 아니다. 원문 산술과 다른 독립 TPrice 입력을 지원한다고 주장하지 않는다.
- 행 식별자는 source hash + invoice + sheet + row + 원본 셀 digest에 묶는다. 누락·중복·stale 해결값은 거부한다.
- 통화는 ISO 3문자 코드, 확인 사유, 확인 시각을 별도 보존한다. 원문에 없었던 통화는 `source_verified`가 아니라 `manually_confirmed`로 표시한다.
- CL 충돌은 어느 CL 값을 가져와 수량을 보정하는 방식으로 해결하지 않는다. 사용자가 Invoice를 권위 원천으로 사용한다는 사실만 확인하고 CL은 계속 `COMPARISON_ONLY`로 보존한다.
- 모든 행과 문서 메타가 해결됐을 때만 별도 source format `china_legacy_resolved_xlsx`를 만든다. 원본 `china_legacy_invoice_xlsx` 객체는 변경하지 않는다.

### 4.4 CL 비교 시트

각 CL 시트는 다음처럼 독립 보존한다.

```json
{
  "sheet_name": "Packing list_CL5",
  "range": "A1:F167",
  "rows": [],
  "formula_cells": [],
  "cached_totals": {},
  "authority": "COMPARISON_ONLY",
  "revision": null
}
```

- CL 값을 Invoice 상품·비용·총액에 합산하지 않는다.
- 여러 CL 합계가 다르면 `CL_CONFLICT_REVIEW_REQUIRED`다. 다수결, 최신처럼 보이는 이름, 첫/마지막 시트로 선택하지 않는다.
- CL이 없거나 일부 셀이 비어도 Invoice의 알 수 없는 값을 0으로 채우지 않는다.

### 4.5 유료 재시도 계획

재시도는 실행 전에 불변 계획으로 확정한다.

```json
{
  "plan_id": "sha256(...)",
  "source_hash": "...",
  "country": "CO",
  "page_ranges": [{"start": 10, "end": 14}],
  "authorized_call_limit": 1,
  "ledger_calls_before": 30,
  "authorized_ledger_ceiling": 30,
  "items": [{"attempt_id": "...", "status": "PLANNED"}]
}
```

- 현재 증거에서는 `authorized_ledger_ceiling=30`, `ledger_calls_before=30`이므로 실행 가능한 항목은 0개다.
- 새 사용자 승인에는 정확한 원본 hash, 국가, 페이지 범위, 최대 추가 호출 수가 있어야 한다. “실패분 재시도” 같은 열린 범위는 실행하지 않는다.
- 호출 원장에는 네트워크 요청 전에 `STARTED`를 기록한다. 동일 `attempt_id`는 다시 실행하지 않는다.
- 캐시 hit는 유료 호출로 세지 않지만, cache miss를 이유로 자동 호출하지 않는다.
- HTTP 429/5xx, timeout, 비JSON, truncation은 해당 항목을 terminal `FAILED`/`TRUNCATED`로 끝낸다. 분할, 재귀, backoff 재호출, 병렬 fan-out을 자동 생성하지 않는다.
- 실패 후 새 범위를 제안할 수는 있으나 별도 사용자의 명시 승인과 새 예산 없이는 실행할 수 없다.
- 서버의 계정 quota는 방어층일 뿐 사용자 승인 예산을 대신하지 않는다.

## 5. 상태와 차단 규칙

| 상태 | 생성/다운로드 | 입고 초안 변환 | ERP 쓰기 |
|---|---:|---:|---:|
| `VERIFIED_FOR_PACKING` | 기존 국가 계약 충족 시 허용 | 별도 receipt gate 필요 | 금지(기존 writer 계약 별도) |
| `DATE_REVIEW_REQUIRED` | 금지 | 금지 | 금지 |
| `AMOUNT_REVIEW_REQUIRED` | 금지 | 금지 | 금지 |
| `LEGACY_CN_REVIEW_REQUIRED` | 금지 | 금지 | 금지 |
| `LEGACY_CN_UNIT_UNSUPPORTED` | 금지 | 금지 | 금지 |
| `LEGACY_CN_MANUALLY_RESOLVED` | 기존 패킹 검증까지 통과하면 허용 | 별도 receipt gate 필요 | 금지(기존 writer 계약 별도) |
| `UNIT_REVIEW_REQUIRED` | 금지 | 금지 | 금지 |
| `CURRENCY_REVIEW_REQUIRED` | 금지 | 금지 | 금지 |
| `CL_CONFLICT_REVIEW_REQUIRED` | 금지 | 금지 | 금지 |
| `RETRY_PLAN_REQUIRED` / `RETRY_BUDGET_EXHAUSTED` | 해당 없음 | 해당 없음 | 금지 |

여러 상태가 동시에 존재할 수 있다. 하나를 사람이 확인해도 나머지 차단은 유지한다. `reviewConfirmed` 하나의 boolean으로 날짜·금액·통화·단위 검토를 일괄 해제하지 않는다.

## 6. 구현 파일 범위

### Phase A 허용 범위

| 파일 | 허용 변경 |
|---|---|
| `lib/importPackingPrompt.js` | 날짜 의미/원문 증거, CO 부대비 의미, 올바른 final check 명시 |
| `lib/importPackingResponse.js` | 날짜 증거와 금액 산식 검증, review 상태 산출; 자동 보정 금지 |
| `lib/importPackingExtractClient.js` | 명시 승인된 단일 요청만 전달하는 계약 유지/강화 |
| `pages/api/import/tools/parse-pdf.js` | 요청 idempotency/계획 식별자 검증이 필요할 때만 최소 변경; 자동 재시도·범위 분할 금지 |
| `components/import-tools/PackingListTool.js` | 날짜/금액별 review 상태 표시와 개별 확인; 차단 상태 연결 |
| `lib/importPackingReceiptAdapter.js` | 검토 상태가 남은 결과의 어댑트 거부, raw evidence 보존; writer 확장 금지 |
| `__tests__/importPacking.test.js`, `__tests__/importPackingHardening.test.js`, `__tests__/importPackingReceiptAdapter.test.js` | 양성/근접 실패/기존 국가 회귀 |

유료 감사용 `outputs/retry-co-ai.cjs`는 운영 앱 계약이 아니다. 재사용한다면 명시 계획 파일을 입력받는 일회성 도구로만 제한하고, `outputs/` 결과를 앱 런타임 의존성으로 만들지 않는다.

### Phase B 허용 범위

| 파일 | 허용 변경 |
|---|---|
| `lib/importChinaInvoice.js`, `lib/importChinaLegacyInvoice.js` | 현대식 parser와 분리된 구형 스키마 탐지/원문 추출, 최초 review-only 상태 반환 |
| 구형 중국 수동 해결 helper | `BUNCH` 확인 + 명시 boxes/stems + 원문 가격 산술만 검증해 별도 resolved 객체 생성; 다른 단위 거부 |
| `components/import-tools/ChinaLegacyReview.js`, `components/import-tools/PackingListTool.js` | 구형 중국 원문/CL 비교/제한된 단·박스·송이·통화 확인 UI; 해결 전 생성기 호출 금지 |
| `lib/importPacking.js` | `china_legacy_resolved_xlsx` 전용 분기만 추가; modern parser 완화 및 범용 native 변환 금지 |
| `lib/importPackingResponse.js` | review-only envelope를 손실 없이 검증하되 현대식 products로 강제 변환 금지 |
| `lib/importPackingReceiptAdapter.js` | 미해결 legacy 거부; resolved 객체도 기존 receipt gate 전까지만 전달, 혼합 비용 자동 freight 분류 금지 |
| legacy parser/helper/UI 및 boundary 테스트 | 세 구형 fixture의 산술·충돌·차단, BUNCH 양성 경로와 타 단위 미지원 회귀 |

다음은 이번 보수 범위 밖이다: 단 이외 원문 단위 변환, 임의 UPrice/TPrice 재작성, 범용 native 수량 편집기, 신규 receipt/warehouse writer, SQL/SP, `TempWarehouseDetail`, `WarehouseMaster/Detail`, `ProductStock`, Order/Shipment/Estimate/Sales 테이블 변경.

## 7. 수용 기준

### Phase A

- 양성: 4자리 연도와 `Invoice Date` 라벨이 있는 CO 날짜는 원문 증거와 같은 날짜로 정규화된다.
- 근접 실패: `17/04/26`만 있는 날짜는 2017 또는 2026으로 바뀌지 않고 review 상태다.
- 근접 실패: Invoice Date 4/16과 Ship Date 4/17이 함께 있는 106255는 둘 다 보존되고 Invoice Date 정책이 명시적으로 적용된다.
- 양성: FC01191은 상품 소계 + 36.34 = grand total로 통과하며 36.34의 항목별 라벨이 보존된다.
- 근접 실패: 상품 소계와 grand total만 같다고 보고 상품 외 비용을 잃는 응답은 실패한다.
- 근접 실패: 비용의 빈칸을 0으로 바꾸거나 모든 비용을 순수 freight로 원가 입력하면 실패한다.
- 양성: 승인된 1개 `attempt_id`는 원장 선기록 후 최대 한 번 실행된다.
- 근접 실패: 502/timeout 이후 동일 또는 분할 범위가 자동 호출되지 않는다.
- 현재 30/30 원장에서는 네트워크 함수가 호출되지 않는 테스트가 통과한다.

### Phase B

- 세 구형 workbook의 총 109 상품행이 원본 순서·시트·행·값·수식 캐시와 함께 추출되고 독립 산술이 일치한다.
- 통화는 명시 근거가 없으므로 null로 남는다.
- `10pcs`, `20pcs`, `500g`는 raw unit으로 남고 Box/Bunch/Steam은 null이다.
- 각 CL 탭은 별도 보존되며 서로 다른 합계가 conflict 상태를 만든다.
- 시트명만 맞고 6열 헤더가 없거나, 같은 헤더 후보가 둘이면 fail-closed 한다.
- 상품 수량/금액이 빈 행(3882와 같은 패턴 포함)은 null로 남고 0행으로 생성되지 않는다.
- `LEGACY_CN_REVIEW_REQUIRED` 결과를 `genChina` 또는 `adaptPackingReceipts`에 넘기려 하면 테스트에서 거부된다.
- 양성: raw qty의 업무 단위를 단으로 확인하고 boxes/stems를 명시한 행은 `total_bunch=raw_qty`, 두 비율은 명시 수량에서만 계산되며 원문 `raw_qty × u_price == t_price`를 유지한다.
- 근접 실패: 동일 행에서 raw qty를 box/stem/pcs/중량으로 선택하거나 단위가 미확인이면 `LEGACY_CN_UNIT_UNSUPPORTED`로 남는다.
- 근접 실패: 행 누락·중복, 다른 source hash/cell digest, boxes/stems 누락, 0으로의 묵시적 기본값, 원문 가격 산술 불일치는 해결되지 않는다.
- 원문 통화가 없으면 수동 통화와 사유가 기록돼야 하며 source-verified로 표시하지 않는다.
- CL 충돌 확인은 Invoice 권위 선택만 기록하고 CL 수량을 합치거나 복사하지 않는다.
- resolved 결과의 혼합 부대비는 CN/CO 모두 `unclassifiedAdditionalCharges`로 유지되고 자동 freight cost input이 되지 않는다.
- 현대식 중국 fixture의 기존 성공/실패 동작은 바뀌지 않는다.

### 공통 회귀

- NL Arrivaldate, TH Arrival/Shipment, EC Shipment Date 계약을 유지한다.
- native separate Box/Bunch/Steam 및 독립 UPrice/TPrice 의미를 유지한다.
- 2025 `33-01`과 2026 `33-01` 교차연도 fixture가 존재하며 날짜/파일명에서 차수 연도를 추정해 덮어쓰지 않는다.
- 모든 실패 경로에서 ERP/DB 쓰기 호출 수는 0이다.

## 8. 검증 명령과 완료 선언

구현 후 최소 검증은 다음 순서다.

```text
node --test __tests__/importChinaInvoice.test.js
node --test __tests__/importChinaLegacyInvoice.test.js
node --test __tests__/invoiceRepairBoundary.test.js
node --test __tests__/importPacking.test.js
node --test __tests__/importPackingHardening.test.js
node --test __tests__/importPackingReceiptAdapter.test.js
npm run test:erp-contract
npm run test:nenova-dnspy-evidence
npm run guard:erp-writes -- --changed-from origin/master
npm run build
```

Phase A와 Phase B 결과는 별도로 보고한다. “전체 통과”는 다음이 모두 충족되기 전에는 금지한다.

1. 위 회귀 테스트 통과
2. 구형 중국은 지원된 BUNCH 수동 해결 계약을 모든 행이 통과하고, 타 단위는 미지원으로 명확히 차단
3. CO 미파싱 4개 송장에 대해 별도 승인된 추출 또는 명시적인 미지원 판정
4. ERP 품목·receipt eligibility·writer 검증은 각각의 기존 계약으로 별도 통과

## 9. 계약 manifest 결정

구현 통합 시 `docs/contracts/invoice-extraction-repair.json`은 실제 추가된 parser, metadata/review helper, prompt, generator/adapter gate, UI와 모든 신규 테스트를 `scope`/`requiredTestFiles`에 포함해야 한다. 파일이 아직 없는 동안 선등록하지 않고, 구현 파일이 존재하는 시점에 함께 검증한다.

- `VALIDATE_INVOICE_DATE_EVIDENCE`: Order/Shipment `preserve`
- `VALIDATE_CO_ADDITIONAL_CHARGES`: Order/Shipment `preserve`
- `PLAN_BOUNDED_PAID_RETRY`: Order/Shipment `preserve`
- `PARSE_LEGACY_CN_REVIEW_ONLY`: Order/Shipment `preserve`
- `RESOLVE_LEGACY_CN_BUNCH_ONLY`: Order/Shipment `preserve`; 다른 raw unit은 unsupported

모든 action의 ERP 부작용은 `preserve`, dnSpy 근거는 `docs/exe-golden/FormWarehouseUpload.md`, 필수 교차연도 fixture는 required로 둔다.

## 10. 부작용 표

| 동작 | TempWarehouseDetail | WarehouseMaster/Detail | ProductStock/StockHistory | Order/Shipment/Estimate/Sales | 외부 AI |
|---|---|---|---|---|---|
| Phase A 로컬 파싱/검증 | 보존 | 보존 | 보존 | 보존 | 없음 |
| Phase A 명시 승인 재시도 | 보존 | 보존 | 보존 | 보존 | 승인된 정확한 항목만 |
| Phase A 검증 실패 | 보존 | 보존 | 보존 | 보존 | 자동 추가 호출 없음 |
| Phase B 구형 중국 추출/검토 | 보존 | 보존 | 보존 | 보존 | 없음 |
| 수동 단위/통화 미확인 | 보존 | 보존 | 보존 | 보존 | 없음; 생성·입고 차단 |
| BUNCH 한정 수동 해결·패킹 생성 | 보존 | 보존 | 보존 | 보존 | 없음; 파일 생성만 |

이 문서 작성 과정에서는 API, DB, 비밀값, 배포, push, 앱 코드 변경을 수행하지 않았다.
