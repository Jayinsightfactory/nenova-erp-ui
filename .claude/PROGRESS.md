# PROGRESS.md — 작업 세션 로그

> 최신 항목이 위에 오도록 유지. Claude 가 매 세션 끝에 자동 추가.

---

## [2026-06-15] 세션 — 도착원가 SQL 자동화 + 카탈로그 export + 배포

### 작업 내용
- **원가자료 Excel 8종 vs ERP** 대조: Cloudland/Holex/Premium Greens 일치, Ecuador→La Rosaleda AWB그룹, 태국→Krung, NZ/SUNPRIDE 품목명 불일치.
- **핵심 버그**: GW/CW가 `OutQuantity`에만 있는 BILL(Cloudland) → `freightWeightOfRow()`에 OutQuantity 추가 → live 도착원가 자동 계산 복구.
- **카탈로그**: 이름/단가 PPT·미리보기 체크박스(기본 ON). Excel 업로드 = 덮어쓰기(선택) UI 명확화.
- **배포**: `e7f747c` → Cafe24 success.

### 변경된 파일 (커밋됨)
- `lib/freightCalc.js`, `lib/pivotFreightArrival.js`, `pages/api/freight/index.js`, `pages/api/freight/excel.js`
- `pages/catalog/index.js`, `lib/catalogPptExport.js`, `lib/catalogUtils.js`, `components/catalog/CatalogPreviewPages.js`
- `scripts/probe-pivot-arrival.js` (yws 계산 fix)

### 인계 문서
- `docs/CLAUDE_HANDOFF_CATALOG_ARRIVAL_2026-06-15.md`

### 다음 작업 예정
- Holex FOB 3건, NZ Bloom/Royal Base 품목명 매핑, probe 스크립트 정리.

---

## [2026-06-12] 세션 — Pivot 필드 드래그(Field List) + 도착원가

### 작업 내용 (미커밋, 2단계 분업)
- **Phase 1 (freight-pipeline-engineer)**: 도착원가 데이터층. `lib/pivotArrivalCalc.js`(순수 가중평균) + `lib/pivotFreightArrival.js`(`getArrivalCostsForWeekRange` — 스냅샷/라이브 + 입고수량 가중평균). `pivotStats.js` rows[]에 `arrivalCost`/`arrivalMeta` additive. **`freightCalc.js` 무변경(zero diff) → 238/238 유지.**
  - 소스규칙: FreightCost 스냅샷 우선, 단 AWB 그룹에 OutUnit='박스' 품목 있으면 전체 라이브 계산(스냅샷에 박스당 컬럼 없음 → freight 탭 정합 보장).
- **Phase 2 (Claude)**: `lib/pivotFieldRegistry.js`(16필드 메타) + `pages/stats/pivot.js` Field List 패널(행/열/필터/값 HTML5 DnD), 도착원가 측정 고정열, 필터존 값체크, 하단 `[구분] In […] And […]` 통합 요약바, `localStorage pivotFieldLayout`. 기존 compact/detail·export·즐겨찾기 무손상.

### 변경된 파일
- 신규: lib/pivotFieldRegistry.js, lib/pivotFreightArrival.js, lib/pivotArrivalCalc.js, __tests__/pivotFreightArrival.test.js, scripts/probe-pivot-arrival.js, docs/work-reports/2026-06-11_pivot-field-drag-arrival.md
- 수정: lib/pivotStats.js(+42), pages/stats/pivot.js(+443), package.json(test:pivot-freight/probe:pivot-arrival), docs/PIVOT_DATA_SPEC_CODEX.md(§7)

### 검증
- freightCalc 238/238, test:pivot, test:pivot-freight(17), test:import-qty 모두 pass. `npm run build` ✓ Compiled successfully(/stats/pivot 포함). 잔여 warning 1건=next.config.js NFT(무관).

### 다음 작업 예정
- 운영 DB 에서 `npm run probe:pivot-arrival`(24-02 3건) ±0.01 parity 확인. 커밋/푸시는 사용자 승인 대기.

### 미결 이슈 / 블로킹
- 행/열 임의 재피벗(거래처를 행으로 등)은 13/14차 검증 shape 보호 위해 미구현(의도적).

---

## [2026-06-04] 세션 — 견적 누락(OrderYearWeek) + 전산호환 불변식 전수감사

### 작업 내용
- **23-01 베트남 호접난 견적서관리 누락** 근본원인: 견적(GetData/GetDetail)이 raw `sm.OrderYearWeek` 로 필터하는데
  웹이 full('20262301'), 전산은 대차수('202623') → 누락. (실측 21/22차=전산 vs 23차=웹 비교로 확정)
