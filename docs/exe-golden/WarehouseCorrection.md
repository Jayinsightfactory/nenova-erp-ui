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

## 2026-11-24 차수 접미 표시·EXE 방식 상세수량

실제 설치 Nenova.exe SHA256 FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79. dnSpy에서 FormWarehouseView.groupControl1_CustomButtonClick → FormWarehouseAdd EditMode 2와 WdetailKey 전달 → btnSave_Click에서 박스·단·송이와 Product.OutUnit/EstUnit 기반 수량, 송이×단가, StockHistory 및 usp_StockCalculation 순서를 확인했다. 추정 타입명 FormWarehouseDetail은 설치본에 없다. ExcelLoadingPackingList.CheckData는 파일 차수에서 '-'만 제거한 연도차수로 확정 검사한다. 웹 표시 접미를 기존 업무키에 붙이면 올바른 확정 키에서 벗어난다.

운영 SELECT-only. WarehouseMaster·StockMaster·ShipmentMaster 차수는 NVARCHAR(20), 2026/47-02 활성 원장 26/26건은 47-02. #8249/51360 박스 NULL·단 60·송이 600, OutUnit/EstUnit 단, 입고 총액은 출고 단위×단가이며 EXE 송이 산식과 다르다. 기존 금액 기준을 입증하고 새 금액이 모호할 경우 차단한다. 기존 정정 감사 SystemActionLog에는 성공 이력 1건, Actor·ActionDtm·LogKey·Payload NVARCHAR(MAX), 저장소와 SQL 정의에서 관련 삭제 처리 없음. A/B 표시는 업무키를 그대로 두고 동일 감사 저장소에 별도 기록한다. 수량은 해당 WdetailKey만 갱신하고 기존 확정·원가·재고 가드와 원자적 감사를 사용한다. 계획 incoming-round-native-quantity-2026-11-24.md와 테스트 참고.

## 2026-11-25 판매 수량과 운송료·중량 표시

실제 설치 EXE FormWarehouseAdd를 dnSpy로 다시 읽어 CheckFixSave, Product 단위 바인딩, 송이×단가, 재고 재계산 순서를 확인했다. 운영 SELECT 2026/48-01 #8205의 행 50907/50908은 3100/3101 중량이며, 행 50905/50906은 2182 운송료였다. 이 순수 분류는 상품 수량 경로에서 세 업무코드를 차단할 뿐 기존 원가·운임 소유 작업과 재고 트랜잭션을 수정하지 않는다. 운영 #8205 최신 원가 HTTP는 200 JSON이며 보고된 HTML은 재현되지 않았다. HTML/게이트웨이 오류에서 원시 파서 문자열을 숨기는 단위·브라우저 회귀를 추가했다.

## 2026-11-25 상세 수량·단가(UPrice) 함께 수정

실제 decompile `FormWarehouseAdd` EditMode 2(`spePrice` 로드 → `btnSave_Click`에서 `UPrice`/`TPrice = SteamQuantity * UPrice` UPDATE)를 재확인했다. 웹 상세 수정(`NATIVE_QUANTITY`)은 `BoxQuantity`·`BunchQuantity`·`SteamQuantity`와 함께 `UPrice` 입력을 지원하며, 기존 합계로 증명된 단위 기준(송이 vs 출고단위)을 보존하거나 모호할 때 명시 선택을 요구한다. `2182 운송료` 행은 수량을 고정한 채 단가만 수정 가능하고 `3100`/`3101` 중량 행은 차단한다. 단가만 변경되어 출고수량 증감이 0이면 `StockHistory`/`Product.Stock`/`usp_StockCalculation` 부작용 없이 해당 `WdetailKey`의 `UPrice`·`TPrice`와 감사 로그만 갱신한다. 운영 DB 쓰기 0.
