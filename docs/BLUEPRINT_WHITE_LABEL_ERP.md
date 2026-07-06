# 화이트라벨 ERP 프로젝트 청사진

**작성일:** 2026-06-16  
**대상:** `nenova-erp-ui` (nenovaweb)  
**목적:** 파일·코드 분류, 규격화, **다른 업체에 동일 기능 이식 시 수정 지점을 명확히** 하는 설계 청사진

> 관련: [tenant.nenova.example.json](../config/tenant.nenova.example.json) · [tenant.schema.json](../config/tenant.schema.json) · [DB_STRUCTURE.md](DB_STRUCTURE.md) · [NENOVA_PROJECT_PLAN_STATUS.md](NENOVA_PROJECT_PLAN_STATUS.md)

---

## 1. 한 줄 요약

현재 프로젝트는 **꽃 수입 도매 ERP + nenova.exe 정합**이 한 몸으로 엮여 있다.  
다른 업체에 넣으려면 **① 테넌트 설정 ② 업종 규칙 ③ 레거시 어댑터** 세 층으로 나누고, UI·API는 **도메인 모듈** 단위로 쪼개야 한다.

---

## 2. 현재 상태 진단

| 항목 | 현황 | 화이트라벨 리스크 |
|------|------|-------------------|
| 규모 | Pages ~90, API ~133, lib ~117, scripts ~156 | 스크립트·문서 산재 |
| UI | `estimate.js`·`paste.js` 각 4,000줄+ | 테마/기능 교체 어려움 |
| 컴포넌트 | 18개 (대부분 로직은 pages에) | 재사용·교체 불가 |
| i18n | 한국어 키 기반, 커버리지 낮음 | 다국어·다업체 문구 불가 |
| DB | MSSQL 단일 스키마, SP 직접 호출 | 스키마는 테넌트별 DB 분리 가정 |
| 브랜딩 | 코드·이미지·도메인 하드코딩 | 즉시 교체 불가 |
| 테스트 | lib 불변식 37건 (Node 단위) | 페이지·API 미커버 |

---

## 3. 파일 분류 체계 (Taxonomy)

모든 경로는 아래 **등급(A~E)** 중 하나로 태깅한다. (향후 `docs/FILE_INDEX.md` 또는 CI 린트로 관리)

### A. 제품 코어 (Product Core) — 업체 무관, 이식 필수

| 경로 | 역할 |
|------|------|
| `lib/db.js` | DB 풀, 트랜잭션 |
| `lib/auth.js`, `lib/useApi.js` | 인증·클라이언트 API (테넌트명만 설정화) |
| `lib/withActionLog.js` | 쓰기 감사 |
| `lib/orderUtils.js` | 주문 차수·단위 정규화 |
| `lib/shipmentDetailWriteGuard.js` | 출고 상세 쓰기 가드 |
| `lib/shipmentFixReconcile.js`, `lib/shipmentFixGuards.js` | 확정·재고 정합 |
| `lib/estimateInvariants.js` | 견적 표시 규칙 |
| `lib/pivot*.js`, `lib/freightCalc.js` | 통계·운임 계산 |
| `pages/api/orders/*`, `pages/api/shipment/*` (핵심) | REST API |
| `__tests__/*` | 불변식 테스트 |

### B. 업종 어댑터 (Industry Adapter) — 꽃 수입 기본, 업종별 교체

| 경로 | 교체 시 |
|------|---------|
| `lib/displayName.js` | 품목 표기·매칭 규칙 |
| `lib/farmKoreanNames.js` | 농장 별칭 |
| `lib/parsePaste*.js` | 붙여넣기 파서 |
| `lib/catalog*.js` | 카탈로그·PPTX |
| `lib/workflowConfig.js` | 카톡방·현장 흐름 |
| `data/category-overrides.json` | 국가·꽃 카테고리 |
| `data/order-mappings*.json` | 붙여넣기 매핑 |

### C. 테넌트 설정 (Tenant Config) — **업체마다 1세트**

