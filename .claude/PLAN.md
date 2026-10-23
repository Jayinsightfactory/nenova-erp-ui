# PLAN.md — 프로젝트 목표 & 기능 계획

## 2026-10-23 — 승인 비용으로 주차별매출 최신화
- [x] 백상460·중량차량비·태국5%·선율 추정, 실제0·수기·확정본/ERP 보존
- [x] FIFO/오래된 이월 추정표식, 미매칭 비용 풀·단위·교차연도·누락 근거 검사
- [x] 1~41 전후 독립 검산15,058 실패0·원장 지문 동일·전체 gate/build
- [~] PR CI·code-only Cafe24·운영 다운로드
- [!] 추정은 실비 청구 인증이 아님. 미래/현재환율·수량/품목 임의 보정은 계속 금지.

## 2026-10-22 — 태국 SQL 실제 운송·통관비
- [x] 실제 dnSpy/SQL read-only: 34차 운송료 있음, 통관 실비 저장 없음, 품목 미연결 상품행 확인
- [x] 기본값 제거, SQL H 공유·합계/단위 보존, NULL/0·교차연도·FIFO 우회 차단 회귀
- [~] 1~41 재대사·전체 gate/build·PR CI·code-only 배포·운영 다운로드
- [!] 34차 실제 통관비/미연결 품목 근거 부족. 숫자를 발명하지 않고 원가·이익률 확인 필요 표시. DB 무변경.
- docs/plans/profit-thai-actual-cost-2026-10-22.md

## 2026-10-22 — 태국 34차 원가의 38~41차 연결
- [x] 실제 dnSpy/SQL read-only, 최근4차수 경계 누락·현재 환율 혼입 확인
- [x] 태국 과거매입 허용, FIFO/이월 정확 환율 공유, 기본 통관비 한계 경고, 회귀
- [~] 1~41 전후 검산·전체 gate/build·PR CI·코드만 배포·운영 다운로드
- [!] 실제 통관 청구서 확정값 없음. 도착원가 통관 기본값과 보고서 H는 별도. 실비 검증 완료 주장 금지.
- DB/재고/매입/확정 revision/단가 근거 저장 없음. docs/plans/profit-thai-carry-2026-10-22.md.

## 2026-10-22 — 26~31차 우선 손익 계산 근거
- [x] 원본 공통식/예외 분리, SQL 품목별 원가·단위 사용, 판매단가/근사환율 대체 제거
- [x] 1~41차 SELECT 독립 검산·원장 지문 동일·전체 검사/빌드
- [~] PR/CI·코드 전용 Cafe24 배포·운영 브라우저 다운로드
- [x] 중국 26/27 E/F·28 E: 같은 품목 19-01 실제 매입/정확 환율/도착원가로 해소, 26~31 원가·환율 누락0
- [!] 태국 38~41, 18차 환율 충돌·초기 차수 일부 원가 근거 / 32~41 원본 없음
- 고정: DB/확정 revision 무변경. 엑셀 묶음과 무관하게 품목별 SQL 단가/수량 사용.

## 2026-10-22 — 손익 단위·평가·환율 (DB 불변)
- [x] 보고서 계산 수정 및 1~41차 SELECT 독립 대사
- [~] 필수 전체 검사·PR·CI·Cafe24·읽기 전용 브라우저 다운로드 확인
- [!] 18차 원본 환율 충돌 / 12~14차 장미 근거 누락 / 32~41차 원본 부재

> 상태: `[ ]` 예정 | `[~]` 진행중 | `[x]` 완료 | `[!]` 블로킹

## 2026-10-15 — 출고→견적서/매출 누락 방지 보호장치

- [x] 주문 없는 출고 저장·확정 차단 (ViewOrder 조인키 기준) + 관리자 조회 API
- [x] ShipmentDate 저장 경로 공통 금액 동기화 (Amount/Vat/Cost, EstQuantity 는 실측 근거로 제외)
- [x] 삭제 마스터 영향 읽기 전용 진단 + ViewShipment DDL 제안 문서 (2026-10-19: 신규 DELETE API 제외)
- [x] 출고 마스터 OrderYearWeek·출고일 차수 범위 검증 (52→01 경계 테스트 포함)
- [x] scan:integrity G1~G4 추가·운영 실행, 15·16·36차 골든 총매출 테스트
- [ ] 기존 불일치 데이터 수리 — 사장님 승인 대기 (쓰기 금지)

## 2026-08-26 후속 — 수량 방향별 확정 유지 저장

