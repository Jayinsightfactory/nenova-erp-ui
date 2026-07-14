# PROGRESS.md — 작업 세션 로그

> 최신 항목이 위에 오도록 유지. Claude 가 매 세션 끝에 자동 추가.

---

## [2026-07-14] 세션(feat/raum-pnl worktree) — 라움 손익계산서 메뉴 신설

### 작업 내용
- 라움(트라움에스앤씨, CustKey 680) 견적서(거래명세표 xlsx, 강남/건대 시트) 업로드 → 품목+단가 동일 시 합산 →
  차수별 손익계산서 생성·저장·인쇄. 사장님 수기 엑셀(라움 손익계산서.xlsx) 대체.
- **손익 기준 (사장님 확정)**: 매출단가=견적서 단가(자동) / 매입단가=수기 입력 / 순익분배 네노바 80 : 미우 20 (차수별 수정 가능)
- 참고단가 = Product.Cost÷1.1 (전산 품목원가 VAT포함 저장 — 매출이익 보고서 평가단가와 동일 해석).
  매칭: order-mappings → 토큰 → scoreMatch(60점+, 분배단가=견적단가 3% 가드로 오매칭 차단). 27차 실측 26/48 매칭.
- 웹 전용 테이블 `WebRaumPnl`/`WebRaumPnlItem` (ensure 패턴, 차수 upsert = 품목 전체 교체)
- 실파일 E2E: 강남 38품목 20,539,603 + 건대 26품목 2,799,350 = 합산 48품목 23,338,953 — 시트 하단 합계와 1원 일치.
  수국 화이트 합산 2,648 = ERP 27차 분배수량과 일치. 27차 저장본 생성됨(매입단가는 사장님 입력 대기).

### 변경된 파일
- `lib/raumPnl.js` (신규): 견적서 파싱/합산 + 참고단가 조회 + WebRaumPnl CRUD
- `pages/api/raum/pnl-import.js` (신규): 업로드 파싱 API (formidable+xlsx)
- `pages/api/raum/pnl.js` (신규): 목록/상세/저장/삭제 API
- `pages/raum/pnl.js` (신규): 업로드→미리보기→매입단가 입력→저장→히스토리→인쇄(iframe srcdoc, A4 가로)
- `components/Layout.js`: 채권관리 그룹에 "라움 손익계산서" 메뉴 추가
- `scripts/probe-raum-pnl-cost*.mjs` (신규): 설계 실측 probe (읽기전용)

### 주의/함정 기록
- SheetJS 날짜 셀은 자정보다 수십 초 이르게 파싱 → +12h 후 날짜부 추출로 보정 (견적일 7/9 오파싱 방지)
- 견적서 단가와 전산 분배단가는 동일(견적서가 전산에서 생성됨) — 분배단가는 매입단가가 아님
- worktree에서 `next dev`는 instrumentation.js의 mssql 번들링 문제로 500 — 검증은 `next build --webpack` + NODE_ENV=production node web.js 로

### 미결 이슈
- 27차 매입단가 48건 사장님 입력 대기 (참고단가 채우기 버튼으로 일괄 가능)
- 엑셀 다운로드(양식 그대로)는 미구현 — 인쇄로 대체, 필요 시 profitReportExcel 패턴 재사용

### [추가 v5] 사입(원산지 없음) 품목 — 매출 포함·손익 제외 (사장님 확정)
- 견적서에서 원산지 열이 빈 행 = 업체 사입분(강남 31~38 등) 자동 인식 → WebRaumPnlItem.IsConsigned
- 매출액 합계에는 포함(견적서 일치 유지), 매입·이익·8:2 분배에서는 제외. 이익율 분모 = 손익대상 매출(전체−사입)
- 그리드/비교표 회색 하이라이트 + '사입 제외' 표시, 인쇄·엑셀 동일(엑셀 합계 이익율 =J/(I−사입셀), 사입셀은 SUMIF)
- 결산(웹·엑셀)은 이익/이익율을 차수 합계행 참조로 변경 — D−C 계산이면 사입 매출이 이익으로 섞이는 함정
- 27차 실측: 사입 8건 매출 1,223,171원, 손익대상 22,115,782원, 이익 5,631,082(25.5%)