- `108790f` adjust/distribute/orders OrderYearWeek 대차수화 + pivotStats 계산식화 + fix-orderyearweek 보정도구
- `782c3d9` fix-orderyearweek OrderMaster 컬럼 columnExists 가드
- **전수 감사**(11개 쓰기파일, 병렬 4에이전트) → `a8f643b` 전 경로 OrderYearWeek 대차수 + Manager UserID 검증
  (shipmentImport/stock-status/public/orders/public/shipments/order-request-approve/adjust)
- 문서: `docs/ERP_COMPAT_INVARIANTS_2026-06-04.md` (불변식 1~8 + 사건 + 감사결과)

### 변경된 파일
- adjust/distribute/orders/shipmentImport/stock-status/public(orders,shipments)/order-request-approve: OrderYearWeek 대차수, Manager UserID
- pivotStats.js: ShipmentMaster 범위쿼리 raw→yearWeekExpr
- pages/api/shipment/fix-orderyearweek.js, estimate-visibility.js(다차수/GetDetail조인/raw 비교): 신규/보강
- docs/ERP_COMPAT_INVARIANTS_2026-06-04.md: 신규

### 다음 작업 예정 (별도 검토)
- estimate/update-cost EstQuantity fallback(Est=Out 강제 위험), Estimate/Descr 무한 append, orders updateOrder manager 무검증.

### 미결 이슈 / 블로킹
- 없음 (견적 누락 해결, 전 쓰기경로 불변식 1·2·6 정합화).

---

## [2026-06-04] 세션 — 출고분배 거래처 누락/분배 안 보임 종합 수정 (dnSpy 근본원인)

### 작업 내용
- **근본원인 확정**: nenova.exe 출고분배 grid 원천 `ViewOrder` 가 `INNER JOIN UserInfo ON om.Manager=ui.UserID`.
  웹이 `OrderMaster.Manager` 에 `'관리자'`(UserName) 를 넣어(UserID='admin' 이어야 함) 웹전용 주문이
  ViewOrder 에서 탈락 → 전산 분배 grid 에 거래처(아이엠/수아레) 안 뜸 → 분배 입력 불가.
- `e348379` Manager 를 `UserInfo`(UserName='관리자')→UserID(fallback 'admin') 로 해석 저장 (adjust.js, orders POST)
  + 기존 깨진 주문 정정 API/버튼(`order-manager-fix`)
- `0408f06` adjust UPDATE 출고일(ShipmentDtm) 강제 정정(분배 다른 날짜 박힘 방지)
- `de197d0` adjust UPDATE ShipmentDetail.CustKey 강제 일치
- `3c62951` 일괄분배 미매칭 품목 확인창 경고
- 진단/보정 도구 `/admin/distribute-repair` 신설(item-trace, distribute-diagnose 연동, ghost-master-cleanup)
- `aed3cf1` ShipmentDetail.isDeleted 참조 제거(실제 컬럼 없음 → SQL 500)

### 변경된 파일
- `pages/api/shipment/adjust.js`, `pages/api/orders/index.js`: Manager=UserID, 출고일/CustKey 강제, 비고 최신2건
- `pages/api/shipment/order-manager-fix.js`, `item-trace.js`, `ghost-master-cleanup.js`: 신규(진단/보정)
- `pages/admin/distribute-repair.js`: 신규(통합 진단/보정 페이지)
- `docs/SHIPMENT_DISTRIBUTE_VISIBILITY_FIX_2026-06-04.md`: 신규(상세 회고)

### 다음 작업 예정
- 웹 분배가 `ShipmentFarm`(농장별 배정)도 작성하도록 — nenova.exe btnSave 구조 확인 후.

### 미결 이슈 / 블로킹
- "농장미배정"(ShipmentFarm 없음)은 거래처/수량은 전산에 정상 표시되나 농장별 배정만 비어있음 — 별도 과제.

---

## [2026-04-24] 세션 #3 — 붙여넣기 학습/파서 dangling 복구 + .claude/ 문서 체계 도입

### 작업 내용
- `b133af3` 터미널 기반 매핑 학습 스크립트 복구 (`scripts/paste-train.js`)
- `d4d0a1c` `paste-train --sync-db` 모드 (.env.local DB 직접 조회)
- `0e630fd` 475개 주문 매핑 학습 데이터 (`data/order-mappings.json`, 446 자동 + 29 수동)
- `e15ad98` 붙여넣기 "➕ 기존 수량 더하기" delta 모드 체크박스
- `2d20d2b` 차수 `-01/-02/-03` 전체 표시 + Claude 분석 감지 차수 자동 적용 배지
- `.claude/CLAUDE.md`, `.claude/PLAN.md`, `.claude/PROGRESS.md` 신규 — 단일 진실 소스 체계 도입

