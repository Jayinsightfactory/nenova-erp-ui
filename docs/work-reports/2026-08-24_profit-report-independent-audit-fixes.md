# 작업 완료 보고 — 매출이익보고서 독립 감사 후 결함 수정

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-24 |
| 사용자 요청 | 두 독립 감사에서 확정된 결함(재고단가 우선순위, catalog 판매단가 오분류)만 최소 범위로 수정. 커밋/푸시/배포 금지 |
| 브랜치 | `codex/profit-report-source-completion-20260818` |
| 커밋 | 없음 (미커밋) |
| 배포 | 미배포 |

---

## 수정한 결함

### 1. 재고단가 exact fallback 우선순위 결함

`lib/profitReport.js`의 `stockSnapshotByCategory`/`stockPriceRows`가
`arrival || catalogEvidence || freightArrival || carried` 순서를 써서, 2026년 28차 원본
workbook의 과거 catalog 단가가 같은 세부차수에서 실제로 계산된 전산 도착원가
(`VERIFIED_FREIGHT_ARRIVAL_CALC`)보다 먼저 선택되는 결함이 있었다. 이전 세션(2026-08-19)의
work-report와 문서는 이 순서를 "정상"으로 기록하고 있었으나, 이번 독립 감사에서 결함으로
확정됐다.

- 수정: `lib/profitReportCalc.js`에 순수 정책 함수 `selectStockPriceEvidence({ arrival,
  freightArrival, catalogEvidence, carried })`를 신설해 `arrival || freightArrival ||
  catalogEvidence || carried` 순서로 고정하고, `stockSnapshotByCategory`/`stockPriceRows`
  두 호출부가 이 함수 하나만 공유하도록 정리했다. bucket 집계(else-if 체인)와
  `priceEvidenceStatus` 라벨 우선순위도 같은 순서로 맞췄다.
- 회귀: `__tests__/profitReportInventoryWorkbookCatalog.test.js`,
  `__tests__/profitReportInventorySourceCompletion.test.js`가 `selectStockPriceEvidence()`를
  실제 값으로 호출해 "freightArrival + catalogEvidence 동시 존재 시 freightArrival 선택"을
  검증한다(문자열 regex가 아니라 실행 검증).

### 2. catalog N열 표시단가의 판매/분배단가 오분류

`data/profit-report-inventory-catalog/v1/index.json`의 `KRW_VAT_INCLUDED`(N열 기말 표시단가)
33개 항목 — 태국 Jinda 계열, 중국, 네덜란드, 미국(레몬잎/더글라스), 에콰도르, Anthurium 등 —
은 출처 셀·산식만으로 취득원가임이 입증되지 않았다. 산식으로 실제 입증된 것은 호주
(`FOREIGN_TAXABLE` — 외화 취득단가 × 대상 차수 AUD 과세환율) 14개뿐이다.

- 수정: 각 catalog entry에 `eligibleForInventoryValuation`(호주 14개 `true`, 나머지 33개
  `false`+`ineligibleReason`)을 추가했다. `lib/profitReportInventoryWorkbookCatalog.js`의
  `inventoryWorkbookPriceEvidenceByProduct()`가 `eligibleForInventoryValuation===false` 항목을
  어떤 연도·차수에서도 후보로 반환하지 않도록 필터링했다. 항목 자체는 삭제하지 않고 JSON에 감사
  근거로 보존한다. `inventoryWorkbookCatalogMetadata()`에 `eligibleEntryCount`/
  `ineligibleEntryCount`를 추가했다.
- 회귀: `__tests__/profitReportInventoryWorkbookCatalog.test.js`가 중국 안개꽃/시네신스, 태국
  Jinda XL, 네덜란드 장미 3종이 더 이상 후보로 반환되지 않음을 실행 검증하고, eligible=14/
  ineligible=33 개수를 고정한다.

### 3. 합계 이익률 K — 이미 J/(C+F)로 정확함을 확인, 수치 회귀만 추가

`lib/profitReportCalc.js#computeProfitTotals`의 `totals.K`는 조사 결과 이미
`totals.J / (totals.C + totals.F)`였다(코드 변경 불필요). 화면(`pages/sales/profit-report.js`),
엑셀(`lib/profitReportExcel.js`), 확정 스냅샷(`pages/api/sales/profit-report-confirm.js`) 모두
이 한 함수만 공유해 세 곳이 이미 일치한다. 기존 `__tests__/profitReportWorkbookFullParity.test.js`가
27차 fixture(원본 `IFERROR((J23/(C23+F23)),"")` 수식)로 이미 이 공식을 검증하고 있었다. 이번
작업에서는 감사가 확정한 27/28차 숫자(J/C/F, 합계 K, 일반 J/C)를 `__tests__/profitReportWeek28Totals.test.js`에
실제 `computeProfitTotals()` 실행으로 고정하는 회귀를 추가했다 — 28차는 원본 workbook 전체 셀
fixture가 저장소에 없어(22~27차만 `__tests__/fixtures/profit-report-22-27.json`으로 보존) 감사가
제시한 집계값(C/F/J)을 직접 대입해 공식만 검증한다.

