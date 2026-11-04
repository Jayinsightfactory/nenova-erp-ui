# 입고 농장·품목 수정과 재업로드 검토

검토일: 2026-11-03 (Asia/Seoul). 범위: 조사만, 구현/배포/운영 데이터 변경 없음.
웹 기준: fetch한 origin/master `6428f624e`. 시작 체크아웃은 구버전이므로 최신 master의 별도 작업트리에서 대조했다. 운영 웹 배포 SHA 및 실브라우저 쓰기 동작은 미검증.

## 판정

현재 웹/EXE의 업로드는 기존 입고 교체가 아니라 신규 등록이다. 같은 파일명·인보이스·AWB로 재업로드해도 기존 원장을 식별하여 교체하는 경로가 없다. 저장이 허용되면 추가 입고로 합산된다. 재업로드 수정 기능은 구현 가능하지만 기존 업로드 버튼 재사용만으로는 안 된다.

## 확인 근거

- `pages/incoming.js:204` handleUpload: POST `/api/warehouse`, 기존 선택 WarehouseKey를 교체 대상으로 보내지 않는다.
- `pages/api/warehouse/index.js` uploadWarehouse: 품목명 정확 일치/전체 검증 → 확정 검사 → 공용 staging 잠금 → 새 WarehouseMaster INSERT → TempWarehouseDetail → usp_CreateWarehouse → usp_StockCalculation(year, week, 0). 중복 파일/인보이스 비교 및 기존행 교체 없음.
- 같은 API의 PATCH는 GW/CW/운임/서류비만 수정하며 FarmName/ProdKey 수정 API가 아니다. 상세 API는 조회 경로다.
- 최신 `docs/contracts/warehouse-upload.json`은 신규 생성 계약이다. 교체 업로드 계약은 아니다.
- `docs/exe-golden/FormWarehouseUpload.md`, `docs/NENOVA_DNSPY_CLI_WORKFLOW.md`, `docs/DB_STRUCTURE.md`, ERP 가드/체크리스트/호환 불변식 및 WEB_VS_ERP_CONFLICTS의 ViewWarehouse 정의를 대조했다. golden의 2026-10-08 정정(공용 staging 전체 소비, EXE 확정 검사 누락 가능성)을 적용했다.

실제 설치 EXE에 아래 명령을 각 타입으로 실행했다:

```powershell
& 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe' --no-color -t ExcelLoadingPackingList 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
# 동일 명령 -t FormWarehouseView 및 -t FormWarehouseAdd 실행
```

- ExcelLoadingPackingList.MakeTempTable: GetNextKey("WarehouseKey")로 새 번호, C2 농장명/G2 차수/K2 인보이스/C3 AWB/G3 일자.
- InsertMaster: 새 Master bulk copy → uspCreateWarehouse → uspStockCalculation(year, week, 0).
- FormWarehouseView: 업로드와 상세 수정은 별개. 상세 수정은 FormWarehouseAdd(EditMode=2, warehouseKey, detailKey)를 연다.
- FormWarehouseAdd.btnSave_Click: 기존 WdetailKey의 ProdKey·수량·단가 등을 UPDATE, 선택한 새 품목에 StockHistory 및 Product.Stock 가산, 트랜잭션 종료 후 새 ProdKey만 재계산한다. 품목 A→B 변경 시 원래 A 재고 재계산 호출이 없어 잔존 위험이 있다. 수량 수정도 Product.Stock 이력이 차액이 아닌 새 수량 전액 가산이다. 실제 운영 수정 실험은 하지 않았다.
- ClassWarehouseMaster.Update에는 FarmName 저장 능력이 있지만 확인한 FormWarehouseView/FormWarehouseAdd 흐름에 농장 변경 UI 연결은 확인되지 않는다. 전체 EXE 모든 화면에 기능이 없다고 단정하지 않는다.

## 운영 DB SELECT-only 확인

환경의 연결 설정을 메모리에서만 읽고 자격증명은 출력/저장하지 않았다. 실행 SQL은 OBJECT_DEFINITION/sys.triggers 조회와 아래 원장 대조 SELECT뿐이며 SP는 실행하지 않았다.

