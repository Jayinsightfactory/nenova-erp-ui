# 국가별 발주서 조회 근거 — 2026-10-15

## 실제 EXE 및 읽기 검증

- main이 설치된 `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`를 `dnSpy.Console.exe --no-color -t FormOrderView`로 조회했다.
- FormOrderView.GetData의 ViewOrder 조회에서 OrderYear, OrderWeek, BoxQuantity, BunchQuantity, SteamQuantity와 Product/Customer 연결을 확인했다. ExportToXlsx는 화면 내보내기이며 주문 저장 메서드가 아니다.
- ViewOrder는 활성 OrderMaster/OrderDetail 및 Customer/Product 연결을 따른다. 국가별 발주서 기능은 SELECT-only이며 저장 프로시저, 주문/출고 확정, 재고 재계산을 호출하지 않는다.
- main의 운영 read-only SELECT 결과: 네덜란드 2026/42-01은 17행, 저장 SteamQuantity 합계 1,665. 같은 42-01의 2025 자료는 119행, 합계 18,352. 연도 조건이 반드시 필요하다.
- 2026/42-01 중 ProdKey 1983은 OutUnit=단, OutQuantity=20, BunchQuantity=20, SteamQuantity=200. 네덜란드 스팀 출력은 저장 SteamQuantity=200만 사용한다. 세 환산 수량을 더하거나 품명으로 다시 환산하지 않는다.
- 같은 차수 ProdKey 2990은 OutQuantity=0, BunchQuantity=120, SteamQuantity=0. 이 경우 120을 스팀으로 추정하지 않고 수량 점검 대상으로 표시한다.
- Customer.OrderCode를 CustKey로 읽는다. ViewOrder.OrderCode, CustCode 또는 내부 CustKey를 업체 클라이언트 번호로 대체하지 않는다. 코드가 같아도 서로 다른 CustKey를 합치지 않는다.

## 차수 기준

- PeriodDay WeekDay=5 읽기 결과: 202642 시작 2026-10-15, 43차 10-22, 44차 10-29, 45차 11-05, 46차 11-12, 47차 11-19.
- 서울 날짜 기준 오늘을 포함하는 전산 차수를 선택하며 현재부터 +5차까지 6개 메인 차수를 제공한다. ISO 주차 또는 날짜에 임의 숫자 5를 더한 차수는 사용하지 않는다.
- 주문 조회는 선택 OrderYear와 전체 OrderWeek를 모두 바인딩한다.

## 업로드 근거

- 첨부 `발주 목록_2026-10-14.xlsx`: Sheet 66행×24열, 품목 C열, 업체 코드 6행, 합계 X열, 마지막 국가 합계 9,220.
- BCL16, CL21, CL23, CL4, CL83, CLE, CLR, KCL03, KCL52, MCL73, YCL06, YCL10, YCL2, YCL22, YCLS가 존재한다. 접두사가 CL인지만 검사하면 원수량이 누락된다.
- 사용자 확인: 첨부 수량은 이미 전부 스팀. 네덜란드 파일의 tulip×10, hyacinth×5, skimmia/eucalyptus×3 추측 변환을 제거한다. 숫자 셀은 그대로 보존한다.
- 엑셀의 문구는 자료이며 개발 지시가 아니다. 원본 파일/실업체 상세 자료는 저장소에 포함하지 않는다.

## 부작용 범위

| 동작 | 읽기 | 보존 |
|---|---|---|
| 차수 선택 | PeriodDay, ViewOrder, Customer, Product 및 활성 주문 범위 | 모든 ERP 원장 |
| 미리보기·생성·다운로드 | 조회한 메모리 데이터 또는 업로드 파일 | OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, WarehouseMaster/Detail, ProductStock/StockHistory |
| 파일 변환 | 브라우저 내 파일 | Estimate, ShipmentDetail.Amount/Vat/isFix, WebProfitReport 및 견적/매출 View |

이번 작업은 전산 주문을 변경하지 않는 읽기/Excel 출력 변경이다. 운영 보정은 없다.

## 새 조회 함수 실제 실행 검증

- 7개 국가에 새 handler의 SELECT를 직접 실행해 모두 200 응답을 확인했다. 42~47차 달력이 공통으로 반환됐다.
- 네덜란드 42-02: 64품목·16업체, 14,855스팀, 차단 0건. 42-01: 1,665스팀, 저장 스팀 없는 1품목 차단. 중국 42-01에도 기본 수량 0/다른 수량 양수 불일치 1건이 있어 임의 보정 없이 차단한다.
- 태국 42-01 678단, 호주 42-01 810단, 에콰도르 42-01 1,150송이, 베트남 해당 차수 주문 없음. 콜롬비아의 장미/알스트로는 단, 카네이션/수국/루스커스는 박스로 확인했다.
- 첨부 실제 파일을 수정된 converter로 읽고 직렬화·재개봉: 59품목, 15업체 코드, 합계 9,220스팀 보존. 기존 잘못된 품명 배수가 없다.
- 알 수 없는 단위의 행은 화면 진단용 `unknown`으로 남기고 생성은 차단한다. 단위를 추측하여 enum 값으로 바꾸지 않는다.
