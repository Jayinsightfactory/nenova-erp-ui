---
name: 재발 방지 마스터 가이드
description: 버그 수정·기능 변경 사례 전수 — 증상·원인·수정·검증·재발 방지를 한곳에서 조회
date: 2026-06-16
type: regression-prevention
related:
  - NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md
  - work_history.md
  - WORK_RECORD_POLICY_2026-05-25.md
---

# 재발 방지 마스터 가이드

> **용도:** 코드 수정 전·배포 후·운영 사고 시 「이 증상 본 적 있다」를 빠르게 찾고, 같은 실수를 반복하지 않기 위한 **패턴 원장**이다.  
> 상세 감사·세션 기록은 링크된 개별 MD를 본다. 본 문서는 **색인 + 재발 방지 체크** 역할.

**갱신 규칙:** 버그 수정 또는 동작 변경이 끝나면 해당 도메인 표에 1행 추가(또는 상태 갱신)하고, 필요 시 `work-reports/`에 상세 MD를 만든다.

---

## 0. 작업 전 3분 체크

| # | 질문 | NO이면 먼저 |
|---|------|-------------|
| 1 | [NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md](NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md) §0·§2 스캔했는가? | 마스터 가이드 |
| 2 | DB 쓰기·`nenova.exe` 공유 row인가? | [PRE_WORK_CONFLICT_CHECK_2026-05-25.md](PRE_WORK_CONFLICT_CHECK_2026-05-25.md) |
| 3 | 출고/주문/견적/재고 도메인인가? | [ERP_COMPAT_INVARIANTS_2026-06-04.md](ERP_COMPAT_INVARIANTS_2026-06-04.md) |
| 4 | 재고·확정·차주 잔량인가? | [STOCK_INTEGRITY_DESIGN.md](STOCK_INTEGRITY_DESIGN.md) |
| 5 | 단위(박스/단/송이)를 건드리는가? | [OUTUNIT_WRITE_AUDIT_2026-06-10.md](OUTUNIT_WRITE_AUDIT_2026-06-10.md) |
| 6 | 관련 키워드 `rg` 검색했는가? | 아래 §8 |
| 7 | 해당 `npm run test:*` 실행했는가? | 아래 §7 |

---

## 1. 견적서 (Estimate) — 비고·인쇄·수량

| ID | 증상 | 원인 | 수정·가드 | 검증 | 상세 |
|----|------|------|-----------|------|------|
| **G-01** | 견적 그리드에 `차감단가`/`차감수량` 비고 누적 | `update-cost`/`update-quantity`가 `Estimate.Descr` append | append 중단 + `sanitizeDescrTextForPrint` | `npm run test:estimate` | [work-reports/2026-06-24_estimate-descr-unit-cost-hide.md](work-reports/2026-06-24_estimate-descr-unit-cost-hide.md) |
| **G-02** | EXE 견적 화면·인쇄에 운영 로그 그대로 | EXE는 DB `Descr` 원문 출력 | DB 트리거 + cleanup API + dnSpy 패치 | `probe-estimate-descr-*.mjs` | [NENOVA_EXE_PRINT_DESCR_PATCH.md](NENOVA_EXE_PRINT_DESCR_PATCH.md) |
| **G-03** | **화면 비고 O, 인쇄 비고 X** (대구희경 등) | ① `byDate=1` 조회 시 `ShipmentDate.Descr`(운영 로그)만 취함 ② 인쇄 합산 시 첫 행 비고만 유지 | `mergeEstimateDescrRaw(DetailDescr, DateDescr)` · `estimatePrintPrepare` 합산 시 비고 병합 · 인쇄 `descLabel` = 화면과 동일 sanitize | `test:estimate` + `node __tests__/estimatePrintFormats.test.js` | [work-reports/2026-06-16_session-regression-prevention-compilation.md](work-reports/2026-06-16_session-regression-prevention-compilation.md) §2 |
| **G-04** | Orange Flame 등 수량·단가 빈칸 | `ShipmentDate` Cost/Est 미동기, OutQty=0 유령 Detail | write-path sync · 읽기 필터 · purge guard | `npm run probe:estimate-24:strict` | [work-reports/2026-06-16_estimate-orange-green-24.md](work-reports/2026-06-16_estimate-orange-green-24.md) |
| **G-05** | byDate 수국 190박스 전량 표시 | Detail 총량×비율 배분 | `applyByDateRowQuantities` + `distributeUnits` | `test:estimate` | `lib/estimateInvariants.js` |
| **G-06** | Freedom 23-1/2 합산 오류 | HTML 집계 키 | `estimateAggregateKey` 출고일 포함 | — | [ESTIMATE_PRINT_FREEDOM_23_FIX_2026-06-09.md](ESTIMATE_PRINT_FREEDOM_23_FIX_2026-06-09.md) |

