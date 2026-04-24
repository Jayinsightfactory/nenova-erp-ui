# PLAN.md — 프로젝트 목표 & 기능 계획

> 상태: `[ ]` 예정 | `[~]` 진행중 | `[x]` 완료 | `[!]` 블로킹

---

## 🎯 최종 목표

Nenova 꽃 수입·유통 ERP 의 **웹·모바일 프런트 + AI 챗봇 + 운송기준원가 자동화**를
전산(이카운트) DB 와 안전하게 공존시키면서 직원 반복 업무를 줄이고, 붙여넣기 주문등록·
카카오워크 이미지 봇·모바일 주문신청까지 한 시스템에서 처리 가능하게 만든다.

---

## 📋 기능 목록

### Phase 1 — 핵심 운영 (MVP, 13/14차 안정 기준)
- [x] 주문등록 / 주문관리 / 출고분배 / 출고확정 / 견적서
- [x] 재고/판매현황/미수금/세금계산서
- [x] 거래처·품목·단가·코드 마스터
- [x] 사용자관리 + JWT 인증
- [x] OrderDetail/OrderMaster PK 충돌 자동 재시도 (`tryInsertWithRetry`)

### Phase 2 — 모바일 + 챗봇 (2026-04-15 세션)
- [x] 모바일 16페이지 (`/m/*`) + MobileShell + 탭바
- [x] 모바일 챗봇 (`/m/chat`) — Text-to-SQL 에이전트
- [x] 챗봇 스키마/카탈로그/비즈스냅샷/API 사용량 컨텍스트
- [x] 역질문 + 로딩 단계 + 히스토리 localStorage 영속화
- [x] 진단 대시보드 `/m/admin/status`
- [x] LLM 비용 모니터링 `/api/m/cost`

### Phase 3 — 운송기준원가 (2026-04-16 ~ 22)
- [x] `/freight` 탭 + FreightCost/FreightCostDetail 테이블
- [x] Flower/Product BoxWeight/BoxCBM/TariffRate 컬럼
- [x] 엑셀 1:1 다운로드
- [x] 238건 fixture 테스트
- [x] **GW/CW 자동 추출** (BILL 품목행, `Gross weigth` 오타 포함)
- [x] **세부카테고리 웹 전용 오버라이드** (Product.FlowerName 미변경)
- [x] **박스당/단당 선택 UI** (콜롬비아 외 단당 기본)

### Phase 4 — 자연어 + 카톡 봇 (2026-04-17 ~ 22)
- [x] Product.DisplayName — 웹 한글 자연어명, 견적서 영문 유지
- [x] 자모 매칭 검색 + 일괄 자동생성
- [x] FarmCredit (농장 크레딧 차수별)
- [x] CurrencyMaster CNY 추가
- [x] ShipmentDetail.OutQuantity 변경 자동 Descr 로그 트리거
- [x] 카카오워크 봇 이미지 업로드 엔드포인트 (`/api/agent/photo-upload` + `/uploads/photos/*` rewrite)

### Phase 5 — 붙여넣기 주문 학습 (2026-04-20 ~ 24)
- [x] 터미널 학습 스크립트 `scripts/paste-train.js` + `--sync-db`
- [x] 475개 매핑 학습 데이터 (`data/order-mappings.json`)
- [x] 붙여넣기 "➕ 기존 수량 더하기" delta 모드
- [x] 차수 `-01/-02/-03` 전체 표시 + Claude 분석 차수 자동 적용 배지

### Phase 6 — 미완 dangling 복구 (2026-04-24 ~)
- [ ] 출고분배 delta 모드 상시화 (`d7a51cb`)
- [ ] Reapply 4건 — distribute week 정규화 / 통합 패널 / custItems OutQuantity
- [ ] Manager uid 처리 / LastUpdateID 제거 패치 3건
- [ ] `/mindmap` ERP·모바일·AI 통합 기능 맵
- [ ] 품목 상세 원가 카테고리 셀 클릭 팝업 편집 (`5bcfa42`)

### Phase 7 — 사이드바 누락 메뉴 노출
- [x] `🏷 세부카테고리` (`/admin/category-overrides`)
- [ ] `/admin/order-requests` — 모바일 주문신청 승인
- [ ] `/admin/worklog` — OrderHistory/StockHistory/ShipmentHistory 통합
- [ ] `/admin/activity` vs `/master/activity` 역할 정리
- [ ] `/shipment/week-pivot` 사이드바 노출 (현재 paste.js 버튼에서만 진입)

### Phase 8 — 중국 카테고리 DB 보강 (조건부)
- [ ] `SELECT * FROM Product WHERE CounName=N'중국'` 결과 확인
- [ ] 중국산 품목의 FlowerName 이 Flower 마스터에 있는지
- [ ] 없으면 `INSERT INTO Flower (중국기타, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff)` 마이그레이션

---

## 🗂️ 세부 태스크

### Phase 6 — dangling 복구 상세
- [ ] 충돌 분석: `d7a51cb`, `d27bfbb`, `09cfb73`, `6151213`, `009a6c6` 순차 cherry-pick
- [ ] Manager/LastUpdateID 3건 — 전산 호환 관점에서 재검토
- [ ] `/mindmap` 재작성 (`fd82da0`) 내용 확인 후 적용

### Phase 7 — 사이드바 정리 상세
- [ ] `components/Layout.js` 에 3개 메뉴 추가
- [ ] activity 중복 정리 방향 (통합 vs 분리) 결정
- [ ] `/incoming-price` 본문에 크레딧 이력 버튼 강조

---

## ⚠️ 알려진 제약사항

- **전산(이카운트) 동시 INSERT 로 PK 충돌 가능** → `tryInsertWithRetry(maxRetry=5)` 방어
- **`CurrencyMaster` 는 수동 갱신** — 환율 변동은 `/finance/exchange` 또는 SSMS UPDATE
- **`FreightCost.ExchangeRate` 는 스냅샷** — 저장 후 과거 BILL 환율 안 바뀜 (의도)
- **xlsx-js-style 사용 금지** (Turbopack 빌드 실패)
- **Next.js 16 public/ 은 빌드 시점 스냅샷** — 런타임 업로드 파일은 `/api/public/photo/*` rewrite 로 우회
- **worktree 커밋 실수로 master 병합 누락** 이력 있음 → PR/push 전 `git branch --contains` 확인 필수

---

## 📊 진행률 요약

| Phase | 전체 | 완료 | 진행중 | 예정 |
|-------|------|------|--------|------|
| Phase 1 | 5 | 5 | 0 | 0 |
| Phase 2 | 6 | 6 | 0 | 0 |
| Phase 3 | 8 | 8 | 0 | 0 |
| Phase 4 | 5 | 5 | 0 | 0 |
| Phase 5 | 4 | 4 | 0 | 0 |
| Phase 6 | 5 | 0 | 0 | 5 |
| Phase 7 | 5 | 1 | 0 | 4 |
| Phase 8 | 3 | 0 | 0 | 3 |
| **합계** | **41** | **29** | **0** | **12** |

*Claude 가 작업 완료 시 이 표를 자동 업데이트 (71% 진행)*
