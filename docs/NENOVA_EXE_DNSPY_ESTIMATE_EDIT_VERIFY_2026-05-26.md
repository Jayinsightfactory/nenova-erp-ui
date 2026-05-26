# Nenova.exe dnSpy 견적서 수정 검증 (2026-05-26)

## 검증 요청

견적서관리에서 단가 또는 수량을 수정할 때, 웹에서 적용한 방식이 `nenova.exe`와 충돌해서 전산 프로그램 오류를 만들 가능성이 있는지 dnSpy 추출물 기준으로 재검증했다.

검증 기준 파일:

- `nenova-members.txt`
- `nenova-key-sql.txt`
- `nenova-il.json`
- `docs/WEB_VS_ERP_CONFLICTS.md`
- `docs/ESTIMATE_EDIT_REVALIDATION_2026-05-26.md`

## dnSpy 추출물에서 확인된 핵심 구조

`nenova.exe`는 출고 확정/취소를 직접 `ShipmentMaster.isFix`만 바꾸는 방식으로 처리하지 않는다.

확인된 호출:

- `DBMSSQL.uspShipmentFix(orderYear, orderWeek, countryFlower)`
- `DBMSSQL.uspShipmentFixCancel(orderYear, orderWeek, countryFlower)`
- `DBMSSQL.uspStockCalculation(orderYear, orderWeek, prodKey)`
- `CommonLogic.CheckFixCancel(orderYearWeek, countryFlower)`

`FormShipmentDistribution.btnFixCancel_Click`는 `CheckFixCancel` 이후 `uspShipmentFixCancel`과 `uspStockCalculation`을 호출한다.

`FormShipmentDistribution.btnSave_Click`는 `ShipmentDetail`, `ShipmentFarm`, `ShipmentDate`를 함께 저장하고, `ShipmentDate`의 출고일/수량까지 맞춘 뒤 트랜잭션으로 처리한다.

`FormEstimateView`는 조회, 출력, 엑셀, 수정/삭제 버튼을 가지고 있지만, 추출된 SQL 문자열 기준으로 견적서 출력/조회는 `ViewShipment`, `ShipmentDate`, `PeriodDay`, `Estimate`, `ProductSort`를 통해 확정 출고 데이터를 읽는 구조다.

## 확정/취소 SP의 의미

기존 분석 문서와 dnSpy 호출 구조 기준:

- `usp_ShipmentFix`
  - 대상: `DetailFix=0`
  - `ShipmentDetail`/`ShipmentMaster` 확정 처리
  - `Product.Stock -= OutQuantity`
  - `StockHistory`, `ShipmentHistory` 기록
  - `ShipmentDate.ShipmentQuantity` 합계와 `ShipmentDetail.OutQuantity` 일치 검증

- `usp_ShipmentFixCancel`
  - 대상: `DetailFix=1`
  - 확정 취소 처리
  - `Product.Stock += OutQuantity`
  - `StockHistory` 기록

따라서 확정된 출고의 수량을 SP 외부에서 직접 바꾸면 다음 위험이 생긴다.

- 확정 당시 차감된 `Product.Stock` 기준과 현재 `ShipmentDetail.OutQuantity`가 달라진다.
- 이후 다시 확정/취소할 때 재고가 추가 차감되거나 복구 수량이 어긋날 수 있다.
- `ShipmentDate` 합계와 `OutQuantity`가 다르면 `usp_ShipmentFix` 검증에서 오류가 날 수 있다.
- `nenova.exe`에서 같은 차수를 열거나 확정할 때 전산 프로그램 오류로 보일 수 있다.

## 현재 웹 구현 검증

### 단가 수정

대상 파일:

- `pages/api/estimate/update-cost.js`

현재 정책:

- 관련 `ShipmentMaster`를 `UPDLOCK, HOLDLOCK`으로 조회한다.
- 하나라도 `isFix=1`이면 `FIXED_WEEK`로 차단한다.
- 확정 차수에서는 웹이 임시로 `isFix=0`으로 내렸다가 다시 `1`로 되돌리지 않는다.
- 미확정 차수에서만 `ShipmentDetail.Cost`, `Amount`, `Vat`을 수정한다.

판정:

- `nenova.exe` 구조와 충돌을 줄이는 방향이 맞다.
- 단가만 바꿔도 확정 상태를 몰래 흔들면 견적 조회, 확정, 취소와 겹칠 수 있으므로 현재의 차단 방식이 더 안전하다.
- 사용자는 전산과 동일하게 먼저 확정현황에서 확정취소 후 단가를 수정하고, 낮은 차수부터 다시 확정해야 한다.

### 수량 수정

대상 파일:

- `pages/api/estimate/update-quantity.js`

현재 정책:

- 확정된 `ShipmentMaster.isFix=1`이면 차단한다.
- `ShipmentDetail.ShipmentDtm`이 없으면 차단한다.
- `ShipmentDate`가 0건이면 차단한다.
- `ShipmentDate`가 2건 이상이면 차단한다.
- 조회 시점 수량과 현재 DB 수량이 다르면 `STALE_DATA`로 차단한다.
- 통과한 경우에만 `ShipmentDetail`과 단일 `ShipmentDate`를 같이 갱신하고 `ShipmentHistory`를 남긴다.
- 수량 환산은 기존 출고 행의 `BoxQuantity` 대비 `BunchQuantity`/`SteamQuantity` 비율을 우선 사용하고, 없으면 상품 마스터 환산값, 마지막으로 화면 조회와 같은 10단/박스 fallback을 사용한다.

판정:

- 확정 출고 수량을 직접 수정하지 못하게 막은 것은 `nenova.exe` 오류 방지에 맞다.
- 출고일 없는 분배 데이터 또는 `ShipmentDate` 누락 데이터를 견적서관리에서 수정하지 못하게 막은 것도 SP 검증 구조와 맞다.
- 단, 여러 출고일로 나뉜 건은 견적서관리에서 단일 출고일로 뭉개면 안 되므로 출고분배 화면에서 처리하도록 차단하는 현재 정책이 안전하다.
- 견적서 화면의 표시 수량 기준과 저장 API의 환산 기준이 다르면 `OutQuantity`가 0 또는 다른 단위로 저장될 수 있으므로, 이 부분을 조회 로직과 맞춰 보정했다.

## 운영 작업 순서 권장

이전차수/전전차수의 단가 또는 수량을 수정해야 할 때는 웹에서도 다음 순서를 유지해야 한다.

1. 확정현황관리에서 필요한 차수 구간을 확정취소한다.
2. 견적서관리에서 단가 또는 수량을 수정한다.
3. 낮은 차수부터 다시 확정한다.
4. 확정 중 deadlock이 나면 재시도 로직이 처리하되, 실패 시 같은 화면에서 다시 확정한다.

웹은 `ShipmentMaster.isFix`를 직접 토글하지 않는다. 저장 버튼에서 확정취소/수정/재확정을 자동 수행할 때도 반드시 전산 SP 경로를 사용하고, 사용자가 진행 로그로 현재 단계를 확인할 수 있게 한다.

## 저장 버튼 자동 확정 사이클 정책

사용자가 견적서관리에서 단가 또는 수량을 수정한 뒤 저장 버튼을 누르면, 웹은 `isFix`를 직접 변경하지 않고 전산 SP 경로만 사용해 다음 순서로 처리한다.

- 수정된 항목 중 가장 낮은 차수를 찾는다.
- 그 차수부터 뒤쪽에 있는 확정 차수만 확정 사이클 대상으로 잡는다.
- 확정해제는 높은 차수부터 낮은 차수 순서로 실행한다.
- 수정값을 저장한다.
- 재확정은 낮은 차수부터 높은 차수 순서로 실행한다.

예시:

- `21-01` 입력값 수정, `21-01`/`21-02` 확정 상태:
  - `21-02` 확정해제
  - `21-01` 확정해제
  - `21-01` 수정값 저장
  - `21-01` 재확정
  - `21-02` 재확정

- `21-02` 입력값 수정:
  - `21-02` 확정해제
  - `21-02` 수정값 저장
  - `21-02` 재확정

이 과정은 견적서관리 화면의 진행 로그에 차수별로 표시한다.

## 남은 위험

이번 검증으로 견적서관리의 단가/수량 수정 정책은 `nenova.exe` 충돌을 줄이는 쪽으로 확인됐다.

다만 다음 항목은 계속 별도 검증 대상이다.

- 출고분배 저장 로직과 `nenova.exe`의 `usp_DistributeOne`, `usp_DistributeTotal`, `usp_DistributeClear` 결과 1:1 비교
- 단가 수정 이력이 `ShipmentDetail.Descr`에만 남는 점
- `ShipmentFarm`까지 포함한 출고분배 세부 이력 parity
- 확정취소 후 재확정 순서를 사용자가 잘못 누르는 경우를 화면에서 더 강하게 안내하는 작업

## 결론

현재 적용한 방식, 즉 확정된 차수의 단가/수량 수정은 차단하고 사용자가 먼저 확정취소 후 수정하게 하는 방식이 `nenova.exe` 구조상 더 안전하다.

`nenova.exe`는 확정/취소를 SP로 처리하면서 `Product.Stock`, `StockHistory`, `ShipmentHistory`, `ShipmentDate` 검증을 함께 수행한다. 따라서 웹에서 확정 상태의 출고 데이터를 직접 수정하거나, 내부에서 몰래 확정취소/재확정을 수행하는 방식보다 현재의 명시적 차단 정책이 전산 오류 예방에 맞다.
