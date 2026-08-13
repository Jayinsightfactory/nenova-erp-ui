# FormOrderAdd 주문등록 근거

- EXE: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\FormOrderAdd.cs`
- 확인 메서드: `btnSave_Click`, `UnitQuantity`, `MergeDataBefore`
- `btnSave_Click`는 `OrderMaster`에 연도·차수·담당자·업체를 저장한 뒤 `OrderDetail` 수량과 `OrderHistory`를 저장한다.
- 새 웹 메뉴는 `source=my-customer` 주문 수량 추가 전용이다. `OrderMaster`/`OrderDetail`/`OrderHistory`만 변경하고 출고·견적·손익 원장은 보존한다.
- 업무키는 `OrderYear + OrderWeek + CustKey + ProdKey`이며 이전 연도 같은 차수 Master를 재사용하지 않는다.
- EXE의 지난 주문 불러오기는 선택 업체의 `CustKey`, 선택 `OrderYear`, 현재 `OrderWeek`보다 작은 주문 중 가장 최근 `OrderMasterKey`를 찾고 `MergeDataBefore`로 품목별 수량을 현재 입력 그리드에 복사한다. 웹도 같은 연도·정확한 업체·이전 차수만 조회하며, 불러온 값의 삭제는 초안에서 제외하는 동작일 뿐 기존 `OrderDetail`을 삭제하지 않는다.
- EXE 분류는 `FlowerName` 단독이 아니다. `FormProductAdd`는 `Flower.FlowerName`을 `Product.FlowerName`에 저장하면서 국가의 `isSelectFlower` 값에 따라 `Product.CountryFlower`를 국가명 또는 `국가명 + FlowerName`으로 함께 저장한다.
- `FormOrderAdd.GetDataCountry`는 `CountryFlower`를 먼저 표시하고, `LoadProductData`는 `CountryFlower + FlowerName`으로 품목을 필터링한다. 웹의 내 업체 주문등록도 저장된 `Product.CountryFlower`를 우선 그룹명으로 사용하고, 값이 비어 있는 레거시 행만 계산값으로 대체한다.

배포 스모크는 읽기 전용으로 수행한다. 실제 업무 등록 뒤에는 같은 네 키의 `ViewOrder`를 재조회하며 `ViewShipment`, `ShipmentDate`, `Estimate`, `WebProfitReport`를 직접 쓰지 않는다.
