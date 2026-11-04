# FormOrderHistory — 발주 관리(주문 변경 이력 피벗)

Source: `C:\Users\USER\nenova-decompiled\Nenova\FormOrderHistory.cs`, `FormOrderHistory.Designer.cs` (dnSpy export, read-only 분석)

## 2026-11-04 웹 /warehouse 발주관리 exe 동일 재구성
- `FormOrderHistory_Load` → `SetComobo()` + `GetData()`. SetComobo는 `LogicManager.Common.GetOrderWeek()`(StockMaster OrderYear/OrderWeek DESC) 첫 행을 기본 차수로, `GetCountryFlower(true)`(빈값 + ViewCountry) 를 품목 룩업으로 사용.
- `GetData` SQL: `ViewOrder o JOIN OrderHistory oh ON o.OrderDetailKey = oh.OrderDetailKey JOIN Customer c JOIN Product p JOIN UserInfo u`, 값은 `(oh.AfterValue - ISNULL(oh.BeforeValue,0)) AfterValue`. 선택 시 `AND o.OrderWeek = '...'`, `AND p.CountryFlower = '...'` (웹은 `@week`, `@countryFlower` 바인딩).
- PivotGrid `pgrdHistory` 배치(Designer): 행 CounName·FlowerName·ProdName·OrderCode(C.N.), 열 ChangeDtm(입력일자), 값 AfterValue(변경수량), 필터 OrderWeek·CustName·OutUnit. `btnExcel_Click` → `ExportToXlsx` WYSIWYG.
- 웹 포팅: `lib/orderHistoryPivotSql.js`(SQL 문자열 그대로), `pages/api/warehouse/order-history-pivot.js`(withAuth GET, SELECT only, `?mode=lookups`), `lib/orderHistoryPivotFields.js`(필드 레지스트리·기본 배치), `components/OrderHistoryPivotPanel.js`. 기존 WarehouseDetail 입고 피벗은 "기존 웹 피벗" 토글로 보존.
- 쓰기 없음: OrderMaster/OrderDetail/OrderHistory/ShipmentMaster/ShipmentDetail/WarehouseDetail 모두 읽기만. 로컬 검증 39-02 → 2,523행, 피벗 1,273행/30 일자 열.
