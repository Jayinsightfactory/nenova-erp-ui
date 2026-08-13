# 출고 분배수량 수정 재점검

## dnSpy 기준

- 대상: `FormShipmentDistribution.btnSave_Click`
- 업무키: `OrderYear + OrderWeek + CustKey + ProdKey`
- EXE는 그리드 저장 목록을 트랜잭션으로 실행하고 `ShipmentDetail` 저장 뒤 수량 단위가
  바뀌면 `ShipmentDate`를 다시 맞춘다.
- 농장표가 수정된 경우 `ShipmentFarm(FarmKey, ShipmentQuantity, SdetailKey)`도 같은 저장
  흐름에서 처리한다.

## 웹 부작용 행렬

| 사용자 동작 | OrderDetail | ShipmentDetail | ShipmentDate | ShipmentFarm | Estimate/Stock/WebProfitReport |
|---|---|---|---|---|---|
| 양수 신규 | 보존 | INSERT | INSERT/동기화 | 보존 | 보존 |
| 양수 변경 | 보존 | UPDATE | 합계 동기화 | 농장행 존재 시 변경 차단 | 보존 |
| 0으로 변경 | 보존 | DELETE | DELETE | 농장행 존재 시 삭제 차단 | 보존 |
| 여러 행 저장 중 오류 | 보존 | 전체 롤백 | 전체 롤백 | 보존 | 보존 |

## 고정한 회귀

- 화면에서 0수량도 일괄 payload에 포함한다.
- 일괄 payload 전체를 한 DB 트랜잭션으로 처리한다.
- 주문등록의 `일괄 분배`도 같은 일괄 트랜잭션 API를 사용한다.
- 0수량에 대응하는 기존 출고가 없으면 빈 `ShipmentMaster`를 만들지 않는다.
- 동일 업체·품목의 활성 Master/Detail 중복을 발견하면 임의 행을 수정하지 않고 중단한다.
- 기존 농장분배가 있는 상세의 총 분배수량 변경은 조용히 불일치를 만들지 않고 차단한다.
- 기존 단가 입력이 없으면 상세행 단가를 우선 보존한다.

이 작업의 근거 확인과 테스트에는 운영 DB 쓰기를 사용하지 않는다.
