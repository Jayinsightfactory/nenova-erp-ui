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

## 호텔+미우 통합게시판 주문입력 (웹 전용 입력면)

- 화면 `/sales/shilla-miu-board`는 이미지·텍스트 발주를 한 업체·차수로 합친 뒤, **합산을 웹 원장에 먼저 쌓고** 마지막에 `POST /api/orders` `source=hotel-miu-board`로 **주문수량만 가산**한다.
- EXE `FormOrderAdd.btnSave_Click`와 같이 `OrderMaster`/`OrderDetail`/`OrderHistory`만 쓰고, `ensureShipmentMaster`는 `raum-pnl`일 때만 켜지므로 이 소스는 `ShipmentMaster`/`ShipmentDetail`/`ShipmentDate`/`Estimate`를 만들지 않는다.
- 공통 `order-mappings.json`은 초기 매칭 읽기만 하고, 이 게시판에서 고친 품목은 `WebHotelMiuProductMap` overlay가 덮는다. `persistImportMatchMappings`/`saveMapping`(공통 파일)은 호출하지 않는다.
- 1차/2차 입력 이력은 웹 전용 `WebHotelMiuIntakeBatch`/`WebHotelMiuIntakeLine`에 남기고, 수정 시 차이 수량(부호 있는 delta)만 다시 `createOrder`에 보낸다.
- 발주표의 `대`는 박스가 아니라 스팀(송이)이다. `normalizeImportUnit`/`normalizeOrderUnit`이 대→송이로 맞춘다. `67박스(2010대)`처럼 박스 수량이 앞에 있으면 주문단위는 박스다.
- `createOrder`는 같은 `OrderYear+OrderWeek+CustKey+ProdKey`의 숨긴(`isDeleted=1`) OrderMaster/OrderDetail를 재사용한다. EXE `FormOrderAdd.GetDataProduct`는 활성 행만 보여 주므로, 수량 0으로 숨긴 행 옆에 새 행을 INSERT하면 전산 화면은 비어 있고 웹 내역만 남는다.
- 호텔+미우 합산 삭제의 음수 delta는 주문등록(재고계산 ~50초)과 겹치면 방금 더한 수량을 다시 뺀다. 화면 `writeLock`과 `disabled={!!busy}`로 겹친 POST를 막는다. 이미 빠진 수량은 차수 팝업의 **등록내역을 전산에 다시 더하기**로 스냅샷 `afterQty`를 가산한다.
- 합산 삭제/수정이 전산 잔량보다 큰 취소를 보내면 `resolveHotelMiuOverflowCancel`이 남은 `OutQuantity`를 0으로 숨긴다. paste/my-customer 는 기존처럼 거부한다. 수국 화이트 0.33박스 leftover에 1440송이 취소를 보내도 합산 카드는 지워진다.
- REGISTERED 합산을 통째로 지우면 전산에서 빼는 값은 합산 원문(반올림 전)이 아니라 주문등록 스냅샷의 반올림 후(`afterQty`)다. 6단을 1박스로 올려 등록한 뒤 합산을 지우면 1박스가 빠진다.
- 합산 수정에서 품목을 다시 매칭하면, DRAFT는 웹 합산 줄만 바꾸고, 이미 주문에 더한 합산은 이전 `ProdKey`를 빼고 새 `ProdKey`를 같은 수량으로 더한다. 출고분배는 하지 않는다.
- 주문등록 확인표의 반올림/반내림 버튼 옆에 결과 박스 수량을 붙인다. 박스당 단·송이 계수가 틀리면 그 칸에서 고친다. 고친 값은 `WebHotelMiuProductMap` overlay 토큰 `prodbox:{ProdKey}`에 저장되어 다음 확인표에 다시 나온다. `Product` 마스터와 출고분배는 바꾸지 않는다.
- 주문등록 후 **주문반영 내역**에 반올림 전(합산 원문)과 반올림 후(주문에 더한 수량)를 상시 표시한다. 차수 버튼 팝업에도 같은 표가 있다.
