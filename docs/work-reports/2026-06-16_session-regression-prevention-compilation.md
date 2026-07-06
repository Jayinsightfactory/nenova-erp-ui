# 작업 기록 — 2026-06-16 재발 방지·버그 수정 컴파일 (세션 2)

**일자:** 2026-06-16  
**목적:** 대화 세션에서 수정한 버그·UX 이슈를 재발 방지 관점으로 정리  
**원장:** [REGRESSION_PREVENTION_GUIDE.md](../REGRESSION_PREVENTION_GUIDE.md)

---

## 1. 견적서 — 사용자 비고 보존 (DB·API)

### 증상
- 분배 화면에 입력한 **직접 메모**가 견적서 비고에 안 나옴
- `차감수량` 등 운영 로그와 섞이면 **메모 전체 삭제** (DB 트리거·sanitize)

### 원인
- `pages/api/estimate/index.js` — 정상출고 `Descr`를 `''`로 고정했던 이력
- `appendDescr` — 사용자 메모까지 2건 제한으로 삭제
- DB `tr_Estimate_SanitizeDescr` — 패턴 포함 시 Descr **전체** 삭제

### 조치

| 파일 | 내용 |
|------|------|
| `pages/api/estimate/index.js` | `sd.Descr` / `sdd.Descr` → `DetailDescr`+`DateDescr` |
| `lib/shipmentDescr.js` | 메모·운영로그 분리 (`partitionDescrParts`) |
| `lib/estimateInvariants.js` | `mergeEstimateDescrRaw`, `sanitizeDescrTextForPrint` |
| `docs/migrations/2026-06-16_estimate_descr_preserve_user_memo.sql` | 트리거: 운영 라인만 제거 |
| `__tests__/estimateInvariants.test.js` | 혼합 비고·병합 테스트 |

### 재발 방지
- Estimate/Shipment Descr append 시 **운영 로그와 사용자 메모 분리** (`shipmentDescr.js`)
- DB 트리거 변경 시 `fn_SanitizeEstimateDescr` = JS `sanitizeDescrTextForPrint` **의도 동기화**
- **미적용:** 운영 DB 트리거 apply 여부 확인 (`scripts/apply-estimate-descr-trigger.mjs`)

---

## 2. 견적서 — 화면 비고 O · 인쇄 비고 X

### 증상
- 견적서 **관리 페이지** 그리드에는 비고 표시
- **인쇄** 실행 시 품목 적요/비고란 **빈칸** (예: 대구희경 26차)

### 원인 (2중)

**① byDate API — Descr 우선순위**

```sql
-- (구) ShipmentDate.Descr만 있으면 Detail Descr 무시
ISNULL(NULLIF(RTRIM(sdd.Descr), ''), sd.Descr)
```

출고일(`ShipmentDate`) 비고에 `임16>12` 같은 **운영 로그만** 있고, 분배(`ShipmentDetail`)에 사용자 메모가 있으면 → sanitize 후 **빈 문자열**.

**② 인쇄 합산 — 첫 행만 비고 유지**

`prepareEstimatePrintRows`가 동일 품목·단가·출고일을 한 줄로 합칠 때 **첫 번째 행의 Descr만** 남김.  
다른 서브차수/출고일 라인에만 메모가 있으면 인쇄에서 유실.

### 조치

| 파일 | 내용 |
|------|------|
| `pages/api/estimate/index.js` | `DetailDescr`, `DateDescr` 분리 조회 → `mergeEstimateDescrRaw` |
| `lib/estimatePrintPrepare.js` | 합산 시 `_descrParts` 모두 병합 · `descLabel` = 화면과 동일 sanitize |
| `pages/estimate.js` | 인쇄 HTML 특수문자 escape |
| `__tests__/estimatePrintFormats.test.js` | 합산 후 비고 유지 테스트 |

### 재발 방지
- `loadItems(..., byDate=true)` 수정 시 **두 Descr 소스 병합** 필수
- `prepareEstimatePrintRows` 그룹핑 시 **Descr 병합** 필수
- 회귀: `node __tests__/estimatePrintFormats.test.js`

