---
name: Nenova Web 마스터 이슈·작업 가이드
description: 프로젝트 시작(2026-04~)부터 현재까지 오류·재작업·이슈 전수 정리 + 작업 전 필수 읽기 순서
date: 2026-06-16
type: master-index
deploy_head: f10dcce
---

# Nenova Web — 마스터 이슈·작업 가이드

> **작업 시작 전 이 문서를 먼저 연다.**  
> 상세는 링크된 개별 MD·코드를 본다. 본 문서는 **색인 + 우선순위 + 열린 이슈** 역할.

---

## 0. 작업 시작 전 필수 순서 (5분)

```
1. 본 문서 §5「열린 이슈」 + §2「불변식 9항」 스캔
1b. 버그/회귀 의심 → docs/REGRESSION_PREVENTION_GUIDE.md 해당 도메인 표
2. 수정 대상이 DB 쓰기면 → docs/PRE_WORK_CONFLICT_CHECK_2026-05-25.md 체크리스트
3. 출고/주문/견적이면 → docs/ERP_COMPAT_INVARIANTS_2026-06-04.md (불변식 1~9)
3b. 재고·확정·차주 잔량이면 → docs/STOCK_INTEGRITY_DESIGN.md (금지·체크리스트)
4. 단위(박스/단/송이) 건드리면 → docs/OUTUNIT_WRITE_AUDIT_2026-06-10.md
5. 운영 데이터 의심 → /admin/distribute-repair 또는 scripts/probe-*
6. 코드 수정 → npm run build (+ 해당 test:*)
7. 배포 후 → **필수** smoke (아래 §8)
8. 견적/출고 수정 후 → `npm run probe:estimate-24:strict` (24차 Orange Flame + 그린화원)
9. 세션 끝 → .claude/PROGRESS.md 한 줄 추가
```

**절대 원칙:** `nenova.exe`와 같은 MSSQL row를 쓰는 기능은 **충돌 확인 → 진단 → 수정**.  
웹이 “정상처럼 보여도” 전산 ViewOrder/ViewShipment/견적 INNER JOIN 탈락 가능.

---

## 1. 문서 구조 맵 (무엇을 어디서 보나)

| 목적 | 문서 |
|------|------|
| **재발 방지 패턴 원장** | [REGRESSION_PREVENTION_GUIDE.md](REGRESSION_PREVENTION_GUIDE.md) |
| **작업 전 충돌 체크** | [PRE_WORK_CONFLICT_CHECK_2026-05-25.md](PRE_WORK_CONFLICT_CHECK_2026-05-25.md) |
| **전산 호환 불변식 (필수)** | [ERP_COMPAT_INVARIANTS_2026-06-04.md](ERP_COMPAT_INVARIANTS_2026-06-04.md) |
| **웹↔EXE 충돌 9건 + 해결** | [WEB_VS_ERP_CONFLICTS.md](WEB_VS_ERP_CONFLICTS.md) |
| **페이지별 DB 쓰기 영향** | [PAGE_DATA_INPUT_DB_PARITY_AUDIT_2026-05-26.md](PAGE_DATA_INPUT_DB_PARITY_AUDIT_2026-05-26.md) |
| **전체 작업 이력·미완** | [work_history.md](work_history.md) |
| **기획·페이지 남은 구현** | [NENOVA_PROJECT_PLAN_STATUS.md](NENOVA_PROJECT_PLAN_STATUS.md) |
| **EXE 메뉴/기능 갭** | [NENOVA_WEB_EXE_MENU_GAP_AUDIT_2026-05-25.md](NENOVA_WEB_EXE_MENU_GAP_AUDIT_2026-05-25.md) |
| **사용자 보고 이슈 재검증** | [NENOVA_EXE_REPORTED_ISSUES_RECHECK_2026-05-26.md](NENOVA_EXE_REPORTED_ISSUES_RECHECK_2026-05-26.md) |
| **DB 테이블·트러블 회고** | [DB_STRUCTURE.md](DB_STRUCTURE.md) |
| **출고일 6일 밀림** | [SHIPMENT_IMPORT_DATE_BASE_OUTDAY_FIX_2026-06-02.md](SHIPMENT_IMPORT_DATE_BASE_OUTDAY_FIX_2026-06-02.md) |
| **분배 안 보임(Manager)** | [SHIPMENT_DISTRIBUTE_VISIBILITY_FIX_2026-06-04.md](SHIPMENT_DISTRIBUTE_VISIBILITY_FIX_2026-06-04.md) |
| **단위 10배 버그** | [OUTUNIT_WRITE_AUDIT_2026-06-10.md](OUTUNIT_WRITE_AUDIT_2026-06-10.md) |
| **차수피벗→주문/분배** | [work-reports/2026-06-16_week-pivot-order-distribute-audit.md](work-reports/2026-06-16_week-pivot-order-distribute-audit.md) |
| **견적 Orange/그린 24차** | [work-reports/2026-06-16_estimate-orange-green-24.md](work-reports/2026-06-16_estimate-orange-green-24.md) |
| **견적 수정 vs exe** | [NENOVA_EXE_DNSPY_ESTIMATE_EDIT_VERIFY_2026-05-26.md](NENOVA_EXE_DNSPY_ESTIMATE_EDIT_VERIFY_2026-05-26.md) |
| **붙여넣기 매칭** | [PASTE_NATURAL_MATCH_AUDIT_2026-05-25.md](PASTE_NATURAL_MATCH_AUDIT_2026-05-25.md) |
| **세션 로그** | [.claude/PROGRESS.md](../.claude/PROGRESS.md) |

