# 원가 다운로드 상태·버튼 디자인

- 범위: 기존 다운로드 가능 조건은 유지하고 원인을 버튼 안/바로 아래 표시. 수입 도구 신규 버튼을 기존 파란색/흰색 테두리 버튼과 통일.
- 기준: InvoiceReceiptCostReview의 busy 또는 preview.status != APPROVED 조건, 서버 preview.issues/실패 메시지, auOriginalCostInputs 누락 판정. 새 서버 검증/입고 조건을 만들지 않는다.
- 부작용: 상태 표시/스타일 변경은 모든 Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport 보존. API/SQL/SP/원가 수식 변경 없음. 실제 FormWarehouseUpload golden의 native writer는 호출하지 않음. 이전 세션 SELECT-only 44-01 snapshot을 격리 UI 검증에 재사용하며 새 운영 probe 불필요.
- 검증: 최초 미리보기 전, 입력 변경, 오류/누락, 작업중, APPROVED(경고만), 명시0, 연도2025/2026. 스타일/작은 화면 줄바꿈/키보드 focus. 운영은 조회만.
