# 라움 손익계산서·이미지 주문등록 — nenova.exe 근거

## 기능 경계

라움 손익계산서와 이미지 OCR 초안은 웹 전용 화면이다. 이미지·가격·적요·결산 미리보기는 `WebRaumPnl`/`WebRaumPnlItem`에 저장하며, 품목 선택은 기존 `Product` 마스터를 조회한다.

이미지 초안의 주문등록만 nenova.exe 주문등록 경로와 공용 `OrderMaster`/`OrderDetail`에 기록한다. 농장분배(`ShipmentFarm`), 출고수량(`ShipmentDetail.OutQuantity`), 출고일(`ShipmentDate`)은 이미지 주문등록에서 생성하거나 수정하지 않는다. nenova.exe 주문등록 화면이 신규 주문 저장 시 빈 `ShipmentMaster`를 준비하는 동작은 `ShipmentMaster`가 없을 때만 재현하며, 기존 출고 상세는 보존한다.

## dnSpy/CLI 확인

- 원본: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\FormOrderAdd.cs`
- CLI 절차:
  `dnSpy.Console.exe --no-color -t FormOrderAdd "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`
- 현재 환경에서는 비대화형 stdout 핸들에서 dnSpy.Console이 `System.IO.IOException(핸들이 잘못되었습니다)`로 종료되어, 동일 원본에서 생성된 decompile 파일과 read-only SQL 근거를 함께 대조했다.

확인한 FormOrderAdd 동작:

- `CheckExistingOrder`: `CustKey + OrderYear + OrderWeek + isDeleted=0`으로 기존 `OrderMaster`를 찾는다.
- `btnSave_Click`: `ClassOrderMaster.Insert/Update` 후 `OrderDetail`을 `ProdKey`별로 저장하고 `OrderHistory`에 주문수량/미발주수량 이력을 남긴다.
- 신규 저장 시 `ShipmentMaster`가 없으면 `OrderYear + OrderWeek + CustKey`로 빈 마스터를 만들고 `OrderYearWeek = OrderYear + OrderWeek.Substring(0, 2)`를 저장한다.
- `GetDataProduct`: `Product`를 기준으로 기존 `OrderDetail`을 LEFT JOIN하고 `od.isDeleted=0`을 적용한다.

## 웹 구현 불변식

- 업무키: `OrderYear + OrderWeek + CustKey + ProdKey`
- `OrderMaster.Manager`는 `UserInfo.UserID`로 해석한다.
- `OrderYearWeek`는 전산 raw 형식인 `OrderYear + 대차수`만 사용한다.
- 이미지 등록은 100% 매칭·수량 양수 검사를 통과한 뒤 `/api/orders`의 기존 트랜잭션 경로를 사용한다.
- 같은 품목이라도 가격이 다르면 결산 행을 합치지 않는다. 주문등록 요청에서는 가격을 제거하고 `ProdKey + 단위`별 수량만 합산한다.

## read-only downstream 확인 항목

- `ViewOrder`: 선택 연도·차수·라움 `CustKey`·품목이 보이는지
- `OrderDetail`: `BoxQuantity/BunchQuantity/SteamQuantity/OutQuantity/EstQuantity`가 품목 단위 규칙으로 채워지는지
- `ShipmentMaster`: 신규 주문 시 빈 마스터만 생성되고 기존 `ShipmentDetail`이 없는지
- `ShipmentDetail`, `ShipmentDate`, `ShipmentFarm`, `Estimate`, `WebRaumPnl`: 이미지 주문등록 전후 수량/금액/행이 보존되는지