### [추가 v4.1] 원가자료 엑셀 → 매입단가 시드 (사장님 요청)
- 도착원가 엔진이 못 채우는(전산 미매칭) 19품목을 원가자료 파일(28-1 콜롬비아/수국, 28-2 NL, CHINA)의
  도착원가(단/송이)로 매칭해 WebRaumCostPrice에 시드 — scripts/seed-raum-cost-from-files.mjs (근거 주석 포함)
- 품종 매칭은 27차 분배수량 교차검증(알스트로 레드 43단=Nadya 430송이, 연핑크=Dubai, 화이트=Whistler,
  카네이션 연그린=Prado Mint, 연보라=Electric Purple 등)
- 결과: 48품목 중 41건 자동입력(도착원가 21+학습 20). 잔여 7건(제임스스토리·피오니·꽃잎용·흰장미·스텔링·버터플라이·다빈치)은
  파일에 근거 없음(태국 아란/베트남/이월 품종 특정 불가/40cm 등급 없음) — 수기 입력 대상

### [추가 v4] 매입단가 = 도착원가 자동 (사장님 확정)
- 매입단가 자동입력 = 가장 최근 **도착원가**(getArrivalCostsWithFallback, 카탈로그/피벗 동일 엔진) → 판매단위(EstUnit) 환산(resolveCatalogArrivalDisplay) → **100원 단위 반올림** (🚢 표시)
- 우선순위: 직접입력 학습값(🧠) > 도착원가(🚢). 학습은 **직접 타이핑한 값만**(costSource='manual') — 자동채움 재학습으로 낡은 원가가 굳는 것 방지
- 단위환산 불가(안개꽃 등)·견적단가 3배 초과는 자동입력 생략 + 사유 툴팁. [🚢 도착원가 다시 채우기]로 전체 갱신 가능
- 27차 실측: 21/48 자동입력, 수국 2,100/송이(마진 14%)·장미 몬디알 11,500/단(4%)·카네이션 돈셀 10,900(-1.9% 역마진 노출)
- ⚠ 함정: arrivalCost 원단위는 박스/송이 혼재 — 반드시 단위환산 후 사용 (초기 구현에서 수국 32,900/박스가 그대로 들어갔음)

### [추가 v3] 강남·건대 하이라이트 비교검증 표 (사장님 요청)
- 검증 패널 아래 "🔍 강남·건대 비교검증" — 행마다 품목명·단가·지점별 수량/금액·합산 수량/금액 나란히
- 초록 = 양쪽 지점 합산된 행 / 주황 = 같은 품목명·다른 단가로 분리 유지(이월분) / · = 해당 지점 없음
- 지점 합계 vs 견적서 원본 하단 합계 ✓/✗ · 메인 그리드에도 동일 하이라이트 적용

### [추가 v2] 매입단가 학습 + 엑셀 다운로드 + 손실 행 (사장님 요청)
- **매입단가 학습**: 저장 시 품목명(정규화)별 WebRaumCostPrice MERGE → 다음 업로드 때 자동 채움(🧠 표시, 수정 가능·재학습). 수동행(손실)은 학습 제외
- **엑셀 다운로드**: exceljs 로 차수별 시트 + 결산 시트 생성. 수식 포함(매입액=수량×단가, 이익, IFERROR 이익율, 분배는 각 시트 M1 비율셀 참조 — M1만 바꾸면 재계산), 결산은 INDEX/MATCH 로 각 차수 시트 합계행 참조. fullCalcOnLoad + 캐시값. 파일명 "라움 손익계산서-YYYY.xlsx"
- **손실/수동 행**: [＋ 손실/수동 행] 버튼 — 품목명/수량/단가 직접 입력, 이익·8:2 분배에 차감 반영, 삭제 가능. WebRaumPnlItem.IsCustom
- E2E: 학습 저장→재업로드 자동채움(2건), 손실 -300,000 → 네노바 -240,000/미우 -60,000 확인. 테스트 데이터(99차·학습행) DB 정리 완료
- ⚠ 교훈: Git Bash curl -d 로 한글 JSON 보내면 cp949 로 깨져 U+FFFD 저장됨 — API 테스트는 UTF-8 파일 --data-binary 로

### [추가] 검증 패널 (사장님 요청 — "합산이 잘못됐는지 검증 기능")
- 업로드 시 9개 항목 자동 대조: 시트별 공급가액/부가세/합계(VAT포함) vs 견적서 하단 요약 셀,
  합산 전후 수량·금액 보존, 품목 행수 추적(64→48 등), 전산 분배단가 교차(⚠ 이월 안내)
