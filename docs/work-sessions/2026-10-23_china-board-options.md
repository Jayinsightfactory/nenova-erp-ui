# 중국 물량표 지역·요일·초기화·엑셀

## 요청과 반영
- 지역을 다른 지역으로 선택, 요일 수정: native select, 화면 및 작업본 reviewState에만 저장. Customer/ShipmentDate 원장은 변경하지 않는다.
- 업체/CL 별도 셀: 엑셀 3행 업체명 / 4행 CL 번호, 5행부터 수량. 웹 미리보기와 다운로드가 같은 AOA를 사용한다.
- 변경 초기화: 미저장 변경을 확인 후 버리고 현재 연도/차수 저장본을 다시 조회. 확정/등록된 ERP 원장은 취소하지 않는다.
- 확정/미확정·EMPTY/REVIEW/APPLIED/MANUAL 모두 현재 화면 다운로드 허용. REVIEW는 아직 적용하지 않은 인보이스 제외 안내. 수량대조 시트 유지.

## 근거 및 부작용
직전 같은 세션 실제 dnSpy/SELECT 근거: [주문 보존 재감사](../work-plans/2026-10-23-china-order-guard-review.md), FormOrderAdd/FormShipmentDistribution golden 및 china-volume-distribution 계약. 이번 변경은 화면/내보내기이며 SQL API/writer 변경 없음. 기존100→분배80에서 주문100, 없는 양수만 신규 주문 원칙 그대로. Estimate, ShipmentDate, ShipmentDetail.Amount/Vat/isFix, WebProfitReport, Stock, Warehouse 쓰기 없음.

## 검증
- 수량 및 XLSX 셀 타입·업체/CL 분리·요일·교차연도 단위검사 통과.
- 지역/요일 작업본 JSON 왕복·전체 ERP/dnSpy/manifest/write guard/build 진행. PR/배포/실브라우저 후속 기록.
- 운영 시험 등록분배 없음. EXE GUI는 이번 화면 변경 범위 밖, 미검증.
