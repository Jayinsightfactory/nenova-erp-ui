# 주문 업로드 재발 방지와 Stock gate busy 복구 — 2026-10-06

## 현재 상태

- 사용자 요청: `nenova.exe` 40-01 수국 확정해제의 `stock gate busy` 복구 및 웹 주문 엑셀 업로드 재발 방지.
- 작업 공간: `work/order-import-stock-gate-recovery`, 브랜치 `codex/order-import-stock-gate-recovery`, 기준 `d95c9c3d`.
- **운영 RUN 해제 완료**: 2026-10-06 09:56 사용자 명시 지시로 동일 토큰의 게이트 한 행만 조건부 해제했다. 소유 세션 종료는 확인하지 못했으며 이를 입증된 고아 잠금으로 기록하지 않는다. 상세 감사 기록은 아래 Operational release를 확인한다.
- 운영 EXE·SP·테이블 스키마·주문·출고·확정·재고 값은 유지했다. 내 업체 ADD도 CALC 제외로 수정했고 전체 검사와 빌드를 통과했다. PR #897 배포 진행 중; 배포 완료는 별도 확인 필요.

## 이어받을 때 고정할 사실

1. 전역 `NenovaStockWeekGate.GateKey=1`의 RUN이 다른 차수의 FIX/CANCEL까지 차단한다. 40-01 수국 자체 잠금으로 설명하지 않는다.
2. 2026-10-06 09:41:54 DB 시각 재조회: `Action=CALC`, `OrderYear=2026`, `OrderWeek=42-01`, `CalcProdKey=2992`, `OwnerSessionID=311`, `LockedAt=2026-10-05 16:39:17.480`, `PendingCalc=0`, `ProtocolVersion=2`.
3. ProdKey 2992는 `MiniCarnation Athena (연핑크)`, 콜롬비아카네이션이다. 소유 토큰은 로컬 복구 manifest에서 정확히 대조한다.
4. 최신 `order-import-final`은 `isMyCustomerOrderSource=true`와 `FINAL_SNAPSHOT` 절대수량 모드여서 **CALC를 건너뛴다**. `2026-09-16` 커밋 `00b73fc4`부터의 정책이다. 재고를 직접 바꾸지 않는 이 규칙은 유지한다.
5. 16:41:17 정재훈 `/api/orders` 최종본 업로드 성공 기록은 인접 로그일 뿐 잠금 생성자 증거가 아니다. 해당 payload의 prodKey 2992 매칭은 없었다. 개인 책임·특정 요청의 인과관계를 단정하지 않는다.
6. 재고 계산이 있는 별도 ADD/수정 경로의 pool 호출은 native GateEnter를 외부 transaction 밖에서 실행한다. timeout/attention이 native CATCH를 건너뛰면 RUN이 지속될 수 있는 구조적 위험이다. 이번 실제 중단의 요청·정확한 오류는 아직 입증하지 못했다.
7. 공용 SP ALTER와 시간 만료 자동 인수는 금지. 다른 소유자/WAIT_CALC를 웹이 지우지 않는다. 40-01 수국의 확정해제/재확정도 자동 수행하지 않는다.

## 근거

- 실제 CLI: `C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe --no-color -t FormOrderAdd "C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe"`.
- `btnSave_Click`: 주문 Master/Detail/History `ExcuteTransaction` 성공 후 신규 EditMode=1에서 `uspStockCalculation(year,week,0)` 호출, 반환 결과가 0이 아니면 오류 안내. 웹의 기존 주문 선commit 경계를 보존한다.
- 읽은 운영 정의: `usp_StockCalculation`, `usp_NenovaStockWeekGateEnter/Leave`, `usp_ShipmentFixCancel`. native CALC는 GateEnter 후 내부 BEGIN TRANSACTION, 내부 COMMIT 뒤 Leave 성공, CATCH 전체 ROLLBACK 뒤 소유 토큰 조건부 Leave 실패를 실행한다.
- native CALC는 선택 및 후속 차수(후속연도 포함)의 지정 품목 `ProductStock`을 갱신한다. `Product.Stock`, 주문·출고 확정 플래그를 변경하는 FIX/CANCEL과 구별한다.
- MD: `ERP_CHANGE_GUARD.md`, `ERP_FEATURE_CHANGE_CHECKLIST.md`, `ERP_COMPAT_INVARIANTS_2026-06-04.md`, `WEB_VS_ERP_CONFLICTS.md`, `DB_STRUCTURE.md`, `NENOVA_DNSPY_CLI_WORKFLOW.md`, `docs/contracts/order-import-shipment-list.json`, `docs/contracts/stock-gate-owner.json`.
- GitHub 최신 배포 조회: run `37290541912`, `d95c9c3d55f92da3bfae06989508f346b42ec8c0`, success. 이는 워크플로 결과이며 이번 수정 배포 완료가 아니다.
- 로컬 증거: `output/orphan-recovery-before.json`, `output/recover-orphan-gate.cjs`. 운영 수량 원문과 접속 비밀은 커밋하지 않는다.

## Q&A

### 1. 누가 재고잠금을 만들었나?

정재훈의 인접 주문 업로드 로그는 확인했지만 소유자와 작업을 연결하는 세션·토큰 감사 근거가 없으므로 생성 주체는 미확정이다. 최신 최종본 업로드는 CALC를 실행하지 않으므로 로그의 근접 시간만으로 원인이라고 설명하면 안 된다.

### 2. 복구하고 업로드를 고쳐 달라

정확한 기존 게이트 identity와 소유 세션 종료 증거를 확인한 뒤, 조건부 잠금 해제와 중단된 42-01/2992 native 계산을 하나의 외부 transaction에서 수행하는 복구안을 준비했다. 계산 실패/보존 대상 차이/게이트 변경이면 rollback한다. EXE·공용 SP·확정 플래그는 바꾸지 않는다. 현재는 DMV 전체 조회 권한 부재로 미실행이다.

