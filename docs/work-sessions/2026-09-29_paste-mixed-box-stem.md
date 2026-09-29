# 붙여넣기 6박스+17스팀 수량 누락 보완

| 항목 | 내용 |
|---|---|
| 세션 | 2026-09-29 / paste-mixed-box-stem |
| 화면 | 붙여넣기 주문등록 분석·분배 미리보기 |
| 원장 부작용 | 분석/미리보기 변경만. 실제 등록·운영 보정 수행 안 함 |
| 배포/PR | 본 브랜치 PR 및 Cafe24 결과 참조 |
| 다음 채팅 | 본 기록 및 week-pivot-distribution, sales-paste-order 계약 |

## 결정·원인

**Q.** 화이트 6박스+17스팀 추가가 17송이만 분배되는 문제.

**A.** 단일 수량 정규식이 `화이트 6박스+`를 품목명, `17스팀`을 마지막 수량으로 인식한다. 명시 혼합수량은 두 성분을 보존하고 완전한 규칙 파싱 결과를 사용한다. 최종 품목 매칭 이후 실제 포장수로 하나의 작은 단위로 환산한다.

- 6박스+17스팀 / SteamOf1Box=30 => 197송이. 기존 단위 helper로 6.566666…박스 가산.
- 원문 두 성분과 환산값을 미리보기에 함께 표시. 저장·수동 품목 재매칭 시 두 성분에서 재계산.
- 사용자가 수량을 직접 변경하면 그 값으로 명시 대체한다. 혼합수량의 개별/일괄 단위 변경은 두 성분에서 환산한다(197송이를 197박스로 오해하지 않음).
- 누락/0/무한대 포장수, 미매칭, 불완전한 원문 행 수는 가산 가능한 부분만 저장하지 않고 차단.
- 공용 API의 다른 화면은 mixedQuantitySupport를 명시하지 않으면 명확한 오류를 반환한다. 잘못된 단일 수량을 조용히 반환하지 않는다.
- 원문 파싱 외 기존 원장 저장 API/SQL, 확정·날짜·재고·견적 처리 순서는 변경하지 않는다.

## 읽기 근거 / 기준표

- 실제 dnSpy FormShipmentDistribution에서 SteamOf1Box/OutQuantity/GetCustomerList 확인. 기존 exe-golden 근거 유지.
- 운영 읽기 probe: 2026 / 39-02 / CustKey=478 왕자원예 / ProdKey=889 Hydrangea White.
- SteamOf1Box=30, OutUnit=박스, SdetailKey=92441, OutQuantity=40, isFix=true. ShipmentDate=1행, ShipmentFarm=0행, ViewOrder=1행, DetailFix=1 ViewShipment=1행.
- 현재 40에 추가하면 46+17/30박스. 읽기만 했으며 주문/분배/금액/부가세/확정 상태 변경 없음.
- 분석/미리보기: OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, Stock, Estimate, WebProfitReport 모두 보존.
- 사용자 명시 등록: 기존 adjust-batch가 선택 연도·차수·업체·품목, 단위 환산, 확정 및 후검증을 담당. 이번 작업에서 자동 실행하지 않는다.

## 검증

- pasteOrderUnit 실행 fixture: 원문 품명 분리, 두 성분 보존, 197송이, 40→46.566666…, 40스팀 포장으로 재매칭하면 257송이, 누락/0/무한대 포장수 차단, 불완전 파싱/음수/3성분 차단, 교차연도 scope 분리.
- 기존 단위/자연어/영업 붙여넣기 테스트 유지. 전체 ERP 계약, dnSpy, manifest, 쓰기 guard, build 재검증.
- `.tmp/probe-mixed-stem.cjs` 및 로그는 비커밋 로컬 검증 자료. 인증 정보 기록 금지.

## 관련 완료

업체별 묶음 표시는 PR #798, master 44d8caf3, Cafe24 run 36534241155 성공. 실제 남대문 청화 메시지 8행 전개에서 업체 1개/기본 4행+추가 확인 4건으로 변경. 동일 1920×1080 화면의 메시지 높이 약 476→244px, 가로 넘침 없음.
