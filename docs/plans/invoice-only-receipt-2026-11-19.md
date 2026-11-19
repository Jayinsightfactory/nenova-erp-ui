# 인보이스 단독 입고 등록

| 작업 | 입고·재고 | 도착원가 | 주문·출고·견적·손익 |
|---|---|---|---|
| PDF 선택·품목 대조·서버 미리보기 | 조회 | 원가 계산 및 저장 없음 | 보존 |
| 명시 입고 승인 | 기존 writer의 WarehouseMaster·WarehouseDetail·StockHistory·Product·ProductStock 및 웹 작업 이력 | `PENDING`, 원가 실행 없음 | OrderDetail·ShipmentDetail(Amount/Vat/isFix)·ShipmentDate·ShipmentFarm·Estimate·WebProfitReport 쓰기 없음 |
| 저장 완료 후 원가 작업 선택 | 이미 확인한 동일 문서·revision·연도·차수·WarehouseKey로 조회 | 기존 원가 사용자 실행 경로 | 보존 |

연도·차수·송장·농장과 박스·단·송이·단위환산·출고/견적수량·단가·금액 매핑 및 원자적 쓰기 순서는 기존 `invoiceReceiptWriter`를 유지한다. 설치된 nenova.exe의 `ExcelLoadingPackingList.MakeTempTable` 및 `InsertMaster`를 dnSpy CLI로 다시 확인했다. 입고 헤더 생성→`uspCreateWarehouse`→`uspStockCalculation` 순서이며 원문 박스/단/송이/가격을 별개로 읽는다. 운영 읽기 SQL에서 `OrderNo`, `GrossWeight`, `ChargeableWeight`, `FreightRateUSD`, `DocFeeUSD`의 NULL 허용과 2026/47-02 송장 18065의 8행·27박스·405단·8,100송이·1,741.50, 2025 동차수 동일 송장 없음 확인.

인보이스 번호·발행일·통화·공급자·품목·수량·단가·금액은 원본/기존 검토 규칙의 적용을 받는다. AWB 첨부 없이 검증된 인보이스 입력은 등록할 수 있다. AWB를 반영할 때는 번호·포장 수·GW/CW·원문 지문 검증을 유지한다. 인보이스에 확인 가능한 값은 기존 매핑을 사용하며 미확인 중량·운임·수수료는 NULL, 원가 환율·공식·운임 배부는 별도 작업에서 확인한다. 출고 정책의 차수·품목 기준과 다른 연도 비교, 기존 중복 방지·원가 승인 하위 계약을 유지한다.
