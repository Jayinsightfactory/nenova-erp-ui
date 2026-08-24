# 담당 3 PRD — 매출이익보고서 국가·화종·환율 resolver

- 작성일: 2026-08-13
- 대상 기능: 주차별 매출이익보고서
- 계약: `docs/contracts/weekly-profit-report.json`
- EXE 근거: `docs/exe-golden/FormProfitReport.md`
- 입력 근거: `.verify/inputs/profit-report-weeks-22-28/week-28.xlsx` (원본 변경 금지)
- 상태: 통합 완료 — 2026-08-24 사용자 확정으로 exact-week 우선 + 무매입 차수 제한 이월 정책 적용

## 1. 문제와 목표

28차 원본과 현재 분류 SQL/순수 함수를 대조하면 다음 경계가 하나의 resolver에 고정되어 있지 않다.

1. `Product.CounName='국내'`, `FlowerName='왁스'`인 경영지원 placeholder 중 `CARNATION/CHINA`, `ETC/ CHINA`, `ROSE / CHINA`는 원본 구매현황에서 중국으로 분류된다. 국가 단서 `CHINA`가 화종 단서 `CARNATION`/`ROSE`보다 먼저 적용되어야 한다.
2. 같은 `국내/왁스` placeholder인 `샘플/단`, `샘플/송이`는 원본 28차 보고서에서 `국내` 그 외 매출로 합산된다. 이를 `기타(미분류)`로 보내면 원본의 국내 매출 619,546원이 사라진다.
3. 호주는 28차부터 H/R 원천 검증 대상이고 통화는 AUD다. R은 현재 차수의 수기 확정값, `FreightCost.ExchangeRate`, 동일 주차 저장값, 22~27 historical registry, 28차 이후 KCS 고시환율 중 정확한 원천을 우선 사용한다.
4. 현재 차수에 재고화 대상 매입이 있으면 exact R이 없을 때 `INPUT_REQUIRED`다. 매입이 없을 때만 직전 대차수부터 최근 exact R을 순차 이월하며, 이 제한 규칙은 호주뿐 아니라 모든 국가·화종·통화에 동일하다. `CurrencyMaster`는 항상 참고 제안 전용이다.

목표는 국가/화종/통화/입력 시작 차수/과세환율 우선순위를 DB 없는 순수 resolver에 모으고 SQL 분류와 API 계산이 같은 계약을 사용하도록 만드는 것이다.

## 2. 원본 Excel 감사

### 전체 구조

| 시트 | 사용 범위 | 비어 있지 않은 셀 | 수식 | 표시 오류 |
|---|---:|---:|---:|---:|
| 주차별 매출이익 보고서 | B1:CA33 | 325 | 270 | 0 |
| 재고잔량 | B1:R165 | 981 | 383 | 0 |
| 그외통관비 | B3:O45 | 255 | 129 | 0 |
| 구매현황 | A1:N88 | 1,042 | 86 | 0 |
| 포워딩 | A1:N17 | 61 | 15 | 0 |
| 판매현황 | A3:R1209 | 5,966 | 742 | 0 |
| 불량차감 | A1:J65 | 639 | 63 | 0 |
| 그 외 매출액 | A1:J99 | 945 | 97 | 0 |
| 콜롬비아 1차 | B1:AH70 | 175 | 40 | 4 |
| 콜롬비아 2차 | B1:S73 | 184 | 48 | 4 |
| 품목리스트 | A1:I3106 | 24,656 | 0 | 0 |

- 전체 수식 1,873개를 검사했다.
- 수식 텍스트의 `#REF!`, 없는 시트 참조, 외부 통합문서 참조는 0건이다.
- OOXML 패키지에 `xl/externalLinks`, `connections`, `queryTables`가 없고 `TargetMode="External"` relationship도 없다.
- 직접 셀 참조 기준 수식 노드 1,873개/수식 간 간선 812개에서 정적 순환참조는 0건이다.
- `xl/calcChain.xml`은 존재한다. 주요 계보는 본표가 구매현황·판매현황·불량차감·그 외 매출액·그외통관비·포워딩·재고잔량·콜롬비아 1/2차를 읽고, 판매현황/불량차감/그 외 매출액이 품목리스트를 읽는 구조다.
- 원본 오류 8개는 `콜롬비아 1차!N21:N24`, `콜롬비아 2차!N21:N24`의 `M/L` 0 나눗셈이다. 원본은 수정하지 않는다.

