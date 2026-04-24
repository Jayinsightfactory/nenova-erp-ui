# PROGRESS.md — 작업 세션 로그

> 최신 항목이 위에 오도록 유지. Claude 가 매 세션 끝에 자동 추가.

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