| 항목 | 현재 위치 | 목표 위치 |
|------|-----------|-----------|
| 회사정보·인쇄 헤더 | `lib/estimatePrintHeader.js` | `config/tenant.{id}.json` + `lib/tenant.js` |
| 로고 | `public/nenova-logo*.png` | `public/tenants/{id}/` |
| 메뉴 | `components/Layout.js` MENU_ITEMS | `config/menu.{id}.json` |
| 도메인·쿠키명 | `lib/auth.js`, 배포 설정 | env + tenant json |
| 기능 on/off | (없음) | `tenant.features` |

예시: [config/tenant.nenova.example.json](../config/tenant.nenova.example.json)

### D. 레거시 EXE 어댑터 (Legacy Adapter) — Nenova 전용, 선택 적용

| 경로 | 내용 |
|------|------|
| `docs/NENOVA_EXE_*` | exe 패치·정합 문서 |
| `usp_Distribute*`, `usp_ShipmentFix` 호출부 | SP 이름을 tenant.legacyAdapter 로 |
| UI 문구 "exe 정합" | feature flag `shipmentExeReconcile` |

**다른 업체에 exe가 없으면** D층 전체 비활성 + 웹 단독 쓰기 경로만 사용.

### E. 운영·일회성 (Operations) — 제품 배포물에서 분리 권장

| 경로 | 정책 |
|------|------|
| `scripts/probe-*` | 진단 → `ops/diagnostics/` 보관, 주차별 파일은 아카이브 |
| `scripts/fix-*`, `repair-*`, `rollback-*` | `ops/repair/` + README에 전제·롤백 명시 |
| `scripts/bulk-*`, `sync-*` | `ops/maintenance/` |
| `docs/work-reports/*` | 운영 일지 (제품 문서와 분리) |
| `.claude/tasks/*` | 에이전트 작업 (배포 제외) |

---

## 4. 코드 레이어 (Layer Model)

```
┌─────────────────────────────────────────────────────────┐
│ L5  UI          pages/*, components/*                   │
├─────────────────────────────────────────────────────────┤
│ L4  API         pages/api/*  (얇게 — 위임만)             │
├─────────────────────────────────────────────────────────┤
│ L3  Application lib/*Service, use-case orchestration    │
│                 (목표: pasteService, estimateService…)   │
├─────────────────────────────────────────────────────────┤
│ L2  Domain      orderUtils, estimateInvariants, pivot…  │
├─────────────────────────────────────────────────────────┤
│ L1  Infra       db, auth, useApi, withActionLog         │
├─────────────────────────────────────────────────────────┤
│ L0  Tenant      lib/tenant.js ← config/tenant.*.json    │
└─────────────────────────────────────────────────────────┘
         │ optional │
         ▼          ▼
   Industry B    Legacy D (exe SP)
```

**규칙**

1. `pages/api/*` — SQL 50줄 이상이면 `lib/`로 이동  
2. `pages/*.js` — 800줄 넘으면 `components/{domain}/` + `lib/{domain}/` 분리  
3. Nenova 문자열 — `lib/tenant.js`의 `getCompany()`, `getBranding()` 만 통과  
4. SP 호출 — `lib/legacyAdapter.js` 한 곳에서 tenant 설정으로 분기  

---

## 5. 목표 디렉터리 구조 (Target Layout)

현재 → 단계적 이전. **한 번에 옮기지 않음.**

```
nenova-erp-ui/
├── config/
│   ├── tenant.schema.json
│   ├── tenant.nenova.json          # 실제 배포 (gitignore 가능)
│   ├── tenant.nenova.example.json
│   └── menu.nenova.json            # (Phase 2)
├── public/
│   └── tenants/
│       └── nenova/
│           ├── logo.png
│           └── logo-estimate.png
├── src/                            # (Phase 3, 선택) pages/lib 이전
│   ├── domain/
│   │   ├── orders/
│   │   ├── shipment/
│   │   ├── estimate/
│   │   ├── stock/
│   │   ├── catalog/
│   │   └── sales/
│   ├── infra/
│   └── tenant/
├── pages/                          # 당분간 유지 (Next Pages Router)
├── lib/
├── components/
│   ├── layout/
│   ├── orders/
│   ├── shipment/
│   └── estimate/
├── ops/                            # scripts/ 에서 E등급 이전
│   ├── diagnostics/
│   ├── repair/
│   └── maintenance/
├── docs/
│   ├── product/                    # 제품 설계·API·불변식
│   └── tenants/
│       └── nenova/                 # Nenova 운영·exe 문서
└── __tests__/
```

