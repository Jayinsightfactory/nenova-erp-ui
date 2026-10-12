# Nenova ERP 컨트롤 타워 운영 설계

작성일: 2026-08-07

## 목적

기존 기능의 완성도 향상, 신규 메뉴 개발, 실제 웹·DB·nenova.exe·MOYI 검증을 여러 세션에서 동시에 진행하되, 같은 파일이나 같은 ERP 원장을 서로 덮어쓰지 않도록 관리한다.

이 문서는 코드 구현 방식이 아니라 세션 분담, 작업 상태, 검증, 병합, 배포의 단일 운영 규칙이다.

## 핵심 원칙

1. 사용자는 각 세션에 직접 지시할 수 있다.
2. 각 세션은 별도 브랜치와 별도 worktree를 사용한다.
3. 구현 세션과 검증 세션을 분리한다.
4. 같은 DB 원장 쓰기는 동시에 실행하지 않는다.
5. master 병합과 운영 배포는 컨트롤 타워 세션만 수행한다.
6. 대화 기억이 아니라 GitHub Issue/PR, 작업 MD, 테스트 결과를 공유 기준으로 삼는다.
7. ERP 기능은 dnSpy/DB 근거와 side-effect matrix가 없는 상태에서 구현 완료로 보지 않는다.
8. 모든 작업은 최신 공식 근거, 미래 변화 시나리오, 운영 데이터 검증과 선제 보완 검토를 포함한다.
9. 운영 DB·최신 nenova.exe·실제 브라우저·MOYI/외부연동 중 하나라도 확인하지 못하면 `SMOKE_VERIFIED` 또는 100% 완료로 표시하지 않는다.

세부 기준은 [`docs/FUTURE_READY_ENGINEERING.md`](FUTURE_READY_ENGINEERING.md)를 따른다.

## 역할

### 컨트롤 타워

- 사용자 요청을 작업 ID로 분해
- 기존 미완료 기능과 신규 기능을 함께 우선순위화
- 세션별 파일·DB 범위 할당
- 작업 간 의존성 관리
- 병합 전 충돌 및 계약 검사
- 통합 테스트·실제 스모크 테스트·배포 승인

컨트롤 타워는 여러 기능을 직접 구현하는 세션이 아니다. 구현 세션의 결과를 통합하고 충돌을 막는 릴리스 관리자다.

### 구현 세션

하나의 도메인 또는 명확한 기능 범위만 수정한다. 공통 API·계산식·DB 계약이 필요하면 먼저 컨트롤 타워에 제안하고 승인된 범위만 변경한다.

### 조사 세션

dnSpy CLI, View/SP, DB schema, read-only probe를 담당한다. 운영 DB INSERT/UPDATE/DELETE를 수행하지 않는다.

### 검증 세션

다른 세션의 결과를 대상으로 테스트한다. 가능하면 구현자가 아닌 별도 세션이 맡는다.

### 배포 세션

빌드, GitHub Actions, Cafe24, /api/ping, 실제 브라우저 및 MOYI 확인만 담당한다. 기능 코드를 수정하지 않는다.

## 권장 동시 세션 구성

~~~text
컨트롤 타워
 ├─ 기존 기능 완성도 감사
 ├─ 재고·입고·분배·확정 구현
 ├─ 매출이익·도착원가·불량차감 구현
 ├─ 자연어 품목매칭 구현
 ├─ MOYI·Drive·외부연동 구현
 └─ 통합 QA·배포 검증
~~~

세션은 화면 단위가 아니라 DB 원장과 변경 책임 단위로 나눈다. 예를 들어 재고 세션과 분배 세션이 같은 차수의 ProductStock 또는 ShipmentDetail을 동시에 수정하면 안 된다.

## 병렬 가능 범위

