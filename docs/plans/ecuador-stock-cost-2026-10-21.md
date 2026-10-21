# 과거 재고 불일치와 후속 정리 조정의 안전한 대사

## 근거와 사용자 결정
- 2026-10-21 실제 설치 EXE를 `dnSpy.Console.exe --no-color -t FormStockView "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`로 확인했다. GetData는 StockMaster/ProductStock, ViewWarehouse/ViewShipment, StockHistory를 읽는다.
- 운영 SELECT로 `dbo.usp_StockCalculation`의 실제 정의를 확인했다. 선택 차수부터 후속연도까지 품목별 cascade하며 Product.Stock은 변경하지 않는다. 전차수 재고 + 입고 - DetailFix=1 출고 + StockType 조정, SQL ROUND(...,2)가 기준이다.
- 대상 2026/30-01 에콰도르 품목의 최초 관측 저장 차이는 현 원천으로 설명되지 않는다. 41-02의 같은 품목별 순조정은 그 차이와 정확히 반대다. 사용자가 이 조정은 별도 실사/폐기가 아니라 과거 부풀림 제거 목적이라고 명시 확인했다.
- 원가가 없는 품목의 판매단가/미래 매입단가를 채우는 방식은 사용하지 않는다. 잘못된 재고수량을 먼저 원천 식과 맞춰야 한다. 원장별 숫자·키·원본 JSON은 ignored `.verify`에만 보관한다.

## 기준 원천과 부작용
|동작|원천/조건|공유 원장 효과|
|---|---|---|
|진단|선택 연도·차수, 현재 SP, 실제 원천 지문|SELECT only|
|보정 계획|각 품목의 시작 차이 = 후속 순조정의 반대, 사용자 목적 확인|변경 없음|
|후속 중복차감 방지|기존 조정 행 보존, 정확한 반대 delta 신규 감사행|StockHistory에만 INSERT|
|재계산|native CALC, 명시 연도/시작차수/양수 품목키, 외부 transaction/IDLE V2 gate|대상 품목의 현재·후속 ProductStock만 native 재계산|
|검증 실패|지문 변경/원천 모순/음수/트랜잭션 유실/보호 원장 변경|전체 rollback|

OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm/History, WarehouseMaster/Detail,
Product(현재고 포함), Estimate, WebProfitReport/확정 revision, 기존 StockHistory는 보존한다.
기존 이력을 삭제하거나 날짜/차수/수량을 수정하지 않는다. SP/스키마 변경 없음.

## 안전 경계
- 일반 UI 자동 보정 기능을 만들지 않는다. 관리자 수동 스크립트는 기본 읽기 전용이고, 명시 입력 계획·원천 지문·rehearsal을 요구한다.
- 업무키는 OrderYear+OrderWeek+ProdKey. CustKey는 이 재고 작업에 적용하지 않으며 없는 키를 만들지 않는다.
- 전년도는 수정하지 않는다. native의 후속연도 범위는 숨기지 않고 계획과 사후검사에 포함한다.
- 반대 조정은 재고를 새로 만들기 위한 것이 아니라 이미 확인된 과거 오류 제거를 이중 반영하지 않기 위한 것이다. 현재 Product.Stock을 올리지 않는다.
- 원가/수익률은 수량 보정 후 같은 SQL 보고서 로더로 재검사한다. 남은 근거 누락·단위 불일치는 정상으로 덮지 않는다.
- 독립 검산은 이월 오차와 반대 방향 조정이 겹칠 때 재계산 단독 실행 위험을 구체적으로 표시한다. 같은 금액이라는 사실만으로 조정 목적을 확정하지 않는다.
- 실제 native 경로에 있는 34-02A/B 백업 노드는 숫자 보고서 차수로 바꾸지 않는다. 정확한 legacy 좌표를 명시 승인 계획에 넣고 해당 좌표의 입출고/조정이 없을 때만 native 그대로 순회한다. NULL OrderYearWeek는 SQL 비교에서 제외되므로 JS의 String(null) 정렬로 후속 차수에 포함하지 않는다. 둘 다 회귀 fixture로 검사한다.
- 메뉴 기준: 기존 검산 화면의 안내 문장만 추가(적용: 원인·다음 행동 명시/원장 읽기 전용). 새 메뉴·새 입력·화면틀·스크롤·키보드 변경은 해당 없음. 운영 보정은 일반 UI가 아니라 별도 관리자 명시 실행이다.

## 검증 계획
합성 교차연도/중복품목/NULL/0/반대조정 불일치/동시변경/중간 실패/보호영역 변화/음수 fixture.
전체 verify:erp-change, PR CI, Cafe24 배포 후 rehearsal rollback → 동일 지문 apply → 별도 연결 readback.
현재 사용자 EXE GUI 직접 조회와 실제 실사재고 인증은 별도 미검증.
