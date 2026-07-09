# PROGRESS.md — 작업 세션 로그

> 최신 항목이 위에 오도록 유지. Claude 가 매 세션 끝에 자동 추가.

---

## [2026-07-09 17:05] 세션(session-b worktree) — 매출이익 보고서 재고평가 엑셀방식 + 판매등록 마감 스냅샷

### 작업 내용 (04ac14f 로 master 배포·검증 완료, GitHub Actions 29003267293 success)
- `525ef33` fix(profit-report): 기초·기말재고 자동평가를 엑셀 원본 방식(실제 매입원가)으로 전환
  - F기말 = (구매금액×환율+포워딩×환율+그외통관비) ÷ 매입총수량 × 기말재고수량 (엑셀 26차 수국·카네 소수점 일치 검증)
  - 매입 없는 주 = 품목별 최근 매입 외화단가×환율 → 최후 fallback 재고단가표. E기초 = 전차수 F 이월
  - **단위 발견**: 이카운트 구매현황 수량(D열) = WarehouseDetail.**EstQuantity** 우선 (26차 5개 카테고리 완전일치).
    재고수량은 품목별 최근 전표 EstQuantity÷BoxQuantity 로 환산 — 분모·분자 단위 일치가 핵심
  - WarehouseDetail 엔 isDeleted 없음(wm만 필터), DB_STRUCTURE.md 147-150 불완전(컬럼 다수 누락) — 문서 갱신 필요
  - 검증: scripts/verify-profit-stock-26.mjs · diag-purchase-qty-26.mjs (읽기전용)
- `04ac14f` feat(sales-history): 판매등록 마감(TUE_CLOSE) 스냅샷
  - 차수 확정본 = **다음주 화요일**까지 수정분(그다음 수요일부터 수정금지, 사장님 확인) — 차주 수 00:00 자동 고정+지각생성
  - 예: 28차(기준수요일 07-08) 마감 = 07-15(수) 00:00. 배포 직후 27차는 지각 생성으로 소급(비고 명시)

### 변경된 파일
- lib/profitReport.js · lib/profitReportCalc.js · pages/api/sales/profit-report.js · pages/sales/profit-report.js
- lib/salesSnapshot.js · pages/sales/registration-history.js
- scripts/verify-profit-stock-26.mjs · scripts/diag-purchase-qty-26.mjs (신규)

### 미결 이슈 / 블로킹
- 재고 스냅샷 vs 실사 괴리(장미 400단·호주 7,100 등 드리프트) → 보고서 자동값에 그대로 반영됨. 실사값 셀 입력이 우선. 근본 해결은 STOCK_INTEGRITY 절차 별건
- docs/DB_STRUCTURE.md WarehouseDetail 절 갱신 필요(누락 컬럼·isDeleted 없음 명시)

---

## [2026-07-08 후속] 라이브 검증 중 발견한 2건 추가 수정

### stageOfRoom('') 오분류 버그 (수정 완료)
`lib/workflowConfig.js`의 `stageOfRoom()`가 `rm.includes(r)`를 쓰는데 r이 빈 문자열이면
JS에서 항상 true라 **방 정보 없는 이벤트가 전부 첫 단계(IMPORT)로 오분류**됨. 비즈니스이벤트
탭이 room 컬럼을 안 가지면서(위 정정 참고) 이 잠재 버그가 파이프라인 탭에서 "10,000건 전부
IMPORT"로 드러남. 빈 문자열 조기 리턴으로 수정, 실제 방 이름 분류는 그대로 정상 동작 확인.

### 알려진 잔여 제약(수정 안 함, 시트 구조상 한계)
- 흐름분석 "② 대화 스레드" 표의 방/참여자 칸이 빈 값 — 비즈니스이벤트 탭에 room/sender 컬럼이
  없어서(위 정정에서 확인). 방/발신자 정보는 이벤트로그 탭에만 있고 그쪽 기반 섹션(① 발신자쌍
  응답시간, ④ 무응답 구간)은 정상. 필요하면 대화스레드도 이벤트로그 기반으로 재설계 가능(후속과제).

---

## [2026-07-08 정정] 세션 — 어제 진단이 오판이었음(curl 유니코드 정규화 버그), 원래 매핑으로 복원

