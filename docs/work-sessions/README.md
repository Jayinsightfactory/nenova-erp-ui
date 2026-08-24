# 네노바 작업 세션 사용법

각 Codex/Claude 세션은 하나의 업무 ID를 가지고 독립적으로 작업한다. 세션 간 대화 기억을 기대하지 않고, 이 디렉터리의 작업 보고서와 Git 브랜치를 공유 기준으로 사용한다.

## 세션별 질문·답변 백업 (기본)

대화가 끝나면 `docs/work-sessions/YYYY-MM-DD_{slug}.md`에 사용자 질문과 에이전트 답변을 요약해 남긴다. 목록은 `INDEX.md`. 규칙: `.cursor/rules/session-qa-log.mdc`. 스킬: `.cursor/skills/session-qa-backup/SKILL.md`.

새 채팅은 대화 기억이 아니라 최근 세션 md를 읽고 시작한다.

## 사용 순서

1. 작업 ID를 만든다.
2. 별도 브랜치/worktree를 만든다.
3. TEMPLATE.md를 복사해 작업 파일을 만든다.
4. 수정 파일과 DB 테이블 범위를 먼저 기록한다.
5. 구현·검증·보고를 진행한다.
6. SMOKE_VERIFIED 전에는 완료로 표시하지 않는다.

## 브랜치 예시

~~~powershell
git fetch origin
git worktree add ..\nenova-wt-STOCK-001 -b codex/STOCK-001-stock-ledger origin/master
~~~

다른 PC에서는 별도 clone을 사용한다. 같은 폴더를 여러 세션이 공유하지 않는다.

## 사용자 세션 지시문

~~~text
[작업 ID] STOCK-001
[목적] 차수별 확정재고·현재분배재고 화면
[허용 범위] pages/stock/ledger.js, pages/api/stock-ledger.js, lib/stockLedger.js
[DB 범위] 조회만: ProductStock, StockMaster, WarehouseDetail, ShipmentDetail, StockHistory
[금지] Estimate/ShipmentDetail 쓰기, 운영 DB 보정
[선행] dnSpy와 DB read-only probe
[완료 기준] 계약 테스트, ERP guard, build, 실제 브라우저 결과 보고
~~~

## 상태 의미

~~~text
PLANNED → EVIDENCE → CONTRACT_READY → IMPLEMENTING → LOCAL_TESTED
→ PARITY_TESTED → PR_READY → INTEGRATED → DEPLOY_PENDING
→ DEPLOYED → SMOKE_VERIFIED
~~~

## 종료 보고 필수 항목

- 작업 ID
- 브랜치
- 변경 파일
- 변경한 DB 테이블
- 변경하지 않은 DB 테이블
- dnSpy 근거
- DB probe 결과
- 테스트 결과
- 실제 웹/전산/MOYI 확인 결과
- 남은 문제와 다음 세션 지시사항

## 충돌 기준

다음 중 하나라도 겹치면 구현 세션을 병렬 실행하지 않고 컨트롤 타워의 순서를 따른다.

- 같은 파일
- 같은 API 쓰기 함수
- 같은 DB 테이블의 INSERT/UPDATE/DELETE
- 같은 OrderYear + OrderWeek + CustKey + ProdKey
- ProductStock 또는 Product.Stock을 갱신하는 SP 호출
- master 병합 또는 운영 배포