## 보존한 경고 (수정하지 않음)

- 태국 GW/H, 콜롬비아 33-02 GW/CW·항공료, 32차 항공료 구매범위 누락 경고는 그대로 유지했다
  (`lib/profitReportAudit.js` 미변경). `__tests__/customsForwardingAuto.test.js` 회귀 통과로 확인.
- 27차 베트남 E21 hardcode, 28차 O23/NL F12/중국 F15, N30=110,000 카네이션 이상값은 여전히
  quarantined/문서화 상태로만 남기고 현재 계산에 넣지 않는다(기존 로직 미변경).

## 변경 파일

| 파일 | 내용 |
|------|------|
| `lib/profitReportCalc.js` | `selectStockPriceEvidence()` 순수 정책 함수 신설 |
| `lib/profitReport.js` | `stockSnapshotByCategory`/`stockPriceRows`가 새 정책 함수를 공유, bucket/상태 라벨 우선순위 정정 |
| `lib/profitReportInventoryWorkbookCatalog.js` | `eligibleForInventoryValuation===false` 항목 필터링, metadata에 eligible/ineligible count 추가 |
| `data/profit-report-inventory-catalog/v1/index.json` | 33개 KRW_VAT_INCLUDED 항목에 `eligibleForInventoryValuation:false`+사유, policy 문구 갱신 |
| `docs/contracts/weekly-profit-report.json` | catalog/입력 계약·교차연도 fixture 문구를 정정된 우선순위·eligibility로 갱신 |
| `docs/exe-golden/FormProfitReport.md` | 2026-08-19 절 신설(결함 1·2, K 공식 확인), 2026-08-17/18 절 문구 정정 |
| `__tests__/profitReportInventoryWorkbookCatalog.test.js` | China/Thai/NL 후보 제외 검증, eligible/ineligible count, `selectStockPriceEvidence` 실행 검증으로 교체 |
| `__tests__/profitReportInventorySourceCompletion.test.js` | 우선순위 regex를 새 함수 호출 패턴 + 실행 검증으로 교체 |
| `__tests__/profitReportWeek28Totals.test.js` | 27/28차 감사 확정 수치로 K=J/(C+F) 및 일반 J/C 실행 검증 추가 |
| `__tests__/profitReportRecentCostCutoff.test.js` | 기존 세션이 남긴 stale regex(옵션 인자 누락) 정정 |

---

## 검증 결과

```
node __tests__/profitReportInventoryWorkbookCatalog.test.js      PASS
node __tests__/profitReportInventorySourceCompletion.test.js     PASS
node __tests__/profitReportWeek28Totals.test.js                  PASS
node __tests__/profitReportRecentCostCutoff.test.js               PASS
node __tests__/profitReportWorkbookFullParity.test.js             PASS (27차 K=J/(C+F) 포함 898셀)
node __tests__/customsForwardingAuto.test.js                      PASS (경고 보존 확인)
npm run test:profit-report-22-28                                  PASS
npm run test:erp-contract                                         PASS (0 실패)
node scripts/check-erp-contract-manifest.mjs                      PASS
node scripts/check-erp-write-contracts.mjs                        PASS (187개 변경 API 검사, ERP Master 쓰기 없음)
npm run build (next build --webpack)                               PASS
git diff --check                                                   PASS (CRLF 경고만, 오류 없음)
```

---

## 미완 / 다음 (운영 저장 검증 필요)

- 이번 작업은 코드/문서/테스트만 수정했고 운영 DB 데이터는 건드리지 않았다. 33차 이후 실제
  화면에서 재고단가 자동연결·경고 건수 변화를 실브라우저로 재확인해야 한다.
- 28차 전체 카테고리 fixture(원본 workbook read-only 추출)가 저장소에 없어, 28차 K 검증은
  감사가 제시한 집계값(C/F/J)을 직접 대입한 공식 검증이다. 28차 전체 workbook 재추출로 fixture를
  보강하면 `profitReportWorkbookFullParity.test.js`처럼 셀 단위 parity까지 확장할 수 있다.
- 미국 SALAL(P59 계열)은 이번 catalog에 등록된 항목이 없어 `eligibleForInventoryValuation:true`
  처리 대상이 없다. 실제 SALAL 항목을 catalog에 추가할 때 같은 기준(출처 셀+산식)으로 표시해야 한다.
- 커밋·PR·master 병합·Cafe24 배포는 수행하지 않았다(작업 지시상 금지).