| 작업 | 병렬 가능 | 직렬화해야 하는 범위 |
|---|---|---|
| dnSpy/DB 조사 | 가능 | 운영 DB 쓰기 금지 |
| 웹 UI 레이아웃 | 가능 | 같은 컴포넌트 파일 |
| MOYI 조회 UI | 가능 | 재고 계산식 직접 복제 금지 |
| 자연어 검색 후보 정렬 | 가능 | Product 원본명 수정 금지 |
| Drive/외부 API | 가능 | ERP 핵심 원장 직접 수정 금지 |
| 재고조정 | 제한 | Product, StockHistory, ProductStock, StockMaster |
| 출고분배 | 제한 | Order*, Shipment*, ShipmentDate, ShipmentFarm |
| 확정/확정취소 | 불가에 가까움 | 관련 차수의 출고·재고·이력 전체 |
| 운영 DB 테스트 | 제한 | 같은 연도·차수·품목·업체 업무키 |
| 병합/배포 | 단일 세션 | master, 운영 서버, GitHub Actions |

ERP 쓰기 작업의 기본 업무키는 다음을 사용한다.

~~~text
OrderYear + OrderWeek + CustKey + ProdKey
~~~

재고조정처럼 Product.Stock과 후속 ProductStock 계산을 일으키는 기능은 품목·차수가 달라도 전역 재고에 영향을 줄 수 있으므로, 실제 운영 DB 쓰기 시에는 재고 쓰기 세션 하나만 활성화한다.

## 작업 상태

~~~text
PLANNED
  → EVIDENCE
  → CONTRACT_READY
  → IMPLEMENTING
  → LOCAL_TESTED
  → PARITY_TESTED
  → PR_READY
  → INTEGRATED
  → DEPLOY_PENDING
  → DEPLOYED
  → SMOKE_VERIFIED
~~~

다음 상태로 넘어갈 조건:

- EVIDENCE: dnSpy/DB 구조 확인 결과가 있음
- CONTRACT_READY: 계약 JSON, 부작용 표, fixture가 있음
- LOCAL_TESTED: 해당 세션 테스트와 빌드가 통과
- PARITY_TESTED: nenova.exe 또는 read-only DB 비교 완료
- INTEGRATED: 컨트롤 타워가 병합하고 전체 검증 완료
- SMOKE_VERIFIED: 배포 후 실제 웹 화면·API·필요한 전산 반영까지 확인

추가 완료 게이트:

- 최신 기술·보안·플랫폼 변화 조사와 적용/비적용 이유가 기록됨
- 신규 업체·테넌트·데이터 증가·외부 서비스 교체 시나리오가 검토됨
- 운영 데이터 대조 결과와 미확인 범위가 명시됨
- 선제 보완사항의 위험·범위·승인 상태가 기록됨

## 기존 기능 완성도 감사 방식

기존 작업은 다음 표로 관리한다.

| 항목 | 확인 내용 |
|---|---|
| 기획 | 사용자 요구사항과 일치하는가 |
| 구현 | 코드가 존재하는가 |
| DB | 저장값이 실제 원장에 남는가 |
| dnSpy | nenova.exe 저장 순서와 같은가 |
| 웹 | 화면 입력·조회·수정이 되는가 |
| 전산 | nenova.exe에서 결과가 보이는가 |
| 회귀 | 견적·매출·재고·MOYI에 영향이 없는가 |
| 배포 | 운영 버전에 반영되었는가 |
| 실사용 | 실제 업무 데이터로 재조회했는가 |

따라서 기존 기능의 구현 완료와 운영 완료를 분리한다.

## 실제 테스트 운영

### 읽기 테스트

다음은 여러 세션에서 병렬로 가능하다.

- 실제 웹 페이지 조회
- API GET
- DB SELECT
- dnSpy 문자열·View·SP 확인
- 엑셀/보고서 비교
- MOYI 읽기 화면 확인

### 쓰기 테스트

다음은 한 번에 하나만 실행한다.