### 무슨 일이 있었나
배포 후 라이브 페이지를 직접 열어보니 "참여자" 열에 사람 이름 대신 `ORDER_CHANGE`/`PHOTO` 같은
분류코드가, "방" 열엔 방이름 대신 시각이 찍히는 등 여전히 필드가 어긋나 있었음. 원인 재조사 결과,
**어제의 "10열 통합 스키마" 진단 자체가 잘못됐음**을 확인:
- 어제는 다른 저장소(mindmap-viewer)의 진단 엔드포인트를 `curl --data-urlencode "tab=비즈니스이벤트"`로
  호출했는데, 그 엔드포인트가 `tabs.includes(req.query.tab)` 정확 매칭이라 유니코드 정규화(터미널 타이핑
  한글이 시트의 실제 탭이름과 바이트 단위로 안 맞음 등)로 매칭 실패 → 조용히 `tabs[0]`("메시지분류")로
  폴백 → 이벤트로그/비즈니스이벤트 요청 3개 전부 사실은 메시지분류 탭의 헤더를 보고 있었음.
- 이번엔 **nenova-erp-ui 자신의 프로덕션 리더**로 최근 실제 행을 직접 덤프하는 임시 엔드포인트
  (`pages/api/kakao/raw-tail.js`, 작업 후 삭제)를 만들어 배포 → 실제 헤더 확인:
  - `이벤트로그`(6열): 시각/방이름/파이프라인/발신자/원문/메시지ID — **기존(2026-06-09 포팅) 매핑이 정확했음**
  - `비즈니스이벤트`(10열): 이벤트ID/시각/이벤트타입/차수/품목/품종/수량/단위/방향/거래처 — **기존 16열 가정
    중 앞 10개 필드는 정확**했고, room/pipeline/sender/summary/relId/triggerMsgId(구 인덱스10~15)에
    해당하는 컬럼만 시트에서 사라짐(16열→10열로 축소).
- 즉 **어제의 "최신화" 수정은 틀린 진단으로 오히려 정상이던 매핑을 깨뜨렸던 것** — 오늘 원상 복원 +
  사라진 6개 컬럼만 빈 값 처리(우아한 성능저하)로 마무리.

### 변경된 파일
- `pages/api/admin/workflow.js`: rowToEvent/rowToLog를 실측 확인된 진짜 매핑으로 재작성.
  이벤트로그의 "파이프라인"열(한글 표시명 "발주/영업")은 코드 내부 키("ORDER")와 안 맞아 여전히
  `stageOfRoom(room)`으로 재도출(원문 그대로 안 씀).
- `pages/api/kakao/raw-tail.js`: 임시 진단용, 확인 후 삭제.

### 검증
- 실제 tail 샘플 행으로 로컬 단위검증(Node) — eventId/time/eventType/week/product 및
  time/room/pipeline/sender/text/msgId 전부 올바르게 파싱됨 확인.

### 다음 작업 예정
- 배포 후 라이브 `/admin/workflow`에서 요약/흐름분석/이슈트래킹 탭 재확인 필요.

---

## [2026-07-08] 세션 — 업무플로우 분석(/admin/workflow) 카카오 시트 스키마 최신화

### 작업 내용
- **핵심 버그 발견+수정**: nenovakakao가 `메시지분류`/`이벤트로그`/`비즈니스이벤트` 3개 탭을 동일한
  10열 통합 스키마(시각/방이름/발신자/원문/AI분류/품목/차수/수량/관리자수정/비고)로 재구성했는데,
  `pages/api/admin/workflow.js`는 2026-06-09 포팅 당시 구 스키마(이벤트로그 A:F 6열, 비즈니스이벤트
  A:P 16열, customer/direction/variety 등 별도 컬럼 존재 가정)를 그대로 쓰고 있어 **모든 컬럼이
  완전히 밀려서** 읽히고 있었음(예: sender 자리에 원문 텍스트, eventType 자리에 발신자명 등).
  Google Sheets API 실측(다른 저장소 mindmap-viewer의 kakao-debug 진단 엔드포인트로 헤더 3개 탭
  교차확인) 후 신 스키마에 맞춰 `rowToEvent`/`rowToLog` 재작성, `LOG_RANGE`/`BIZ_RANGE`를 `A:J`로
  축소. 실제 시트 행 데이터로 단위검증 완료(로컬, Node 스크립트).