### 수동 검증
- [ ] 견적서 관리 — 거래처 선택 → 비고 열 확인
- [ ] 동일 거래처 **인쇄** → 적요/비고 열 동일 텍스트
- [ ] EXE 직접 인쇄는 별도 — [NENOVA_EXE_PRINT_DESCR_PATCH.md](../NENOVA_EXE_PRINT_DESCR_PATCH.md)

---

## 3. 출고분배 엑셀 검증 — 비교표 미표시

### 증상
- 26-01(또는 2026-26-01) 카네이션 엑셀 **검증 완료**
- KPI·업체별 합계는 보이나 **「업체별 품목 수량 비교」** = 「표시할 품목 수량이 없습니다」

### 원인

| 케이스 | 설명 |
|--------|------|
| **필터** | 기본 `적용대상` — 변경·분배차이 없으면 0건 → 피벗 빈 화면 |
| **확정차단** | 품종 FULLY_FIXED → `applyTarget` false — **분배차이 36건 있어도 적용 0** (정책) |

스크린샷 예 (2026-26-01 카네이션):
- 전체 272 · 분배차이 36 · **확정차단 272** · 적용가능 0
- → 비교하려면 **「전체」** 또는 **「분배차이만」** 필터
- → 적용하려면 **카네이션 품종 확정취소** 후 재검증

### 조치 (`pages/shipment/distribute-import.js`)

| # | 내용 |
|---|------|
| 1 | 적용 0건 + 전체 행 있음 → 필터 자동 `전체` |
| 2 | 필터 결과 0 → `rows` 폴백 + 안내 배너 |
| 3 | 검증 완료 메시지에 `(변경 없음 — 전체 비교 표시)` |
| 4 | 미매칭 없을 때 비교 섹션 scrollIntoView |
| 5 | 빈 피벗 시 「전체 비교 보기」 버튼 |

### 재발 방지
- `applyTarget` ⊂ `rows` — **확정차단은 적용 불가**가 맞음 (로그·KPI로 안내)
- UI는 **데이터 0 ≠ 검증 실패** — 필터/폴백으로 비교표 항상 접근 가능하게 유지
- 수량경고(10배) · 엑셀누락(삭제대상) — 적용 전 KPI 확인

---

## 4. 기타 세션 작업 (링크)

| 항목 | 문서 |
|------|------|
| 재고·견적 Descr·즐겨찾기 업체 | [2026-06-16_session-stock-estimate-paste-template.md](2026-06-16_session-stock-estimate-paste-template.md) |
| 출고 확정 exe reconcile | [2026-06-16_shipment-fix-exe-reconcile.md](2026-06-16_shipment-fix-exe-reconcile.md) |
| 화이트라벨 청사진 | [BLUEPRINT_WHITE_LABEL_ERP.md](../BLUEPRINT_WHITE_LABEL_ERP.md) |

---

## 5. 변경 파일 목록 (세션 2 · 미커밋 기준)

```
lib/estimateInvariants.js
lib/estimatePrintPrepare.js
pages/api/estimate/index.js
pages/estimate.js
pages/shipment/distribute-import.js
__tests__/estimateInvariants.test.js
__tests__/estimatePrintFormats.test.js
docs/REGRESSION_PREVENTION_GUIDE.md
docs/work-reports/2026-06-16_session-regression-prevention-compilation.md
```

---

## 6. 다음 작업 체크리스트

### 배포
- [ ] 견적 비고·인쇄 수정 배포
- [ ] distribute-import UI 배포
- [ ] `npm run test:estimate` · `estimatePrintFormats.test.js` CI 포함 여부

### 운영
- [ ] DB 트리거 `2026-06-16_estimate_descr_preserve_user_memo.sql` 적용
- [ ] 26-01 카네이션 — 확정취소 → 분배차이 36건 검토 → 적용
- [ ] 대구희경 26차 — 화면/인쇄 비고 E2E

### 문서
- [ ] [REGRESSION_PREVENTION_GUIDE.md](../REGRESSION_PREVENTION_GUIDE.md) — 새 패턴 발생 시 §1~3 갱신
- [ ] [NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md](../NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md) — G/J 레지스트리 동기화
