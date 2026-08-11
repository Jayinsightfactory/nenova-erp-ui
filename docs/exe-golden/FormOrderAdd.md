# FormOrderAdd 주문등록 근거

- EXE: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\FormOrderAdd.cs`
- 확인 메서드: `btnSave_Click`, `UnitQuantity`
- `btnSave_Click`는 `OrderMaster`에 연도·차수·담당자·업체를 저장한 뒤 `OrderDetail` 수량과 `OrderHistory`를 저장한다.
- 새 웹 메뉴는 `source=my-customer` 주문 수량 추가 전용이다. `OrderMaster`/`OrderDetail`/`OrderHistory`만 변경하고 출고·견적·손익 원장은 보존한다.
- 업무키는 `OrderYear + OrderWeek + CustKey + ProdKey`이며 이전 연도 같은 차수 Master를 재사용하지 않는다.

배포 스모크는 읽기 전용으로 수행한다. 실제 업무 등록 뒤에는 같은 네 키의 `ViewOrder`를 재조회하며 `ViewShipment`, `ShipmentDate`, `Estimate`, `WebProfitReport`를 직접 쓰지 않는다.