### 3. SSMS에서 세션 311 조회가 모두 0건

사용자 첫 사진은 sessions와 requests가 각각 0건이다. 추가 사진은 `SysAdmin=0`, `ViewServerState=0`이다. 따라서 첫 사진을 소유 세션 종료 확인으로 사용할 수 없다. 운영 SQL 관리자에게 동일 조회의 결과와 조회 권한 확인을 요청해야 한다. 조회 권한을 임의로 변경하지 않는다.

### 4. MD 확인해서 처리해 달라, 갑자기 오류가 생겼다

기존 V2 MD는 오래된 RUN의 자동 해제/TTL 인수를 의도적으로 금지한다. 따라서 오래 지속된 RUN 자체를 삭제 근거로 사용할 수 없다. 외부 transaction 없이 CALC를 실행할 때 생길 수 있는 고착 경로를 웹 wrapper로 보강하고, 최신 Excel 최종본은 재고 비변경 계약을 유지한다. 이번 실오류의 최초 요청 원인은 추가 로그/관리자 증거가 필요하다.

## 구현 및 검증 계약

`ORDER_STOCK_CALC_TRANSACTION_CONTRACT.md`와 `docs/contracts/order-stock-calculation.json`을 따른다. 주문 선commit 후 계산의 기존 응답 경계는 유지한다. 계산 배치는 외부 transaction을 소유하고 gate row를 native보다 먼저 잠근다. V2 capability/완전 IDLE/명시 연도·차수·양수 품목/returnCode 및 output/원래 transaction marker/정상 IDLE를 검증한다. 실패 시 계산 배치 전체 rollback, 주문은 이미 저장된 상태임을 구분한다. timeout 자동 재전송이나 공용 SP 변경을 하지 않는다.

## 하위 작업 운영

- 설계·ERP 경계·운영 읽기 및 통합: 메인. 운영 쓰기·배포는 메인만 가능.
- 구현: `gpt-6.1-sol/high` (지정 terra 모델 미지원으로 구현 가능한 현행 모델 사용), helper/API/계약/단위 테스트.
- 검색·UI 실패 안내·SQL fixture: `gpt-6-luna/high` (지정 5.6-luna 미지원 대체), 서로 다른 파일 범위.
- 최종 검토: `gpt-5.6-sol/high`, 읽기 전용.
- 권한: 하위 작업 P0_LOCAL, 외부/운영 쓰기와 승인 요청 금지. 메인이 의존성 junction 및 loopback Docker fixture(포트14339, 공식 SQL2022, mount 없음) 준비.

## 미완료 / 다음 단계

- 실제 SQL fixture, 전체 ERP suite, manifest/scope/dnSpy 검증, 빌드, 최종 검토 후 PR/배포.
- 운영 복구는 별도 단계: 관리자가 전체 세션 조회로 311 종료를 확인하고 현재 게이트 token/scope가 그대로인지 재검증한 뒤 수행. 임의 KILL/확정해제/전년도 재고 삭제 금지.
- 이어받기: 이 파일과 `ORDER_STOCK_CALC_TRANSACTION_CONTRACT.md`, 로컬 preflight artifact를 읽고 실제 검증·배포 상태부터 확인한다. 기억이나 과거 요약만으로 복구 완료/업로드가 원인이라고 설명하지 않는다.
# Operational release — 2026-10-06 09:56 SQL server time

The user explicitly instructed release without administrator confirmation. One exact RUN gate was conditionally cleared: GateKey 1, 2026/42-01 CALC, ProdKey 2992, session 311, token CC8E5202-594A-4778-9B4E-ED614DB532B9, LockedAt 2026-10-05 16:39:17.480. Owner termination was NOT verified; do not describe it as proven orphan recovery. No SQL permissions were changed.

The release committed and a fresh query returned all owner/action/scope fields NULL and PendingCalc=false. Scoped order, shipment, shipment date/farm, estimate, Product.Stock, StockHistory and future ProductStock snapshots were compared and preserved. Native CALC and 40-01 FIX/CANCEL were not executed. An initial attempt rolled back on an order-sensitive checksum; comparison was corrected to sort serialized rows within each result set, and the second attempt passed. Evidence: ignored output/explicit-gate-release-audit.json and output/explicit-gate-release-result.json.

The isolated SQL fixture passed real helper success, cross-year cascade, busy-owner preservation, missing output rollback, attention rollback, second-product native rollback and stale Leave ownership protection. Prevention code remains undeployed at this point; operational release does not establish recurrence prevention or EXE user-action success.
# Final scope correction: my-customer is order-only

User clarified before deployment that my-customer registration only saves orders and displays history, with no distribution or stock effect. Inspection found existing ADD still called CALC; only REPLACE/FINAL_SNAPSHOT were skipped. Corrected API to skip CALC for all isMyCustomerSource modes, removed misleading ADD stock warning, and added executable ADD no-stock/no-shipment assertions. This is an explicit web business requirement and must not be overridden by EXE EditMode=1's broader CALC behavior. The adjacent final-upload log still does not establish the incident's originating request.
# Deployment candidate verification

Final code passed full `test:erp-contract`, manifest (79 contracts), ERP write scope, dnSpy evidence and production build. Real SQL fixture passed at compatibility level 130 on isolated SQL2022 loopback container. Local browser at 1920x1080/100% passed simulated upload HTTP503: exactly one POST, draft preserved, uncertainty alert, no horizontal overflow or page errors; all API requests were intercepted and no ERP writes occurred. Screenshot: ignored output/order-import-503-1920.png. Production deployment result must be checked separately.
