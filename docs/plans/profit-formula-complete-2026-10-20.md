# 전체 차수 계산식 검증 기준

- 요청: 최초 설계식과 모든 차수/확정본의 계산·표시를 대조하고 확인된 결함만 수정·배포.
- 기준: 원본 formula-source-contract.v2 및 22~28차 수식 fixture, 이후 명시 승인 AC/AJ·FIFO·원가 이월 정책. 승인된 정책 차이는 결함으로 되돌리지 않는다.
- 독립 검산은 production 계산 함수를 호출하지 않고 표시 입력을 독립 산술로 대조한다. 입력 원천의 정확성 인증과 산술 일치를 구분한다.
- 일반 I=E+G+H-F, J=C-I+AJ, K=J/C. noEnding 3국은 I에서 F를 빼지 않고 J에서 더하며 K=J/(C+F). 합계 K와 열별 SUM 범위도 원본대로 보존.
- 수동 확정 revision은 불변. 오류 발견 시 과거 값 덮어쓰기·자동 확정취소 금지. 검증 근거와 새 revision 경로를 구분한다.
- 운영 SQL 첫 조회: 수동 확정 revision 0건, 계산 snapshot 116건(2026). 실제 조회 범위를 다시 기록하고 미존재 확정본을 검증 성공 건수에 넣지 않는다.
- 코드 결함 후보: 확정 저장 SOURCE/CALC 목록에 AC/AJ 누락. 입력값을 보존하도록 수정하고 확정→재조회 fixture로 검증한다.

## 부작용 표

| 동작 | ERP 주문/출고/입고/재고/견적 | WebProfitReport | 계산 snapshot | 수동 확정본 |
|---|---|---|---|---|
| 전수 검산 | SELECT only | SELECT only | 모든 revision SELECT | 모든 revision SELECT |
| 검산 결과 표시 | 보존 | 보존 | 보존 | 보존 |
| 이후 사용자 확정 | 보존 | 보존 | 보존 | 기존 INSERT에 조정값 추가; 이전 revision 보존 |

## 기준 ledger

| 기준 | 원천 | 소비자/회귀 |
|---|---|---|
| 연도+대차수 | 원본 업무키/DB 실제 목록 | 전수 probe, 화면 요청, 교차연도 fixture |
| 0/NULL | Excel blank semantics와 필수 입력 진단 분리 | 산술 parity는 기존 0 대체를 재현하되 missing 입력 별도 경고 |
| 조정 AC/AJ | 사용자 2026-08-26 승인, executable helper | 확정 SOURCE/CALC, 화면, 엑셀, 검산 |
| 국가별/합계 예외 | 원본 셀 수식 및 fixture | 독립 검산, 기존 parity tests |
| 저장본 시점 | immutable revision 및 CalcVersion | 현재 원천과 혼합 금지, 최신본/과거본 구분 |

## 검증

로컬 실제 dnSpy FormStockView CLI 재확인(2026-10-20). 보고서 자체는 웹 전용이며 SQL writer/SP 변경 없음. 원본 fixture 전체열·합계, 변경 계약/교차연도, 전체 verify:erp-change, CI, Cafe24, 실제 브라우저 스모크를 완료 전까지 미검증으로 둔다.
메뉴 기준: 페이지/키보드 적용, 기존 shell 보존. 신규 업로드/ERP 반영 동작 해당 없음.
