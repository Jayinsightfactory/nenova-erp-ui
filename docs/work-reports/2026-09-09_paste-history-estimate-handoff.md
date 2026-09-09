# 붙여넣기 작업 묶음 / 견적 편집권 및 최신화

## 사전 기준 및 근거

- SystemActionLog.LogKey가 HTTP 실행 단위다. 시간/사용자 추정으로 여러 작업을 합치지 않는다.
- 운영 읽기 probe: SHIPMENT_ADJUST_BATCH 412건 중 최근 5건 확인. 5625 committed=3, 5624 committed=0(preflight), 5623 committed=5, 5622 committed=0, 5621 committed=1. 기존 Payload 4000자 절단은 과거 데이터 복구 근거가 아니므로 불완전 표시한다.
- 읽기 probe 2026/36/Cust13 편집권 inactive. ERP 쓰기 없음.
- dnSpy ClassEstimate 확인: Insert/Update/Delete는 Estimate 자체 원장 작업이며 Update는 EstimateKey 기준. 이번 변경은 해당 저장 SQL 및 출고/재고 원장을 변경하지 않는다.
- 로컬 docs/CODEX_SUBTASK_ORCHESTRATION.md 없음. 제공 AGENTS의 주/하위 작업 경계를 적용한다.

## 부작용 표

|동작|Order/Shipment/ShipmentDate/Farm|Estimate/매출/재고/손익|웹 부가 테이블|
|---|---|---|---|
|작업 이력 조회|보존|보존|SystemActionLog SELECT|
|작업 감사 보존|기존 업무 계약 유지|기존 업무 계약 유지|기존 감사 INSERT의 안전한 전체 요약|
|편집권 인계/최신화/닫기|보존|보존|WebErpEditLease만 변경|
|초안 충돌 해결|보존|보존|브라우저 초안만 변경; 별도 저장 시 기존 검증 유지|

## 구현 전 기준 고정

- 업무키는 명시 연도 + 부모 차수 + 업체. 품목 이력 검색은 전체 실행 묶음을 유지한다.
- 이력 기본은 본인 Actor(userName 또는 userId), 전체 선택은 명시적. 조회당 최대 200개 로그/커서. 원문 토큰·IP 등 반환 금지.
- 정상 acquire/refresh는 타인 편집권을 빼앗지 않는다. 인계는 estimate 화면, isAdminUser 서버 판정, confirmed=true, 관찰한 leaseStamp 일치가 모두 필요하다. 하나라도 누락/false/변경이면 차단한다.
- leaseStamp는 업무키+비밀 토큰+Revision의 SHA256. heartbeat만으로 변하지 않고 저장/재인계 시 변한다. 인계는 UPDLOCK/HOLDLOCK 하에서 확인 후 토큰 회전. 이전 사용자 저장/해제는 무효.
- 인계는 업무 저장을 실행하지 않는다. 최신 원장과 초안을 대조 후 다시 저장한다. 재고/낙관적 검증을 우회하지 않는다.
- 명시 불러오기는 폴링 경합과 분리하고 성공을 확인한다. 원본=현재이면 초안 유지, 현재=희망값이면 이미 적용으로 해제, 모두 다르면 사용자가 선택한다. 행 누락은 차단한다.
- 화면 기준 1920×1080, 100%. 운영 실데이터 저장 없이 mock UI 및 읽기 smoke로 검증한다.

## 검증

- `npm run test:erp-contract`, `test:nenova-dnspy-evidence`, `test:erp-manifest -- --changed-from 48f9216`, `guard:erp-writes -- --changed-from 48f9216`, `npm run build` 통과. 최종 스냅샷 재실행 및 Cafe24 결과는 PR 댓글에 남긴다.
- 관리자/비관리자, confirmed 생략·false, 화면 불일치, stamp 생략·변경, 교차연도, heartbeat 유지, 저장 후 stamp 변경, 이전 토큰 저장/해제 거부 fixture 통과.
- 초안 원본=현재, 현재=희망, 상충, 행 없음, 원본 없는 과거 초안, 수량 음수 표시 및 만료 lease 재취득 fixture 통과.
- 1920×1080 mock 브라우저: 취소/추가 카드 한 묶음, 내 작업 기본, 가로 잘림 없음, 페이지 오류 없음. 견적 6개 대조 사례 통과. 모든 ERP POST 차단.
- 경고의 다시 불러오기는 모달 없이 대조하고 상단 확정 현황 버튼의 기존 모달은 유지한다. 저장 진행 중에는 명시 최신화도 대기시킨다.
- 운영 인계/저장/재고보정은 하지 않았다. 배포 후 조회 및 표시만 smoke한다.
