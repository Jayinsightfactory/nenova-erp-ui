# 주광 수량 한 자리 표시 — 2026-10-23

- 최신 사용자 기준: 소수 수량은 소수 첫째 자리까지만 표시, 정수는 정수. 입력 중인 문자열은 보존.
- 표시 formatter만 변경. 초안/저장/환산/금액/재고/확정/Excel 원본값은 보존한다. 기존 박스+낱개 설명은 유지한다.
- 일반/윌슨 입력의 null 편집상태는 그대로 유지하여 focus/blur/방향키 이동만으로 저장하지 않는다. 박스+낱개 대화상자는 표시값이 아닌 원본값을 받는다.
- 부작용 표: 표시/초점 이동/상세 열기 = OrderDetail, ShipmentDetail, ShipmentDate, ShipmentFarm, Estimate, StockMaster, ProductStock, WebProfitReport 모두 보존. 명시 수정은 기존 저장경로.
- 근거: docs/plans/weekday-box-parts-2026-10-23.md의 실제 dnSpy decimal 환산/N2 표시 및 SELECT 포장값. 이번 변경은 DB/API/인쇄/Excel 숫자 정책을 변경하지 않는 UI 표시 한정이다.
- 메뉴 기준: 적용=기존 키보드, 초점, 스크롤, 표시/원본 분리. 해당 없음=새 메뉴/권한/SQL/원장 쓰기. 예외=없음.
- 검증: 1박스+1단(15단 포장) 원본1.066666667→표시1.1, 대화상자1+1 및 blur 무저장; 1박스+3단→1.2; 작은 소수·음수·정수·빈값; 기존 교차연도 및 수량 환산 회귀.