---

## 2. 전산 호환 불변식 9항 (요약)

| # | 불변식 | 위반 증상 |
|---|--------|-----------|
| 1 | `OrderMaster.Manager` = **UserInfo.UserID** (문자열 `'관리자'` 금지) | ViewOrder 탈락 → 분배 grid 거래처 안 보임 |
| 2 | `OrderYearWeek` = 연도+**대차수** (`23-01`→`202623`, full `20262301` 금지) | 견적서관리 GetData 누락 |
| 3 | `ShipmentDetail.CustKey` = Master CustKey 강제 | 분배 화면 누락 |
| 4 | `ShipmentDtm` = BaseOutDay 출고일 + **ShipmentDate 재생성** | 견적 INNER JOIN 탈락, 6일 밀림 |
| 5 | Out/Est/Box/Bunch/Steam 5종, **Est=Out 강제 금지** | 견적 금액·확정 검증 오류 |
| 6 | ShipmentMaster **재사용** (CustKey+OrderWeek, isFix DESC) | 중복 마스터 |
| 7 | **`sd.isDeleted` 컬럼 없음** — 쿼리 시 SQL 500 | |
| 8 | PK = `safeNextKey` + `tryInsertWithRetry` | PK 충돌 |
| 9 | 1 ShipmentDetail + N ShipmentDate (EstQuantity = distributeUnits) | 견적/전산 수량 불일치 |

전수 감사·수정: 커밋 `a8f643b`, `108790f` 등 — [ERP_COMPAT_INVARIANTS](ERP_COMPAT_INVARIANTS_2026-06-04.md)

---

## 3. 이슈 분류 레지스트리

### A. PK / KeyNumbering (치명)

| 이슈 | 증상 | 원인 | 조치 | 상태 |
|------|------|------|------|------|
| OrderDetail PK duplicate | 2627 duplicate key | MAX+1 vs 전산 race | `tryInsertWithRetry` | ✅ |
| ShipmentDetailKey 역전 | exe 일괄분배 버튼 무반응 | KeyNumbering < MAX(SdetailKey) | 채번 보정 + `syncKeyNumbering` | ✅ (재발 시 distribute-repair) |
| Deadlock 1205 | 간헐 500 | 동시 분배 | 재시도 로직 | ✅ [SHIPMENT_FIX_DEADLOCK_RETRY](SHIPMENT_FIX_DEADLOCK_RETRY_2026-05-26.md) |

### B. Manager / ViewOrder (치명)

