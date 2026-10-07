# 주차별 매출이익 비고: 실제 재고조정 표시

## 범위 및 완료 기준

사용자 요청: 주차별 매출이익자료 비고란에 재고조정이 있었던 부분을 표시한다. 기존 수기 비고·보고서 금액·확정 revision·ERP 원장은 보존한다. 이번 구현은 웹 비고 표시이며 엑셀/외부전송 양식은 변경하지 않는다.

| 동작 | StockHistory / Product / CodeInfo | 주문·출고·입고·재고·Estimate | WebProfitReport / 확정본 |
|---|---|---|---|
| 자동 재고조정 비고 조회 | SELECT | 모두 보존 | 모두 보존 |
| 기존 수기 비고 저장 | 기존 경로 보존 | 모두 보존 | 기존 수기 비고만 저장 |

## 기준 원장

- 실제 dnSpy FormStockView와 SQL usp_StockCalculation의 조정 정의: StockHistory.AfterValue−BeforeValue, CodeInfo.Category='StockType' 및 ChangeType=Descr.
- 운영 SELECT 확인: 여러 품목의 감소 조정, 품목별 순0 상쇄이력, 전차수의 증가 조정, Descr 빈값과 조정 포함 원장 수량식 일치를 확인했다. 실제 수치·키·품명은 로컬 감사 MD에만 보관하고 공개 회귀시험은 합성 fixture로 대체한다.
- StockHistoryKey를 실제 이력 식별자로 사용하고 조회 키는 명시적 OrderYear+MajorWeek다. 현재 Product의 이름/OutUnit은 표시값이며 과거 확정 시점 품명·단위로 인증하지 않는다.

## 기준표

| 항목 | 정책/소비자 |
|---|---|
| 연도·차수 | year 필수4자리, week1~53 대차수 또는 유효한 세부차수; 누락/잘못된 값400. 연도 현재값 fallback 없음 |
| SQL 범위 | sh.OrderYear=@year AND (sh.OrderWeek=@major OR sh.OrderWeek LIKE @prefix); 해당 대차수만. 조회된 각 행도 순수 변환에서 scope 재검사 |
| 실제 조정 판정 | EXISTS CodeInfo StockType. 중복 코드로 이력 중복 증폭하지 않음. 입고/출고 확정 이벤트는 제외 |
| 품목 누락/삭제 | LEFT JOIN Product, 이력 제거하지 않고 품목번호/단위 미확인 표시 |
| 수량 | OutUnit별 분리. AfterValue−BeforeValue; null/비정상 값은0으로 만들지 않고 확인 필요. 순0이어도 증가·감소 이력 존재 표시 |
| 표시 | 비고사항 아래 자동 조회 영역. 차수/품목/국가·품종/순증감/증가·감소/건수/사유. 사유 없는 이력은 사유 미기재. 손익 영향이나 실물재고 정상 확정 문구 없음 |
| 출처 | 현재 원장 조회임을 명시. 확정 보고서의 저장 당시 근거/금액을 수정했다는 인상 금지 |
| 로딩/실패 | 별도 읽기 요청, 본표/수기 비고는 유지. 차수 전환 시 이전 결과 표시 차단, abort/요청 식별자로 늦은 응답 무시. 실패를 조정 없음으로 표시하지 않음 |
| 무조정 | 성공 응답의0건일 때만 해당 차수 재고조정 이력 없음 |

## 검증

운영 사례 구조를 재현하는 가상수량·가명 fixture, 같은 차수 전년도 배제, 다른 차수 배제, 연도/차수 누락·0·배열·부정확 값, 순0 상쇄, 단위 분리, 사유 공란/일부 공란, 품목 누락, 수량null/0·소수, XSS 문자열은React텍스트로표시, 조회 실패/늦은 응답/기존비고 보존. 필수ERP계약·dnSpy·manifest·쓰기guard·build 및1920×1080 웹스모크 후 배포완료판정.

## 사전 준비

별도 GET `/api/sales/profit-stock-adjustment-notes` 및 `lib/stockAdjustmentReportNotes.js`를 사용한다. 기존 profit-report API와 계산hash 대상 helper를 수정해 단순비고추가가 과거 계산 snapshot 전체갱신을 유발하지 않도록 한다.

전용worktree profit-weight-policy/nenova-erp-ui, codex/profit-stock-adjustment-notes, origin/master6a9508df 기반. 의존성 준비됨. 기존 감사MD수정 보존. 운영DB인증은 메인만 사용하며 하위작업에는 위 비밀값 없는 조회결과만 전달한다.

## 구현 검증

- 구현: 사용 가능한 중간 등급 gpt-6-sol로 지정 모델 미지원 대체. P0 로컬 구현/테스트만 수행했다. 독립 최종검토에서 중요 결함 없음.
- 실행형 합성 fixture·API mock·React 정적 렌더·비동기 응답 경합 테스트 통과.
- `npm run verify:erp-change` 전체 통과(계약·dnSpy·manifest·쓰기 guard·build). 신규 API staging 후 origin/master 기준 manifest/쓰기 guard도 별도 통과.
- 메인이 신규 앱 SQL을 운영 DB에 SELECT로 실행하여 실제 조정 원천·그룹 변환을 대조했다. 운영값은 공개 문서에 싣지 않는다.
- 계산 hash는 변경 전후 `2026-10-06.1+2e2d7524f254`로 동일하다. 기존 계산 API/helper·수기비고·확정본 변경 없음.
- 실제 운영수치가 포함된 감사·세션 MD는 공개 저장소 push에서 제외한다. 배포·실브라우저 결과는 작업 완료 보고에서 별도 확인한다.
