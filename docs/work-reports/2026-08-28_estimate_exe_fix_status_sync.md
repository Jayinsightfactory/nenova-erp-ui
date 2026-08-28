# 견적서관리 nenova.exe 확정현황 동기화

## 원인

- `nenova.exe`의 확정은 `ShipmentMaster.isFix`와 `ShipmentDetail.isFix`를 변경하므로 웹 편집 지문이 달라지는 것이 정상이다.
- 웹은 이 변화를 외부 변경으로 감지했지만, 사용자가 **확정 현황 확인**을 눌러도 기존 작업 기준을 새 원장 기준으로 바꾸지 않았다.
- 명시적 `refresh({ force: true })`도 일반 polling과 같은 digest 비교를 다시 거쳐 stale 상태를 해제하지 못했다.
- 확정현황 모달만 갱신하고 출고 목록·선택 업체 상세는 다시 읽지 않아 체크와 건수가 열린 화면에 남았다.

## 수정 계약

1. 자동 8초 확인과 heartbeat는 계속 외부 변경 감지만 수행한다.
2. 사용자가 **확정 현황 확인** 또는 **확정 현황 다시 불러오기**를 직접 누른 경우에만 현재 원장을 새 기준으로 수용한다.
3. `ShipmentDetail.isFix` 기준 확정현황을 먼저 읽은 뒤, 현재 탭이 소유한 업체 작업권의 기준만 갱신한다.
4. 같은 연도·대차수·업체의 목록과 상세를 다시 읽고 한 번 더 지문을 비교한다.
5. 다른 사용자나 다른 브라우저 탭의 작업권은 넘겨받거나 갱신하지 않는다.
6. 실제 견적 내용 지문에서는 Master/Detail 확정값을 제외하고, 양수 출고 상세행의 확정값은 별도 상태 지문으로 관리한다.
7. 상태 지문만 바뀌면 저장을 막지 않고 출고 목록과 선택 업체를 자동으로 다시 읽는다.

## ERP 영향

| 원장 | 영향 |
|---|---|
| OrderMaster / OrderDetail | 없음 |
| ShipmentMaster / ShipmentDetail | 읽기만 수행 |
| ShipmentDate / ShipmentFarm | 읽기만 수행 |
| Estimate / ProductStock / StockHistory | 없음 |
| WebErpEditLease | 현재 탭이 소유한 업체의 BaselineDigest만 명시적 재조회 시 갱신 |

확정·확정취소 자체의 nenova.exe/dnSpy 계약과 재고 계산은 변경하지 않는다.
