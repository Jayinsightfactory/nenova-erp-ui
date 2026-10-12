# 담당 1 PRD — 주차별 매출이익보고서 확정 스냅샷 계약

작성일: 2026-08-13  
담당 범위: 22~28차 보고서 원천·상태·재계산 금지, 28차 Excel 기준값, 27 F → 28 E 연결  
제외 범위: 분류 규칙, 그외통관비·포워딩 입력 UI와 계산 규칙

## 1. 문제와 목표

기존 주차별 매출이익보고서는 조회할 때마다 현재 `Shipment*`, `Warehouse*`,
`ProductStock`, `FreightCost`, `CurrencyMaster`와 웹 수기값을 다시 읽어 계산한다.
따라서 과거 Excel 기준값과 조회 시점의 웹 재계산값이 한 화면에서 섞일 수 있고,
어느 원천이 확정본인지 판별할 상태 계약이 없다.

이번 변경은 다음을 고정한다.

- 보고서 상태는 `LIVE_UNCONFIRMED`와 `CONFIRMED`로 분리한다.
- `LIVE_UNCONFIRMED`는 현재 웹 원장을 한 번 계산한 값이며 저장된 기준값이 아니다.
- `CONFIRMED`는 원천, 파일 해시 또는 서버 캡처 식별자, 확정 시각·확정자,
  스키마 버전과 행별 계산 결과를 함께 보존한다.
- 확정본 조회는 현재 ERP·웹 원천을 재조회해 값에 섞지 않는다.
- 확정 뒤 E/F/H/R/S·비고·재고단가 저장과 재확정은 거부한다.
- Excel 기준 fixture가 없는 22~26차는 추측하지 않고 `UNVERIFIED`로 남긴다.
- 27차는 저장소 작업보고서의 합계만 부분 검증이며, 행별 Excel 원본은 `UNVERIFIED`다.
- 28차는 지정된 Excel의 보고서 시트 캐시값을 `CONFIRMED` fixture로 사용한다.

## 2. 업무키와 상태 전이

보고서 업무키는 `OrderYear + MajorWeek`다. `MajorWeek` 또는 `OrderWeek` 단독으로
다른 연도의 스냅샷을 선택하지 않는다. ERP 원천 행을 진단할 때는 기존 계약대로
`OrderYear + OrderWeek + CustKey + ProdKey`를 유지한다.

```text
LIVE_UNCONFIRMED --confirm current calculation--> CONFIRMED
CONFIRMED --조회/Excel/MOYI 출력--> CONFIRMED (동일 payload)
CONFIRMED --수기저장/비고저장/재고단가저장/재확정--> 거부
```

확정 취소·재확정은 이번 계약에 없다. 향후 필요하면 기존 확정본을 덮어쓰지 않고
새 revision과 명시적 승인 이력을 별도 계약으로 추가해야 한다.

## 3. 원본 Excel 읽기 전용 검사

대상: `.verify/inputs/profit-report-week-28.xlsx`  
SHA-256: `D777E8745B3B1E2FBF89AC782633E9FD654F38FD7684ECBB620032221ECB156B`

- 시트 11개: 주차별 매출이익 보고서, 재고잔량, 그외통관비, 구매현황, 포워딩,
  판매현황, 불량차감, 그 외 매출액, 콜롬비아 1차, 콜롬비아 2차, 품목리스트.
- 전체 수식 셀 1,873개, calcChain 1,873개로 개수가 일치한다.
- 외부 formula reference, externalLink, connection 관계는 0개다.
- 보고서 기준 범위 `B7:U23`에는 수식 오류 캐시가 없다.
- 콜롬비아 1차·2차의 보조 `N21:N24`에는 각각 `#DIV/0!` 4개, 합계 8개가
  캐시되어 있다. C/E/F/G/H/I/J 기준 셀의 직접 원천으로 사용하지 않고 검사 결과에
  보존한다.
- 검사 전후 파일 해시는 동일해야 하며 원본 Excel은 수정·재저장하지 않는다.

## 4. 22~28차 근거 상태

| 연도/차수 | 상태 | 근거 | 사용 계약 |
|---|---|---|---|
| 2026/22~26 | `UNVERIFIED` | 허용 범위 안에 원본 Excel 없음 | 확정본으로 사용 금지, 현재 웹값과 혼합 금지 |
| 2026/27 | `PARTIAL_VERIFIED` | `docs/work-reports/2026-07-21_profit-report-27-reconciliation.md` 합계 | F 합계의 28 E 이월 검증에만 사용 |
| 2026/28 | `CONFIRMED` | 지정 Excel SHA-256 + `주차별 매출이익 보고서!B7:U23` | 행별·합계 고정, 재계산 금지 |

28차 합계 기준:

| 열 | 값 |
|---|---:|
| C | 244,367,497 |
| E | 13,229,405.2035 |
| F | 21,966,629.475086842 |
| G | 214,091,241.8802 |
| H | 11,460,110 |
| I | 216,814,127.6086131 |
| J | 27,553,369.391386844 |

27차 작업보고서의 F 합계 `13,229,405.204`와 28차 Excel E 합계
`13,229,405.2035`의 차이는 `0.0005`이며 허용오차 `0.001` 안이다. 행별 27차
Excel 파일은 허용 범위에 없으므로 행별 F→E 동일성은 `UNVERIFIED`로 남긴다.

## 5. 사용자 동작별 side-effect matrix

| 동작 | Order/Shipment | Warehouse | StockMaster/ProductStock | StockHistory | Estimate | WebProfitReport | WebProfitReportSnapshot |
|---|---|---|---|---|---|---|---|
| 미확정 보고서 조회 | 읽기만 | 읽기만 | 읽기만 | 보존 | 읽기만 | 읽기 | 읽기 |
| 확정 보고서 조회·Excel·MOYI 출력 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | 확정 payload 읽기 |
| 현재 웹 계산 확정 | 읽기만 | 읽기만 | 읽기만 | 보존 | 읽기만 | 읽기 | 업무키에 1회 생성 |
| 확정 뒤 수기값·비고·단가 저장 | 보존 | 보존 | 보존 | 보존 | 보존 | **거부** | 보존 |
| 재확정·확정 payload 덮어쓰기 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | **거부** |

GET은 ERP·웹 원장을 수정하지 않는다. 스냅샷 저장은 웹 전용
`WebProfitReportSnapshot`만 생성하며 주문·출고·재고·견적 원장에 쓰지 않는다.

## 6. downstream 보존 matrix

| downstream | 허용 영향 | 금지 영향 |
|---|---|---|
| `ViewOrder` / `ViewShipment` | 미확정 계산의 읽기 원천 | 행 생성·수정·삭제 |
| `ShipmentDate` | 없음 | 날짜·수량 변경 |
| `ShipmentDetail.Amount/Vat/isFix` | 미확정 계산에서 확정 매출 읽기 | UPDATE 또는 재확정 |
| `Estimate` | 미확정 계산에서 읽기 | 생성·수정·삭제 |
| `WebProfitReport` | 미확정 계산의 기존 수기값 읽기 | 확정 뒤 수정, 확정 payload 역기록 |
| 판매/월별 손익 | 주차 확정 payload 합산 | E/F 월별 재계산, 현재 원장으로 과거 확정값 교체 |

## 7. 교차연도 fixture

순수 정책 테스트에는 다음 합성 fixture를 둔다.

- 2025/28 `CONFIRMED`, 서로 다른 decoy 합계.
- 2026/28 `CONFIRMED`, 지정 Excel 합계.
- 요청 업무키가 2026/28이면 2025/28은 선택하지 않는다.
- 2025/28만 존재할 때 2026/28 요청은 다른 연도로 fallback하지 않는다.

합성 decoy 값은 운영 사실이 아니라 연도 격리 검사용임을 fixture에 명시한다.

## 8. 구현 범위

- `data/profit-report-confirmed-snapshots.json`: 22~28 근거 상태, 28차 행별 Excel
  기준값, 27 F→28 E aggregate lineage.
- `lib/profitReportSnapshot.js`: 업무키 선택, 상태/원천 검증, 확정 payload 고정,
  웹 전용 스냅샷 저장과 immutable guard.
- `lib/profitReportCalc.js`: 확정 행은 저장된 계산값만 반환하고 재계산하지 않는다.
- `pages/api/sales/profit-report.js`: 확정본 우선 조회, 미확정 상태 메타데이터,
  현재 계산 1회 확정 action, 확정 뒤 쓰기 차단.
- `pages/sales/profit-report.js`: 원천·상태 표시와 확정본 편집 비활성화. 분류·통관
  컴포넌트 내부는 수정하지 않는다.
- 계약 JSON·EXE golden·DB 구조·독립 회귀 테스트를 갱신한다.

## 9. 완료 조건

- 28차 C/E/F/G/H/I/J 행별 값과 합계가 Excel 캐시값과 허용오차 내 일치한다.
- 27 F→28 E 합계 연결이 허용오차 `0.001` 안에서 통과한다.
- 확정 28차 조회는 ERP 자동계산 함수를 호출하지 않고 fixture payload를 반환한다.
- 확정 행에 `computeProfitRow`를 호출해도 저장된 값이 그대로 반환된다.
- 다른 연도 같은 28차를 선택하지 않는다.
- 확정 뒤 수기·비고·단가·재확정이 거부된다.
- `npm run test:erp-contract`, dnSpy evidence, manifest/write guard, build를 실행한다.
- 운영 DB, 최신 nenova.exe 실행, 실제 브라우저, 배포는 금지 범위이므로
  `미검증`으로 보고한다.