---

## 6. 도메인 모듈 맵 & 커스터마이즈 포인트

| 모듈 | UI | API/lib | 다른 업체 시 수정 |
|------|-----|---------|-------------------|
| **주문** | `orders/paste`, `new`, `paste-template` | `api/orders`, `orderUtils` | 파서(B), 매핑 JSON(C), 메뉴 |
| **출고** | `shipment/distribute`, `week-pivot` | `api/shipment`, `shipmentImport` | exe 어댑터(D), 차수 라벨(C) |
| **견적** | `estimate.js` | `api/estimate`, `estimatePrint*` | 회사 헤더(C), 인쇄 양식 |
| **재고** | `stock`, `shipment/stock-status` | `api/stock`, `api/shipment/stock-*` | SP 유무(D) |
| **카탈로그** | `catalog/` | `api/catalog`, `lib/catalog*` | 로고·슬라이드 템플릿(C) |
| **영업/채권** | `sales/*` | `api/sales` | 이카운트 연동 on/off |
| **마스터** | `master/*` | `api/master` | 거의 A (공통) |
| **관리** | `admin/*` | `api/admin` | 감사 로그 공통 |
| **모바일/챗** | `m/*` | `api/m`, `lib/chat` | 스키마 힌트·Anthropic 키 |

---

## 7. Nenova 하드코딩 → 설정화 매핑

| 하드코딩 | 파일 | 설정 키 |
|----------|------|---------|
| `(주)네노바 / 김원배` | `estimatePrintHeader.js` | `company.legalName` |
| 사업자번호·주소·계좌 | 동일 | `company.*` |
| `nenova ERP` | `Layout.js` | `branding.appTitle` |
| `/nenova-logo.png` | 여러 | `branding.logoPath` |
| `nenovaToken` | `auth.js` | `auth.cookieName` |
| `nenova2026secretkey` | `auth.js` | **env only** (기본값 제거) |
| `nenovaweb.com` | smoke, chat | `domains.web` |
| 카톡방 이름 | `workflowConfig.js` | `dataOverrides` 또는 tenant json |
| 장미 품종 한글맵 | `displayName.js` | `industry.vertical`별 rules 파일 |

---

## 8. scripts 정리 규칙

### 명명 규칙 (신규)

| 접두사 | 용도 | 배포 포함 |
|--------|------|-----------|
| `probe-` | 읽기 전용 진단 | ops만 |
| `repair-` | 데이터 복구 (apply 플래그) | ops + 승인 절차 |
| `sync-` | live↔DB 동기화 | ops |
| `bulk-` | 대량 배치 | ops |
| `test-` / `__tests__` | 자동 검증 | CI |

### 정리 액션 (권장)

1. **아카이브:** `26-02`, `25-01` 등 주차 고정 파일 → `ops/archive/2026-06/`  
2. **통합:** `lib/db.js` import 안 하는 스크립트 → 수정 또는 폐기  
3. **인덱스:** `ops/README.md`에 스크립트 표 (목적·위험도·--apply 여부)  
4. **금지 목록:** `docs/STOCK_INTEGRITY_DESIGN.md` 운영 금지 스크립트 유지  

---

## 9. 문서 분류

| 종류 | 위치 (목표) | 예 |
|------|-------------|-----|
| 제품 설계 | `docs/product/` | 불변식, API 계약, 레이어 |
| 테넌트 운영 | `docs/tenants/nenova/` | exe 패치, 주차별 복구 |
| 작업 일지 | `docs/work-reports/` | 세션 기록 |
| 마이그레이션 SQL | `docs/migrations/` | 버전·날짜 접두사 |
| ADR | `docs/adr/` | 구조 결정 기록 |

---

## 10. 다른 업체 온보딩 체크리스트

새 업체 `tenantId = acme` 배포 시:

### 필수 (1일)