| 이슈 | 증상 | 조치 | 상태 |
|------|------|------|------|
| Manager=`'관리자'`(UserName) | 웹 주문이 exe 분배 grid에 안 뜸 | UserID=`admin` 해석 INSERT | ✅ `e348379` |
| CreateID | (과거) 전산 필터 | CreateID 정책 문서화 | ⚠️ WEB_VS_ERP #2와 정책 혼재 — **현재 코드는 UserID+admin** |

### C. OrderYearWeek (견적 누락)

| 이슈 | 증상 | 조치 | 상태 |
|------|------|------|------|
| full vs 대차수 | 23-01 베트남 호접난 견적 안 뜸 | `split('-')[0]` 통일 | ✅ |
| OrderMaster 컬럼 없는 DB | SQL 오류 | `columnExists` 가드 | ✅ |

### D. ShipmentDtm / 출고일 6일 밀림

| 이슈 | 증상 | 조치 | 상태 |
|------|------|------|------|
| 수요일 fallback | 신규 분배가 +6일 | `weekToShipDateByBaseOutDay` | ✅ 23-01 18건 보정 |
| ShipmentDate 미동기 | exe 견적 빈칸 | `syncShipmentDateEst.js` | ✅ |

### E. CustKey / 분배 visibility

| 이슈 | 조치 | 상태 |
|------|------|------|
| sd.CustKey 0/NULL | adjust/distribute @ck 강제 | ✅ 신규 경로 |
| **과거 데이터** | 16~22차 각 200건+ CustKey 누락 | ⚠️ repair 도구로 선택 보정 |

### F. OutUnit / 10배 버그

| 경로 | 위험 | 조치 | 상태 |
|------|------|------|------|
| paste adjust `unit='단'` | OutQuantity +10박스 | `computeShipmentAdjustUnits` 2026-06-11 | ✅ |
| week-pivot adjust (unit 없음) | OutUnit 기준 | 안전 | ✅ |
| shipmentImport / public API | unit 미환산 | 2026-06-11 FIX | ✅ |

### G. 견적서 (Estimate)

| 이슈 | 증상 | 조치 | 상태 |
|------|------|------|------|
| ShipmentDate Cost/Est 비움 | exe 수량·단가 빈칸 (Orange Flame) | write-path sync | ✅ |
| OutQuantity=0 유령 Detail | web 0행 (그린화원 24차) | 읽기: SQL filter `988eb5c` · **쓰기: purge guard** | ✅ read+write |
| fix-cycle 다른 차수 | 확정 차수 오류 | edited weeks 수집 | ✅ |
| Freedom 23-1/2 합산 | 출력 HTML 집계 | 코드 수정 | ✅ [ESTIMATE_PRINT_FREEDOM_23](ESTIMATE_PRINT_FREEDOM_23_FIX_2026-06-09.md) |
| 견적 비고 `차감단가` 표시 | 단가 수정마다 비고 누적 | update-cost Descr 미기록 + API sanitize | ✅ |
| **화면 비고 O · 인쇄 X** | byDate Descr 우선순위 + 합산 시 첫 행만 | `mergeEstimateDescrRaw` + `estimatePrintPrepare` 병합 | ✅ (미배포) |
| Estimate.Descr 무한 append (`차감수량` 등) | 메모 비대 | 화면 sanitize ✅ · DB 트리거 · cap 미구현 | 🔶 트리거 운영 apply 확인 |
| pivotStats StockMaster yws | full 포맷 경계 | ⏸ | 열림 |

### H. 확정 (isFix) / 부분확정