### 재발 방지 — 견적 비고 수정 시

1. **절대** `ShipmentDetail.Descr` / `Estimate.Descr`에 단가·수량 운영 로그를 무제한 append하지 않는다 → `lib/shipmentDescr.js` (`appendDescr`, 사용자 메모 분리).
2. `loadItems(byDate=1)` 변경 시 **`DetailDescr` + `DateDescr` 둘 다** 조회·병합하는지 확인.
3. `prepareEstimatePrintRows`에서 **동일 키 합산 시 `_descrParts` 병합** 유지.
4. 화면: `sanitizeEstimateDescrForDisplay` · 인쇄: 동일 함수(정상출고) 또는 `formatEstimatePrintDescr`(차감).
5. EXE 경로는 웹 sanitize와 별개 → DB 정리 또는 dnSpy.

**핵심 파일:** `lib/estimateInvariants.js`, `lib/estimatePrintPrepare.js`, `pages/api/estimate/index.js`, `pages/estimate.js`

---

## 2. 출고분배 · 엑셀 검증 업로드

| ID | 증상 | 원인 | 수정·가드 | 검증 | 상세 |
|----|------|------|-----------|------|------|
| **J-01** | 검증 완료인데 「업체별 품목 수량 비교」 빈 화면 | 기본 필터 `적용대상` + 적용 0건(전부 동일 또는 **확정차단**) | 적용 0건이면 `전체` 필터 · 빈 필터 시 `rows` 폴백 · 안내 배너 | 수동: `전체`/`분배차이만` | [work-reports/2026-06-16_session-regression-prevention-compilation.md](work-reports/2026-06-16_session-regression-prevention-compilation.md) §3 |
| **J-02** | 분배차이 N건인데 적용가능 0 · 확정차단=전체 | `evaluateImportRowFixBlock` — 품종/라인 FULLY_FIXED | **확정취소 후** 재검증 (코드 버그 아님) | KPI·로그 `🔒 확정` | `lib/shipmentFixScopeCore.js` |
| **J-03** | 신규 분배 출고일 +6일 | 수요일 fallback | `weekToShipDateByBaseOutDay` | `shipmentDateBaseMismatch=0` | [SHIPMENT_IMPORT_DATE_BASE_OUTDAY_FIX_2026-06-02.md](SHIPMENT_IMPORT_DATE_BASE_OUTDAY_FIX_2026-06-02.md) |
| **J-04** | 분배차이 행이 UI에 안 보임 | 필터·KPI 부재 | `분배차이` KPI/필터/피벗 | — | `work_history.md` 2026-06-02 |
| **J-05** | 업로드 일괄분배(직접 INSERT) 오동작 | 전산 SP 미검증 | UI **비활성화** | — | `distribute-import.js` `preAlignAvailable=false` |
| **J-06** | 엑셀 10배 수량 | 박스/단/송이 혼동 | `detectQtyWarnings` · 적용 전 confirm | preview 수량경고 KPI | `lib/shipmentImport.js` |

### 재발 방지 — distribute-import 수정 시