- usp_CreateWarehouse 실제 정의: TempWarehouseDetail 전체에서 WarehouseDetail INSERT, StockHistory INSERT, Product.Stock 가산. 기존 입고 교체/중복 제거 없음.
- usp_StockCalculation 실제 정의: 지정 차수부터 이후 StockMaster 차수까지 ProductStock 재계산. ProdKey가 0이면 전체, 양수면 그 품목만 계산. 2025년 이하 거부 및 native stock gate 존재. 이 SP 자체에 Product.Stock 동기화 UPDATE는 없다.
- ViewWarehouse: Master/Detail/Product JOIN, Farm은 이름 LEFT JOIN, `wm.isDeleted=0` 필터.
- 표본 `WarehouseKey=7968 / 2026 / 44-01 / ProdKey=2077`: 상세 1행, OutQuantity=40, 같은 키 ViewWarehouse 합=40.
- WarehouseMaster/WarehouseDetail/ProductStock의 sys.triggers 조회 결과 0행.
- 견적·확정매출의 개별 업무건 전후 비교, 실제 파일 재업로드/수정, 동시 EXE 업로드 재현은 미검증. 사용자가 특정 오입고 건을 지정하지 않아 개별 데이터 정합성 감사로 확대하지 않았다.

## 현재 동작별 영향

| 동작 | 입고 | 재고 | 주문/출고/견적/매출 |
|---|---|---|---|
| 웹/EXE 재업로드 | 새 Master/Detail 추가 | 입고 가산·재계산 | 해당 업로드 코드/SP에서 직접 수정하지 않음 |
| EXE 상세 수정 | 기존 WdetailKey 갱신 | 새 품목 이력·Stock 가산 및 그 품목 재계산 | 해당 저장 메서드의 직접 수정 없음 |
| 웹 원장 삭제 | Master soft delete, 상세 보존 | 전체 품목 ProductStock 재계산 | 해당 API의 직접 수정 없음 |
| 웹 삭제 후 업로드 | 별도 요청으로 삭제·신규 생성 | 두 번 재계산, 새 업로드는 Product.Stock 가산 | 원가 연결/후속 집계 영향 별도 검증 필요 |

웹 삭제는 Product.Stock 차감/삭제 이력이 없어 삭제→재업로드를 안전한 교체와 동일시할 수 없다. 두 요청 사이에 실패하면 기존 입고만 빠지며 새 WarehouseKey/WdetailKey로 연결도 달라진다. FreightCost.WarehouseKey 및 FreightCostDetail.WarehouseDetailKey 연결이 문서에 명시되어 있다.

## 구현한다면 필요한 구조

1. 기존 입고 원장 선택 → 수정 파일 업로드 → 농장/품목/수량/금액 변경 전후 미리보기 → 교체 저장.
2. 식별 기준은 명시 WarehouseKey와 기존 버전. 파일명/농장명/AWB만으로 자동 교체 금지. 농장명 자체가 수정 대상일 수 있다.
3. 농장만 변경하면 헤더와 농장별 정산 영향만 검증하며 입고 수량을 다시 가산하지 않는다. ShipmentFarm의 기존 농장 분배를 자동 이동하지 않는다.
4. 품목·수량 변경은 기존/신규 ProdKey 합집합의 정확한 차액 이력 및 Product.Stock/ProductStock 일관성 확보. 해당 차수 이후 이월과 native gate까지 검사한다.
5. 기존 원가/운임/정산 연결을 명시 처리하고 단순 상세 전체 삭제·재생성으로 연결키를 잃지 않는다. 연결됐거나 확정된 건은 사전 차단 또는 별도 재검증 절차를 둔다.
6. 검증·변경·재계산·결과 확인을 한 트랜잭션으로 묶고 오류 시 전체 롤백. 재시도 중복 방지와 동시 EXE 쓰기 검증 필요. EXE가 같은 applock을 사용한다는 근거가 없어 현재 웹 잠금만으로 공용 staging 안전성을 보장하지 않는다.
7. 주문·ShipmentDetail 수량/Amount/Vat/isFix·ShipmentDate·Estimate·WebProfitReport를 임의 변경하지 않고 영향 진단을 수행한다.
8. 교체 전용 계약, 교차연도, 농장만 변경, A→B, 동일 파일 재시도, 확정/원가연결, 재계산 실패 롤백 fixture 후 ERP 필수 검증을 진행한다.

검토 산출물만 작성했으며 기능 코드 변경이 없어 빌드/쓰기 테스트/배포는 실행하지 않았다.