| 이슈 | 조치 | 상태 |
|------|------|------|
| 차수 전체 확정이 미확정 품목군 분배까지 차단 | CountryFlower 품목군 체크 | ✅ |
| week-pivot UI vs API 확정 범위 불일치 | UI=셀, API=품목군 | ⚠️ UX 주의 (감사 MD) |
| fix-status 구간 취소 | 구현됨 | 🔶 운영 실측 일부 |
| 25-01 웹 확정 vs exe 풀림·음수 | reconcile + guards + UI 이중표시 | ✅ [SHIPMENT_FIX_EXE_RECONCILE](SHIPMENT_FIX_EXE_RECONCILE.md) |
| 카테고리 fix 후 ProductStock 어긋남 | scoped op 후 차수 전체 `usp_StockCalculation` | ✅ `shipmentFixReconcile.js` |
| 부분 카테고리 fix (2+ 미확정) | `PARTIAL_CATEGORY_FIX_BLOCKED` | ✅ `shipmentFixGuards.js` |
| `Product.Stock` 음수 (이중재고 drift) | reconcile + **repair-negative apply 금지** | ✅ [STOCK_INTEGRITY_DESIGN](STOCK_INTEGRITY_DESIGN.md) |
| 26-1 유령잔량 (웹복구·live↔ps) | undo-web-recovery + sync-week-stock-to-live | ✅ 2026-06-25 |

### K. 재고 정합 (Product.Stock ↔ ProductStock)

| 이슈 | 증상 | 조치 | 상태 |
|------|------|------|------|
| `repair-negative-product-stock --apply` | 웹복구 유령재고, 차주 전파 | **운영 금지** | 🚫 |
| 전주 ProductStock 이월 | 26-1 ps만 남음 (네덜란드) | `sync-week-stock-to-live` | ✅ 절차화 |
| live만 과다 | exe 실시간 ≠ 차수잔량 | live→ps (History 없이) | ✅ 절차화 |
| 차주 오픈 미점검 | gap 누적 | §4.2 주간 checklist | 📋 [STOCK_INTEGRITY_DESIGN](STOCK_INTEGRITY_DESIGN.md) |
| 수동 adj26 품목 | 배치 sync 덮어쓰기 | 스킵 규칙 R4 | ✅ |


### I. 붙여넣기 주문등록

| 이슈 | 조치 | 상태 |
|------|------|------|
| 자연어 매칭 오류 | mapping cache + Claude parse | 🔶 지속 |
| 등록+일괄분배 이중 클릭 | 주문 이중 가산 | ⚠️ 운영 주의 |
| 기준차수 저장/불러오기 | baseWeek + matches | ✅ `f10dcce` |
| 거래처 학습 시점 | 저장/분배 성공 후 | ✅ |

### J. 차수피벗 / 엑셀 업로드

| 이슈 | 조치 | 상태 |
|------|------|------|
| 셀=adjust 주문+분배 동시 | 설계됨 | ✅ [week-pivot audit](work-reports/2026-06-16_week-pivot-order-distribute-audit.md) |
| 엑셀 누락 행 삭제대상 | preview 보강 | ✅ |
| **검증 후 비교표 빈 화면** | 적용대상 0 + 필터 | `전체` 자동·폴백 | ✅ (미배포) |
| **확정차단 전체·적용 0** | FULLY_FIXED 품종 | 확정취소 후 적용 (정책) | 📋 UX 안내 |
| 업로드 품종 일괄분배 (직접 INSERT) | **비활성화** | 🚫 의도적 차단 |
| 전산 SP 버튼 | distribute-sp API | ✅ 2026-06-03 |

### K. Pivot 통계 / 도착원가

| 이슈 | 상태 |
|------|------|
| exe compact/detail parity | 🔶 side-by-side 검증 미완 |
| Field List DnD | ✅ |
| GW/CW in OutQuantity (Cloudland) | ✅ `e7f747c` |
| Holex/NZ 품목명 매핑 | 🔶 |

### L. 챗봇

| 이슈 | 조치 | 상태 |
|------|------|------|
| 농장→거래처 오인 | 라우팅 | ✅ 2026-06-02 |
| 분배수량→재고로 빠짐 | 라우팅 | ✅ |
| 재고=입고+StockHistory−출고 | 기준 통일 | ✅ |

### M. 이카운트 / 영업매출 / 인프라

| 이슈 | 상태 |
|------|------|
| ERP 원본 100% 매칭 | 🔴 미완 (웹 계산값) |
| 신한은행 API | 🔴 Phase 3 |
| Railway→MSSQL IP (구 문서) | ⚠️ 현재 Cafe24 VPS 배포 |
| npm audit | 🔶 |

---

## 4. 타임라인 (주요 사건)

