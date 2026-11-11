# 입고관리 원장 권한 복구 — 구현 전 기준

- 실제 dnSpy CLI FormWarehouseView.btnDelete_Click 확인: 선택 WarehouseKey로 DeleteCheck 후 삭제, 상세/StockHistory 처리 및 재고계산. 이번 변경은 웹 진입 권한에만 한정하며 기존 웹/EXE 삭제 처리의 차이를 수정하거나 동등하다고 주장하지 않는다.
- 운영 SELECT: 활성 Authority=4 계정 4개 모두 DeptName 비어 있음. 계정 식별정보 출력/보관 없음. 2025/44-01 활성 헤더54, 2026/44-01 헤더50. 운영 쓰기0.
- 기준: lib/invoiceReceiptAccess.js canManageInvoiceReceipt. 인증 identity 필수, inactive 거부, 관리자/수입부/정확한 숫자·문자 코드4/7 허용. 일반 영업·경영·현장 거부. POST/PATCH/DELETE가 동일 helper 사용.

| 동작 | WarehouseMaster | WarehouseDetail | Stock | Order/Shipment/ShipmentDate/ShipmentFarm/Estimate/WebProfitReport |
|---|---|---|---|---|
| 권한 거부 | 보존 | 보존 | 보존 | 보존 |
| 허용 DELETE | 기존 PK soft delete | 기존 보존 | 기존 명시 연도/차수 재계산 | 직접 변경 없음, 기존 재고 SP 영향 유지 |
| 허용 POST/PATCH | 기존 처리 유지 | 기존 처리 유지 | 기존 처리 유지 | 기존 처리 유지 |

검증 fixture: 빈 부서 Authority4/7 및 관리자 통과, 다른 역할·비활성·identity없음 차단(DB0), 확정차수 거부 유지. 2025/2026 동일44-01에서 선택 WarehouseKey의 연도만 재계산. SQL·기본값·원가/견적/매출 산식 변경 없음.