- [x] 기존 수량은 확정 상태 유지, 실제 증가에만 부족재고 검사, 감소도 변경 품목 재고 반영
- [x] 작업 소유자 보호 V2 스크립트·웹 호환부와 로컬 SQL 동시 실행 시험
- [x] 전체 ERP/견적 검사, 실제 API+격리 SQL 및 가짜 자료 브라우저 저장·업체 유지 검사
- [x] 후속 배포 지시에 따라 최신 기준 코드 통합·전체 검사·운영 SELECT 사전 확인
- [!] 운영 소유자 보호 설치·배포: EXE/웹/예약 작업 저장 중지 구간 확인 대기

상세: `docs/work-reports/2026-08-26_estimate-directional-quantity-verification.md`.
배포 지시는 받았으며, 운영 반영에는 EXE/웹/예약 작업의 쓰기 중지 구간 확인이 필요하다.

## 2026-08-26 후속 — 견적서 업체 선택·재조회 통일

- [x] 일반 조회와 수량·단가·통합·등록·삭제·품목정보 저장 후 공통 재조회, 검색 초안/적용 업체 분리
- [x] 늦은 응답·오류·저장 완료·편집 기준값 갱신의 다른 업체 덮어쓰기 방지 및 로컬 검사
- [!] 후속 화면 클릭 시험: Chrome 새 탭 연결 오류로 미완료. 실제 페이지 함수를 가짜 응답으로 실행한 검사는 별도 완료
- [ ] 운영 반영·실제 저장 검증: 이번 요청은 수정만이며 실행하지 않음. 새 지시 없이 진행 금지

상세: `docs/work-sessions/2026-08-26_estimate-category-buttons.md`의 질문 4. 아래 기존 Phase 진행률과 별개인 후속 수정이며, 이전 작업/잔여 위험을 완료로 바꾸지 않는다.

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

### Phase 9 — 매출이익 보고서 정밀화 (2026-07-09 ~ 07-13)
- [x] 기초·기말재고 자동평가 엑셀 원본 방식 전환 (`525ef33`)
- [x] 그외통관비(H)·포워딩(S) 자동계산 + 화면 임베드 입력 (`42bd474`/`46dd199`/`8385575`)
- [x] ProductStock 스냅샷 드리프트 롤링계산 + `StockMaster.isFix` bit→tinyint 근본수정 (`a90c36c`)
  — 이 수정 전까지 "시작재고 앵커" 기능이 한 번도 정상 동작한 적 없었음
- [x] 컬럼 표시/숨김·프리셋·차수비교뷰·"확인 필요" 배너 (`97cc6b0`/`3ccfcde`/`f8147fd`/`1248066`)
- [x] 입력칸 포커스 튕김 버그(EditCell 컴포넌트 호이스트) 수정 (`bc7828f`)
- [x] 견적서관리 확정차수 단가수정 사이클 버그 수정 (`be76cda`)
- [!] **콜롬비아 그외통관비 이중 소스 불일치** — 사용자 확인 전 보류 (백상창고료 410/460원,
  겸역차감 누락 여부, 국내운송비 정액 vs 트럭대수 공식). 상세: PROGRESS.md 2026-07-13 세션 미결 이슈
- [ ] 재고 스냅샷 드리프트 근본 해결(구조적, 이번 세션은 완화책만) — 카테고리별 실사 앵커 입력 지속 필요

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
| Phase 9 | 7 | 6 | 0 | 1(블로킹) |
| **합계** | **48** | **35** | **0** | **13** |

*Claude 가 작업 완료 시 이 표를 자동 업데이트 (73% 진행)*

## ECOUNT 373 프로그램 이관 (2026-10-21 재개)
- [x] 0단계: 재개 문서·인벤토리 복사, PR1161 운영회귀 확인(API 2,217행/34구역)
- [x] 1단계-릴리스1: 33화면 대상 DOM 증거 1,019버튼 분류, ACTION_IDS 누락 11데이터셋 수정 (PR #1164, d3c33993 배포)
- [!] 1단계-릴리스2: 33화면 기간 프리셋·새창 원본 관측 후 자리표시 708개 활성화 — 크롬 ECOUNT 로그인 필요(차단)
- [ ] 2단계: 미관측 340 프로그램 P008~P019 → P020~P027 → P028~P039 → P040~P051 → P052~P059 → P005~P007
- [ ] 3단계: 외부 API 57버튼 UI+저장계약+합성응답
