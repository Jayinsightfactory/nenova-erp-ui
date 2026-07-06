# SOLUTION_LINK — nenova-erp-ui (네노바 통합 솔루션의 ERP 코어)

> 마스터 문서: `C:\Users\USER\NENOVA_SOLUTION_AUDIT.md` (전체 그림·우선순위는 거기 참조)
> Cursor 작업 시 이 파일 + `CLAUDE.md`를 항상 컨텍스트에 포함할 것.

## 이 repo의 역할
꽃 수입·유통 ERP의 웹 프런트+API (nenovaweb.com 운영 중, 완성도 ~80%).
**솔루션 내 위치: 모든 자동화의 최종 수신처** — 카톡 파이프라인, talkhub 승인, orbit 인사이트가 결국 이 ERP의 데이터를 읽고 쓴다.

## 연결 지점 (이 repo 기준 in/out)

| 상대 | 방향 | 인터페이스 | 상태 |
|---|---|---|---|
| nenova.exe (전산) | 공유 | MSSQL 공존 (`_new_` 테이블 → 검증 후 복사) | ✅ |
| nenovakakao | IN | `POST/PATCH /api/shipment/stock-status`, `GET /api/master` — **카톡 자동입력 수신 (Phase 3)** | ❌ 미구현 |
| 구글시트(카카오) | IN | `/api/kakao/summary`, `/api/orders/kakao-audit` (읽기) | ✅ |
| 이카운트 | OUT | `/api/ecount/*` 판매/구매/분개 push | ⚠️ 단방향 (역검증 없음) |
| n8n | OUT | `/api/automation/*` read-only 프록시 (토큰) | ✅ |
| talkhub | OUT(계획) | 승인요청 → talkhub 컨펌 카드, 승인결과 웹훅 수신 | ❌ 기획만 |
| orbit | OUT(계획) | ERP 지표 → orbit 대시보드/그래프 | ⚠️ nenova-dashboard 일부 |

## 이 repo에서 작업할 때의 목적 (우선순위)
1. **P1: 카톡 자동입력 수신 준비** — stock-status API에 자동입력용 감사로그/출처(source='kakao') 필드, 실패 시 보류 큐.
2. **P2: 이카운트 역검증** — EcountMatchAudit 테이블 + 비교 화면 (`NENOVA_ECOUNT_ERP_MATCH_AUDIT.md` 설계 있음).
3. **P2: 미완 기능** — 사용자 CRUD, 주문수정, 코드관리 저장, ShipmentFarm.
4. **P3: talkhub 승인 연동** — 모바일 주문신청 승인을 talkhub 컨펌으로 위임하는 어댑터.

## 하네스에서의 역할
이 repo = ORBIT 하네스의 **도구·실행 계층 + 권한 격리**(`ORBIT_ORCHESTRATION_HARNESS.md` §2·§5). 에이전트의 EXECUTE 단계 도구가 여기 API.
- 조회 API = PLAN/EXECUTE의 read 도구 (Orbit Flow 컨텍스트 보조)
- 쓰기는 `_new_` 테이블 격리 → 실제 운영 테이블 직접 쓰기 금지 (= 하네스 권한 스코프). 확정은 VERIFY 통과 + talkhub 컨펌 후.
- 감사로그에 actor(사람/에이전트/카톡) 필드 — 하네스 관찰성(§7).

## 데모 자산 (이 repo)
- `public/demo/agent-api-test.html` — 에이전트 API 테스트 콘솔 (읽기 전용, 영업 시연용). 솔루션 네이밍: 이 repo = **Nenova ERP** (ORBIT 스위트의 1번 고객 레퍼런스).

## 작업 규칙 (요약 — 상세는 CLAUDE.md/DB_STRUCTURE.md)
- `ShipmentDetail`에 isDeleted 없음 (쿼리 시 500). Master/Product/Customer에는 있음.
- `OrderMaster.Manager`는 **UserID**('admin')여야 함 — UserName 넣으면 전산 분배 그리드에서 거래처 사라짐.
- `OrderYearWeek`는 연도+대차수(예: '202623') — 세부차수 8자리로 쓰면 견적서관리 누락.
- 전산과 공유하는 테이블 직접 쓰기 금지 → `_new_` 테이블 경유. 문제 발생 시 `/admin/distribute-repair`.
- 품목 매칭 확장은 `displayName.js INPUT_ALIAS_TO_EN` + `parse-paste KO_EN_KEYWORDS` 사전으로 (웹·챗봇 공통).
