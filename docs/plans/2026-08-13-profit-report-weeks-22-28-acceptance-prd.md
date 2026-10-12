# 담당 6 PRD — 22~28차 매출이익 보고서 읽기 전용 인수검사

작성일: 2026-08-13  
대상 원본: `.verify/inputs/profit-report-week-28.xlsx`  
원본 SHA-256: `D777E8745B3B1E2FBF89AC782633E9FD654F38FD7684ECBB620032221ECB156B`

## 1. 목적

22~28차 주차별 매출이익 보고서의 로컬 증거를 한 명령에서 검사하는 읽기 전용 harness를 만든다. 원본 Excel은 수정·재저장하지 않고, 28차 전체 시트와 웹의 순수 계산 계약을 대조한다. 22~27차는 저장소에 남은 fixture·계약·작업보고서만 증거로 사용하며, 원본 전체 시트가 없는 차수는 추측하지 않고 `미검증`으로 보고한다.

## 2. 범위

- 원본 workbook의 모든 worksheet를 누락 없이 열거하고 사용 범위·수식 수·수식 오류를 검사한다.
- raw OOXML에서 외부 링크·연결·수식 체인·깨진 참조를 검사한다.
- 28차 본표의 항목별 `C/G/I/J/K/M/P/T`를 `lib/profitReportCalc.js`로 재계산하고 상대 오차 5% 이하인지 검사한다.
- 콜롬비아 1·2차의 H/S 배부와 국가별 통관 H를 `lib/customsForwarding.js`의 순수 함수로 재계산한다.
- 보고서·판매·구매·포워딩·불량·그외매출의 분류 라벨과 웹 분류 계약을 대조한다.
- 27차 기말 F 합계가 28차 기초 E 합계로 이월되는지 검사한다.
- `OrderYear + OrderWeek + CustKey + ProdKey` 복합키와 전년도 동일 차수 fixture를 검사한다.
- 환율·통관·재고 원천 우선순위와 선택 연도 스코프를 정적 계약으로 검사한다.
- 재현 가능한 JSON 결과와 Markdown 인수보고서를 생성한다.

## 3. 비범위

- 원본 Excel 수정, 수식 재계산 결과 저장, 서식 변경
- 운영 DB 조회·쓰기, 실제 ERP 등록, 브라우저·nenova.exe 실행
- 다른 담당자가 수정 중인 구현 파일·계약 manifest 변경
- 22~27차 원본 workbook이 없는 상태에서 전체 시트 숫자를 추정하거나 합격 처리
- git push·병합·배포

## 4. 증거와 판정 상태

| 차수 | 로컬 증거 | 판정 가능 범위 |
|---:|---|---|
| 22~25 | 저장소의 기존 순수 계산 회귀·문서 | 계약 fixture만 검증, 전체 시트는 `미검증` |
| 26 | 기존 콜롬비아 H/S 수치 fixture와 수식 계약 | 핵심 배부 계산만 검증, 전체 시트는 `미검증` |
| 27 | `docs/work-reports/2026-07-21_profit-report-27-reconciliation.md`의 F 합계 | 27 F→28 E 합계 연결만 검증, 항목별 이월은 `미검증` |
| 28 | 허용된 원본 workbook 전체 | 모든 시트·수식·오류·계보와 웹 순수 계산 검증 |

`PASS`는 검증 대상이 모두 통과했을 때만 사용한다. 원본 부재나 운영 DB 의존 항목은 `UNVERIFIED`, 명백한 오차·오류·계약 불일치는 `FAIL`이다. 전체 상태는 `FAIL > UNVERIFIED > PASS` 우선순위로 정한다.

## 5. 사용자 동작별 side-effect matrix

이 담당은 읽기 전용 검사만 수행한다.

| 동작 | OrderMaster/Detail | ShipmentMaster/Detail | ShipmentDate/Farm | Warehouse | StockMaster/ProductStock/History | Estimate | WebProfitReport |
|---|---|---|---|---|---|---|---|
| Excel 구조·수식 검사 | preserve | preserve | preserve | preserve | preserve | preserve | preserve |
| 웹 순수 계산 fixture 실행 | preserve | preserve | preserve | preserve | preserve | preserve | preserve |
| 교차연도 fixture 실행 | preserve | preserve | preserve | preserve | preserve | preserve | preserve |
| JSON/Markdown 보고서 생성 | preserve | preserve | preserve | preserve | preserve | preserve | preserve |