### 담당 범위 근거 셀

- `구매현황!C30/C31 = ETC/ CHINA`, `C78/C79 = ROSE / CHINA`; N열 분류는 모두 `중국`이고 I열 환율은 193.81이다.
- `품목리스트!A2092/A2098/A2109`은 각각 `CARNATION/CHINA`, `ETC/ CHINA`, `ROSE / CHINA`이며 현재 마스터 표시가 `국내/왁스`다.
- `품목리스트!A2100/A2101`은 `샘플/송이`, `샘플/단`이며 `국내/왁스`다.
- `그 외 매출액!I82:I85 = 샘플/단`, `J82:J85 = 국내`; 공급가 합계는 619,546원이다.
- `주차별 매출이익 보고서!B22 = 국내`, `O22 = 619,546`, `C22 = 619,546`이다.
- `주차별 매출이익 보고서!B13 = 호주`; 28차에는 매출/재고만 있고 Q/S/R은 비어 있어 시작 차수와 “당주 매입 없음”을 구분해야 한다.

artifact-tool 의존성 로더가 현재 세션에 제공되지 않아 Excel 재계산·렌더 기반 동적 계보 검증은 `미검증`이다. 위 결과는 원본을 수정하지 않은 OOXML/캐시 수식 정적 감사다.

## 3. resolver 계약

### 3.1 분류 우선순위

1. 중량 비가치 행(`Gross weight`, `Chargeable weight`, 오탈자 `weigth`)은 보고서 금액 분류에서 제외한다.
2. 명시적 운송료 업무 규칙을 적용한다.
3. `CHINA`/`중국` 국가 단서를 화종 단서보다 먼저 적용한다. `CARNATION/CHINA`도 중국이다.
4. `국내/왁스`의 `샘플/단`, `샘플/송이`는 `국내`다.
5. 나머지는 국가와, 콜롬비아에 한해 화종을 결합한다.
6. 어떤 규칙에도 들지 않으면 `기타(미분류)`다.

SQL `CASE`와 JavaScript 분류 함수는 같은 resolver 규칙/상수에서 생성한다.

### 3.2 통화와 R 우선순위

| 분류 | 통화 |
|---|---|
| 네덜란드 | EUR |
| 호주 | AUD |
| 중국 | CNY |
| 일본 | JPY |
| 국내·공제·기타(미분류) | 없음 |
| 그 외 수입국 | USD |

유효한 양수 환율과 sourceRef/effectiveAt가 확인된 원천만 후보로 인정한다.

1. 현재차수 `WebProfitReport.R` 증거 override
2. 당주 `FreightCost.ExchangeRate` 구매금액 가중 스냅샷
3. 동일 주차 저장 `WebTaxableRate`
4. 22~27 historical registry 또는 28차 이후 KCS 고시환율
5. 원천 없음 — 매입 차수의 전차수 fallback과 CurrencyMaster 자동 적용 금지

자동값과 실효값을 분리한다. source에는 선택된 정확 주차 원천과 evidence metadata를 남긴다.

### 3.3 시작 차수와 정확 주차 증거

| 국가 | H 시작 | R 시작 | 자동 환율 조건 |
|---|---:|---:|---|
| 호주 | 28 | 28 | 대상 연도·주차와 일치하는 승인 원천 |
| 베트남 | 29 | 29 | 대상 연도·주차와 일치하는 승인 원천 |
| 그 외 | 기존 정책 | 기존 정책 | 대상 연도·주차와 일치하는 승인 원천 |

## 4. 업무키·교차연도 fixture

