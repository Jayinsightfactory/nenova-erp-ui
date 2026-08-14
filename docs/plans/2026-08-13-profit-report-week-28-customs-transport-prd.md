# 담당 4 PRD — 28차 그외통관비·운송 Excel 공식 보강

작성일: 2026-08-13
대상 기능: 주차별 매출이익보고서 H(그외통관비), 국가별 통관 입력, 월드운송료
원본 증거: `.verify/inputs/profit-report-weeks-22-28/week-28.xlsx` (읽기 전용)

## 1. 목표

28차 원본 Excel의 H열 계산을 로컬 웹 계산과 재현 가능한 fixture로 고정한다.

- 관세·선율은 1차와 2차 각각의 `1/2/3` 분할 입력을 합산한다.
- 국가별 1차·2차 중량은 서로 섞지 않고 합산한 뒤 각 반차수의 차량 등급과 금액을 계산한다.
- 월드운송료는 VAT 포함 청구액을 원천으로 하며 H에는 `/ 1.1` 공급가를 반영한다.
- 백상창고료는 적용 시점의 단가 이력을 사용하고, 현재 단가로 과거 차수를 재작성하지 않는다.
- `WebCustomsWeekly`의 명시적 직접입력은 자동값보다 우선하는 override다.
- 28차 H 차이 `+657,113`은 추측이 아니라 Excel 셀·수식·선행 셀에서 추출한 구성요소 fixture의 합으로 설명한다.

## 2. 범위

포함:

- `lib/customsFields.js`, `lib/customsForwarding.js`, 통관 API와 주차 손익 계산 경로
- `docs/contracts/weekly-profit-report.json`
- `__tests__/customsForwardingAuto.test.js`, `__tests__/profitReportWorkbookParity.test.js` 또는 담당 4 전용 독립 회귀 테스트
- Excel 수식 계보 및 28차 H 차이 fixture

제외:

- C/E/F/G/I/J/L/N/O/P/Q/R/S/T 등 다른 원천 계산 변경
- `Order*`, `Shipment*`, `Estimate`, `Warehouse*`, `ProductStock`, `StockHistory` 쓰기
- 운영 DB 보정, 실제 ERP 등록, 배포, git push/merge

## 3. 업무 식별자와 교차연도 fixture

업무 식별자는 `OrderYear + OrderWeek`이며 품목 배분이 필요한 읽기 범위에서는 기존 계약대로 `CustKey + ProdKey`를 추가한다. 같은 `OrderWeek='28-01'/'28-02'`가 2025와 2026에 모두 존재하는 fixture를 둔다.

- 요청 연도 2026이면 2026 중량·통관·수기 override만 읽는다.
- 2025의 같은 28차 저장행은 자동값·carry·override 선택에 참여하지 않는다.
- 국가별 1차와 2차는 `OrderYear + 반차수`로 각각 집계한 뒤 대차수 H에서 합산한다.

## 4. 사용자 동작별 side-effect matrix

| 동작 | WebCustomsWeekly | WebCustomsHistory | WebProfitReport | WebForwardingWeekly | Order/Shipment | Warehouse | Estimate | ProductStock/StockHistory |
|---|---|---|---|---|---|---|---|---|
| 보고서/통관 자동조회 | 읽기 | 보존 | 읽기 | 읽기 | 읽기만 | 읽기만 | 보존 | 읽기만 |
| 국가별 직접입력 저장 | upsert | insert audit | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 |
| H 수기 보정 저장 | 보존 | 보존 | H 키만 upsert | 보존 | 보존 | 보존 | 보존 | 보존 |
| 차량/월드운송료 자동계산 | 저장하지 않음 | 보존 | 보존 | 보존 | 보존 | 읽기만 | 보존 | 보존 |

모든 GET은 읽기 전용이다. 저장은 변경된 국가행을 하나의 트랜잭션으로 처리하며 부분 성공을 허용하지 않는다.

## 5. downstream 영향 matrix

| 대상 | 허용 영향 | 금지 영향 |
|---|---|---|
| ViewOrder/ViewShipment | 보고서 원천 읽기만 | 주문·출고 수량 또는 연도/차수 변경 |
| ShipmentDetail.Amount/Vat/isFix | 확정 매출 읽기만 | UPDATE/재계산 |
| ShipmentDate/PeriodDay | 차수·월 분류 읽기만 | 생성·수정·삭제 |
| Estimate | 보존 | 생성·수정·삭제 |
| WebProfitReport | 기존 명시적 H override 읽기/저장 | 다른 열 원천 변경 |
| 판매현황/손익 | H와 그에 따른 기존 I/J 산식 반영 | C/G 등 독립 원천 변경 |

## 6. Excel 공식 계약

### 6.1 분할 합계

