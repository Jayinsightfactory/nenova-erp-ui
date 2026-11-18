# WarehouseCorrection 근거 (기존 golden 산식 변경 없음)

2026-11-03 실제 dnSpy CLI:
`C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe --no-color -t FormWarehouseAdd "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`
동일 명령으로 ExcelLoadingPackingList, FormWarehouseView도 확인했다.

FormWarehouseAdd.btnSave_Click: WarehouseDetail.WdetailKey UPDATE, Product 선택 단위별 OutQuantity/EstQuantity, StockHistory 입고, Product.Stock 가산, usp_StockCalculation. 새 ProdKey만 재계산하므로 A→B 정정에 그대로 복제하지 않는다.
ExcelLoadingPackingList.InsertMaster: 새 WarehouseMaster → usp_CreateWarehouse → usp_StockCalculation(year,week,0). 기존 입고 교체 아님.
FormWarehouseView.GetDetail: WarehouseKey로 WarehouseDetail/Product 조회.

운영 DB SELECT-only: WarehouseKey7968/2026/44-01/ProdKey2077 상세40=ViewWarehouse40. 실제 usp_CreateWarehouse/usp_StockCalculation/ViewWarehouse 정의 조회. WarehouseDetail.WdetailKey IDENTITY, WarehouseMaster.WarehouseKey 비IDENTITY. SystemActionLog Payload nvarchar(max), SessionId nvarchar(200). FreightCost WarehouseKey FK, InvoiceOperation 및 원가 문서의 참조는 별도 검증한다. 세 테이블 WarehouseMaster/Detail/ProductStock 트리거0. SQL 쓰기 및 실제 수정 실험 없음.

교체의 차액정책/부작용/차단조건은 `docs/plans/incoming-replacement-2026-11-03.md`, 실행 계약은 warehouse-correction.json. 기존 master key 보존, 공용 TempWarehouseDetail 회피, 새 품목과 기존 품목 모두 재고 재계산, 상세 연결이 있으면 교체 차단. 주문·출고·견적·매출 불변.

## 2026-11-18 농장 선택 후보·검색 근거
실제 dnSpy CLI ClassWarehouseMaster.Update와 FormWarehouseView.GetData를 재확인했다. FarmName은 WarehouseMaster의 문자열이며 FarmKey를 새로 생성하는 저장이 아니다. Farm 마스터에 없는 기존 입고 농장명도 실제 입고에는 존재한다. 운영 SELECT-only: 활성 Farm87개, Fagua/Inti 이름0개; WarehouseMaster에는 Fagua Flowers/Faguaflowers Intl LLC 존재. 마스터 자동생성·원장정정은 실행하지 않았다.
웹의 후보는 활성 마스터+활성 입고의 기존 이름을 warehouseFarmChoicesSql 한곳에서 읽고 preview/locked final에서 재검증한다. 삭제·동명중복 마스터는 과거입고로 우회하지 않는다. FarmKey없는이름은입고FarmName메타로만사용하고 ShipmentFarm배정후보는 실제마스터키만유지한다. 농장검색은표시필터이며수정대상연도/차수/PK와원가·확정·재고·견적·매출writer변경없음. 계획 incoming-farm-search-2026-11-18.md 및 real MSSQL candidate/warehouseCorrection fixture 참조.
