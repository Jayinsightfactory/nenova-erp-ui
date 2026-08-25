# 붙여넣기 주문등록 저장 후 전산 대조 보강

## 확인된 원인

- `POST /api/shipment/adjust`는 SQL 실행이 예외 없이 끝나면 실제 원장과 nenova.exe 조회 뷰를 다시 읽지 않고 성공을 반환했다.
- 업체별 일괄 버튼은 품목마다 단건 API를 순서대로 호출해, 뒤 항목 실패 시 앞 항목만 반영되는 부분 성공이 가능했다.
- 화면의 주문·분배 재조회가 실패해도 완료 메시지를 유지했다.
- 운영 작업기록의 `SHIPMENT_ADJUST_BATCH` 성공행이 `AffectedCount=0`으로 남아 실제 반영 건수를 작업기록만으로 판정할 수 없었다.

## 수정 계약

| 사용자 행동 | 주문 | 분배 | 출고일 | 저장 후 판정 |
|---|---|---|---|---|
| 붙여넣기 등록만 | 입력 정책대로 변경 | 보존 | 보존 | raw OrderDetail과 ViewOrder가 예정 수량과 같아야 완료 |
| 붙여넣기 추가+분배 | 기존 정책대로 증가 | 증가 | 분배 합계로 동기화 | raw Order/Shipment, ViewOrder/ViewShipment, ShipmentDate가 모두 같아야 완료 |
| 붙여넣기 취소 | AUTO_CANCEL 계약대로 주문 보존 | 감소 | 분배 합계로 동기화/0 정리 | 위 다섯 원천이 모두 같아야 완료 |
| 업체별/전체 일괄 | 위 정책 반복 | 위 정책 반복 | 위 정책 반복 | 모든 행을 한 트랜잭션으로 처리하고 한 행이라도 불일치하면 전체 롤백 |

업무키는 모든 조회와 쓰기에서 `OrderYear + OrderWeek + CustKey + ProdKey`를 사용한다. 2025년과 2026년의 같은 차수를 섞지 않는다.

## nenova.exe 호환 근거

- `FormShipmentDistribution.btnSave_Click`: 한 품목은 ShipmentDetail 한 행으로 저장하고 ShipmentDate 합계가 출고수량을 구성한다.
- `FormShipmentDistribution.GetCustomerList`/업체 선택 조회: ViewOrder/ViewShipment에 노출되어야 전산 화면에서 확인 가능하다.
- 따라서 raw 테이블 저장만 확인하지 않고 ViewOrder, ViewShipment, ShipmentDate까지 같은 트랜잭션 안에서 재조회한다.

## 오류 처리

- 누락, 중복행, 업체키 불일치, 전산 뷰 미노출, 수량 불일치, 출고일 합계 불일치는 `SHIPMENT_POST_WRITE_MISMATCH` 또는 `ORDER_POST_WRITE_MISMATCH`로 중단한다.
- 오류는 저장 트랜잭션 내부에서 발생하므로 앞서 실행된 항목도 모두 롤백된다.
- 화면은 `success=true`와 `verified=true`가 함께 있을 때만 완료로 표시하고 매칭 학습을 기록한다.
- 일괄 작업기록에는 실제 `committedCount`와 `verifiedCount`를 남긴다.

## 운영 증거와 제한

- 2026-08-25 읽기 전용 작업기록 확인에서 최근 `SHIPMENT_ADJUST_BATCH` 성공행들이 영향 건수 0으로 기록된 사실을 확인했다. 이는 기존 성공 판정이 실제 재조회 결과를 포함하지 않았음을 보여준다.
- 과거 작업기록만으로 해당 행의 실제 현재 수량을 단정하거나 자동 재실행하지 않는다. 배포 이후 새 요청부터 서버가 저장 직후 원장을 대조한다.
- 검증 과정에서 운영 주문·분배 원장을 수정하지 않는다.