- 보고서 조회/저장 업무키는 `OrderYear + MajorWeek`이며, 원천 ERP 조회는 `OrderYear + OrderWeek`를 함께 사용한다.
- 2025년 28차와 2026년 28차가 동시에 있어도 2026 조회는 2025 `WarehouseMaster`, `FreightCost`, `WebProfitReport.R`을 후보로 사용하지 않는다.
- 매입이 있는 차수에서는 전차수 R을 자동 후보로 쓰지 않는다. 매입이 없는 차수만 직전 대차수부터 최근 exact R을 제한적으로 이어 사용한다. 01차는 전년도 52차부터 탐색하며 같은 차수 번호의 다른 연도를 임의로 섞지 않는다.

## 5. side-effect matrix

| 동작 | OrderMaster/Detail | ShipmentMaster/Detail | ShipmentDate | WarehouseMaster/Detail | FreightCost | Product/Country | ProductStock/StockHistory | Estimate | WebProfitReport | WebCustomsWeekly/History |
|---|---|---|---|---|---|---|---|---|---|---|
| 보고서 분류 조회 | 보존 | 읽기만 함 | 보존 | 읽기만 함 | 읽기만 함 | 읽기만 함 | 읽기만 함 | 읽기만 함 | 읽기만 함 | 읽기만 함 |
| 환율 resolver 계산 | 보존 | 보존 | 보존 | 읽기만 함 | 읽기만 함 | 읽기만 함 | 보존 | 보존 | 읽기만 함 | 보존 |
| 증거 R 저장 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | 선택 `OrderYear + MajorWeek + Category + R + sourceRef + effectiveAt`만 저장 | 보존 |
| 분류 migration dry-run | 보존 | 보존 | 보존 | 읽기만 함 | 읽기만 함 | 읽기만 함, 제안만 출력 | 보존 | 보존 | 읽기만 함 | 보존 |

## 6. downstream 보존 행렬

| 대상 | 계약 |
|---|---|
| ViewOrder/ViewShipment | 조회 결과와 원장 행을 변경하지 않는다. |
| ShipmentDetail.Amount/Vat/isFix | 변경하지 않는다. 매출 집계는 기존 `isFix=1` 계약을 유지한다. |
| ShipmentDate/PeriodDay | 변경하지 않는다. |
| Estimate | 변경하지 않는다. |
| ProductStock/StockHistory | 변경하지 않는다. |
| WebProfitReport | H/R/S는 sourceRef/effectiveAt가 있는 증거 override만 API에서 변경 가능하다. resolver/migration은 쓰지 않는다. |
| 확정 판매/손익 | 분류와 R 원천 선택만 달라질 수 있으며 원천 거래는 보존한다. |

## 7. 구현 범위

- 순수 resolver와 SQL 분류 생성기 추가
- 기존 분류/통화 API를 resolver에 위임
- 과세환율 선택을 resolver에 위임
- 국내 행을 보고서/엑셀 카테고리 목록에 추가
- CHINA 우선순위, 국내 샘플, AUD 시작 차수, exact-week R 우선순위, 교차연도 fixture 회귀테스트 추가
- `Product` 후보와 환율 원천 충돌을 SELECT로만 보여주는 migration dry-run 제공
- 주차별 손익 계약/EXE golden 문서 갱신

## 8. 비범위

- 재고·통관 UI 변경
- 원본 Excel 수정
- 운영 DB probe/쓰기, 실제 ERP 등록
- `Product`, `Country`, `CurrencyMaster`, `WebProfitReport` 자동 보정
- git push/병합/배포

## 9. 완료 기준

1. 담당 resolver 단위/회귀테스트 통과
2. `npm run test:erp-contract`
3. `npm run test:nenova-dnspy-evidence`
4. `npm run test:erp-manifest -- --changed-from origin/master`
5. `npm run guard:erp-writes -- --changed-from origin/master`
6. `npm run build`
7. migration 파일에 DML/EXEC가 없다는 정적 검사 통과

운영 DB, 최신 nenova.exe, 실제 웹, MOYI, 배포는 사용자 금지 범위이므로 최종 상태는 `미검증`으로 보고한다.
