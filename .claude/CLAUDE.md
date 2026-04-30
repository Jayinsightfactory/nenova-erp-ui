# CLAUDE.md — 프로젝트 컨텍스트 & 작업 규칙

> ⚠️ **이 파일을 항상 먼저 읽어라.** 대화 히스토리보다 이 파일이 우선이다.
> 🔗 도메인 규칙 상세: 프로젝트 루트 [`CLAUDE.md`](../CLAUDE.md) · DB 구조 [`docs/DB_STRUCTURE.md`](../docs/DB_STRUCTURE.md)
> 🤖 **에이전트 팀 활성화** (2026-04-29~): 다도메인/복잡 작업은 `nenova-orchestrator` 가 specialist 에 위임. 자세한 내용 [`.claude/agents/README.md`](agents/README.md) · 도입 배경 [`docs/AGENT_TEAM_ADOPTION.md`](../docs/AGENT_TEAM_ADOPTION.md)

---

## 📌 프로젝트 기본 정보

```
프로젝트명: nenova-erp-ui (Nenova ERP 웹)
목적: 네노바 꽃 수입·유통 ERP 웹/모바일 프런트 + 챗봇 + 운송기준원가
기술 스택: Next.js 16 (pages/), React 18, MSSQL(mssql), Anthropic SDK, Node.js 18+
저장소: GitHub Jayinsightfactory/nenova-erp-ui (master)
배포: Cafe24 VPS 172.233.89.171 → nginx → pm2(nenova-erp) → node web.js
도메인: https://nenovaweb.com
마지막 업데이트: 2026-04-24
```

---

## 🏗️ 아키텍처 & 구조 원칙

```
pages/
├── index.js, dashboard.js, login.js
├── orders/        ← 주문 (index/new/paste)
├── shipment/      ← 출고 (distribute/stock-status/view/history/week-pivot)
├── estimate.js    ← 견적서
├── freight.js     ← 운송기준원가 (BILL → 카테고리/품목 원가)
├── stock.js, warehouse.js, incoming.js, incoming-price/
├── master/        ← 거래처/품목/단가/코드
├── admin/         ← 사용자/주문신청/작업이력/세부카테고리
├── sales/, stats/, finance/, purchase/, ecount/
├── m/             ← 모바일 전용 16페이지 + 챗봇
└── api/           ← 대응 API 레이어

lib/
├── db.js          ← MSSQL 풀 + query/withTransaction
├── auth.js        ← JWT withAuth
├── freightCalc.js ← 운송원가 계산 (238 fixture test)
├── categoryOverrides.js ← 세부카테고리 파일 저장 (웹 전용)
├── displayName.js ← 한글 자연어명 자모 매칭
├── chat/          ← 챗봇 (schema/sqlagent/catalog/biz)
└── …

components/
├── Layout.js      ← PC 사이드바
└── m/MobileShell.js

data/              ← 런타임 파일 저장 (git 추적: order-mappings.json / ignore: category-overrides.json)
docs/              ← DB_STRUCTURE.md + migrations/*.sql
scripts/           ← paste-train* 학습 도구
```

**절대 바꾸지 않는 원칙:**
- [ ] **DB 가 정답, 웹이 맞춘다.** 웹에서 DB 스키마/자동 보정 시도 금지 (stable-13-14 이전 장애 이력)
- [ ] **환산 수량(Box/Bunch/Steam)은 한 행에 모두 저장됨.** 합산 금지 → `Product.OutUnit` CASE WHEN 으로 하나만
- [ ] **ShipmentDetail.OutQuantity 는 예외** — 단일값, 추가 환산 금지
- [ ] **PK 생성은 `safeNextKey` + `tryInsertWithRetry`** (MSSQL IDENTITY 아님, 전산 race)
- [ ] **isDeleted=0 / ShipmentMaster.isFix=1** 필터 필수
- [ ] **견적서 인쇄는 iframe srcdoc 방식** (Blob+window.open 부모탭 이탈)
- [ ] **카테고리 재분류는 웹 전용 오버라이드** (`data/category-overrides.json`) — Product.FlowerName 안 건드림

---

## 🎨 코드 스타일 & 컨벤션

```
파일명: kebab-case (pages/*), PascalCase (컴포넌트)
함수/변수: camelCase
DB 컬럼: PascalCase (OrderMasterKey, SdetailKey)
커밋 메시지: feat/fix/chore/refactor/train(scope): 내용 + Co-Authored-By
들여쓰기: 2 spaces
```

