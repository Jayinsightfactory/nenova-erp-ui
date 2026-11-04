# 보류 원불량 차수 우선 표시
- 사용자: 보류는 몇 차 불량인지 메인으로 표시.
- 기준: 조회/적용 차수가 아닌 API 원장행 orderYear + orderWeek. 하위차수 및 전년도 보존, 누락 시 미확인 표시(조회차수 대입 금지).
- UI: 보류 표의 No 위치를 불량 차수로 변경, 각 행에 원연도·차수 굵은 배지. 번호는 보조표시. 등록대상/이월 표는 기존 유지.
- 부작용: 표시만 변경. 모든 Order/Shipment/ShipmentDate/Estimate/WebProfitReport/불량 원장 및 수기·단가·적격성·요청 payload 보존.
- 근거: 이번 세션 ClassEstimate dnSpy(C:/Users/USER/defect-cost-native-1104.txt) 및 읽기전용 원장 probe의 라움926=2026/42,1007=2026/43. 기존 managementDescriptor도 원행 연도/차수 사용. SQL·저장 순서 변경 없음.
- 검증: 원차수42 vs 적용44, 전년도 동일42, 하위차수42-02, 누락값; API격리 실제 UI 헤더/원차수/쓰기0; 필수 ERP gate/build/배포/Aside.
