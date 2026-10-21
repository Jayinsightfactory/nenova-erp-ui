# 알스트로 요약·농장 제목 병합

Q. 주문/입고/재고/잔량/농장명 옆 박스 제목도 병합. 아래 계산은 보존. 박스에서 수량으로 역방향 동시 입력 가능한가?
A. 모든 수량·박스 쌍의 헤더만 병합. 일반 xlsx 수식은 입력 셀과 결과 셀의 양방향 동시 편집을 지원하지 않으며 박스 직접 입력은 수식을 덮어쓴다. VBA 등 별도 방식이 필요하고 이번 변경은 기존 수량→박스 계산 유지.

부작용: 다운로드 표시만 변경. Order/Shipment/Warehouse/Stock 및 Estimate/ShipmentDate/ShipmentFarm/Amount/Vat/isFix/WebProfitReport 모두 보존. 선택 연도·차수와 기존 수량/16 기준, 빈칸, 합계, 업로드 승인 정책 유지.
실제 dnSpy FormQuantityPivot 재실행: ViewWarehouse/ExportToXlsx 확인. SELECT-only probe 2026/44-01 입고0,43-01=1648,2025/44-01=1872 동일. 앞선 docs/exe-golden/FormQuantityPivot.md 근거 및 계약 유지.
메뉴 기준: 적용—제목 가독성, 원수량·계산 보존. 새 메뉴/웹 shell/ERP 쓰기 해당 없음.
검증: 2025/2026 생성파일의 요약·농장 헤더 병합, 본문 수식·수량 및 실제 업로드 파서 회귀. 필수검사·배포 진행 중(미검증).
검색어: 알스트로 요약농장 제목병합 양방향수식