- 전부 ✓면 초록 "✅ 검증 통과", 하나라도 어긋나면 빨강 "🚨 검증 실패 N건" + 차액 표시. 저장 시 VerifyJson 으로 보존
- 음성 테스트: 수량 조작 파일(2503→2600)로 강남 3건 정확히 검출 확인
- 함정 수정: 수식 캐시 없는 셀 null→0 — 부가세 0은 미기재로 보고 공급가액×10% 폴백

---

## [2026-07-13 18:00] 세션(session-b) #3 — 매출이익 보고서 통관비 자동화 + 재고 스냅샷 앵커 + 확정차수 편집사이클 버그 수정

> 범위: 2026-07-10 ~ 2026-07-13, 8개 커밋. 매 커밋마다 배포(nenovaweb.com) 완료.

### 작업 내용
- `a90c36c` **ProductStock 스냅샷 드리프트 대응 + isFix bit 버그 수정** — `lib/profitReport.js`
  `stockSnapshotByCategory`에 품목별 `isFix IN(1,2)` 앵커 기반 롤링계산(앵커+입고-출고) 추가.
  근본 원인은 `StockMaster.isFix`가 **bit 컬럼**이라 "시작재고" 마커값 2를 저장 못 하고 SQL Server가
  조용히 1로 바꿔버려(=확정과 구분 불가) 매번 새 행이 생성되던 것 — **이 버그 때문에 "시작재고 앵커"
  기능 자체가 이번 세션 전까지 한 번도 정상 동작한 적이 없었음**. `docs/migrations/2026-07-10_stockmaster_isfix_tinyint.sql`
  (bit→tinyint, SSMS 실행 완료) + `pages/api/shipment/stock-status.js` OrderYear 누락 수정으로 해결.
  `scripts/audit-stock-drift.mjs` 감사 스크립트 신규(영구 보존, 커밋됨).
- `42bd474`/`46dd199`/`8385575` **그외통관비(H)·포워딩(S) 자동계산** — 완성본 엑셀 22/23차 실셀
  역분석 반영, 화면에 입력 패널 임베드(수정이력 포함), 포워딩은 입고관리 SERVICE FEE/운송료 라인
  자동감지로 수기입력→자동화 전환.
- `97cc6b0`/`3ccfcde`/`f8147fd`/`1248066`/`55cb15a` 보고서 UX — 컬럼 표시/숨김, 차수별 비교뷰,
  **재고 스냅샷 미확정 카테고리 "확인 필요" 배너**(앵커도 수기값도 없는 E/F 표시), 컬럼 프리셋 저장,
  차수 위아래 버튼, 국내(운송료) 수국/Hydrangea → 콜롬비아 수국 분류 수정.
- `bc7828f` **입력칸 타이핑 중 포커스 튕김 버그 수정** — `EditCell`이 `ProfitReportPage` 내부에 정의돼
  매 렌더(=매 키입력)마다 새 함수 identity 생성 → React가 다른 컴포넌트로 취급해 `<input>` 언마운트.
  모듈 스코프로 호이스트 + `edits`/`setEdit` props 전달로 수정.
- `be76cda` **확정된 차수 단가수정이 재확정 시점에 되돌아가던 버그 수정** — 견적서관리에서 확정
  (isFix=1) 차수 단가 수정은 확정해제→적용→재확정 사이클을 타야 하는데, `applyCostEdits()`의
  `cycleWeeks`가 **항상 빈 배열로 하드코딩**돼 있어 사이클이 전혀 동작하지 않았음. 서버측
  (`update-cost.js`)의 확정차수 차단도 `if (false && ...)`로 꺼져 있어 직접 UPDATE는 "성공"으로
  보였지만 재확정 시점에 원래 값으로 롤백됨(소재2호 Eryngium 27-02차: 3000→3200 수정 후 3000 복귀
  관측). `applyQtyEdits`가 이미 쓰던 `getFixCycleWeeksForEditedItems` 패턴을 `applyCostEdits`에도
  동일 적용 + 서버측 차단 재활성화(안전망).

### 변경된 파일
- `lib/profitReport.js`, `lib/profitReportExcel.js`, `lib/customsForwarding.js`
- `pages/sales/profit-report.js`(대폭 확장), `pages/api/sales/profit-report.js`
- `pages/api/shipment/stock-status.js`, `pages/estimate.js`, `pages/api/estimate/update-cost.js`
- `docs/migrations/2026-07-10_stockmaster_isfix_tinyint.sql`(신규, SSMS 실행 완료)
- `scripts/audit-stock-drift.mjs`(신규, 영구 보존)