1. `applyTarget` = `!fixBlocked && (변경 || needsShipmentApply)` — **확정차단은 적용 불가**가 정책.
2. UI 기본 필터: `applyCount > 0 ? 'apply' : rows.length ? 'all' : 'apply'`.
3. `pivotSourceRows`: 필터 결과 0이면 `rows` 폴백(비교표 항상 가능).
4. 미매칭 모달이 비교 영역을 가릴 수 있음 → 매칭 완료 후 재검증.

**핵심 파일:** `pages/shipment/distribute-import.js`, `lib/shipmentImport.js`, `lib/shipmentFixScopeCore.js`

---

## 3. 출고 확정 · 재고 정합

| ID | 증상 | 원인 | 조치 | 상세 |
|----|------|------|------|------|
| **H-01** | 웹 확정 vs exe 풀림·음수 | scoped fix 후 차수 전체 재고 calc 누락 | `shipmentFixReconcile.js` | [SHIPMENT_FIX_EXE_RECONCILE.md](SHIPMENT_FIX_EXE_RECONCILE.md) |
| **H-02** | `Product.Stock` 음수·유령재고 | `repair-negative --apply`, live↔ps drift | **repair apply 금지** · undo-web-recovery · sync-week-stock | [STOCK_INTEGRITY_DESIGN.md](STOCK_INTEGRITY_DESIGN.md) |
| **H-03** | 26-02 갑자기 재고 생성 | 잘못된 fix 스크립트 | 스크립트 삭제 + rollback | [work-reports/2026-06-16_session-stock-estimate-paste-template.md](work-reports/2026-06-16_session-stock-estimate-paste-template.md) §1 |
| **H-04** | 26-1 웹복구 유령 | 25차 repair 전파 | `undo-web-recovery-stock.js` | [work-reports/2026-06-25_undo-web-recovery-26-01.md](work-reports/2026-06-25_undo-web-recovery-26-01.md) |

**금지 (운영):** `repair-negative-product-stock.js --apply`, `align-live-to-ps` 무계획 실행, `sync-week-stock-to-live --no-out-guard` 남용.

---

## 4. PK · Manager · OrderYearWeek · CustKey

| ID | 영역 | 재발 방지 |
|----|------|-----------|
| **A-01** | PK duplicate | `tryInsertWithRetry` + `syncKeyNumbering` after INSERT |
| **B-01** | Manager=`'관리자'` | UserID=`admin` 등 UserInfo 매핑 |
| **C-01** | OrderYearWeek full | `split('-')[0]` 대차수 통일 |
| **E-01** | sd.CustKey NULL | adjust/distribute @ck 강제 · 과거 데이터는 repair |
| **D-01** | ShipmentDate 미동기 | 모든 Detail 변경 후 `syncShipmentDateEst` |

→ [ERP_COMPAT_INVARIANTS_2026-06-04.md](ERP_COMPAT_INVARIANTS_2026-06-04.md), [WEB_VS_ERP_CONFLICTS.md](WEB_VS_ERP_CONFLICTS.md)

---

## 5. 붙여넣기 · 주문즐겨찾기 · 차수피벗

| ID | 증상 | 수정 | 상세 |
|----|------|------|------|
| **I-01** | adjust `unit='단'` 10배 | `computeShipmentAdjustUnits` | [OUTUNIT_WRITE_AUDIT_2026-06-10.md](OUTUNIT_WRITE_AUDIT_2026-06-10.md) |
| **I-02** | 즐겨찾기 등록 업체 고정 | `paste-template.js` `RegisterCustomerPicker` | [session-stock-estimate §5](work-reports/2026-06-16_session-stock-estimate-paste-template.md) |
| **I-03** | 등록+일괄분배 이중 클릭 | 운영 주의 (이중 가산) | WEB_VS_ERP |
| **J-PV** | 차수피벗 셀=adjust | 주문+분배 동시 | [week-pivot-order-distribute-audit](work-reports/2026-06-16_week-pivot-order-distribute-audit.md) |

---

## 6. Pivot · 챗봇 · 기타 UI

