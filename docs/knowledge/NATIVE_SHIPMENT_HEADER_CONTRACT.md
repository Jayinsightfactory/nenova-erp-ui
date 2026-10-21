# 주문과 EXE 출고분배 헤더의 연결 계약

이 문서는 실제 EXE와 운영 보정으로 확인한 규칙이다. 단순한 추정이나 모든 주문 입력 경로에 적용하는 자동 보정 지침이 아니다.

## 연결 헤더란 무엇인가

- `OrderMaster → OrderDetail`: 업체·연도·차수별 주문과 품목별 주문수량.
- `ShipmentMaster`: 업체·연도·차수별 출고의 연결 헤더. 빈 헤더만 있어도 되며 수량을 뜻하지 않는다.
- `ShipmentDetail → ShipmentDate / ShipmentFarm`: 실제 분배수량, 출고일, 농장배정.
- 빈 ShipmentMaster 생성과 실제 출고분배는 별개다. 헤더 보정에 분배량·확정·재고계산을 끼워 넣지 않는다.

## 2026-10-21 dnSpy 확인

실행파일: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
SHA256: `FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79`
CLI: `C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe`
명령: `--no-color -t FormOrderAdd <exe>` 및 `--no-color -t FormShipmentDistribution <exe>`.

1. `FormOrderAdd.btnSave_Click`: 같은 연도·세부차수·업체의 ShipmentMaster가 없으면 주문 저장 목록에 `ClassShipmentMaster.Insert()`를 포함한다.
2. `FormShipmentDistribution.GetShipmentMaster`: `OrderYear + OrderWeek + CustKey`로 ShipmentKey를 SELECT한다. 이 메서드는 없는 헤더를 만들지 않는다. 무행 결과는 native scalar 변환 오류의 원인이 된다.
3. 실제 조회에는 `isDeleted=0` 조건도 정렬도 없다. 삭제 헤더가 있다는 이유로 새 헤더를 추가하면 조회가 모호해질 수 있다. **삭제 포함 전체 헤더가 0건인 확인된 대상만 단순 신규 보정한다.** 이미 존재하거나 중복이면 별도 조사한다.
4. `btnSave_Click`의 후속 단계는 상세 수량과 날짜·농장을 저장한다. 헤더 누락을 이유로 이 후속 분배를 임의 실행하지 않는다.

## 반드시 보존할 생성값과 업무키

| 기준 | 값/규칙 |
|---|---|
| 헤더 업무키 | OrderYear + OrderWeek(세부차수) + CustKey |
| 품목 검증 키 | 위 키 + ProdKey |
| raw OrderYearWeek | 연도 + 대차수. 2026/44-01이면 `202644`, `20264401` 아님 |
| EstimateName | `44차 종합견적서` 같은 대차수 표시명 |
| 신규 상태 | isFix=0, isDeleted=0 |
| 웹 생성 추적 | 배포된 API와 동일한 WebCreated=1, CreateID/CreateDtm |
| 키 | 기존 safeNextKey/tryInsertWithRetry 및 ShipmentMasterKey KeyNumbering 동기화 |

헤더 자체에 Manager나 상세 수량을 임의 추가하지 않는다. OrderMaster.Manager, OrderDetail 수량·환산필드·isDeleted·이력도 그대로 보존한다.

## 웹 입력 경로의 구분

- `order-import-final` / FINAL_SNAPSHOT은 PR1183부터 주문과 같은 transaction 안에서 빈 헤더를 준비한다.
- 정상 업로드는 주문 최종본을 적용하는 기능이다. **기존 헤더만 복구하려고 주문 API에 예전 파일을 재전송하지 않는다.** 업로드 이후 정상 수정한 수량을 덮어쓸 수 있다.
- 내 업체/영업 붙여넣기/호텔 등은 각 source의 별도 계약을 따른다. 이번 사례를 근거로 모든 주문 경로에 출고 생성이나 CALC를 추가하지 않는다.
- 웹 조회의 헤더 재사용은 활성/fixed 우선/최소키 규칙을 따르지만, native 조회의 삭제 필터 부재는 별도로 고려해야 한다.

## 운영 보정 절차

1. 예방 코드가 배포됐는지 확인한다. 대상 연도·세부차수·업체를 고정하고 사용자 보정 범위를 확인한다.
2. fresh dnSpy, 실제 schema/trigger, 주문·전체 헤더·게이트를 SELECT한다.
3. 보호 대상과 허용 쓰기를 먼저 선언한다. 허용=빈 ShipmentMaster와 그 키 번호 동기화. 주문/상세분배/날짜/농장/견적/재고/손익은 보존.
4. 직전 잠금 안에서 대상과 헤더 부재를 재확인한다. 같은 transaction에서 전후 보호행 hash를 비교하고 차이가 있으면 전부 rollback한다.
5. rollback 리허설 후 실제 commit, **새 DB 연결**로 native lookup과 보호행을 재확인한다. DB 원문·자격증명·개인정보는 증거파일에 넣지 않는다.
6. EXE 조회 SQL의 성공과 실제 EXE GUI 조작 검증을 구분한다. 운영에 시험용 분배/확정을 하지 않는다.

## 44-01 보정 결과

2026-10-21 사용자 명시 승인으로 CustKey 31,277,490,491,500,503,515,592,664,674의 헤더 10개를 추가했다. ShipmentKey7069~7078. 생성 전에는 삭제 포함 모두0, 확정 후 업체별 정확히1개였다. 재실행 검증 추가생성0.

보정 전/후/별도연결 조회에서 14개 보호영역 hash가 모두 동일했다. 범위는 대상 업체의 모든 연도44-01 주문·출고와 연결자료, 해당 품목의 재고 등이며 현재차수169행만을 뜻하지 않는다.
- OrderMaster18 / OrderDetail317 / OrderHistory483
- ShipmentDetail112 / ShipmentDate112 / ShipmentFarm0 / Estimate13
- Product145 / ProductStock25087 / StockHistory2166 / StockMaster2 / WebProfitReport0
- ViewOrder289 / ViewShipment112

과거 연도 출고112건도 그대로 보존됐다. 빈 헤더 추가로 ViewShipment나 견적에 가짜 분배가 나타나지 않았다. 실제 직원 EXE GUI 재조회는 미검증이다.

증거: [보정 hash·키 기록](../operations/2026-10-21_44-01-header-repair.json), [보정 계획](../plans/header-repair-44-01-20261021.md).
회귀검사: `__tests__/myCustomerOrderApi.test.js`의 신규/재시도/교차연도/삭제헤더/기존확정/실패rollback fixture 및 `docs/contracts/order-import-shipment-list.json`. 이후 신규 주문입력 source를 추가할 때 이 계약과 그 source의 부작용을 함께 검증한다.

검색어: ShipmentMaster 연결헤더 GetShipmentMaster FormOrderAdd 44-01 빈출고헤더 주문수량보존 삭제헤더 중복헤더
