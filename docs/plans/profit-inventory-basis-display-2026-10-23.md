# 국가별 재고 도착원가 표시 기준

## 범위 및 부작용

이번 변경은 기존 보고서가 실제 채택한 E/F 평가 방법과 계산 피연산자를 표시한다.
국가 전체를 새 평균 공식으로 전환하지 않는다. 콜롬비아 5품종·베트남의 기존 평균 우선,
단위 혼합/환산 누락/당주 매입 없음 예외와 품목별 원가 fallback을 그대로 유지한다.

| 동작 | 주문·출고·입고 | 재고·현재고·이력 | 견적·Amount/Vat/isFix | WebProfitReport·확정 revision |
|---|---|---|---|---|
| 국가별 평가 근거 표시 | 기존 SELECT만 | 보존 | 보존 | 보존 |
| 펼치기/접기 | 조회 추가 없음 | 보존 | 보존 | 보존 |

## 기준 ledger

- 권위: API가 이미 계산한 average/resolved/value. 표시 helper는 평가 결과를 바꾸지 않는다.
- 평균: (Q+S)×R+H, 당주 매입수량, 기말 환산수량, 선택된 average.unitCost를 함께 표시한다.
- 기초: 직전 대차수 평가 입력을 사용하고 현재 차수 H/R/S로 역산하지 않는다.
- 단위: 국가 이름에서 박스/단/송이를 추정하지 않는다. 제공되지 않은 단위는 미제공으로 표시한다.
- 기타 국가/혼합단위: 품목별 원가 합계를 나눠 평균 도착원가인 것처럼 만들지 않는다.
- 무매입: 매입수량 0이면 당차수 평균 계산 불가 사유를 표시하고 기존 품목 근거를 설명한다.
- 추정: APPROVED_ESTIMATE는 평균 방식 여부와 별도 축으로 유지한다.
- 확정본: 저장 calc를 보존하며, 보관되지 않은 과거 평균 피연산자는 현재 DB로 복원하지 않는다.
- 이전 계산 캐시에 새 메타데이터가 없으면 근거 미제공으로 표시한다. 자동 refresh 쓰기 금지.
- 메뉴 기준: 기존 shell 유지, native details 키보드 사용, 페이지 세로 흐름. 넓은 표의 가로스크롤만 예외.

## 근거와 검증

기존 docs/exe-golden/FormProfitReport.md 및 실제 CLI/SELECT probe는 메인 작업 기록에 연결한다.
2026-10-23 실제 dnSpy.Console.exe --no-color -t FormStockView를 실행해 GetData의
StockMaster JOIN ProductStock 및 Product.OutUnit/EstUnit을 재확인했다. 화면 단위는 OutUnit이고
보고서는 EstUnit 환산량임을 구분한다. 기존 SELECT-only live-final.json 결과를 읽어
2026/26-10·27-02 장미 unitMismatch=true와 FIFO, 27·30 베트남 무매입 FIFO를 확인했다.
새 SQL 대사는 메인 작업에서 수행한다. 이전 기록을 신규 실측으로 표현하지 않는다.
표시 변경에는 SQL predicate/원가 공식/스냅샷 선택 변경이 없다.
회귀: 평균·추정 평균·직접 원가·무매입·단위혼합·누락·0·미지 국가·2025/2026·확정본 불변.
실제 SELECT 및 실브라우저/필수 전체 gate 결과는 메인 작업 완료 기록 전 미검증이다.
