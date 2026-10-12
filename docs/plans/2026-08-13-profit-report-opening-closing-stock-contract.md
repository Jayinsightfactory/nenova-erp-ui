# 주차별 매출이익보고서 기초·기말재고 연결 PRD (22~28차)

작성일: 2026-08-13  
담당 범위: 기초상품재고(E)·기말상품재고(F)의 재고 스냅샷 연결 계약과 회귀검증

## 1. 문제와 목표

현재 주차별 매출이익보고서는 `ProductStock`이 존재하는 마지막 세부차수를 선택하지만
`StockMaster.isFix`를 선택 조건으로 사용하지 않는다. 이 때문에 같은 대차수의 마지막
미확정 스냅샷이 뒤에 생기면 보고서 기초·기말재고 원천이 확정 재고에서 이탈할 수 있다.

22~28차의 E/F를 다음 계약으로 고정한다.

- 기초재고 E: 선택한 `OrderYear` 안에서 직전 대차수의 마지막 **확정** 세부차수
  `ProductStock` 스냅샷.
- 기말재고 F: 선택한 `OrderYear` 안에서 현재 대차수의 마지막 **확정** 세부차수
  `ProductStock` 스냅샷.
- “마지막”은 `OrderWeek=MM-SS`의 숫자 suffix `SS` 내림차순이다. 같은 세부차수의
  중복 `StockMaster`는 `ProductStock` 행 수, 그 다음 `StockKey DESC`로 하나만 고른다.
- 확정 조건은 `StockMaster.isFix=1`이다. `isFix=0`, `NULL`, 시작재고 마커 `2`는
  E/F 원천으로 선택하지 않는다.
- 22~28차는 전년도 동일 대차수나 동일 `OrderWeek`를 fallback으로 사용하지 않는다.
- `기초 + 입고 - 출고`를 보고서에서 다시 계산하지 않는다.

## 2. 근거와 해석 경계

- `ProductStock.Stock`은 `usp_StockCalculation`이 생성한 차수별 재고 스냅샷이다.
- 전산 재고 공식은 `직전 스냅샷 + 입고 - 확정 출고 + StockHistory 재고조정`이다.
- 따라서 재고조정은 보고서가 `StockHistory`를 별도로 더해서 포함하지 않고,
  **확정 `ProductStock` 스냅샷에 이미 반영된 값으로만 포함**한다. 별도 가산은 중복계상이다.
- 운영 DB와 최신 EXE를 이 작업에서 조회할 수 없으므로 실제 22~28차 확정행과 수량은
  `미검증`으로 남긴다. 로컬 golden·계약·fixture·정적 SQL 검사를 실행 증거로 사용한다.
- `.verify/inputs/profit-report-week-28.xlsx`는 수정하지 않고 모든 시트·수식·캐시 오류·
  외부참조·수식 계보를 읽기 전용 검사한다. 계산 캐시가 없거나 Excel 재계산이 필요하면
  그 셀은 `미검증`으로 분리한다.

## 3. 사용자 동작별 side-effect matrix

| 사용자 동작 | OrderMaster/Detail | ShipmentMaster/Detail | WarehouseMaster/Detail | StockMaster/ProductStock | StockHistory | Estimate | WebProfitReport |
|---|---|---|---|---|---|---|---|
| 22~28차 보고서 조회 | 보존 | 읽기만 함 | 읽기만 함 | 읽기만 함 | 보존 | 읽기만 함 | 읽기만 함 |
| 재고 평가단가 목록 조회 | 보존 | 보존 | 읽기만 함 | 읽기만 함 | 보존 | 보존 | 읽기만 함 |
| 기존 E/F 수기 보정 저장 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | 선택 연도+대차수 키만 생성/수정 |

재고 스냅샷 선택 변경은 읽기 계약 변경이다. `StockMaster`, `ProductStock`,
`StockHistory`에 INSERT/UPDATE/DELETE를 추가하지 않는다.

## 4. downstream 보존 matrix