### 변경된 파일
- `scripts/paste-train.js`, `scripts/paste-train-auto.js`: 신규 (학습 도구)
- `data/order-mappings.json`: 신규 (475 매핑, gitignore 에서 제외)
- `pages/api/orders/index.js`: delta 모드 UPDATE 분기 + LastUpdateID 유지 (tryInsertWithRetry 와 병합)
- `pages/orders/paste.js`: `deltaMode` state + 체크박스 UI + `detectedWeek` 배지 + `getNearby2026Weeks` 3배 표시
- `pages/api/orders/parse-paste.js`: Claude 에 차수 감지 요청, WW-SS 정규화 반환
- `.gitignore`: 학습 매핑 파일은 추적, 세션용 캐시만 ignore
- `.claude/{CLAUDE,PLAN,PROGRESS}.md`: 신규

### 다음 작업 예정
- Phase 6 dangling 복구 2단계 (사용자 판단 대기)
- Phase 7 사이드바 누락 메뉴 3건 노출
- Phase 8 중국 카테고리 DB 조회 후 필요시 마이그레이션

### 미결 이슈
- 없음 (1단계 완료, 2단계는 사용자 테스트 후 진행)

---

## [2026-04-23] 세션 #2 — dangling 커밋 발견 + 복구 1차 + 장애 수정

### 작업 내용
- `65dbbc5` 카카오워크 봇 이미지 업로드 (`/api/agent/photo-upload` + `/uploads/photos/*`)
- `b6189d0` 업로드 사진 런타임 서빙 fix (Next.js 16 public 빌드 스냅샷 우회 rewrite)
- `f6fb4ec` **GW/CW 추출 + 세부카테고리 + 박스당/단당 선택 UI** (dangling 3묶음 수동 적용)
- `25d3a83` 단당 무게/CBM 입력 갱신 버그 수정 (form.BoxWeight vs boxWeight 우선순위)
- `d026823` OrderDetail/OrderMaster PK 충돌 자동 재시도 복구 (dangling `0c03b9d`)
- `docs/DB_STRUCTURE.md` 신규 — 트러블 회고 9건 + 테이블/FK/쿼리 체크리스트

### 변경된 파일
- `docs/DB_STRUCTURE.md`: 신규
- `pages/api/agent/photo-upload.js`: 신규 (JWT + formidable + 30일 자동 정리)
- `pages/api/public/photo/[...path].js`: 신규 (런타임 파일 스트리밍)
- `next.config.js`: rewrite `/uploads/photos/:path* → /api/public/photo/:path*`
- `lib/categoryOverrides.js`: 신규 (웹 전용 파일 저장소)
- `pages/api/freight/category-override.js`: 신규 (GET/POST/DELETE)
- `pages/admin/category-overrides.js`: 신규 (🏷 세부카테고리 관리)
- `pages/api/freight/{index,excel}.js`: 오버라이드 적용 + GW/CW 품목행 추출
- `pages/freight.js`: input+datalist + 🌐 배지
- `pages/master/products.js`: 박스당/단당 2쌍 입력, 콜롬비아 기본 강조
- `lib/freightCalc.js`: `isFreightItem` 에 `Gross weigth`/`Chargeable weigth` 추가
- `components/Layout.js`: 🏷 세부카테고리 메뉴 추가
- `pages/api/orders/index.js`: `tryInsertWithRetry(maxRetry=5)` 추가

### 발견 사항
- **worktree(`mystifying-davinci`) 커밋 11개가 master 에 merge 안 됨** — 기능 실종
- 이전 세션 요약의 "Reapply 로 복원됨" 설명 오류 — Reapply 커밋도 dangling
- 백업 태그 10개 생성 (`backup-before-recovery-20260422-1109`, `dangling/*` 8개)

### 미결 이슈
- Phase 6 dangling 복구 대기 (출고분배 delta / 통합 패널 / Manager uid / mindmap / 카테고리 팝업 편집)
- Phase 8 중국 Product 조회 결과 미확인

---

## [2026-04-22] 세션 #1 — DB 구조 확립 + 카카오워크 업로드

### 작업 내용
- `docs/DB_STRUCTURE.md` 작성 (트러블 회고 9건 + 전체 테이블/FK/마이그레이션)
- 사이드바 누락 페이지 검증 (orders-requests / worklog / activity / week-pivot / credit-history)
- OrderRequest/OrderRequestDetail 테이블 존재 확인 (SSMS)
- CurrencyMaster CNY 195.0 확인
- Flower 중국 기본값 없음 — 조건부 마이그레이션 대기

### 미결 이슈
- worktree dangling 커밋 존재 인지 (다음 세션에서 전면 해결 시작)

---

*새 세션이 끝날 때마다 위 형식으로 앞에 추가. 커밋 SHA + 변경 파일 + 다음 예정 + 미결 이슈 필수.*
