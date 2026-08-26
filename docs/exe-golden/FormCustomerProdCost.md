# FormCustomerProdCost — 최근 거래업체 선택

## 2026-08-26 dnSpy/CLI 실제 확인

`& 'C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe' --no-color -t FormCustomerProdCost 'C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe'`

CLI 실행 성공. SetCombo는 Common.GetCustomer(false)를 CustKey/CustName으로 바인딩하고 GetData는 ClassCustomerProdCost.Select(업체, 국가품종)를 호출한다. btnModify_Click은 수정행의 CustKey+ProdKey를 Delete→Insert(Cost,Descr)하여 ExcuteTransaction한다.

ClassCustomerProdCost.Select 원문은 Product LEFT JOIN CustomerProdCost ON ProdKey+CustKey이며 CountryFlower로 제한한다. 웹의 기존 exeCustomerProdCostSql.js와 일치한다. 이번 변경은 이 SQL과 저장 함수를 변경하지 않는다.

## 웹 전용 목록 표시 기준

사용자 요청으로 검색 전 목록만 최근 거래업체로 좁힌다. EXE 저장 규칙을 변경하는 것이 아니다.

| 동작 | 읽기 | 변경 |
|---|---|---|
| 목록 메타데이터 | Customer, OrderMaster/OrderDetail, ShipmentMaster/ShipmentDetail | 없음 |
| 기본 목록/검색/선택 | 이미 받은 고객 메타데이터 | 브라우저 선택 상태만 |
| 단가 저장 | 기존 CustomerProdCost 경로 | 이번 변경 없음 |

- KST 오늘 포함 90일, 미래 제외. 주문은 OrderMaster.OrderDtm, 출고는 ShipmentDetail.ShipmentDtm.
- ClassOrderMaster/Detail 확인: OrderDtm, OrderMasterKey, OutQuantity, isDeleted 존재.
- ClassShipmentMaster/Detail 확인: ShipmentKey, master isDeleted, detail ShipmentDtm/OutQuantity. Detail isDeleted 가정 금지.
- 빈 마스터만으로 최근 거래로 세지 않는다. 양수 상세가 필요하다.
- 연도는 날짜 범위와 마스터 PK로 구분한다. OrderWeek만으로 JOIN/필터하지 않는다.
- Estimate, ShipmentDate, ShipmentFarm, ShipmentDetail.Amount/Vat/isFix, WebProfitReport, StockHistory/ProductStock 모두 preserve.

## read-only 검증

운영 기존 /master/pricing 화면: 담당자 있는 활성 업체 전체 123개 표시 확인. 직접 DB 접속 환경파일은 없어 독립 SQL probe는 미실행. 신규 SELECT는 배포 후 실제 GET 결과/브라우저로 확인하고 저장은 실행하지 않는다.

최근업체 변경 배포54bedf7 후 운영 브라우저에서 최근77/전체123, 과거 업체 검색 및 검색어 제거 후 복귀를 확인했다.

## 품목 선택 확장 (2026-08-26)

동일 CLI 명령으로 FormCustomerProdCost의 GetData/btnModify_Click을 재확인했다. 품목 체크는 웹 전용 표시·일괄 단가 입력 대상 선택 기능이며 SQL과 API 저장 함수는 변경하지 않는다. 조회한 품목 전체를 초기 선택하고 사용자가 일부를 해제하면 표와 이후 일괄 단가 입력에서 제외한다. 선택 자체는 CustomerProdCost와 모든 ERP 원장을 보존한다. 이미 입력한 미저장 단가를 선택 해제로 삭제하지 않는다.
