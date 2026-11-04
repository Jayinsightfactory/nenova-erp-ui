# WarehouseCorrection 근거 (기존 golden 산식 변경 없음)

2026-11-03 실제 dnSpy CLI:
`C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe --no-color -t FormWarehouseAdd "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`
동일 명령으로 ExcelLoadingPackingList, FormWarehouseView도 확인했다.

FormWarehouseAdd.btnSave_Click: WarehouseDetail.WdetailKey UPDATE, Product 선택 단위별 OutQuantity/EstQuantity, StockHistory 입고, Product.Stock 가산, usp_StockCalculation. 새 ProdKey만 재계산하므로 A→B 정정에 그대로 복제하지 않는다.
ExcelLoadingPackingList.InsertMaster: 새 WarehouseMaster → usp_CreateWarehouse → usp_StockCalculation(year,week,0). 기존 입고 교체 아님.
FormWarehouseView.GetDetail: WarehouseKey로 WarehouseDetail/Product 조회.

운영 DB SELECT-only: WarehouseKey7968/2026/44-01/ProdKey2077 상세40=ViewWarehouse40. 실제 usp_CreateWarehouse/usp_StockCalculation/ViewWarehouse 정의 조회. WarehouseDetail.WdetailKey IDENTITY, WarehouseMaster.WarehouseKey 비IDENTITY. SystemActionLog Payload nvarchar(max), SessionId nvarchar(200). FreightCost WarehouseKey FK, InvoiceOperation 및 원가 문서의 참조는 별도 검증한다. 세 테이블 WarehouseMaster/Detail/ProductStock 트리거0. SQL 쓰기 및 실제 수정 실험 없음.

교체의 차액정책/부작용/차단조건은 `docs/plans/incoming-replacement-2026-11-03.md`, 실행 계약은 warehouse-correction.json. 기존 master key 보존, 공용 TempWarehouseDetail 회피, 새 품목과 기존 품목 모두 재고 재계산, 상세 연결이 있으면 교체 차단. 주문·출고·견적·매출 불변.
