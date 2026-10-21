# 업로드 주문 → EXE 분배 헤더 누락 재발 방지 — 2026-10-21

## 구현 전 원인·기준 확인

실제 설치 Nenova.exe SHA256 FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79.
`dnSpy.Console.exe --no-color -t FormOrderAdd` 재실행: 주문 저장 시 빈 ShipmentMaster를 생성한다.
FormShipmentDistribution.GetShipmentMaster는 그 헤더를 SELECT만 하고 DBMSSQL.GetIntScalar는
조회 결과가 없을 때 null을 int로 변환한다. WarningMSG 예외 및 이후 key0 위험이 있는 native 전제다.
피벗 음수 패치는 FormQuantityPivot.GetData의 2바이트 변경으로 이 경로를 변경하지 않았다.

운영 SELECT-only: 2026/43-01/유오디아 꽃마을/ProdKey2226 주문10, 출고헤더0을 확인했다.
SystemActionLog 2026-10-09 11:35:37.683 ORDER_WRITE /api/orders SUCCESS의 payload를
정확 CustKey로 대조: source=order-import-final, year=2026, week=2026-43-01,
ProdKey2226 qty1 unit박스. OrderDetail 생성시각11:35:36.777과 일치한다.
웹 해당 경로는 isMyCustomerSource에 포함되어 ensureShipmentMaster=false였다.
따라서 웹 주문 업로드의 native 호환 누락이다. 사용자의 0→10 입력 오류가 아니다.
이 기록은 native 실행파일 자체의 최신 피벗 패치와 관련되지 않는다.

## 기준 원천과 소비 지점

| 기준 | 근거 | 구현 |
|---|---|---|
| 업로드 최종본만 추가 예외 | 실제 감사 source, 사용자의 재발방지 요구 | isFinalSnapshotSource |
| 연도+세부차수+업체 | native 조회 및 운영 probe | 기존 잠금 조회 재사용 |
| 활성 fixed 우선/최소key 재사용 | ERP invariants | 기존 ORDER BY 유지 |
| raw 연도+대차수/견적명 | fresh FormOrderAdd | 기존 생성 코드 유지 |
| PK non-identity | sys.columns read-only | 기존 safeNextKey+retry+sync 유지 |
| 전체 실패 롤백 | 기존 withTransaction | 헤더/주문/이력 같은 트랜잭션 |

## 동작별 부작용

- 업로드 최종본: OrderMaster/Detail/History 기존 최종수량 계약. ShipmentMaster 없을 때만 빈
  미확정 헤더 생성, 있으면 보존. ShipmentDetail/Date/Farm/Estimate/Stock/WebProfitReport 보존.
- 내 업체/영업 붙여넣기: 기존 별도 주문 전용 계약 유지. 이번 사건의 원천이 아니므로 확장하지 않음.
- 재시도: 헤더와 동일 최종수량 재사용, 가산/중복/확정 없음.
- 실패: 신규 헤더 포함 전체 롤백. 빈 출고 상세나 가짜 0 주문 생성 없음.

## 검증 및 한계

실제 createOrder를 실행하는 transactional fixture: 신규/재시도/전년도/다른업체/세부차수/
삭제헤더/기존확정헤더/삽입실패/후속품목실패 롤백. 단위1박스→10단 검사.
기존 브라우저 분배 저장으로 요청한 10단 복구는 앞선 작업에서 완료되었으며 이번 코드 테스트에
운영 쓰기를 사용하지 않는다. 운영확인에는 ViewOrder/ViewShipment/ShipmentDate, DetailFix,
Amount/Vat 및 매출·견적 읽기 결과를 구분한다. 실제 EXE 재조회는 미검증.

초기 검토한 EXE 자체의 누락 헤더 생성 패치는 구현하지 않는다. 감사 기록으로 확인된 웹 원천을
기존 검증된 헤더 준비 분기에 연결한다. 기존 다른 누락 자료 전체 자동보정 또는 모든 native
오류 해결을 주장하지 않는다. 웹 배포가 적용점이며 이번 변경에 EXE 재설치는 필요하지 않다.

메뉴 기준선: 적용=입력 최종값·명시 저장·원자성·연도 격리 보존. 해당 없음=화면틀·스크롤·키보드
변경(서버 저장 분기만 수정). 예외=업로드의 과거 ShipmentMaster 무조건 보존 계약을 호환 근거로 정정.
