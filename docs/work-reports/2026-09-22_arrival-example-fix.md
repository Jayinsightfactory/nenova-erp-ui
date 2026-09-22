# 도착원가 예시 혼입·조회 범위 수정

## 선검증 및 기준 원장
- 실제 dnSpy CLI FormWarehouseView GetData/GetDetail 재확인: WarehouseMaster/Detail 경계 유지.
- 운영 SELECT: 2026 #23 37-2 정상 53 + 예시 16, #22 38-2 정상 18 + 예시 16. 해당 차수 2025 현재본 없음. 예시 SheetName은 정확히 `08-1(예시)`.
- 업로드 #23은 누적 workbook 전체 2032행 저장. 재업로드로 과거 원가를 덮지 않는다.
- 기존 34행 검증은 예시 16행 혼입을 놓쳤다. 행수뿐 아니라 SheetName/SourceRow provenance를 검사한다.

## 기준표 / 부작용
|동작|기준과 소비자|변경|보존|
|---|---|---|---|
|예시 제외|실제 workbook 시트명, isArrivalExampleSheet / 수동·자동 공통 파서|새 import의 입력 집합만|정상 과거 시트 정책, 수량/단가 원본|
|업로드 후 조회|저장된 행의 연도·차수, 파일명 우선/최신 fallback|화면 필터/목록|원장|
|차수 표기|arrivalWeekPredicate / 목록·품종·누락 조회|SELECT 조건 37-2=37-02|연도 필수|
|운영 예시 보정|배포 후 #22/#23 + 연도/차수/시트/현재 여부 잠금 재확인|WebArrivalCostLine.IsCurrent, History|정상 행, 수동 단가/매칭, ERP 전체|

Order/Shipment/ShipmentDate/ShipmentFarm/Estimate/ProductStock/StockHistory/Warehouse/WebProfitReport에는 쓰지 않는다. 호텔 화면 참고 원가의 예시 혼입만 제거하고 저장된 호텔 매입단가는 보존한다.

## 검증
진행 중. 실제 파일 재파싱, 실행형 예시 fixture, 교차연도 scope, SQL 숫자 차수 대조, 필수 게이트, 배포 후 브라우저 및 보정 전후 대조를 기록한다.
