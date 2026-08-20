# FormArrivalCost — 도착원가 웹 전용 원장 경계

## dnSpy CLI 확인

```powershell
& 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe' --no-color -t FormWarehouseView 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
```

확인 대상은 `FormWarehouseView.GetData`와 `GetDetail`이다. 이 화면은
`WarehouseMaster`와 `WarehouseDetail`을 조회하고, `UPrice/TPrice` 및 품목 정보를
입고 원장 기준으로 표시한다. `nenova.exe`에 별도 도착원가 revision 입력 화면이나
`WebArrivalCost*` 테이블 저장 메서드는 존재하지 않는다.

## 웹 구현 경계

- 원천 조회: `WarehouseMaster`, `WarehouseDetail`, `Product`, `Farm`은 읽기 전용이다.
- 웹 저장: `WebArrivalCostImport`, `WebArrivalCostLine`, `WebArrivalCostHistory`만 사용한다.
- 업로드는 같은 `OrderYear + OrderWeek + CountryName`의 이전 웹 원장 행만
  `IsCurrent=0`으로 만들고 새 revision을 현재본으로 저장한다.
- `Product.Cost`, `WarehouseDetail.UPrice/TPrice`, `ShipmentDetail`, `Estimate`,
  `ProductStock`, `WebProfitReport`에는 자동 반영하지 않는다.
- 매칭되지 않은 품목·농장은 삭제하지 않고 `PRODUCT_REQUIRED` 또는
  `FARM_REQUIRED` 상태로 저장한 뒤 사용자가 전산 키를 선택한다.
- 배분기준은 `엑셀 원식`, `중량`, `부피·용적`, `FOB 금액비례`, `균등배분` 중 하나로
  웹 원장에만 저장하고, 변경 전후는 `WebArrivalCostHistory`에 남긴다.

## 2026-08-20 품목 검색 = 매칭데이터, 차수·국가는 표시

- 도착원가 화면 검색의 업무 키는 매칭데이터(`order-mappings`)가 가리키는 `ProdKey`다.
- `문라이트`처럼 붙여넣기에서 학습된 별칭으로 검색하면 해당 전산 품목 행이 나온다.
- `OrderWeek`와 `CountryName`은 결과 표 표시 값이다. 국가명·차수명만 입력한 검색어는
  품목 필터로 쓰지 않는다.
- 교차연도 충돌을 막기 위해 목록 GET은 계속 `OrderYear`를 받는다. 품목 검색 시 차수는
  선택이며, 비우면 같은 연도의 모든 차수 현재본을 보여 준다.
- `화이트`처럼 여러 품종이 매칭되면 전산 `Product.CountryFlower`(국가+품종) 버튼으로
  좁힌다. `FormOrderAdd`와 같이 `CountryFlower`를 우선하고, 값이 없으면
  `CounName + FlowerName`으로 대체한다. 품목명에서 `화이트붐` 같은 그룹을 만들지 않는다.
- 검색·품종 탭·페이지 조회는 SELECT 전용이다. `OrderDetail`/`ShipmentDetail`/`Estimate`는
  보존한다.

## 읽기 전용 probe

동일 연도의 같은 차수와 다른 연도의 같은 차수를 함께 조회할 때도 검색 payload는
`OrderYear`를 별도 전달한다. 도착원가 API는 `OrderMaster`, `ShipmentMaster`,
`ShipmentDetail`, `Estimate`, 재고 프로시저를 호출하지 않는다.

## 2026-08-07 품종·누락 원가 조회 보강

- 품종 요약과 누락 판정의 ERP 기대 범위는 `WarehouseMaster.OrderYear + OrderWeek`를
  동시에 제한하고 활성 `WarehouseMaster`의 `WarehouseDetail.ProdKey`만 읽는다.
- 같은 연도·차수 현재 `WebArrivalCostLine`에 해당 `ProdKey`가 없으면
  `COST_NOT_UPLOADED`로 표시한다. 0원이나 이전 차수 원가를 사용하지 않는다.
- 품종 선택·검색·페이지 조회는 SELECT 전용이다. 저장 버튼은 기존처럼
  `WebArrivalCostLine` 매칭/배분기준과 `WebArrivalCostHistory`만 변경한다.

