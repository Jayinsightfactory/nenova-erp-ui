# 붙여넣기 분배 교착 재발 방지 · 2026-10-13

## 요청 / 관측
사용자: 동일 deadlock victim 오류가 발생하지 않도록 수정·검증·배포 요청.
운영 SELECT API 로그11368:2026-10-13 11:26:03, SHIPMENT_ADJUST_BATCH FAIL, 실제 저장(preflight=false),2026/41-02,CANCEL Cust611 Prod1306 10 → ADD Cust456 Prod1306 10, SPID1650 deadlock victim.
해당 API는 단일 원자 트랜잭션이므로 두 건 모두 rollback. 처음 일반 설명의 부분 성공 가능성은 해당 요청에 적용되지 않음을 사용자에게 정정.
실제 SQL deadlock graph는 확보하지 못함. 코드에서 CANCEL-first 입력 순서별 업체 lease/ERP lock 및 MAX PK lock 교차 획득 위험 확인; 이 구조를 이번 사건의 확정 그래프로 주장하지 않음.

## 기준 ledger 및 구현 계약
- 실제 업무순서 CANCEL 전체→ADD 전체와 OrderYear+OrderWeek+CustKey+ProdKey 유지.
- 단건/배치/되돌리기가 공유하는 executeShipmentAdjustmentInTransaction 진입 때, ERP/lease 잠금보다 먼저 DB transaction-owned exclusive applock `nenova:shipment-adjustment-write:v1` 획득.
- 전역 PK allocator까지 공유하므로 해당 분배 조정 경로를 같은 자원 하나로 직렬화. UI 서버 메모리 큐가 아니라 DB 잠금으로 다중 프로세스에도 적용. transaction commit/rollback 시 자동 해제.
- EXE/미참여 API는 이 잠금을 사용하지 않으므로 모든 SQL 교착의 절대 방지를 약속하지 않음. SQL1205 전체 롤백 확인 후 fresh transaction에서 한정 재시도.
- 실제 분배 조정만 retries5/base250ms 지수 대기+jitter. 일반 DB 기본값 유지. 통신/timeout/commit 결과 불명 자동 재시도 금지.
- app lock 최대10초, 실패시 명확한 대기 안내와 0반영. 원장 잠금 없이 대기 시작.
- lease ownership/stale snapshot/확정/재고/단위/사후대조 모두 기존 코어로 재검증.

| 동작 | 쓰기 범위 | 보존 |
|---|---|---|
| 잠금 대기 | transaction applock만 | 모든 ERP 데이터 |
| 실패/retry | 실패 시도 전체 rollback 후 기존 코어 | 실패 시 모든 Order/Shipment/Date/Farm/History, Estimate/WebProfitReport |
| 성공 | 기존 ADD/CANCEL 계약과 동일 | 새 수량/금액/재고 정책 추가 없음 |

## 사전 증거
- 실제 dnSpy CLI FormShipmentDistribution 실행:outputs/deadlock-native-distribution.txt, 기존 FormShipmentDistribution golden의 Master→Detail→Date/Farm 저장 경계 재확인.
- 운영 로그 GET 결과 outputs/deadlock-production-log.json. 운영 변경 없음.
- 실제 MSSQL 격리 fixture nenova-estimate-sql-test-20260826(SQL2022,127.0.0.1:14339,운영과 분리)에서 경쟁/롤백/실제 SQL1205 재시도 테스트 통과.
- docs/CODEX_SUBTASK_ORCHESTRATION.md 없음. 사용자 제공 에이전트 역할/루트만 병합·배포 규칙 적용.

## 기준선
메뉴 shell/레이아웃 변경 해당 없음. 진행/실패 상태 적용. 기존1920×1080 UI 유지. ERP 변경 가드/계약/교차연도/실행 검증 적용.

## 검증 및 배포
- 완료: 전체 test:erp-contract(실패0), db retry 7항목, 실제 격리 MSSQL 역순 writer 직렬화/rollbackOnly/오류 rollback/SQL1205 전체 재시도 및 중복 수량 방지.
- read-only 운영 대조: 2026/41-02/1306의456 주문10·분배10·날짜10,611 주문10·출고상세없음.2025 대응행없음.456 ViewShipment/ViewOrder 존재, MasterFix0, 견적 GetDetail0(기존 상태). 사용자의 중단 배치 자동 재실행 없음.
- 완료: 변경파일 manifest102건/write guard3 API/dnSpy evidence/build 통과.
- 남음: PR/배포 및 실브라우저 확인.
- 로컬 outputs 및 .next-delivery-smoke는 커밋 제외.

## Q&A
**Q.** 동일 오류가 생기지 않게 작업.
**A.** 분배 조정 경로가 ERP 잠금 전에 공통 DB 잠금을 획득하도록 수정했다. 확인된 SQL1205 abort만 새 트랜잭션으로 전체 재시도하고 commit 응답불명은 반복하지 않는다. 실제 SQL 경쟁 fixture에서 검증했다.

| 항목 | 기록 |
|---|---|
| 기간/화면 | 2026-10-13 / 붙여넣기 주문등록·분배 조정 API |
| ERP 부작용 | 운영 읽기만 수행; 기존 조정 쓰기 계약 보존 |
| PR/배포 | 검증 후 기록 |
| 다음 작업 | 실제 배포결과와 read-only smoke 확인 |
