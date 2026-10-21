# 중국 발주 현황 읽기/다운로드 근거 — 2026-10-05

## 2026-10-19 HF 별도 셀
- 기존 dnSpy/ViewOrder 근거 재사용: SQL/API/조회/매칭은 변경하지 않고 다운로드 표시만 변경.
- 품목명 A열, HF CODE B열(문자열), 단위 C열, 합계 D열, 업체 E열부터. banner A1:D1은 유지.
- 부작용: Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport 모두 보존. 운영 DB 쓰기 없음.
- XLSX round-trip 회귀로 선행0, 미매칭 빈칸, 단위별 합계, 소수/박스환산, CL 그룹 경계, 교차연도, 260업체를 검사.

## 2026-10-08 단일 시트 다운로드
- 사용자 요청에 따라 선택 세부차수 다운로드는 품목별업체수량 1시트만 저장한다. 숨김 수량원본 및 감사 4시트는 제외한다.
- 삭제 시트 참조 수식은 기존 캐시 표시값으로 변환한다. 수량(박스수), 단위별 합계, HF/CL 리터럴, 날짜, 서식, 고정 행/열은 유지한다.
- 파일 응답만 변경하며 기존 API, ViewOrder 조회 SQL, 업무키, EXE, 모든 ERP 원장과 견적/매출 downstream은 보존한다. 새 DB/SQL 동작이 없으므로 기존 dnSpy 및 읽기 근거를 재사용한다.
- 회귀: XLSX 저장/재개봉 후 정확히 1시트, 수식 없음, 소수/누락 환산/중복 CL/교차연도 suffix/업체 필터/260업체 검증.


## 2026-10-07 예시 다운로드 상단 및 파일명
- main이 실제 설치 EXE FormQuantityPivot를 dnSpy.Console로 재실행하여 ViewOrder.OutQuantity, FROM ViewOrder, btnExcel_Click 확인. 기존 SQL/API/ERP 저장 경로 변경 없음.
- 첫 시트 표시 행만 추가: 짧은 세부차수 중국 / ETA / 다운로드 시점 Asia/Seoul 날짜 / SEA/Air. 사용자 명시 기준으로 ETA는 이번 다운로드 날짜이며 실제 운송 예정일 계산이 아니다. Customer.OrderCode만 업체 헤더로 유지한다.
- 숨김 수량원본 및 구조화 감사 시트 행/숫자/업무키/수식은 보존. 표시 헤더·freeze/autofilter만 2행으로 이동.

## 수량(박스수)·코드 전용 표시 후속
- main 실제 dnSpy.Console.exe --no-color -t ClassProduct 설치 EXE 재실행: OutUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box decimal 속성 및 SELECT/저장 컬럼 확인. 이번 API 변경은 현재 Product.BunchOf1Box/SteamOf1Box SELECT 컬럼 추가만 수행하며 기존 주문 수량·WHERE·연도 범위는 보존한다.
- 2026-10-05 운영 read-only 조회 중심40: 중국 주문1337행,169개 관련 품목 모두 OutUnit단,현재 BunchOf1Box 양수147개·0/누락22개. 단 수량/BunchOf1Box를 참고 박스수로 표시한다. 송이는 명시 SteamOf1Box,박스는 그대로. 0분모를 보정하거나16·1 등으로 대체하지 않는다. 이것은 원장 재환산/견적금액 변경이 아닌 다운로드 표시다.
- 품목명에는 실제 HF만 남기고 빈HF/검토 문구를 생략한다. CL 접두어별 정렬은 표현 순서이며 CustKey/ProdKey/단위 업무키를 합치지 않는다. Excel 코드는 리터럴, 원본 numeric/SUM/환산 수식은 숨김 수량원본에 보존한다.

## 품목(HF)×업체(CL) 수량표
- 2026-10-05 main 실제 CLI FormQuantityPivot 재실행: `vo.OutQuantity Quantity`, `vo.OrderYear`, `FROM ViewOrder vo`, `WHERE vo.OutQuantity > 0`, `btnExcel_Click` 확인. 원장 SQL/API/EXE 수정 없이 단일 세부차수 조회 결과만 가로 업체/세로 품목으로 표시한다.
- 운영 read-only preflight: 중심 2026/40, 37~43 선택 범위, 중국 주문1336행/42업체, 40-03 포함. Excel `Pivot 통계_2026-10-05.xlsx`의 39-01 품목×업체/Total 구조는 양식 참고이며 전산 수량 원천을 대체하지 않는다.
- 사용자 정정: 품목의 코드번호는 이전 HF 첨부 사전의 HF CODE. Product.ProdCode/ProdKey를 괄호 HF로 표시하지 않는다. 업체 CL은 현재 활성 Customer.OrderCode. 집계키는 ProdKey+unit/CustKey로 분리, 코드/표시명으로 병합 금지.
- 공용 `buildChinaOrderCustomerMatrix`가 화면/Excel의 실제 orders에서 선택 연도+full OrderWeek, 양수 중국 수량, 고객 표시정보 일치 및 단위별 합계를 검사한다. 기존 견적·확정·출고·입고·재고 원장과 downstream 값은 보존한다.

