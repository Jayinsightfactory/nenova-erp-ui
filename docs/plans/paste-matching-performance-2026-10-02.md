# 붙여넣기 매칭 응답성 보완

## 근거와 범위

- 실제 dnSpy CLI FormOrderAdd GetDataProduct/btnSave_Click 재조회: 활성 Product 선택과 ERP 저장은 분리. ViewShipment 연결은 OrderYear/OrderWeek/CustKey/ProdKey.
- 운영 읽기 전용 SELECT: 활성 품목3284, ProdKey447 Moon Light/박스. 39-02 ViewOrder 2025=6/2026=24, ViewShipment 2025=4/2026=24. 표본50ms이며 서버 전체 부하 측정이 아님.
- 3284개 합성 품목 공통 랭킹은 측정 데이터에 따라 약35~543ms 동기 계산. 실제 초기 빈 입력에서는 랭킹을 실행하지 않으므로 초기 멈춤의 단독 원인으로 단정하지 않음.
- 172개 원문 actual-component fixture: 접힌 상세를 지연 렌더링하면 DOM8297→4169, 한 개 펼침4193. 원문172개 및 펼친 상세의 기존 동작 보존.

## 변경과 부작용

| 동작 | 변경 | 보존 |
|---|---|---|
| 현황 탐색 | 40그룹씩 표시, 전체 검색 유지 | 별칭 저장/삭제/서버 확인 |
| 현황/개별품목 검색 | 기존 공통 랭킹을 Worker에서 계산, 늦은 결과 제외 | 전체 후보·정렬·단위·품목키 |
| 원문 이력 | 파생값 메모화, 상세 펼칠 때 생성 | 모든 원문·정확 적용 상태·영구 사전분석 |
| ERP 저장 | 없음 | Order/Shipment/ShipmentDate/Farm/Stock/Estimate/WebProfitReport 전부 |

## 완료 기준

검색 워커 결과 동일성·오류·늦은 응답 fixture, 1920×1080/작은 화면 UI, 전체 ERP 필수 검사, 빌드, PR/배포, 운영 스모크. 운영 브라우저 응답 제한은 별도로 명시하고 측정 없이 완전 해결을 주장하지 않는다.
