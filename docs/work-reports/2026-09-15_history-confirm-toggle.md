# 원문 확인처리 토글

확인처리는 선택 연도·차수·원문 식별자에 대한 웹 확인 표시다. 기존 비공개 파일
원장과 CAS/멱등성 API를 재사용한다. 확인취소는 ERP 되돌리기가 아니다.

| 동작 | 웹 확인 이벤트 | SystemActionLog | Order/Shipment/Date/Farm/Stock | Estimate/손익 |
|---|---|---|---|---|
| 확인/확인취소 | 기존 API append | 보존 | 보존 | 보존 |
| 성공 후 자동 확인 | 기존 committed 로그로 계산 | 기존 GET만 | 보존 | 보존 |

기준: 수동 확인은 MANUALLY_APPLIED, 확인취소는 MANUALLY_NOT_APPLIED.
완전한 committed 로그·같은 연도/차수/원문·전체 항목 수 일치만 자동 확인한다.
preview/failed/불완전 로그/부분 저장/undo는 자동 확인하지 않는다. 수동 취소가
작업보다 늦으면 취소 유지, 그 뒤 새 성공 작업이 있으면 다시 자동 확인한다.
DB 로그의 timezone 없는 시각은 KST다. 수동 확인 이벤트는 서버 ISO 시각이다.
분석과 매칭 자체는 확인 처리하지 않으며, 확인 저장 실패는 목록에 바로 표시한다.

dnSpy CLI FormShipmentDistribution의 GetCustomerList/btnSave_Click 및 ShipmentDate
참조를 읽기 전용 재확인했다. 기존 저장 경로는 변경하지 않는다.
docs/CODEX_SUBTASK_ORCHESTRATION.md는 저장소에 없어 하위 작업 없이 진행한다.
검증: 순수 상태 fixture, 파일 원장/API CAS·교차연도 테스트, 1920×1080 브라우저
토글·새로고침·실패 표시 fixture 및 기존 ERP 필수 검사.
