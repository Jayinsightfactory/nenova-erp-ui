# Nenova.exe dnSpy/CLI 선검증 고정 절차

NenovaWeb의 주문·출고·분배·입고·재고·견적·정산 기능을 추가하거나 수정할 때는 코드를 먼저 작성하지 않는다. 실제 `nenova.exe` 또는 저장된 decompile 소스를 dnSpy/CLI로 확인하고, 같은 DB의 읽기 전용 결과를 대조한 뒤 구현한다.

## 1. 필수 증거

작업 기록에 아래 항목을 남긴다.

- exe 원본: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile 소스: `C:\Users\USER\nenova-decompiled\Nenova`
- 대상 Form/Class/메서드 이름
- 조회 SQL과 WHERE/JOIN 업무키
- 저장 테이블·컬럼·트랜잭션 순서
- 저장 프로시저 이름과 파라미터(사용하는 경우)
- 읽기 전용 운영 DB probe 결과
- 웹 구현과 exe 구현의 차이·부작용 표

## 2. 확인 순서

1. 대상 기능을 Form 단위로 찾고 dnSpy CLI로 실제 EXE를 decompile한다. 예:
   ```powershell
   & 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe' --no-color -t FormShipmentDistribution 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
   ```
2. 조회 메서드를 찾는다. 예: `GetCustomerList`, `grdViewShipment_FocusedRowChanged`.
3. 저장 이벤트를 찾는다. 예: `btnSave_Click`, `btnDistribution_Click`.
4. `ShipmentFarm`, `ShipmentDate`, `OrderYear`, `OrderWeek`, `CustKey`, `ProdKey`, `FarmKey` 문자열과 호출 SP를 추출한다.
5. decompile SQL의 `JOIN`, `WHERE`, `INSERT/UPDATE/DELETE`, 트랜잭션 순서를 기록한다.
6. 같은 업무키로 웹 DB를 읽기 전용 대조한다. 운영 데이터는 이 단계에서 수정하지 않는다.
7. 웹 기능 계약 JSON, 순수 정책 테스트, 교차연도 fixture를 작성한 뒤 구현한다.
8. 배포 전 계약검사·SQL scope 검사·빌드·exe parity probe를 통과시킨다.

## 3. 이번 출고분배의 확정 근거

decompile 파일: `C:\Users\USER\nenova-decompiled\Nenova\FormShipmentDistribution.cs`

- `GetCustomerList`는 `ViewOrder + ViewShipment + ShipmentDate + Customer`로 업체 목록을 만든다. `ShipmentFarm`은 상단 업체 목록의 필수 JOIN이 아니다.
- `grdViewShipment_FocusedRowChanged`는 `ViewWarehouse -> Farm`으로 농장 후보를 만들고, `ShipmentFarm(SdetailKey)`를 합산해 하단 농장표를 만든다.
- `btnSave_Click`은 `ShipmentDetail` 저장 후 수정된 `dtFarm`의 유효 `FarmKey`를 `ClassShipmentFarm.Insert()`로 저장하고, 단위수량이 변하면 `ShipmentDate`를 삭제 후 재생성한다.
- `ClassShipmentFarm.Insert()`의 실제 컬럼은 `(FarmKey, ShipmentQuantity, SdetailKey)`이다.

이 근거 없이 `ShipmentFarm`을 임의 FarmKey로 생성하거나 `ViewOrder/ViewShipment`만 확인하고 exe 호환 완료로 판정하지 않는다.

## 4. 금지

- 웹 화면이 정상이라는 이유로 exe 호환을 추정하지 않는다.
- 운영 DB에 임의 `FarmKey`, `Manager`, `OrderYearWeek`, `ShipmentDate`를 보정하지 않는다.
- decompile 근거 없이 기존 SP를 대체하거나 새 직접 INSERT 경로를 추가하지 않는다.
- 기능 추가 후 문서만 갱신하고 테스트·probe를 생략하지 않는다.
