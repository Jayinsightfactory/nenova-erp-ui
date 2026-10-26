# 인보이스 연도 자동 제안 및 순주문 대조

- 사용자 승인: 인보이스에 명시된 연도를 입고 연도 기본값으로 사용. 기존의 무조건 수동입력 정책보다 이번 지시 우선.
- 우선순위: 담당자/차수 기준 명시 연도 → 파일명 연도 → 인보이스 날짜의 유일한 4자리 연도. 현재 연도 fallback 없음. 충돌은 표시하고 선택 연도 확인 필요. 기존 저장 문서는 임의 변경하지 않음.
- EXE 실제 CLI: ExcelLoadingPackingList는 G3의 yyyy/MM/dd 연도를 SelectOrderYear 문자열로 사용. 빈 날짜일 때 현재연도 적용 경로는 도입하지 않음.
- SELECT-only 업무키 probe: 화면 문서 966a9e13…는 2026/44-01, CO, DRAFT rev1. RawMetadata invoiceDate=2026-10-23. 이미 연도는 정상.
- 읽기 전용 preview(감사 INSERT wrapper 제외) 재현: reconciliation orders[0].quantity must be finite and nonnegative. ViewOrder에는 실제 음수 조정 수량(-1,-2 등)이 존재. 이를 0으로 대체/삭제하지 않고 순주문 합산에 보존한다. 신규 draft 입고는 계속 비음수.
- 부작용: 연도 제안/확인/순주문 대조는 화면·순수 함수. 운영 WebInvoice/Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport 모두 보존. 기존 writer/SP/DDL 수정 없음. 테스트 동안 preview 감사 INSERT도 실행하지 않음.
- 검증: 날짜 연도/명시 선택/충돌/누락/교차연도, orders signed/draft negative reject/overflow, 실제 문서 SELECT-only preview 후속 점검.
