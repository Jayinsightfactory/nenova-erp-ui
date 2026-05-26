# 견적서관리 수량/단가 수정 EXE 호환 검증 (2026-05-26)

## 요청

견적서관리에서 수량 또는 금액을 바꿀 때 출고일 분배, 금액 계산, 확정 처리 방식이 `nenova.exe`와 다르게 동작할 수 있는지 검증한다.

## 확인 범위

- `/estimate` 화면의 수량 수정 버튼
- `/api/estimate/update-quantity`
- `/estimate` 화면의 단가 수정 버튼
- `/api/estimate/update-cost`
- `/api/shipment/distribute`
- `/api/shipment/adjust`
- `/api/shipment/fix`
- 운영 읽기 전용 진단: `/api/shipment/distribute-diagnose?week=21-01`

## 운영 읽기 전용 진단 결과

`21-01` 기준:

- `ShipmentDate` 합계 불일치 또는 `ShipmentDtm` 누락: 0건
- `KeyNumbering` 동기화 필요: 0건
- `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear`, `usp_ShipmentFix`, `usp_ShipmentFixCancel`, `usp_StockCalculation`: 모두 존재
- `ShipmentDetail.CustKey` 누락/불일치: 200건 이상
- `ShipmentDetail.OutQuantity`와 `EstQuantity` 불일치: 200건 이상

주의: `OutQuantity`와 `EstQuantity` 불일치는 전산 저장 단위와 견적 표시 단위가 다를 때 정상적으로 발생할 수 있다. 예를 들어 카네이션 `OutQuantity=1`, `EstQuantity=15` 같은 케이스가 있다. 따라서 이 항목은 즉시 오류로 단정하지 않고 품목 단위별 의미를 확인해야 한다.

## 확인된 차이점

### 1. 견적서 수량 수정은 ShipmentDate를 직접 재작성한다

`/api/estimate/update-quantity`는 `ShipmentDetail`의 수량과 금액을 갱신한 뒤 기존 `ShipmentDate`를 삭제하고 `ShipmentDetail.ShipmentDtm` 기준으로 단일 행을 다시 넣는다.

이 구조는 출고일이 하나뿐인 일반 출고에는 단순하고 안전하지만, `nenova.exe` 또는 출고분배 화면에서 출고일별로 여러 건 분배된 출고에는 위험하다. 견적서관리에서 수량만 고치려다 기존 출고일별 분배가 단일 출고일로 합쳐질 수 있기 때문이다.

조치:

- 출고일이 없는 출고는 견적서관리 수량 수정에서 차단한다.
- `ShipmentDate`가 2건 이상인 출고는 견적서관리 수량 수정에서 차단한다.
- 이런 케이스는 출고분배 화면에서 출고일을 보면서 수정해야 한다.

### 2. 견적서 단가 수정은 확정 상태를 임시 해제 후 직접 갱신한다

`/api/estimate/update-cost`는 관련 `ShipmentMaster`가 확정이면 트랜잭션 안에서 `isFix=0`으로 바꾼 뒤 `ShipmentDetail.Cost`, `Amount`, `Vat`를 직접 수정하고 다시 `isFix=1`로 돌린다.

수량과 재고를 바꾸지는 않기 때문에 `usp_ShipmentFix`를 다시 호출하지 않아도 재고 차감에는 직접 영향이 없다. 다만 `nenova.exe`가 단가 수정 이력을 별도 테이블이나 SP로 남긴다면 웹과 완전히 같다고 볼 수 없다.

현재 웹은 단가 변경 이력을 `ShipmentDetail.Descr`에 추가하지만 `ShipmentHistory`에는 단가 변경 행을 넣지 않는다. 추후 전산의 단가 변경 이력 구조가 확인되면 맞춰야 한다.

### 3. 금액 계산 기준수량은 Bunch 우선이다

현재 견적서 조회, 수량 수정, 단가 수정, 출고분배 저장은 대부분 금액 계산 기준을 다음 순서로 잡는다.

1. `BunchQuantity`
2. `SteamQuantity`
3. `BoxQuantity`

이 방식은 기존 카네이션/장미류와 맞는 경우가 많지만, 최근 확인된 알스트로처럼 실제 견적 표시 단위가 `송이`이어야 하는 품목은 금액 계산 기준도 단가 단위와 함께 다시 검증해야 한다.

이번 작업에서는 출력 표시를 송이 기준으로 맞췄지만, DB 단가가 송이당 단가인지 단/묶음당 단가인지까지 확인하지 못했으므로 계산식을 바꾸지는 않았다.

### 4. 출고분배 저장은 EXE SP와 1:1 경로가 아니다

웹 `/api/shipment/distribute`와 `/api/shipment/adjust`는 `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentHistory`를 직접 갱신한다. 반면 `nenova.exe`의 일괄/개별 출고분배 버튼은 `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear`를 사용한다.

확정/취소는 웹도 `usp_ShipmentFix`, `usp_ShipmentFixCancel`를 호출하도록 맞춰져 있다. 따라서 가장 큰 차이는 “분배 저장” 단계다.

## 이번 코드 보강

파일: `pages/api/estimate/update-quantity.js`

- 출고일 미지정 출고는 수량 수정 차단
- 출고일별 분배가 여러 건인 출고는 수량 수정 차단
- 기존 정상 단일 출고일 수량 수정 흐름은 유지

## 남은 검증 과제

1. `ShipmentDetail.CustKey`가 null인 기존 21-01 출고 200건 이상을 정리할지 결정해야 한다. 신규 웹 경로는 `CustKey=ISNULL(CustKey,@ck)`로 보강되어 있으나, 과거 데이터는 남아 있다.
2. 알스트로 단가가 송이당인지, 박스/단 기준인지 운영 실제 견적서와 전산 화면으로 확인해야 한다.
3. `update-cost`의 단가 변경 이력을 `ShipmentHistory`에도 남겨야 하는지 `nenova.exe` 동작을 dnSpy/DB 로그로 추가 확인해야 한다.
4. 출고분배 저장을 웹 직접 갱신으로 유지할지, `usp_DistributeOne/Total/Clear` 기반으로 전환할지 별도 설계가 필요하다.