- `lib/workflowConfig.js`: EVENT_TYPES에 실측 확인된 AI분류 코드 `COMM_INFO`(정보공유) 추가.
- 로컬 dev 서버로 문법/파싱 확인(SQL/ViewOrder 매칭 구간은 미변경, 미검증 — 인증토큰 발급이 크리덴셜
  생성으로 분류돼 차단됨. 배포 후 실 카카오 시트 연결 상태에서 `/admin/workflow` 확인 필요).

### 변경된 파일
- `pages/api/admin/workflow.js`: LOG_RANGE/BIZ_RANGE 축소, rowToEvent/rowToLog 신스키마 재작성
- `lib/workflowConfig.js`: EVENT_TYPES에 COMM_INFO 추가

### 알려진 제약(후속 과제)
- `customer`/`direction`/`variety`/`unit` 전용 컬럼이 신 스키마엔 없음 → 항상 빈 값:
  - 이슈트래킹 탭 "② 거래처별 요청/이슈 패턴"은 당분간 항상 빈 결과("데이터 없음")
  - 차수 타임라인 탭의 취소(-)/추가 색상 구분 무력화(항상 "추가"로 표시)
  - 필요시 원문(D열, summary 필드에 이미 있음)에서 거래처명 텍스트 매칭 추출을 별도 기능으로 추가 가능
- EVENT_TYPES는 딱 1개 실측 코드만 확인·반영. 전체 AI분류 taxonomy는 nenovakakao repo(`_flow_analysis.py`
  등)에서 확인 필요 — 매칭 안 되는 코드는 원본 그대로 표시되므로 화면이 깨지진 않음(안전한 성능저하).

### 다음 작업 예정
- 사용자 승인 후 커밋/푸시 → Cafe24 배포 → 실 카카오 시트 연동 상태에서 `/admin/workflow` 라이브 확인.
- 여유 있으면 거래처 텍스트매칭(원문→Customer 마스터) 추가로 issueTracking §2 복구.

---

## [2026-06-16] 세션 — 마스터 이슈 가이드 + paste 기준차수

### 작업 내용
- **마스터 문서** `docs/NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md` — 프로젝트 시작~현재 오류·재작업·열린 이슈 전수 색인, 작업 전 5분 체크리스트.
- **paste** 기준차수/등록차수 분리, 저장하기, 저장본 품목 매칭 (`f10dcce` 배포).
- week-pivot·paste 분배 경로 감사 MD (2026-06-16).
- **smoke** 24차 견적 회귀 (Orange Flame Detail↔Date, 그린화원 byDate) + deploy 후 자동 smoke.
- **유령행 쓰기 차단** `shipmentDetailWriteGuard` — adjust/import/update-quantity + refresh purge.

### 다음 작업 예정
- 마스터 §5 열린 이슈 순차 처리 (ShipmentFarm, ProductStock 진단, pivot exe side-by-side).

---

## [2026-06-16] 세션 — 견적 Orange Flame / 그린화원 24차

### 작업 내용
- **Orange Flame (exe):** 운영 진단 → ShipmentDate 동기화 이미 정상(DetailEst=DateEst=15, Cost 일치). 과거 Date 미동기화 이슈는 syncShipmentDateEst 커밋들로 해소됨.
- **그린화원 (web):** OutQuantity=0 유령 ShipmentDetail 8건이 byDate 견적 API에 0수량·0단가로 노출 → `loadItems` SQL 필터 + `filterActiveEstimateShipmentRows` 추가.
- 진단 스크립트: `scripts/probe-estimate-orange-green-24.mjs`
- 문서: `docs/work-reports/2026-06-16_estimate-orange-green-24.md`

### 변경된 파일
- `pages/api/estimate/index.js`, `lib/estimateInvariants.js`, `__tests__/estimateInvariants.test.js`

### 다음 작업 예정
- push → 배포 후 probe 재실행으로 그린화원 bad rows 0 확인.

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
