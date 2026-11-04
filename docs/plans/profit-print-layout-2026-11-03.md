# 주차별 매출 인쇄 표시 변경

## 최신 지시와 판정 기준
- 인쇄에는 사용자 비고와 선택 열의 기존 금액·빈칸·0·음수를 그대로 유지한다. 자동 상태/검증 설명은 인쇄에만 제외하며 웹 진단 및 XLSX 감사 정보는 보존한다.
- 선택 연도와 체크 차수만, 한 차수당 A4 가로 한 장. 인쇄 버튼은 자료 준비 후 인쇄 대화상자를 바로 연다. 취소·실패 시 부분 인쇄하지 않는다.
- 화면 컬럼 기본값은 v4에서 22개 전체로 한 번 전환하고 이후 명시 선택을 저장한다. 기존 v3 및 프리셋은 삭제하지 않는다. 출력 v1의 명시 선택은 보존하고 신규 출력 기본값은 22개다.
- 컬럼 팝업은 viewport 안으로 배치하고 Escape/닫기 시 버튼으로 복귀한다. 체크박스 방향키/Home/End 및 기본 Tab/Space를 제공한다.

## 근거와 부작용
2026-11-03 실제 설치 EXE에 dnSpy.Console.exe --no-color -t FormStockView를 실행하여 GetData의 StockMaster/ProductStock, ViewShipment, OrderYearWeek 선택을 다시 확인했다. 읽기 전용 원천 probe 근거는 기존 docs/plans/profit-selected-output-2026-10-21.md 및 최근 배포의 동일 출력 금액 대사를 재사용한다. 이번 변경은 원천 조회/SQL/SP/API/계산 함수를 수정하지 않으며 추가 운영 DB 조회나 쓰기를 수행하지 않는다.

| 동작 | ERP 주문/출고/입고/재고/견적 | WebProfitReport/확정/계산 snapshot | 브라우저 |
|---|---|---|---|
| 선택·출력 | 보존 | 기존 GET만, 저장/refresh 금지 | 선택 저장 및 메모리 HTML |
| 인쇄 비고 분리 | 보존 | 보존 | 원 사용자 note metadata 사용; 문구 정규식 삭제 금지 |

Next Pages Router의 로컬 CSR 가이드를 읽었다. window/document/인쇄/focus는 이벤트와 effect 안에서만 사용한다. 단위/계약·독립 Chromium PDF 페이지수/열폭/키보드·빌드 검증 후 배포한다. 실제 프린터 장치의 용지/배율 설정은 사용자 환경에 따라 달라질 수 있다.