- 주문 등록
- 출고 분배
- 확정/확정취소
- 재고조정
- 견적서 등록
- 불량차감 등록
- 운영 데이터 수정

쓰기 테스트는 반드시 테스트 대상의 연도·차수·업체·품목을 보고서에 남기고, 저장 전후 ViewOrder, ViewShipment, ShipmentDate, ProductStock, StockHistory, Estimate를 재조회한다.

## 사용자 지시 방법

사용자는 각 세션에 아래 형식으로 지시한다.

~~~text
[작업 ID] STOCK-001
[목적] 차수별 확정재고와 현재분배재고 통합 화면
[범위] 재고관리 웹 화면과 읽기 API
[수정 금지] ShipmentDetail, Estimate 직접 수정 금지
[검증] dnSpy FormStockView/FormStockAdd, DB read-only probe, 실제 브라우저
[완료 기준] 테스트·패리티·변경 파일·남은 이슈 보고
~~~

사용자가 별도 세션에 직접 추가 지시할 때도 작업 ID를 유지한다. 작업 범위를 바꾸면 기존 지시를 덮어쓰지 말고 SCOPE_CHANGE로 보고하게 한다.

## 컨트롤 타워가 각 세션에 보내는 공통 지시

~~~text
작업 ID와 브랜치를 먼저 확인하세요.
AGENTS.md, .claude/CLAUDE.md, 관련 계약 JSON, DB_STRUCTURE.md를 읽으세요.
수정 전 side-effect matrix와 dnSpy/DB 근거를 작성하세요.
운영 DB 쓰기는 승인 없이 하지 마세요.
다른 작업 범위의 파일과 DB 테이블은 수정하지 마세요.
종료 시 작업 템플릿의 모든 항목과 테스트 결과를 보고하세요.
~~~

## 병합·배포 규칙

1. 구현 세션은 master에 직접 push하지 않는다.
2. 각 작업은 별도 branch/worktree에서 완료한다.
3. 컨트롤 타워가 변경 파일과 DB 범위를 확인한다.
4. QA 세션이 통합 브랜치에서 전체 ERP guard를 실행한다.
5. 아래 명령이 모두 통과한 뒤 병합한다.

~~~powershell
npm run test:erp-contract
npm run test:nenova-dnspy-evidence
npm run test:erp-manifest -- --changed-from HEAD^
npm run guard:erp-writes -- --changed-from HEAD^
npm run build
~~~

6. 배포 세션만 운영 배포한다.
7. 배포 후 실제 웹·API·nenova.exe·MOYI 결과를 확인한다.

## 현재 네노바 작업에 적용할 우선순위

1. 기존 메뉴 완성도 감사표 작성
2. 재고·입고·대체입고 원장 계약 확정
3. 재고관리 웹 화면 구현
4. MOYI 차수별 재고 조회 연결
5. 자연어 품목 매칭 이력 통합
6. Drive/외부 파일 기능 분리 구현
7. 기존 주차별 매출이익·불량차감·견적서 회귀검증
8. 통합 테스트 후 단일 배포

Drive나 MOYI 같은 외부연동은 ERP 원장 세션과 병렬 진행할 수 있지만, 외부연동 세션이 ProductStock, ShipmentDetail, Estimate를 직접 수정하지 않도록 계약으로 제한한다.

## 모델·권한 사전배정

하위 작업의 모델 선택과 승인 없는 실행 방식은 [`CODEX_SUBTASK_ORCHESTRATION.md`](CODEX_SUBTASK_ORCHESTRATION.md)를 따른다. 컨트롤 타워는 하위 작업 생성 전에 권한 등급, 모델 역할, 수정 범위, 입력 자료, 의존성, 테스트와 완료 기준을 확정한다. 하위 작업에서 승인 요청이 발생하도록 두지 않으며, 예상하지 못한 권한은 `NEEDS_MAIN_PREFLIGHT`로 회수해 컨트롤 타워가 처리한다.
