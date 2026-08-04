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

## 읽기 전용 probe

동일 연도의 같은 차수와 다른 연도의 같은 차수를 함께 조회할 때도 검색 payload는
`OrderYear`를 별도 전달한다. 도착원가 API는 `OrderMaster`, `ShipmentMaster`,
`ShipmentDetail`, `Estimate`, 재고 프로시저를 호출하지 않는다.