- [ ] `config/tenant.acme.json` 작성 (schema 검증)
- [ ] `public/tenants/acme/` 로고
- [ ] `.env` DB 연결 (별도 DB 권장)
- [ ] `company.*` 인쇄·견적 헤더 확인
- [ ] `branding.appTitle`, 메뉴 노출 (`features`)

### 업종 (3~5일)

- [ ] `displayName` / 카테고리 rules (B층)
- [ ] 붙여넣기 파서·매핑 (또는 기능 off)
- [ ] 차수·단위 명칭 (`industry.timeBucketLabel`)

### 레거시 (선택)

- [ ] exe 없음 → `legacyAdapter.enabled: false`, SP 대체 경로 검증
- [ ] exe 있음 → SP 이름·테이블 매핑 문서화

### 통합 (선택)

- [ ] 이카운트 / 회계 / n8n / Anthropic 키 per-tenant env

---

## 11. 단계별 로드맵

### Phase 0 — 문서·분류 (현재, 1주)

- [x] 본 청사진 + tenant schema 예시
- [x] **테넌트 스튜디오** 샘플 페이지 [`/demo/tenant-studio`](../pages/demo/tenant-studio.js) — 입력 즉시 UI 미리보기 + JSON export
- [ ] `docs/FILE_INDEX.md` — A~E 태그 1차 (핵심 경로만)
- [ ] `ops/README.md` — scripts 위험도 표

### Phase 1 — 테넌트 설정층 (2~3주)

- [ ] `lib/tenant.js` — `getTenant()`, `getCompany()`, `getBranding()`
- [ ] `estimatePrintHeader.js` → tenant 읽기
- [ ] `Layout.js` title/logo → tenant
- [ ] auth cookie명 env화, **기본 JWT secret 제거**

### Phase 2 — God page 분리 (4~6주)

- [ ] `paste.js` → `components/orders/*` + `lib/orders/pasteService.js`
- [ ] `estimate.js` → `components/estimate/*` + `lib/estimate/*`
- [ ] `config/menu.nenova.json` + 동적 메뉴

### Phase 3 — ops 분리 & CI (2주)

- [ ] `scripts/` → `ops/` 이동, package.json 스크립트 경로 수정
- [ ] `test:all` CI 게이트 (배포 전)

### Phase 4 — 두 번째 테넌트 파일럿 (검증)

- [ ] demo tenant (mock DB 또는 스키마 복제)
- [ ] exe 없는 모드로 주문·출고·견적 E2E

---

## 12. ADR 요약

| ID | 결정 | 이유 |
|----|------|------|
| ADR-001 | DB는 테넌트별 인스턴스(스키마 분리), 코드는 단일 repo | exe·SP 결합도 |
| ADR-002 | Pages Router 유지, `src/` 이전은 Phase 3 선택 | 리스크 최소화 |
| ADR-003 | 레거시 exe는 adapter 플러그인, 코어에 섞지 않음 | 화이트라벨 |
| ADR-004 | 불변식 테스트(`__tests__`)는 이식 시 반드시 통과 | 운영 사고 방지 |
| ADR-005 | scripts는 제품 루트에서 `ops/`로 격리 | 배포물 명확화 |

---

## 13. 즉시 착수 가능한 작업 (우선순위)

1. **`lib/tenant.js` + `estimatePrintHeader` 설정화** — 인쇄물부터 체감  
2. **`estimate.js` / `paste.js` 모달·패널만 components로 추출** — 이미 시작된 패턴 (`OrderRegisterDistributeModal`)  
3. **scripts 30일 미사용 probe → archive**  
4. **docs 내 비밀번호·키 스크럽** (work_history 등)  
5. **메뉴 JSON화** — 업체별 메뉴 on/off  

---

## 14. 참고 링크

- [WORK_RECORD_POLICY_2026-05-25.md](WORK_RECORD_POLICY_2026-05-25.md)
- [STOCK_INTEGRITY_DESIGN.md](STOCK_INTEGRITY_DESIGN.md)
- [ERP_COMPAT_INVARIANTS_2026-06-04.md](ERP_COMPAT_INVARIANTS_2026-06-04.md)
- [NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md](NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md)

---

*다음 단계: Phase 1 착수 시 `lib/tenant.js` 구현 + `estimatePrintHeader` 연동 PR 권장.*
