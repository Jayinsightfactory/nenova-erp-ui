# 견적서관리 단가/수량 변경 재검증 (2026-05-26)

## 요청

견적서관리 탭에서 단가 또는 수량을 변경했을 때 오류가 생길 수 있는지, 출고일분배와 확정 상태를 포함해 전반적으로 문제 없는지 재검증한다.

## 수량 변경 검증

대상: `pages/api/estimate/update-quantity.js`

현재 보호장치:

- 확정된 `ShipmentMaster`는 수량 변경 차단
- `ShipmentDetail.ShipmentDtm`이 없으면 차단
- `ShipmentDate`가 0건이면 차단
- `ShipmentDate`가 2건 이상이면 차단
- 조회 시점 수량과 현재 DB 수량이 다르면 `STALE_DATA`로 차단

판단:

- 일반적인 단일 출고일 출고는 수량 변경 가능
- 여러 출고일로 나뉜 출고는 견적서관리에서 수량을 덮어쓰지 못하게 막혀 있음
- 출고일분배가 깨질 수 있는 경로는 현재 차단되어 있음

## 단가 변경 검증

대상: `pages/api/estimate/update-cost.js`

기존 위험:

- 단가 변경은 수량과 재고를 바꾸지 않는데도 확정된 `ShipmentMaster.isFix`를 트랜잭션 안에서 잠깐 0으로 내렸다가 1로 되돌렸다.
- 아주 짧은 순간이라도 확정 상태가 흔들리면 견적 조회, 전산 확정, 웹 확정과 겹칠 때 불필요한 충돌 여지가 있다.

반영한 수정:

- 단가 변경 시 `ShipmentMaster.isFix`를 더 이상 변경하지 않음
- `ShipmentMaster`와 `ShipmentDetail`은 잠금으로 확인하되, `ShipmentDetail.Cost`, `Amount`, `Vat`만 단일 트랜잭션으로 수정
- 화면 진행 문구도 "확정 상태 유지 -> 단가/금액 수정"으로 변경

## 남은 주의점

- 단가 변경 이력은 현재 `ShipmentDetail.Descr`에 남고, `ShipmentHistory`에는 남기지 않는다.
- `nenova.exe`가 단가 변경 이력을 별도 테이블/SP로 남기는 구조라면 추가 parity 작업이 필요하다.
- 알스트로처럼 견적 출력 단위가 송이인 품목의 실제 단가 기준이 송이/단/박스 중 무엇인지는 운영 단가 정책 확인이 필요하다. 이번 수정은 기존 금액 계산식을 바꾸지 않았다.