| 시기 | 사건 |
|------|------|
| 2026-04 | 프로젝트 시작, DB_STRUCTURE 트러블 9건, dangling 커밋/worktree 이슈 |
| 2026-04~05 | PK retry, CreateID/Manager, OrderWeek 정규화, LastUpdateID 정책 |
| 2026-05-25 | **충돌 우선 원칙** 도입, 21-01 KeyNumbering 장애, 메뉴 갭 감사 |
| 2026-05-26 | 전체 검증, 부분확정 분배, 견적 exe parity 감사 |
| 2026-06-02 | 출고일 6일 밀림 FIX, 재고=StockHistory 기준 통일, 챗봇 라우팅 |
| 2026-06-03 | 업로드 일괄분배 **차단**, distribute-sp(전산 SP) 추가, 영업매출 기획 |
| 2026-06-04 | **OrderYearWeek 사건**, Manager=UserID, distribute-repair, 불변식 전수감사 |
| 2026-06-09~10 | OutUnit 감사+FIX, 24-01 parity |
| 2026-06-11 | pivot exe parity, adjust ShipmentDetail 환산 |
| 2026-06-15 | 도착원가 GW/CW, 카탈로그 export |
| 2026-06-16 | 견적 유령행 filter, paste 기준차수, week-pivot 감사, **출고 확정 exe reconcile** |
| 2026-06-24 | 견적 인쇄 규칙, EXE 비고 DB정리, **견적 비고 차감단가 숨김**, 25-01 bulk 재확정, **Product.Stock 음수 0** |

---

## 5. 🔴 열린 이슈 / 미완 (2026-06-24)

### 운영·데이터

1. **과거 ShipmentDetail.CustKey 누락** — 신규 경로는 OK, legacy row는 `/admin/distribute-repair` 선택 보정
2. **`StockMaster.isFix=0` after web fix** — UI `FIXED_PENDING_STOCK`; 음수와 별개 ([SHIPMENT_FIX_EXE_RECONCILE](SHIPMENT_FIX_EXE_RECONCILE.md))
3. **ShipmentFarm(농장 배정)** — 웹 분배가 exe btnSave 수준 미구현 ([PROGRESS 2026-06-04](.claude/PROGRESS.md))
4. **fix-status 구간 확정취소** — 운영 실측 일부
5. **Product.Stock 재발** — `STOCK_INTEGRITY_DESIGN.md` 사다리. `repair-negative --apply` 금지

### 기능·Parity

5. **nenova.exe 메뉴/버튼 100% 실측** — 갭 감사만 있음, 전수 미완
6. **차수피벗 엑셀 vs exe** — 컬럼·수식 샘플 비교 지속 필요
7. **Pivot stats vs exe** — 24-02 side-by-side ([pivot-exe-parity](work-reports/2026-06-11_pivot-exe-parity.md) 미커밋 이력)
8. **업로드 품종 일괄분배** — SP 1:1 대조 전 **재활성 금지**
9. **이카운트/경영지원 숫자 100% 매칭** — 웹 계산 vs ERP 원본
10. **분배 저장 전 단가 0 경고** — CustomerProdCost/Product.Cost 없을 때

### UX / 소규모 플랜

11. `orders/new.js` 레이아웃 340px ([work_history §미완](work_history.md))
12. products/search 주문 빈도순
13. incoming XLSX AYURA 파싱
14. 모바일 메뉴 ↔ 데스크톱 동기화

### 코드 부채 (⏸)

15. `Estimate.Descr` 길이 cap
16. `pivotStats.js` StockMaster OrderYearWeek full/raw 경계

---

## 6. 재발 방지 — 코드 전 검색 키워드

**패턴 원장:** [REGRESSION_PREVENTION_GUIDE.md](REGRESSION_PREVENTION_GUIDE.md) — 증상별 ID(G-03, J-01 등)와 테스트 매트릭스.

