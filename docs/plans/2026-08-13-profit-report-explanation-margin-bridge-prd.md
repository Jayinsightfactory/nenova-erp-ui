# 담당 5 PRD — 매출이익 설명·이익률 차이 UI

작성일: 2026-08-13
상태: 통합 구현 완료 — 실행 기준은 최신 evidence/confirm 계약
대상 계약: `docs/contracts/weekly-profit-report.json`

## 1. 목표

주차별 매출이익 보고서에서 사용자가 `매출액(C)`, `매출비율(D)`, `기초재고(E)`,
`기말재고(F)`, `매입(G)`, `통관비(H)`, `원가(I)`, `이익(J)`, `이익률(K)`의 원천과
공식을 화면 안에서 접기/펼치기로 확인할 수 있게 한다. 각 설명은 확정 출고 사용 여부와
직접입력 가능 여부와 필요한 증거 metadata를 함께 표시한다.

현재 차수와 직전 차수의 이익률 차이는 판매믹스, 분배단가, 원가, 재고, 환율, 운송의
여섯 기여도로 분해한다. 분해 결과는 시작 이익률, 여섯 기여도, 종료 이익률이 정확히
재조정되는 독립 순수 helper로 계산한다.

검증이 필요한 항목은 표 위의 여러 배너로 흩어놓지 않고 카테고리 표 바로 아래의 단일
`검증 필요` 영역에 모은다.

## 2. 범위

- `pages/sales/profit-report.js`
  - 설명 접기/펼치기 UI
  - 직전 차수 이익률 브리지 UI
  - 표 하단 검증 목록
  - 기존 profit-report GET/POST/download 호출에 명시적 `year` 전달
- `lib/profitMarginDecomposition.js`
  - DB·React·API에 의존하지 않는 스냅샷 정규화 및 Shapley 기여도 계산
- `lib/profitReportExplanations.js`
  - 지표별 원천·공식·확정·직접입력 설명의 단일 소스
- 전용 회귀테스트와 `weekly-profit-report` 계약 manifest 갱신

원천 API와 SQL, 원본 Excel은 변경하지 않는다.

## 3. 근거 우선순위

1. `.verify/inputs/profit-report-weeks-22-28/week-28.xlsx`의 수식과 계보
2. `docs/exe-golden/FormProfitReport.md`
3. `lib/profitReportCalc.js`와 `pages/api/sales/profit-report.js`의 현재 계약
4. `docs/contracts/weekly-profit-report.json`

서로 다르면 자동으로 하나를 정답으로 추정하지 않고 검증 항목에 `미검증`으로 남긴다.
외부 자료, 운영 DB, 실제 `nenova.exe`, 로그인 브라우저는 이번 작업 범위에서 사용하지 않는다.

## 4. 지표 설명 계약

| 지표 | 원천 | 공식 | 확정 기준 | 직접입력 |
|---|---|---|---|---|
| C 매출액 | 확정 `ShipmentDetail.Amount`의 N + 확정 차수 `Estimate.Amount`의 L/O | `C=N+L+O` | `ShipmentMaster.isFix=1` 및 `ShipmentDetail.isFix=1` | 불가 |
| D 매출비율 | C | `행 C / 전체 C` | C와 동일 | 불가 |
| E 기초재고 | 같은 연도 전차수의 마지막 `StockMaster.isFix=1` + ProductStock 스냅샷 | 정확한 `OrderYear+OrderWeek+ProdKey`의 `VERIFIED` 단가 증거로 평가 | 전년도·미확정·입출고 추정·최근단가 fallback 금지 | 최종 E 직접입력 불가; 단가 증거만 등록 가능 |
| F 기말재고 | 이번 차수의 마지막 `StockMaster.isFix=1` + ProductStock 스냅샷 | 정확한 `OrderYear+OrderWeek+ProdKey`의 `VERIFIED` 단가 증거로 평가 | 확정 ProductStock 외 수량 및 `Product.Cost`/최근단가 fallback 금지 | 최종 F 직접입력 불가; 단가 증거만 등록 가능 |
| G 매입액 | 입고 Q, 환율 R, 포워딩 S | `G=P+T`, `P=Q×R`, `T=S×R` | 출고확정 비대상, 입고/BILL 원천 | 직접 G 불가; R/S만 보정 가능 |
| H 그외통관비 | 구조화 통관 원천·중량 배분 | 자동 H | 출고확정 비대상 | 가능 |
| I 매출원가 | E/G/H/F | 일반 `I=E+G+H-F`; `noEnding`은 `I=E+G+H` | 혼합 원천 | 불가 |
| J 매출이익 | C/I/F | 일반 `J=C-I`; `noEnding`은 `J=C-I+F` | C와 원가 원천을 상속 | 불가 |
| K 이익률 | J/C/F | 일반 행 `J/C`; `noEnding` 행과 합계는 현재 원본 계약의 `J/(C+F)` | J와 분모 원천을 상속 | 불가 |