| downstream | 허용 영향 | 금지 영향 |
|---|---|---|
| `Estimate` | 없음 | 생성·수정·삭제 |
| `ShipmentDate` | 없음 | 수량·날짜 변경 |
| `ShipmentDetail.Amount/Vat/isFix` | 확정 매출 읽기만 함 | 값 변경 |
| `WebProfitReport` | 기존 수기 E/F가 있으면 우선 표시 | 자동 스냅샷 선택 결과를 ERP 원장에 역기록 |
| 판매/견적 View | 없음 | `ViewOrder`/`ViewShipment` 조인 결과 변경 |
| 통관·환율 | 기존 계산값을 E/F 평가 입력으로 읽기만 함 | 관련 코드·계약·수식 수정 |

## 5. 업무키와 교차연도 fixture

스냅샷 업무키는 `OrderYear + OrderWeek + StockKey`이고, 품목 집계는 여기에
`ProdKey`를 더한다. `OrderWeek` 단독 비교는 금지한다.

필수 fixture:

- 2025 `27-03`, `isFix=1`, ProductStock 존재.
- 2026 `27-01`, `isFix=1`, ProductStock 존재.
- 2026 `27-02`, `isFix=1`, ProductStock 존재.
- 2026 `27-03`, `isFix=0`, ProductStock 존재.
- 기대값: 2026년 27차 기말은 `2026/27-02`; 2025 `27-03`과 2026 미확정
  `27-03`은 선택하지 않는다.
- 2026년 28차 기초는 위와 동일한 `2026/27-02`; 2025년 27차를 사용하지 않는다.
- 22~28차 각각 `beginMajor=major-1`, `endMajor=major`, `OrderYear` 동일을 검증한다.
- 확정 스냅샷이 없으면 미확정/전년도/입출고 추정으로 fallback하지 않고
  `STOCK_BEGIN_SNAPSHOT_MISSING` 또는 `STOCK_END_SNAPSHOT_MISSING`으로 남긴다.

## 6. 구현 범위

- `lib/profitReport.js`: 확정 스냅샷 선택을 순수 정책/SQL 계약으로 분리하고
  `stockPriceRows`, `stockSnapshotByCategory`가 동일 선택기를 사용하게 한다.
- `pages/api/sales/profit-report.js`: 22~28차 기초·기말의 같은 연도 연결 메타데이터를
  유지하고, 누락 상태를 감사 정보로 전달한다.
- `docs/contracts/weekly-profit-report.json`: 확정 재고, 교차연도, 재고조정 포함 경계를 선언한다.
- `docs/exe-golden/FormProfitReport.md`, `docs/DB_STRUCTURE.md`: 기존의 “isFix 진단값” 문구를
  이 보고서의 확정 E/F 계약과 구분해 갱신한다.
- 회귀테스트: 22~28차 매핑, suffix 순서, 중복행 tie-break, 미확정 제외,
  전년도 동일 차수 제외, 누락 시 no-fallback, 재고조정 이중합산 금지를 검사한다.

통관·환율 구현 파일은 수정하지 않는다.

## 7. 완료 조건

- 원본 Excel SHA-256을 기록하고 파일 수정 전후 해시가 동일하다.
- 전체 워크시트 목록, used range, 수식 수, 오류 캐시, 외부 링크, 정의 이름,
  E/F의 직접·간접 선행 셀 계보가 검사된다.
- 22~28차 E/F 스냅샷 매핑 fixture와 전년도 동일 차수 fixture가 통과한다.
- `latestStockSnapshotWeek` SQL에 `OrderYear`, 대차수 prefix, `isFix=1`,
  `ProductStock EXISTS`, 숫자 suffix 정렬이 모두 존재한다.
- 재고 조회·보고서 저장 경로가 ERP 재고/출고/견적 원장을 쓰지 않는다.
- `npm run test:erp-contract`, manifest guard, ERP write guard, build를 실행한다.
- 운영 DB·최신 EXE·실브라우저·배포는 금지 범위이므로 `미검증`으로 보고한다.