## 6. downstream 영향 matrix

| 대상 | 허용 동작 | 금지 동작 | 자동검사 |
|---|---|---|---|
| `ViewOrder` / `ViewShipment` | 정적 계약 확인 | 조회 결과 추정·DB 수정 | 연도·차수 복합 스코프 토큰 검사 |
| `ShipmentDetail.Amount/Vat/isFix` | 보존 계약 확인 | 값 변경 | 보고서 소스의 `isFix=1` 필터 검사 |
| `ShipmentDate` / `ShipmentFarm` | 보존 | 생성·수정·삭제 | side-effect matrix 고정 |
| `Estimate` | 보존 | 생성·수정 | manifest/exe-golden 보존 계약 확인 |
| `ProductStock` / `StockHistory` | 스냅샷 선택 규칙 확인 | 재계산·보정 | `OrderYear`와 마지막 `ProductStock` 선택 정적검사 |
| `WebProfitReport` | 읽기 계약 확인 | 수기값 저장 | `OrderYear + MajorWeek` 키 정적검사 |

## 7. 업무키·교차연도 fixture

- 기본 업무키는 `OrderYear + OrderWeek + CustKey + ProdKey`다.
- fixture에는 2025년과 2026년의 같은 `28-01`, 같은 고객·품목을 함께 둔다.
- 선택 연도 2026 조회 결과에는 2025행이 포함되면 안 된다.
- 일반 차수 28의 기초재고는 2026년 27차 마지막 스냅샷이어야 하며, 2025년 27차를 선택하면 실패한다.
- 01차에 한해서만 전년도 52차 이동을 허용한다.

## 8. 인수 기준

1. 원본 SHA-256이 fixture와 일치하고 파일의 수정시각·크기·해시가 검사 전후 동일하다.
2. 28차 workbook의 11개 시트를 모두 검사하고, 수식·오류·외부참조·calcChain 결과를 보고한다.
3. 수식 셀의 캐시 오류, `#REF!`, 누락 시트 참조는 한 건이라도 있으면 수식 무결성 `FAIL`이다.
4. 항목별 계산 비교는 `abs(actual-expected) / max(abs(expected), 1) <= 0.05`를 사용한다.
5. 27 F 합계 `13,229,405.204`와 28 E 합계의 오차율이 5% 이하다. 항목별 27 F 근거가 없으면 별도 `UNVERIFIED`로 남긴다.
6. 통관 H와 콜롬비아 H/S는 workbook 입력을 웹 순수 함수에 넣어 5% 이내여야 한다.
7. 보고서와 상세 시트의 분류 라벨, 웹 분류 라벨의 차이를 모두 보고한다.
8. 환율은 통화 매핑, `FreightCost.ExchangeRate → 전차수 확정 R(29차 이후) → CurrencyMaster` 우선순위, 선택 연도 스코프를 검사한다. DB 실제값은 `UNVERIFIED`다.
9. 검사기는 원본 Excel에 쓰지 않으며 운영 DB와 외부 환경을 호출하지 않는다.
10. strict 실행은 `FAIL` 또는 필수 증거의 `UNVERIFIED`가 있으면 비정상 종료한다. 회귀테스트는 이러한 상태를 정확히 검출하는지를 검증한다.

## 9. 독립 파일 계획

- `scripts/profit-report-acceptance-harness.mjs`: 읽기 전용 실행 진입점
- `__tests__/helpers/profitReportAcceptance.mjs`: workbook/OOXML/fixture 판정 순수 로직
- `__tests__/fixtures/profit-report-weeks-22-28.json`: 허용 증거와 교차연도 fixture
- `__tests__/profitReportAcceptanceHarness.test.js`: 회귀테스트
- `docs/work-reports/2026-08-13_profit-report-weeks-22-28-acceptance.md`: 실행 결과
- `.verify/outputs/profit-report-weeks-22-28-acceptance.json`: 기계 판독 결과

기존 구현 파일과 `docs/contracts/weekly-profit-report.json`은 수정하지 않는다.