```bash
# sd.isDeleted (500)
rg "sd\.isDeleted" pages lib

# OrderYearWeek full 포맷
rg "replace\('-',''\)" pages lib

# Manager 리터럴
rg "'관리자'" pages/api lib

# ShipmentDate 동기화 누락 경로
rg "ShipmentDetail" pages/api --glob "*.js" | rg -v syncShipmentDate

# Descr append (운영 로그 오염)
rg "appendDescr|Descr.*append|차감수량|차감단가" pages/api lib

# 견적 인쇄 비고 병합
rg "mergeEstimateDescrRaw|DetailDescr|DateDescr|prepareEstimatePrintRows" lib pages

# 분배 import 필터·확정차단
rg "applyTarget|fixBlocked|pivotSourceRows" pages/shipment/distribute-import.js
```

**테이블 함정:** `ShipmentDetail`에 `isDeleted`, `Cost`, `Amount`, `Vat` **없음** → `Product.Cost` / `CustomerProdCost` 사용.

---

## 7. 진단·보정 도구

| 도구 | 용도 |
|------|------|
| `/admin/distribute-repair` | Manager, OrderYearWeek, CustKey, 출고일, ghost master |
| `/api/shipment/distribute-diagnose` | SP 파라미터, KeyNumbering |
| `scripts/probe-estimate-orange-green-24.mjs` | 견적 상세 덤프 (`--strict` = assert) |
| `npm run probe:estimate-24:strict` | 24차 Orange Flame Detail↔Date + 그린화원 byDate |
| `lib/shipmentDetailWriteGuard.js` | OutQuantity=0 Detail INSERT 차단·purge |
| `npm run test:smoke` | 운영 ping+로그인+23-01 주광+**24차 견적 회귀** |
| `npm run test:smoke:estimate` | 회귀 단위 + strict probe |
| `npm run test:adjust-unit` | 단위 환산 |
| `npm run test:estimate` | 견적 invariants |

---

## 8. 배포 후 필수 검증 (2026-06-16~)

**CI:** push `master` → GitHub Actions → Cafe24 `pm2 restart` → **서버 로컬 smoke** (`SMOKE_BASE_URL=http://127.0.0.1:3000`). 실패 시 deploy job exit 1.

**로컬/운영 수동 (배포 직후 권장):**

```powershell
cd C:\Users\USER\nenova-erp-ui
$env:SMOKE_BASE_URL="https://nenovaweb.com"
npm run test:smoke
npm run probe:estimate-24:strict
```

| smoke 항목 | 검증 내용 |
|------------|-----------|
| 23-01 주광 Hydrangea | exeStructureBroken, detailSplitCnt |
| **Orange Flame 24-01** | `estimate-cost-source-audit` Detail↔Date Cost mismatch = 0 |
| **그린화원 24차** | `/api/estimate?shipmentKey=&byDate=1` 정상출고 qty·cost > 0 |

| 항목 | 값 |
|------|-----|
| HEAD | `f10dcce` (+ smoke 회귀 미배포) |
| URL | https://nenovaweb.com |
| Smoke (이전) | 9 passed — 회귀 2항 추가 후 11 expected |

---

## 9. 작업 유형별 → 읽을 문서 (치트시트)

| 하려는 작업 | 먼저 읽을 것 |
|-------------|--------------|
| 출고분배/ adjust / distribute | PRE_WORK + ERP_COMPAT §3~4 + OUTUNIT |
| 견적서 API/UI | **REGRESSION_PREVENTION §1** + ERP_COMPAT + estimate work-reports + dnSpy MD |
| 붙여넣기/매칭 | PASTE_* + paste.js + §I |
| 차수피벗 셀/주문추가 | week-pivot audit 2026-06-16 |
| 엑셀 업로드 분배 | **REGRESSION_PREVENTION §2** + SHIPMENT_IMPORT_DATE + work_history 2026-06-03 차단 |
| Pivot/도착원가 | PIVOT_DATA_SPEC + freight handoff |
| 새 API INSERT | WEB_VS_ERP #1 + tryInsertWithRetry + syncKeyNumbering |

---

*이 문서는 `work_history.md`, `REGRESSION_PREVENTION_GUIDE.md`, `.claude/PROGRESS.md`, `docs/work-reports/*` 갱신 시 함께 업데이트한다.*
