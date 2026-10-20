# SQL 원장 독립 대사 — 구현 전 기준

## 근거와 범위

2026-10-20 실제 dnSpy FormStockView.GetData 재확인. 기존 FormWarehouseView/GetData,
Shipment/Estimate 보고서 확정 조건은 FormProfitReport 근거와 기존 계약을 보존한다.
운영 SELECT로 ShipmentMaster/Detail, Estimate, WarehouseMaster/Detail, Product,
CodeInfo, StockMaster/ProductStock을 직접 읽고 웹 결과와 독립 합산 대조했다.
웹 산술이 맞는 것만으로 SQL 원천 검증 완료라 표시해서는 안 된다.

| 기준 | 권위/소비자 | 처리 |
|---|---|---|
| 업무키 | SQL OrderYear+OrderWeek, 기존 매출 OrderYearWeek 조건 | 명시 연도, 01~53, 충돌 행 제외 사유 표시 |
| N/O 판매 | 확정 master/detail, 0 아닌 OutQuantity, 공급액 Amount | 운송료는 O, 일반 상품 N |
| L/O 차감 | 확정 master, Estimate/CodeInfo 불량차감 | 코드 중복으로 금액 증폭 금지; 충돌은 판정 보류 |
| Q | active WarehouseMaster/Detail.TPrice | 중량·비재고 비용 제외, 외화 그대로 대사 |
| 분류 | 기존 보고서 분류, 웹 override | SQL CASE와 JS 일치; override가 있으면 같은 정책 반영 |
| E/F/H/R/S | 재고수량/직접 단가 검산 및 기존 출처 경고 | N/L/O/Q 일치로 이 항목까지 검증했다고 주장하지 않음 |
| 확정본 | 저장 당시 revision | 현재 SQL과 다른 시점이므로 HISTORICAL |
| 변경 감지 | 기존 전후 SHA256 | 금융 원행/분류 설정도 hash 포함, 변경 시 정상 판정 금지 |

## 부작용 표

조회/차수 이동/전체 차수 검산은 SELECT와 메모리 계산만 수행한다.
OrderMaster/Detail, ShipmentMaster/Detail/Farm/Date, Estimate, WarehouseMaster/Detail,
StockMaster/ProductStock/StockHistory, WebProfitReport, 확정 revision 전부 보존한다.
SQL 표준키 충돌, 과거 원가 누락, 52/53차 정책 충돌은 원장 자동보정하지 않는다.
실제 사업 숫자/원행은 ignored .verify에만 보관한다.

## 회귀 기준

같은 차수 다른 연도, 확정/미확정, 0수량, raw 연도키 충돌, 코드 중복,
상품/운송료/무게/비재고 비용, 명시 0/null, 분류 override, 확정 당시 시점,
SQL 합계와 웹 값 변이, 다른 시점 원천 변경을 합성 fixture로 검사한다.
