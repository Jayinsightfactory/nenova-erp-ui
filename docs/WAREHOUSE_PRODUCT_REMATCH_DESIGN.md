# 입고 업로드 품목 재매칭 — 2026-10-01

## 근거 및 범위

실제 `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`를 dnSpy.Console
`-t ExcelLoadingPackingList`로 다시 추출했다. MakeTempTable은 WarehouseKey를
usp_GetNextKey로 채번하고, InsertMaster는 usp_CreateWarehouse 성공 뒤
usp_StockCalculation(연도, 세부차수, 0)을 실행한다. DBMSSQL.BulkCopyTI는 공용
TempWarehouseDetail을 TRUNCATE한다. 재매칭 화면은 EXE에 없는 웹 확장이며,
저장 SP·박스/단/송이 수량·가격은 EXE 경로를 유지한다. 100% UI 동일성을 주장하지 않는다.

운영 읽기 전용 probe: WarehouseKey는 identity가 아니다. 활성 Hydrangea 동명 품목 3건.
TempWarehouseDetail에는 이미 처리된 WarehouseKey 7528의 2행이 남는다.
실제 usp_CreateWarehouse의 이름식은 LOWER(REPLACE(LTRIM(RTRIM(name)),NCHAR(160),N' ')),
Product.isDeleted=0이다. SP는 전체 임시행을 소비하고 Product.Stock 및 StockHistory를
변경한다. 이전 계약의 이 부작용 누락을 바로잡는다. StockCalculation은 2025 이하를
거부하므로 저장도 2026 이상만 허용한다. 현재 표본 2026/40-02/433의 ViewOrder 1,
ViewShipment 0. 39-02 입고 master는 2025 24건 / 2026 38건으로 연도 구분이 필수다.

## 기준/소비자 고정

- 파일 원본 prodName/sourceRow/수량/가격 보존. 직접 선택은 selectedProdKey만 추가.
- POST /api/warehouse/validate: metadata + items → {success:true, valid, rows, errors, products}.
  rows는 입력순서의 {index, sourceRow, originalName, prodKey, prodName, countryFlower,
  outUnit, estUnit, status:exact|manual|error, error}. products는 활성 DB 품목의
  {ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,NameCount}.
- 후보/검증/최종 저장은 lib/warehouseProductMatching.js의 동일 SQL 이름식과
  활성 범위 사용. 자동 유사매칭 금지. 명시 선택도 활성·이름 유일성 재검증.
  동명 중복은 native SP가 이름으로 재조회하므로 선택 키만으로 우회할 수 없다.
- 클라이언트는 검증 응답을 표시하지만 저장 직전 서버가 트랜잭션 안에서 다시 검사.
  파일/메타/선택 변경 시 검증 무효. 검증 실패 행 1개라도 있으면 저장 없음.
- 관리자/수입부 권한 그대로. 연도+세부차수 명시, 확정 품종 차단 유지.
- CommonLogic CLI도 재추출: CheckFixSave는 ViewShipment.DetailFix로 현재 확정,
  StockMaster의 직전 차수 미확정, 다음 차수 확정을 검사한다. 이 기준을 검증/저장에
  공유하고 최종 검사에는 HOLDLOCK을 적용한다. MasterFix만 보는 이전 웹 조건은 정정.
- 원본 단위별 수량을 재환산하지 않음. Out/EstQuantity는 DB OutUnit/EstUnit으로
  native SP가 고른 Box/Bunch/SteamQuantity와 저장 후 대조.
- 저장 중 이중 클릭 차단. 동일 연도/차수/농장/파일명/인보이스/AWB의 활성 원장은
  재등록 차단하여 응답 유실 재시도 중복 방지. 변경 파일은 기존 원장을 확인한 뒤 처리.

## 동시성 및 부작용

|동작|Product|입고 원장|TempWarehouseDetail|StockHistory/ProductStock|주문/출고/견적/매출|
|---|---|---|---|---|---|
|조회·검증·선택|읽기|보존|보존|보존|보존|
|저장|native SP의 Stock 증가|Master + native SP Detail 생성|배타 잠금, 처리 완료가 증명된 잔여행만 교체|native SP 기록/재계산|보존|
|실패|롤백|롤백|롤백|롤백|보존|

공용 staging은 앱 잠금에 더해 TABLOCKX/HOLDLOCK으로 EXE 동시 BulkCopy도 차단.
기존 staging의 모든 필드와 중복 건수가 이미 WarehouseDetail에 존재하는지 비교한다.
ProdName은 Detail에 저장되지 않으므로 현재 이름이 아닌 저장된 ProdKey와 수량/가격/코드를 대조한다.
미처리 staging이 하나라도 있으면 EXE의 진행 중 파일을 삭제하지 않고 업로드 거부.
채번은 EXE와 같은 usp_GetNextKey('WarehouseKey'), 비정상/충돌 키는 롤백.
고정된 Product 읽기 잠금으로 검증→SP 사이 이름 변경을 방지한다.

## 완료 기준

정상/미등록/동명/삭제/선택 키 위조/숫자 오류/교차연도 fixture, staging 미처리 보호,
native SP 실패 및 재고계산 실패 롤백 검증. ERP 필수 gate와 build, 1920×1080 UI
및 작은 viewport 검증 후 배포. 실제 운영 입고를 테스트 목적으로 생성하지 않는다.