### 다음 작업 예정
- 콜롬비아 그외통관비 이중 소스 불일치(아래 미결) — 사용자에게 어느 소스가 정답인지 확인 요청.
- `docs/CONFIRMED_WEEK_EDIT_SAFETY_CHECKLIST.md` 신규 작성(확정차수 편집류 작업 공통 체크리스트).

### 미결 이슈 / 블로킹
- **[미해결·미수정] 콜롬비아 그외통관비 소스 이중화**: 농장별 상세 "원가자료.xlsx" 계열과 요약
  "재고수정.xlsx" 계열이 서로 다른 값/공식을 제시함 — 사용자 확인 전까지 코드 변경 보류.
  - 백상창고료 단가: 410원/kg(구) vs 460원/kg(신, **현재 코드 `lib/customsForwarding.js` COLOMBIA_RATES.BakSangRate=460 적용 중**)
  - "겸역차감" 비용 항목이 두 소스 중 한쪽에만 존재 — `computeColombiaCustomsTotal()`에 전혀
    반영 안 됨(누락 가능성)
  - 국내운송비: 신 소스는 99,000원 정액, 구 소스는 트럭대수×단가(Truck1t/2.5t/5t) 공식
    (**현재 코드는 트럭대수 공식 적용 중** — `computeColombiaCustomsTotal`의 `truck` 항)
  - → 사용자에게 보고만 하고 코드는 건드리지 않음. 다음 세션 작업 전 필수 확인.
- 재고 스냅샷 드리프트는 24/25/26/27차·다수 카테고리에 걸친 구조적 문제(이번 세션의 앵커 롤링계산은
  완화책이지 근본 해결 아님) — E/F는 (a) 실사값 수기 입력 또는 (b) 차수피벗 "시작재고" 저장(이제 정상
  동작) 중 하나로 앵커된 경우만 신뢰 가능. `pages/sales/profit-report.js`의 "확인 필요" 배너로 주별
  미확정 카테고리 확인 가능.

---

## [2026-07-10 11:20] 세션(session-b) #2 — 🚨 Turbopack hydration 운영장애 복구 + 차수피벗 일괄적용

### 운영장애 (오전 배포부터 전 페이지 버튼 무반응)
- 신고 증상: "차수피벗 콜롬비아 버튼 누르면 페이지 꺼짐" → 실체는 **사이트 전체 hydration 정지**
  (화면은 그려지나 React 미시동 — 로그인 폼이 네이티브 제출, 콘솔 에러 0, API 스모크 통과)
- 소거 검증: 코드 revert 무효 · 재빌드 무효 · deps 무변화(next 16.2.1 고정) · 캐시 무관(rm -rf .next)
  → **Turbopack 프로덕션 번들의 페이지 런타임 엔트리 미실행 버그** 확정 (수동 eval 시 "chunk path empty" 노출)
- 복구: `ef69fad` build → **next build --webpack** + next.config.js webpack 폴백(pptxgenjs node: scheme).
  로컬·라이브 실크롬 검증(fiber 부착·React 이벤트 정상). **Turbopack 복귀 금지** (CLAUDE.md 배포주의 갱신)
- 재발방지: `scripts/hydration-smoke.js` + deploy.yml **Hydration smoke 단계**(Actions 러너 실브라우저) 추가

### 차수피벗 기능 (aa2b15e·b0c45a2 배포)
- 셀 편집 = 즉시 적용 → **변경 대기(주황 old→new) + [▶ 변경 시작] 일괄 적용** (셀별 adjust 순차, 개별 커밋)
- 입고 미등록/초과 = 자동 강제 진행(전차수 이월잔량 케이스, 로그 기록) / 취소량초과·취소대상없음 = 실패 유지·재시도
- 적용 로그 패널(진행/성공/강제/실패 실시간) · [🔎 빈 행 추가](주문 없는 업체/품목 노출→수량입력→변경시작)
- PivotErrorBoundary(렌더 크래시 시 원인표시+다시그리기) + 리사이즈 colgroup 재초기화 키에 필터상태 포함

### 미결
- 배포 직후 열려 있던 직원 창은 새로고침 필요(구 청크 메모리 상태)
- 스모크 계정(nenovaSS3)으로 검증하느라 사장님 Chrome 로그인 교체됨 — 본인 계정 재로그인 필요

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
