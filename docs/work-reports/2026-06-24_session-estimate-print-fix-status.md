# 작업 인계 — 견적 인쇄 / 25차 미카엘 / 확정현황 불일치 (2026-06-24)

> 브랜치: `master` · 배포: `8142a9a`  
> 운영: https://nenovaweb.com  
> **확정·재고 통합 가이드:** [`SHIPMENT_FIX_EXE_RECONCILE.md`](../SHIPMENT_FIX_EXE_RECONCILE.md)

---

## 1. 요약

| 이슈 | 상태 | 핵심 |
|------|------|------|
| 견적서 인쇄 — 수량0·비고 로그 (웹) | ✅ 배포 | `f49455a`, `7eb1b5d` |
| 견적서 인쇄 — 차감 행 동일 규칙 | ✅ 배포 | `7eb1b5d` |
| NENOVA.EXE 인쇄 비고 (`임재용0>1`) | ✅ DB 정리 + 가이드 | `1289f98`, dnSpy 문서 |
| 견적서 관리 비고 `차감단가` 누적 | ✅ 코드 (미배포) | [단가 비고 숨김](2026-06-24_estimate-descr-unit-cost-hide.md) |
| 25-01 확정: exe 풀림 vs 웹 확정 | ✅ 복구 완료 | §4 + [음수 복구](2026-06-24_negative-product-stock-repair.md) |

---

## 2. 견적서 인쇄 규칙 (nenovaweb)

### 2.1 요구사항 (사장님 확정)

| 규칙 | 동작 |
|------|------|
| 비고/적요 | `수량변동`, `분배변동`, `임16>12`, `차감수량`, `차감단가` 등 **운영 로그 미출력** |
| 수량 0 | 품목·단가·금액 **행 전체 미출력** (금액만 있어도 제외) |
| 수량 > 0, 단가 0 | **정상 출력** |
| 차감(불량/검역/단가차감) | 위 규칙 **동일 적용** (수량 0 차감도 제외) |
| 차수별 분배 적요 | 옵션, **기본 OFF** |

### 2.2 변경 파일

| 파일 | 내용 |
|------|------|
| `lib/estimateInvariants.js` | `isPrintableEstimateRow`, `isOperationalEstimateDescr`, `formatEstimatePrintDescr`, `sanitizeDescrTextForPrint`, `sanitizeEstimateDescrForDisplay` |
| `pages/estimate.js` | `buildEstimateHtml` 필터·적요, 그리드 비고, CSV 다운로드 |
| `__tests__/estimateInvariants.test.js` | 45건 통과 |

### 2.3 커밋

- `f49455a` — Align estimate print with nenova.exe FormPrintEstimate rules.
- `7eb1b5d` — Apply estimate print rules to deduction rows.

---

## 3. NENOVA.EXE 견적 인쇄 비고

### 3.1 원인

- **웹** 견적 API(`loadItems`)는 정상출고 `Descr`를 `''`로 내려줌 → 화면/인쇄에서 로그 안 보임.
- **EXE** `FormPrintEstimate` SQL: `sdd.Descr AS Descr`, `e.Descr AS Descr` — **DB 그대로** 인쇄.

### 3.2 25차 (주)미카엘플라워 실측

| SK | 차수 | DB `ShipmentDetail.Descr` (정리 전) |
|----|------|-------------------------------------|
| 5060 | 25-01 | `임재용0>1` × 5품목 + 차감 `차감수량 -2>0` |
| 5201 | 25-02 | `임재용0>1` × 1품목 |

**정리 API 실행 (운영):**

```http
POST /api/dev/estimate-print-descr-cleanup
{ "week": "25", "cust": "미카엘", "apply": true }
```

→ **7건** 업데이트 (ShipmentDetail 6 + Estimate 1). 정리 후 SK 5060/5201 `Descr` 빈 값 확인.

### 3.3 근본 해결 (EXE)

