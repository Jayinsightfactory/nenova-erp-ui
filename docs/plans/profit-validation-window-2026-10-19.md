# 수익률 검증 별도 창 구현 기준

## 범위와 근거

사용자 요청: 매출자료 메뉴에서 별도 새창으로 확인. 기존 주차별 매출이익 보고서 상단의 버튼과 공용 메뉴 진입점을 추가한다. 앞서 설계한 전체 독립 검증 엔진을 구현했다고 표시하지 않고 기존 보고서 경고/반차수 원천 점검/실제 재고조정 이력을 읽기 전용으로 연결한다.

2026-10-19 실제 `dnSpy.Console.exe --no-color -t FormStockView`로 설치 Nenova.exe의 GetData·연도/차수 선택과 StockMaster/ProductStock 연결을 재확인했다. 같은 날 운영 SELECT-only probe에서 명시2026/32 범위의 ProductStock와 Master/Detail 확정 매출 존재를 확인했다. 조회는 행 존재 여부만 출력했으며 업무 수치·자격증명은 기록하지 않았다. 원천 SQL과 계산·SP는 변경하지 않는다. 기존 FormProfitReport/FormStockView golden을 보존한다.

## 기준 ledger

| 기준 | 권위 / 소비자 |
|---|---|
| 연도/대차수 | outputScope 순수 함수, URL/조회/응답 검증 공통; 연도 누락·배열·0차 거부 |
| 초기값 | 보고서 버튼은 조회된 연도/차수 전달, 메뉴 단독 진입은 기존 전차수 기본값 표시 후 명시 조회 |
| GET | profit-report, profit-report-week-check, profit-stock-adjustment-notes 기존 인증 API |
| 보고서 금액 | 기존 computeProfitRow/Totals, 확정 calc/Totals 우선. 독립 검산으로 표현 금지 |
| 기준시점 | 보고서 snapshot stale/확정 revision과 현재 원장 점검 분리, 자동 새 버전 저장 금지 |
| 실패/취소 | HTTP/success/범위/rows 형식 검증; 취소·늦은 응답 폐기, 실패를0건으로 표시 금지 |
| 판정 | 기존 경고 없음은 전체 정상 인증이 아님. 독립 수량 대사/최초 원인 추적 미구현 명시 |
| 새창 | popup=1 공용 shell, 원래 페이지 이동/초안 저장 없음. 차단 시 기본 링크로 새 탭 가능 |

## 부작용 / downstream

| 동작 | Order/Shipment/ShipmentDate/Farm | Warehouse/StockHistory/ProductStock | Estimate/WebProfitReport/확정·계산snapshot |
|---|---|---|---|
| 새창 열기 | 보존 | 보존 | 보존 |
| 보고서·점검 조회 | 기존 SELECT | 기존 SELECT | 기존 SELECT, POST 없음 |
| 재고조정 이력 확인 | 보존 | 기존 SELECT | 보존 |

기존 운영 경고 문구·분류를 고치거나 정답으로 승격하지 않는다. 엑셀 출력·확정·원장 수정 경로는 이 창에 없다. 외부 AI 호출 없음.

## 확인할 것

- 누락/0/배열/교차연도, stale, 부분 실패, HTTP401/500, 늦은응답/취소 fixture.
- 일반/팝업 단일 shell, 큰/작은 화면, 페이지 세로 스크롤, Tab/Enter 및 창 열기.
- 기존 수기/확정/계산 계약과 전체 verify:erp-change, UI layout 검사.
- PR CI 후 squash/배포/ping/실브라우저. 실패 단계를 숨기거나 배포 검사를 생략하지 않음.

메뉴 기준선: 단일 shell·페이지 스크롤·키보드·범위보존·실패표시 적용. 매칭·ERP 반영 전 확인은 해당 없음. 넓은 금액표의 가로 스크롤만 예외.