## 5. 이익률 기여도 계산 계약

입력 스냅샷은 반드시 `{ orderYear, major, rows }`를 가진다. `major`가 같아도
`orderYear`가 다르면 별도 스냅샷이다.

여섯 요인은 다음 필드를 교체한다.

| 요인 | 교체 필드 | 의미·한계 |
|---|---|---|
| 판매믹스 | 카테고리별 C 비중 | 전체 매출을 고정하고 카테고리 구성만 교체 |
| 분배단가 | 전체 C 규모 | 현재 API에 판매수량·실판매단가가 없어 단가 단독 분리는 불가. 매출총액 변화 대체치이며 UI에 `미검증` 표시 |
| 원가 | Q | 구매 외화원금 변화 |
| 재고 | E/F | 보고된 기초·기말 평가액 변화 |
| 환율 | R | 구매·포워딩 원화환산율 변화 |
| 운송 | S/H | 포워딩 USD와 그외통관비 변화 |

요인 간 곱셈 상호작용(`Q×R`, `S×R`)과 교체 순서 편향은 6요인의 모든 순열을 평균한
Shapley 방식으로 배분한다. 기여도 합계와 실제 이익률 차이의 잔차는 부동소수점 오차
범위 안이어야 하며, 범위를 넘으면 UI의 검증 목록에 표시한다.

판매수량·실판매단가가 API에 추가되기 전까지 `분배단가`는 확정값이 아니며
`미검증` 상태를 유지한다. API를 추정 변경하지 않는다.

## 6. 사용자 동작별 side-effect matrix

| 사용자 동작 | OrderMaster/Detail | ShipmentMaster/Detail | Warehouse | Stock/ProductStock | Estimate | WebProfitReport | 네트워크/저장 |
|---|---|---|---|---|---|---|---|
| 설명 펼치기/접기 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | 없음 |
| 검증 목록 확인 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | 없음 |
| 직전 차수 브리지 펼치기 | 읽기 결과만 사용 | 읽기 결과만 사용 | 읽기 결과만 사용 | 읽기 결과만 사용 | 읽기 결과만 사용 | 읽기 결과만 사용 | 기존 GET만 사용, `year` 명시 |
| 브리지 재계산 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | 클라이언트 순수 계산 |

## 7. downstream 영향 matrix

| 대상 | 영향 |
|---|---|
| ViewOrder | 보존, 조회/조인 추가 없음 |
| ViewShipment | 보존, 기존 보고서 GET 결과만 사용 |
| ShipmentDate | 보존 |
| ShipmentFarm | 보존 |
| ShipmentDetail.Amount/Vat/isFix | 보존 |
| Estimate | 보존 |
| WebProfitReport | 설명·브리지에서 보존; H/R/S/note는 증거 metadata와 함께 저장하고 E/F 최종 저장은 거부 |
| 판매현황/견적/월별손익 | 계산·저장 계약 변경 없음 |

## 8. 교차연도 fixture

- 기준: `2025 + 28차`
- 비교: `2026 + 28차`
- 두 스냅샷은 차수명이 같아도 병합하지 않는다.
- UI의 직전 차수 조회는 `year`를 명시하며, 01차의 직전은 전년도 52차로 계산한다.
- 테스트는 두 연도의 동일 28차가 서로 다른 이익률과 기여도를 유지하는지 확인한다.

## 9. 완료 조건

- 원본 Excel의 전 시트·수식·오류·외부참조·수식 계보 정적검사 결과가 기록된다.
- 설명 UI가 아홉 지표의 네 속성을 모두 표시한다.
- 검증 항목이 표 하단 단일 영역에 표시된다.
- 여섯 기여도 합계가 실제 이익률 차이와 조정된다.
- 0 매출, 음수/공제, 누락 카테고리, `noEnding`, 교차연도 동일 차수 fixture가 통과한다.
- `weekly-profit-report` 계약, 전용 테스트, ERP 계약 가드, 빌드가 통과한다.
- 운영 DB·실제 EXE·실브라우저·배포는 수행하지 않고 `미검증`으로 보고한다.
