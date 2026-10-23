# 원본 물량표 업체 추가·전체폭

## 기준과 부작용 (구현 전)
- 업체·품목 행 추가는 기존 same-origin/token 검증 매칭 popup에서 업체 선택. 원본 탭 유지. 신규 고객 master 생성 아님.
- 선택 업체의 customerOptions(CustKey/CustName/OrderCode/CustArea)로 현재 시트 품목행에 0 초안 생성. 기존 동일 고객은 중복 생성하지 않는다. 수량을 입력한 최종 초안을 기존 preview/apply에 전달.
- 고객 지역별 순서는 원본 머리글, 신규 지역은 고객영역 끝. 원본 workbook을 변경하지 않는 표시 projection, 기존 수량/가격/ID 보존. 지역은 저장 metadata이며 ERP Customer 수정 없음.
- 작업 저장은 기존 immutable 웹 JSON만 변경. 수량/매칭/배치/저장으로 Order/Shipment/Date/Farm/Warehouse/Stock/Estimate/WebProfitReport 모두 보존. 실제 분배는 명시 검토/동의 후 기존 CATEGORY_REPLACE writer 및 readback만 수행. 작업 저장을 ERP 완료로 표시 금지.
- 선택 연도·차수는 기존 source identity에 귀속. popup 중 원본 변경 시 선택 폐기. 업체 중복/취소/키보드/저장 복원/2025·2026 fixture 필요.
- 표 전폭, 보조 도구는 표 위 조밀한 영역. 좌측 품목명은 전체 읽기 가능, 반복 품목명은 가로폭 확보+두 줄까지만, title로 전체 제공. 원본 엑셀 셀/수식 변경 없음.

## 사전 근거
- 2026-10-23 실제 dnSpy.Console -t FormShipmentDistribution 재실행. GetCustomerList의 OrderYear+OrderWeek, ShipmentDate/Farm 분리 저장 계약 유지.
- SELECT-only: 활성 Customer675, CustArea27. 43-02 ViewOrder 2025=306 /2026=385. 2026/43-02 ViewOrder↔ViewShipment 결합 표본0: 실제 분배 완료 증거 아님. 운영 시험 쓰기 없음.
- DB_STRUCTURE의 오래된 IDENTITY/환산 설명보다 현재 dnSpy 및 DutchVolumeDistribution 계약 우선. SQL/writer 변경 없음.
- 화면/키보드/초안/검토 적용, 신규 메뉴·공용 shell 변경 해당없음. 필수 gate 및 운영 확인 후 완료.
