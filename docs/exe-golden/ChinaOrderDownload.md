# 중국 발주 현황 읽기/다운로드 근거 — 2026-10-05

- 실제 EXE: C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe
- CLI: C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe --no-color -t FormQuantityPivot [EXE]
- main actual CLI 결과: FormQuantityPivot.GetData 주문 UNION에서 `vo.OutQuantity Quantity`, `FROM ViewOrder vo`, `WHERE vo.OutQuantity > 0`. btnExcel_Click의 ExportToXlsx는 표시 내보내기이며 ERP 쓰기 없음.
- native ViewOrder는 OrderMaster/OrderDetail 활성행 + Customer/Product 활성행 + Country/UserInfo 조인. 연도/세부차수/업체/품목 identity 유지. 해당 보기의 단일 OutQuantity 사용, 환산열 합산/출고수량 대체 금지.
- 새 페이지는 중국 주문등록 자료 자체를 조회하므로 native 피벗 StockList 연결을 사용하지 않는다. 재고마스터 미생성 차수의 주문도 빠뜨리지 않기 위한 명시 웹 읽기 확장이다. native 원장/view/SP를 수정하지 않는다.
- read-only 운영 GET `/api/stats/pivot-exe?fromYear=2026&fromWeek=37-01&toYear=2026&toWeek=43-99`: 전체20,019행 중 중국 주문1,332행. `/api/master?entity=products`: 첨부416개 중국품목 모두 같은 ProdKey/ProdCode. `/api/estimate/weekday-calendar`로 37~43차 실제 목요일 달력 확인. raw 업무자료와 인증정보는 output에만 두고 커밋하지 않는다.
- 기준 파일 Sheet에는416품목, 명시 HF CODE126개. 보조 review의 closest catalogue code는 후보 참고값이지 확정 HF CODE가 아니다. 이미 입력된HF+No match도 원본검토상태를 숨기지 않는다.
- 조회/재업로드/내보내기 모두 Order/Shipment/Warehouse/Estimate/재고와 Product 변경 없음. 브라우저 업로드 사전은 ERP나 다른 브라우저에 자동 동기화되지 않는다.
- 업체 CL 코드 근거: `docs/DB_STRUCTURE.md` Customer.OrderCode 및 `docs/exe-golden/FormQuantityPivot.md` 거래처 주문코드 기록. native ClassCustomer.OrderCode와 같은 현재 활성 Customer.OrderCode를 CustKey로 읽는다. 주문별 ViewOrder.OrderCode/CustCode/내부키와 혼용하지 않는다. 업체별 발주와 주문상세 XLSX에 문자열로 보존하고, 코드 누락은 임의 보정하지 않는다.