- 실제 EXE: C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe
- CLI: C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe --no-color -t FormQuantityPivot [EXE]
- main actual CLI 결과: FormQuantityPivot.GetData 주문 UNION에서 `vo.OutQuantity Quantity`, `FROM ViewOrder vo`, `WHERE vo.OutQuantity > 0`. btnExcel_Click의 ExportToXlsx는 표시 내보내기이며 ERP 쓰기 없음.
- native ViewOrder는 OrderMaster/OrderDetail 활성행 + Customer/Product 활성행 + Country/UserInfo 조인. 연도/세부차수/업체/품목 identity 유지. 해당 보기의 단일 OutQuantity 사용, 환산열 합산/출고수량 대체 금지.
- 새 페이지는 중국 주문등록 자료 자체를 조회하므로 native 피벗 StockList 연결을 사용하지 않는다. 재고마스터 미생성 차수의 주문도 빠뜨리지 않기 위한 명시 웹 읽기 확장이다. native 원장/view/SP를 수정하지 않는다.
- read-only 운영 GET `/api/stats/pivot-exe?fromYear=2026&fromWeek=37-01&toYear=2026&toWeek=43-99`: 전체20,019행 중 중국 주문1,332행. `/api/master?entity=products`: 첨부416개 중국품목 모두 같은 ProdKey/ProdCode. `/api/estimate/weekday-calendar`로 37~43차 실제 목요일 달력 확인. raw 업무자료와 인증정보는 output에만 두고 커밋하지 않는다.
- 기준 파일 Sheet에는416품목, 명시 HF CODE126개. 보조 review의 closest catalogue code는 후보 참고값이지 확정 HF CODE가 아니다. 이미 입력된HF+No match의 원본검토상태는 보조 감사 시트/필터에서 보존하되, 최신 사용자 지시에 따라 기본 수량표 품목명에는 실제 HF만 표시하고 미매칭 문구는 생략한다.
- 조회/재업로드/내보내기 모두 Order/Shipment/Warehouse/Estimate/재고와 Product 변경 없음. 브라우저 업로드 사전은 ERP나 다른 브라우저에 자동 동기화되지 않는다.
- 업체 CL 코드 근거: `docs/DB_STRUCTURE.md` Customer.OrderCode 및 `docs/exe-golden/FormQuantityPivot.md` 거래처 주문코드 기록. native ClassCustomer.OrderCode와 같은 현재 활성 Customer.OrderCode를 CustKey로 읽는다. 주문별 ViewOrder.OrderCode/CustCode/내부키와 혼용하지 않는다. 업체별 발주와 주문상세 XLSX에 문자열로 보존하고, 코드 누락은 임의 보정하지 않는다.

## 세부차수 정정 근거
- 2026-10-05 같은 설치 EXE를 main이 dnSpy CLI로 재확인: GetData의 `vo.OrderYear`, `vo.OrderWeek`, `vo.OutQuantity Quantity`와 `WHERE vo.OutQuantity > 0` 보존. 세부차수 정정은 표시/Excel 집계만 변경하며 API SQL·EXE·DB·SP 변경 없음.
- 수정 전 운영 읽기 GET 2026/40: 7메인 37~43, 양수 중국주문1,336건/42업체. 실제 40-03 포함 12개 세부차수, 43차 양수 주문 없음. 01/02로 고정하지 않고 정확한 연도+원본 OrderWeek 열을 만든다. 검색 전 전체 결과에서 열을 만들고 필터 후에도 유지한다.
- `OrderMaster/OrderDetail`, `ShipmentMaster/Detail/Date/Farm`, `WarehouseMaster/Detail`, `ProductStock/StockHistory`, `Estimate`, `WebProfitReport` 부작용 없음. 기존 출고/견적/재고 처리 경로를 호출하지 않는다.

## 2026-10-21 두 시트 다운로드
- 품목별업체수량은 기존 수량(박스수), 단수량은 동일 업무키의 숫자 단 수량. 단은 그대로, 박스는 BunchOf1Box 곱, 송이는 BunchOf1Box/SteamOf1Box 곱. 규격 누락/불일치는 환산확인, 해당 합계도 전파.
- 기존 FormQuantityPivot.GetData/btnExcel_Click 근거 재사용: ViewOrder.OutQuantity의 읽기 전용 파일 표시 변경. API/SQL/EXE 저장 경로 변경 없음.
- 2026-10-21 운영 읽기 전용 probe: OrderYear=2026, OrderWeek 42-01 단 153행/71품목, 42-02 단 73행/34품목. 활성 중국 양수 주문만 조회. 단 원수량은 포장규격 누락에도 보존.
- Order/Shipment/ShipmentDate/ShipmentFarm/Warehouse/StockHistory/Estimate/Amount/Vat/isFix/WebProfitReport 변경 없음. 교차연도 및 XLSX 재읽기 fixture로 두 시트 범위와 숫자형 검증.
- 사용자 최종 정정: 두 시트 동시 다운로드를 취소하고 버튼 두 개(단·박스 다운로드 / 단만 다운로드)로 분리. 파일당 선택 형식 시트 하나만 생성, 파일명 단박스/단만 접미사 구분. 20개 관련 검사 재통과.

## 2026-10-21 다운로드 버튼 잘림 보완
- 실제 운영 브라우저 1366px에서 단만 버튼 right=1386.90625로 뷰포트 밖 잘림 재현. control-panel와 내부 파일/차수 그룹을 모든 폭에서 줄바꿈하고 그룹 최대너비를 100%로 제한.
- 표시 CSS만 변경. 기존 OrderYear/fullOrderWeek/CustKey/ProdKey, 단/박스 환산, ViewOrder 조회 및 모든 주문/출고/재고/견적 원장 보존. 기존 dnSpy/DB 근거 그대로 적용.