- 문서: [`docs/NENOVA_EXE_PRINT_DESCR_PATCH.md`](../NENOVA_EXE_PRINT_DESCR_PATCH.md)
- dnSpy → `FormPrintEstimate` → `SanitizeDescrForPrint()` (웹 `lib/estimateInvariants.js` 와 동일 규칙)
- EXE 경로: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`

### 3.4 관련 커밋·도구

- `1289f98` — cleanup API + dnSpy 가이드
- `GET/POST /api/dev/estimate-print-descr-cleanup`
- `node scripts/probe-estimate-descr-25-michael.mjs`
- `node scripts/extract-nenova-exe-strings.mjs "<exe경로>" "Print"`

---

## 4. 25-01 확정현황 — exe vs nenovaweb 불일치

### 4.1 증상

- **nenova.exe**: 25-01 차 확정 풀림, 재고 **마이너스**
- **nenovaweb** 견적서관리 → 확정현황: **확정**으로 표시

### 4.2 진단 API (2026-06-24 운영 DB)

```bash
node scripts/probe-fix-parity-audit.mjs 25-01
# 또는 GET /api/dev/fix-parity-audit?week=25-01
```

**결과 요약 (`2026-25-01`, 복구 전):**

| 지표 | 값 | 의미 |
|------|-----|------|
| `ShipmentDetail.isFix` (출고>0) | 506/506 확정 | 웹 **출고확정 = FIXED** |
| `ShipmentMaster.isFix` | 56/56 마스터 확정 | 견적 좌측 `SubWeeksFix` 배지 `25-01:1` |
| Master ≠ Detail 불일치 | **0건** | |
| `ViewShipment.DetailFix` 불일치 | **0건** | |
| **`StockMaster.isFix`** | **0 (미마감)** | 재고 차수 마감 안 됨 |
| **`Product.Stock` 음수** | **17품목** | exe 실시간 재고 화면 마이너스 |

음수 재고 예: Hydrangea White **-129**, CARNATION Cherrio **-25**, ROSE Shimmer **-20** …

### 4.3 근본 원인 (오류 위치)

**단일 DB가 아니라 “확정” 정의가 시스템마다 다름.**

```
┌─────────────────────┬──────────────────────────┬─────────────────────────┐
│ 구분                │ nenovaweb 확정현황        │ nenova.exe 체감          │
├─────────────────────┼──────────────────────────┼─────────────────────────┤
│ 출고 확정           │ ShipmentDetail.isFix     │ ViewShipment.DetailFix   │
│                     │ → 25-01 전부 1 → "확정"  │ → DB상 전부 1 (일치)    │
├─────────────────────┼──────────────────────────┼─────────────────────────┤
│ 재고 마감           │ API에만 stockFixed 필드  │ StockMaster.isFix        │
│                     │ UI에 미표시(수정 전)     │ → 25-01 = 0 → 미마감    │
├─────────────────────┼──────────────────────────┼─────────────────────────┤
│ 실시간 재고         │ fix-status 음수재고 쿼리 │ Product.Stock           │
│                     │ 25-01 = 0건 (다른 식)    │ → 17품목 음수           │
└─────────────────────┴──────────────────────────┴─────────────────────────┘
```

- **웹 버그라기보다** `fix-status.js`가 **출고 Detail 기준만** `status=FIXED`로 판정하고, `StockMaster.isFix`는 응답에만 넣고 **배지에 안 보여줌** → 사용자는 “확정”으로 오인.
- **exe**는 재고 마감·`Product.Stock` 음수를 같이 보므로 “풀림 + 마이너스”로 보임.
- `docs/WEB_VS_ERP_CONFLICTS.md` §9: `Product.Stock`(단일 누적) vs `ProductStock`(차수 스냅샷) **이중 재고** 구조 — 확정취소/재확정 꼬임 시 음수 가능.

### 4.4 코드 보완 (본 세션)

| 파일 | 변경 |
|------|------|
| `pages/api/dev/fix-parity-audit.js` | exe/web 확정·재고 불일치 진단 |
| `pages/api/shipment/fix-status.js` | 응답에 `stockFixStatus` (`FIXED`/`OPEN`/`NONE`) 추가 |
| `pages/estimate.js` | 확정현황 모달 — **출고확정** / **재고마감** 열 분리 + 안내 문구 |
| `scripts/probe-fix-parity-audit.mjs` | CLI 프로브 |

### 4.5 운영 조치 (2026-06-24 완료)

| 단계 | 작업 | 결과 |
|------|------|------|
| 1 | `bulk-refix-weeks.mjs` 20-01~25-02 | 출고확정 전 차수 FIXED |
| 2 | `probe-reconcile-week.mjs 25-01` | 153품목 calc, 음수 잔존 |
| 3 | `repair-negative-product-stock.js` | **17+26품목, 음수 0** |
| 4 | 20-01~25-02 검증 | `negativeLiveCount: 0` |

**잔여:** `StockMaster.isFix=0` → UI `FIXED_PENDING_STOCK` (exe “재고 마감” 표시와 별개, 음수 아님).  
**별도:** `distribute-diagnose?week=25-01` `missingCustKey` 200건 — 확정 표시와 무관한 데이터 품질.

재발 시 → [`SHIPMENT_FIX_EXE_RECONCILE.md`](../SHIPMENT_FIX_EXE_RECONCILE.md) §4

---

## 5. 이전 세션에서 완료된 배포 (참고)

| 커밋 | 내용 |
|------|------|
| `c4b7d22` | NL 피벗 엑셀 ship-day (`lib/pivotVolumeCustDays.js`) |
| `58c617c` | 피벗 필터 prune — 품목 누락 수정 |
| `f49455a`~`1289f98` | 견적 인쇄 + EXE 비고 정리 |
| `724da43`~`6437260` | fix-parity-audit |
| `407b2d4`~`8142a9a` | reconcile + guards + 음수 복구 스크립트 |

---

## 6. 테스트·프로브 명령

```bash
node __tests__/estimateInvariants.test.js
node scripts/probe-fix-unfix-status.mjs 25-01
node scripts/probe-fix-parity-audit.mjs 25-01
node scripts/probe-estimate-descr-25-michael.mjs
node scripts/probe-negative-stock-week.js 2026 25-01
npm run test:smoke   # 운영 SMOKE_BASE_URL 설정 시
```

---

## 7. 미완 / 후속

| 항목 | 비고 |
|------|------|
| NENOVA.EXE `FormPrintEstimate` dnSpy 패치 | DB 정리만으로는 수량 수정 시 비고 재누적 |
| `StockMaster.isFix=0` | reconcile/fix 후에도 0 — `FIXED_PENDING_STOCK` |
| 25-02 `PARTIAL` | 일부 카테고리 미확정 (음수와 별개) |
| 25-01 `missingCustKey` 200건 | `ShipmentDetail.CustKey` NULL |

---

## 8. 관련 문서

- [`SHIPMENT_FIX_EXE_RECONCILE.md`](../SHIPMENT_FIX_EXE_RECONCILE.md) — 확정·reconcile·음수 복구 **통합 가이드**
- [`2026-06-24_negative-product-stock-repair.md`](2026-06-24_negative-product-stock-repair.md)
- [`NENOVA_EXE_PRINT_DESCR_PATCH.md`](../NENOVA_EXE_PRINT_DESCR_PATCH.md)
- [`WEB_VS_ERP_CONFLICTS.md`](../WEB_VS_ERP_CONFLICTS.md) §7~9
