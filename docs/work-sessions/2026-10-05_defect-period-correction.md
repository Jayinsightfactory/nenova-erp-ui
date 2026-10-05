# 불량 초안 차수 정정

사용자 요청: 차수정정기능 만들어서 수정해.

관리자 선택 차수 정정은 기존 원장키와 업체·품목·수량·담당자를 보존한다. DRAFT, 미삭제, 미등록, 수입부 미확정, 이월 이력 없음, 예상버전 일치만 허용한다. 명시 원본/대상 연도·차수를 검증하고 대상 전산등록 마감 여부를 잠금 조회한다. 행과 감사 이력은 하나의 트랜잭션이며 하나라도 실패하면 전부 롤백한다. 응답 불명 후 자동 재시도하지 않는다.

## 선행 근거
2026-10-05 로컬 dnSpy.Console.exe --no-color -t ClassEstimate로 설치된 Nenova.exe 확인. ClassEstimate.Insert/Update/Delete는 EstimateKey와 ShipmentKey 기반 Estimate 쓰기다. 이번 기능은 웹 초안 OrderYear/OrderWeek와 RowVersionNo/UpdatedBy만 변경하며 Estimate/Shipment/Order/Stock/WebProfitReport 쓰기는 없다. WebSalesDefectDeductionHistory에 PERIOD_CORRECT 전후 스냅샷과 사유를 기록한다.
운영 SELECT probe: 저장번호721~748 총28건 모두2026/42 DRAFT 버전1, EstimateKey 없음, 수입부 미확정. 대상2026/40 applied 등록 건수0. 상세 로컬 reports/defect-period-before.json. 전년도 동일차수는 선택키/원본연도 검사로 제외한다.

## 검증
정책 fixture: 관리자/비관리자, 연도 경계, 잘못된 범위, 중복키, 변경 버전, 처리/확정행. 트랜잭션 fixture: 두 번째 행 실패·이력 실패·마감 시 전체 rollback; 성공 시 수량 보존. 필수 계약/manifest/SQL scope/dnSpy/build 및 배포 결과는 완료 후 추가.

## 후속 UI 수정
PR #877 배포 성공(3536c2cf). 운영 28건은 아직 42차이며 입력 단계에서 브라우저 native prompt가 멈춰 저장은 실행되지 않았다. 연속 prompt/confirm을 명시적 정정 폼으로 교체하고, 조회 클릭 이벤트가 manager 인수로 전달되는 오류를 무인수 호출로 수정한다. 원장/API 정책은 동일하다.