**사용 라이브러리:**
- 현재: `@anthropic-ai/sdk`, `formidable`, `jsonwebtoken`, `mssql`, `next`, `react`, `xlsx`
- **금지**: `xlsx-js-style` (Turbopack 빌드 실패)
- 추가 설치 전 반드시 사용자 승인

---

## 🚫 하지 말아야 할 것들

- [ ] DB 스키마 변경 — 마이그레이션 SQL 제안 후 사용자 SSMS 실행
- [ ] `git push --force` / `--no-verify` — 사용자 명시 요청 없이 금지
- [ ] `Product.FlowerName` UPDATE — 전산 호환 깨뜨림 (세부카테고리는 파일로)
- [ ] `autoDetectFlower` 재활성화 — 2026-04-22 비활성화 결정 유지
- [ ] `ShipmentDetail` 환산에 `OutUnit` 분기 — 13/14차 단일 공식 유지
- [ ] `SteamOf1Box=0` fallback 보정 API 로 — data/master 에서 교정
- [ ] 새 로직으로 "더 똑똑하게" 대체 — 13/14차 검증된 동작이 정답

---

## ✅ 작업 시작 전 체크리스트 (매 세션)

1. `.claude/CLAUDE.md` (이 파일) 읽기
2. `.claude/PLAN.md` → 현재 작업이 플랜에 있는지 확인
3. `.claude/PROGRESS.md` → 마지막 세션 상태 + 미결 이슈 확인
4. `git log master --oneline | head -10` → 최근 HEAD 파악
5. `git tag -l "backup-*" "dangling/*" "stable-*"` → 보존 태그 인지
6. DB 작업이면 `docs/DB_STRUCTURE.md` + `docs/migrations/*` 선행 참조
7. 수정 파일의 기존 패턴 파악 후 동일 방식으로 작업

---

## 💾 작업 종료 시 필수 저장 규칙

**모든 작업 세션이 끝날 때 반드시 아래 실행:**

### 1. `.claude/PROGRESS.md` 최상단에 세션 블록 추가
```
## [YYYY-MM-DD HH:MM] 세션 #N — 제목

### 작업 내용
- 커밋 SHA + 간단 설명

### 변경된 파일
- 경로: 변경 요약

### 다음 작업 예정
- …

### 미결 이슈 / 블로킹
- …
```

### 2. `.claude/PLAN.md` 상태 업데이트
- 완료: `[ ]` → `[x]`
- 블로킹: `[!]`
- 진행률 요약 표 자동 갱신

### 3. 중요 결정사항은 이 CLAUDE.md 또는 `memory/session_YYYY-MM-DD.md` 에 반영

### 4. GitHub push 여부 확인 (사용자 명시 요청 시만)

---

## 🔄 컨텍스트 복구 프롬프트

> 새 대화 시작할 때 붙여넣기:

```
.claude/CLAUDE.md, .claude/PLAN.md, .claude/PROGRESS.md 를 순서대로 읽고
현재 프로젝트 상태를 파악한 뒤 작업을 이어서 진행해줘.
과거 대화는 무시하고 이 MD 파일 기준으로 판단해.
이어서 docs/DB_STRUCTURE.md 와 루트 CLAUDE.md 의 도메인 규칙도 참조해.
```

---

## 🔖 주요 보존 태그 (GC 방지 + 원복점)

| 태그 | 용도 |
|---|---|
| `stable-13-14` | 13/14차 안정 기준점 (`81121fa`) — 롤백 시 diff 대상 |
| `backup-before-rollback-2026-04-21` | 이전 세션 백업 |
| `backup-before-recovery-20260422-1109` | dangling 복구 작업 전 원복점 (`b6189d0`) |
| `dangling/*` (8개) | worktree 커밋 GC 방지 (카테고리/GW-CW/단당라벨) |

---

## 📎 관련 참조

- `docs/DB_STRUCTURE.md` — 테이블/FK/트러블 회고 9건/쿼리 체크리스트
- `docs/migrations/*.sql` — 수동 실행 마이그레이션 (idempotent)
- `__tests__/freightCalc.test.js` — 238건 fixture (lib/freightCalc 수정시 필수 pass)
- 루트 `CLAUDE.md` — 도메인 규칙 상세 (출고일 계산, 진단 API 등)

*이 파일은 프로젝트의 단일 진실 소스(Single Source of Truth)입니다.*