| ID | 증상 | 조치 문서 |
|----|------|-----------|
| **P-01** | Pivot vs exe 수치 불일치 | [work-reports/2026-06-11_pivot-exe-parity.md](work-reports/2026-06-11_pivot-exe-parity.md) |
| **P-02** | `sd.isDeleted` SQL 500 | 컬럼 없음 — 쿼리 제거 |
| **UI-01** | Portal 없는 드롭다운 잘림 | `createPortal` |
| **CB-01** | 챗봇 농장→거래처 오인 | 라우팅 보정 | `work_history.md` 2026-06-02 |

---

## 7. 자동 테스트 매트릭스

| 변경 영역 | 필수 명령 |
|-----------|-----------|
| 견적 invariant / 비고 / byDate | `npm run test:estimate` · `node __tests__/estimatePrintFormats.test.js` |
| 출고 확정 / import fix block | `node __tests__/shipmentFixScope.test.js` |
| adjust 단위 | `npm run test:adjust-unit` |
| 배포 후 smoke | `npm run test:smoke` · `npm run probe:estimate-24:strict` |
| 전체 build | `npm run build` |

---

## 8. 코드 수정 전 ripgrep 키워드

```powershell
# 견적 비고·인쇄
rg -n "mergeEstimateDescrRaw|sanitizeDescrTextForPrint|DetailDescr|DateDescr|prepareEstimatePrintRows" lib pages/api/estimate pages/estimate.js

# 분배 import·확정차단
rg -n "evaluateImportRowFixBlock|applyTarget|fixBlocked|pivotSourceRows" lib pages/shipment/distribute-import.js

# ShipmentDate 동기화 누락
rg -n "UPDATE ShipmentDetail" pages/api --glob "*.js" | rg -v syncShipmentDate

# sd.isDeleted (없는 컬럼)
rg "sd\.isDeleted" pages lib

# KeyNumbering
rg "syncKeyNumbering|tryInsertWithRetry" pages lib

# Descr append (운영 로그 오염)
rg "appendDescr|Descr.*append|차감수량|차감단가" pages/api lib
```

---

## 9. 2026-06-16 세션 — 미배포·미커밋 주의

로컬에만 있는 변경(배포 전 반드시 smoke):

| 영역 | 주요 파일 |
|------|-----------|
| 견적 비고·인쇄 | `estimateInvariants.js`, `estimatePrintPrepare.js`, `estimate/index.js`, `estimate.js` |
| 분배 검증 UI | `distribute-import.js` |
| 주문 즐겨찾기 업체 | `paste-template.js` |
| 사용자 메모 DB 트리거 | `docs/migrations/2026-06-16_estimate_descr_preserve_user_memo.sql` (운영 적용 여부 확인) |
| 화이트라벨 스�affold | `BLUEPRINT_WHITE_LABEL_ERP.md`, `lib/tenant*.js`, `pages/demo/tenant-studio.js` |

---

## 10. 문서 계층 (기록 정책)

| 계층 | 파일 | 역할 |
|------|------|------|
| **재발 방지 원장** | **본 문서** | 패턴·체크·테스트 |
| 마스터 색인 | [NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md](NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md) | 열린 이슈·불변식·배포 검증 |
| 날짜별 요약 | [work_history.md](work_history.md) | 타임라인 + 링크 |
| 세션/기능 상세 | [work-reports/](work-reports/) | 원인·수정·체크리스트 |
| 일일 대화 원장 | [DAILY_CONVERSATION_LOG_2026-06-16.md](DAILY_CONVERSATION_LOG_2026-06-16.md) | 요청·결정 전체 |
| 기록 원칙 | [WORK_RECORD_POLICY_2026-05-25.md](WORK_RECORD_POLICY_2026-05-25.md) | 커밋·문서 규칙 |

---

*갱신: 2026-06-16 — 견적 인쇄 비고(G-03), 분배검증 UI(J-01~02), 세션 컴파일 work-report 추가.*