각 합계는 값이 있는 분할칸만 더하고 빈칸은 0으로 취급한다.

```text
Customs1 = Customs1_1 + Customs1_2 + Customs1_3
Customs2 = Customs2_1 + Customs2_2 + Customs2_3
SunYul1  = SunYul1_1  + SunYul1_2  + SunYul1_3
SunYul2  = SunYul2_1  + SunYul2_2  + SunYul2_3
```

분할값이 전달되지 않은 구형 행은 기존 합계를 첫 분할칸과 동등한 legacy 원천으로 보존한다.

### 6.2 국가별 중량과 차량 조합

1차와 2차 GW는 각 반차수 입고행을 국가별로 합산한다. 반차수별 합계마다 Excel의 차량 조합 규칙을 적용하고 두 금액을 마지막에 더한다. 차량 대수 산식과 28차 실제 경계값은 원본 계보 검사 후 fixture로 고정한다. 증거가 없을 때는 `미검증`으로 남기며 임의 용량 가정을 추가하지 않는다.

### 6.3 H 계산

```text
H = 백상창고료
  + 관세 1·2차 분할합계
  + 선율 1·2차 분할합계의 Excel상 VAT 처리값
  + 월드운송료 1·2차 VAT포함액 / 1.1
  + 한국방역 1·2차의 Excel상 VAT 처리값
```

국가별 예외(예: 베트남 선율)는 원본 Excel 수식이 확인된 경우에만 유지한다.

### 6.4 직접입력 우선순위

```text
명시적 WebCustoms 직접입력 override
> 같은 연도·차수의 자동 중량/차량 계산값
> 같은 연도 내 허용된 legacy/carry 원천
> 미입력
```

자동값을 화면에 표시했다는 이유만으로 수기 override로 저장하지 않는다. 빈칸으로 직접 지운 경우와 값이 한 번도 없었던 경우를 구분한다.

### 6.5 백상 단가 이력

단가는 `effectiveFromYear + effectiveFromWeek`가 대상 `OrderYear + OrderWeek` 이하인 이력 중 가장 최근 값을 선택한다. 같은 차수의 명시적 저장 스냅샷이 있으면 이력 재평가보다 우선한다. 28차의 실제 단가와 전환점은 Excel 계보에서 검증한 뒤 fixture에 기록한다.

## 7. 28차 H 차이 fixture

필수 fixture 구조:

```js
{
  orderYear: 2026,
  majorWeek: 28,
  excelH: 11460110,     // 주차별 매출이익 보고서!H23
  comparedH: 10802997,  // 보고된 차이에서 역산; 운영 원천은 미검증
  expectedDelta: 657113,
  components: [
    // { category, sourceCell, formula, excelValue, webValue, delta, evidence }
  ]
}
```

Excel H의 검증된 구성은 국가별 통관 시트 합계 `6,410,350`과 콜롬비아 1·2차 합계 `5,049,760`이며 총 `11,460,110`이다. 보고된 비교 차이 `+657,113`으로부터 비교 합계 `10,802,997`은 산술적으로 재현되지만, 로컬에는 비교 대상 웹/운영 DB의 국가별 원천이 없으므로 국가별 delta 구성은 `미검증`으로 유지한다.

## 7-1. 원본 전체 검사 결과

- SHA-256: `d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b` (검사 전후 동일)
- 11개 시트, 수식 1,873개, 정의 이름 10개, 외부 수식 참조 0개
- 캐시 오류 8개: `콜롬비아 1차!N21:N24`, `콜롬비아 2차!N21:N24`의 빈 분모 수익률 `#DIV/0!`; H 계보에는 참여하지 않음
- H23 계보: 일반 국가 `그외통관비!I35:I45` + 콜롬비아 `1차/2차!H21:H24`
- 28-01 콜롬비아는 `GW 7,613kg`, 백상 `460원/kg`, `5t 1대`; 28-02는 `GW 2,043kg`, 백상 `460원/kg`, `2.5t 1대`

## 8. 검증 기준

- 원본 Excel의 파일 해시는 검사 전후 동일하다.
- 모든 시트, 수식 셀, 오류 캐시, 외부참조, 정의 이름, H 선행 셀 계보를 읽기 전용으로 검사한다.
- 2025/2026 동일 28차 fixture가 연도 격리를 증명한다.
- split 합계, 국가별 반차수 중량, 차량 조합, `/1.1`, 단가 이력, 직접입력 우선순위를 각각 독립 테스트한다.
- 기존 다른 원천 계산 회귀 테스트가 그대로 통과한다.
- `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, manifest/write guard, build를 실행한다.
- 운영 DB·최신 nenova.exe 실행 결과·실브라우저는 이번 승인 범위 밖이므로 최종 상태에 `미검증`으로 기록한다.
