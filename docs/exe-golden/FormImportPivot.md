# 수입부 Pivot — nenova.exe 입고 조회 경계 기록

## 확인 근거

수입부 Pivot은 웹 전용 집계/정산 화면이다. `nenova.exe`의 원천 입고 조회는
`FormWarehouseView.GetData`를 기준으로 확인했으며, 웹은 같은 입고 원장을 읽고
결제일 설정만 `WebImportFarmPaymentDay`에 별도로 저장한다.

dnSpy CLI 확인 명령:

```powershell
& 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe' --no-color -t FormWarehouseView 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
```

확인된 `FormWarehouseView` 메서드와 범위:

- `GetData`: `WarehouseMaster`와 집계된 `WarehouseDetail`을 읽고 `OrderYear`,
  `OrderWeek`, `FarmName`, `InvoiceNo`, `InputDate`를 표시한다.
- `btnSearch_Click`: `GetData`를 다시 호출하는 새로고침 동작이다.
- `grdViewMaster_FocusedRowChanged` / `GetDetail`: 선택한 `WarehouseKey`의 상세를 읽는다.
- `btnExcel_Click`: 선택된 `WarehouseKey` 상세만 엑셀로 내보내는 EXE 동작이다.

웹 수입부 Pivot은 이 원천 범위를 차수 범위로 집계한다. FarmName은 입고 헤더의
농장명 그대로 사용하며, `Farm` 마스터와 이름이 일치하지 않아도 원장 행을 숨기지
않는다. 결제일 설정은 EXE 원장과 무관한 웹 설정이다.

## 부작용 표

| 동작 | WarehouseMaster/Detail | Order/Shipment/Stock | WebImportFarmPaymentDay |
|---|---|---|---|
| 페이지 자동 조회 | 읽기 | 보존 | 읽기 |
| 농장 선택/결제일 필터 | 읽기 | 보존 | 읽기 |
| 농장별 결제일 저장 | 보존 | 보존 | 해당 FarmName 1행 upsert |
| 선택 농장 정산서 보기/엑셀 | 읽기 | 보존 | 읽기 |

결제일 설정은 `FarmName`별 공통 설정이며, 같은 농장명이 여러 차수에 나타나도
공통으로 적용된다. 5/15/25 이외 값은 저장하지 않는다.
