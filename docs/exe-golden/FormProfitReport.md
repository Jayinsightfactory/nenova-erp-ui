# 주차별 매출이익보고서 — Nenova 호환 근거

## 기능 성격

주차별 매출이익보고서는 `nenova.exe`에 동일한 별도 입력 Form이 있는 기능이 아니라 웹 전용 보고서다. 따라서 웹이 임의의 주문·출고·견적 원장을 만들거나 수정하지 않고, `nenova.exe`가 사용하는 공용 View/테이블의 의미를 그대로 따라야 한다.

## 공용 ERP 읽기 계약

- 매출 N·불량 L·그외매출 O는 `ShipmentMaster`와 `ShipmentDetail`을 사용하며 확정 출고(`ShipmentMaster.isFix=1`, `isDeleted=0`)만 집계한다. N은 추가로 `ShipmentDetail.OutQuantity <> 0`을 요구한다.
  - 2026-08-11 정정: 이 문서에 `ShipmentDetail.isFix=1`로 적혀 있었으나 `lib/profitReport.js`의 실제 필터는 `ISNULL(sm.isFix,0)=1`이다. 루트 `CLAUDE.md`와 `docs/DB_STRUCTURE.md`(매출 집계 체크리스트)도 `sm.isFix=1`을 기준으로 하므로 문서 표기를 코드에 맞춰 정정했다.
  - 미해결 항목(코드 변경 없음): `docs/SHIPMENT_FIX_PARTIAL_AUDIT_2026-05-26.md`가 다루는 부분확정(마스터 `isFix=1` + 일부 `sd.isFix=0`) 상태에서는 이 보고서가 미확정 라인까지 매출로 집계할 수 있다. `lib/pivotStats.js`는 같은 매출 집계를 `sd.isFix=1`로 한다. 필터를 바꾸면 확정 차수의 매출액·매출이익 숫자가 즉시 달라지므로 설명 UI 작업 범위에서는 변경하지 않고 미결로 남긴다.
- 견적/차감은 `Estimate`와 `ShipmentMaster`의 동일 연도·차수 범위를 사용한다.
- 매입 Q, 국가별 GW/CW, 포워딩은 `WarehouseMaster`·`WarehouseDetail`을 `OrderYear + OrderWeek`로 제한한다.
- E/F/H/R/S는 재고 스냅샷·입고 GW/CW·입고별 과세환율 스냅샷(`FreightCost.ExchangeRate` — AUD를 포함한 전 통화가 통관 신고 시점 관세청 과세환율이며, 구매현황에 남는 상업(환전) 환율과는 다른 값이다)·포워딩 원천에서 자동 계산해 기본 표시한다. 29차 이후 당주 과세환율 스냅샷이 없으면 전차수에 확정 저장된 과세환율 R을 우선 상속하고, 그것도 없을 때만 `CurrencyMaster` 현재 환율을 fallback한다. 청구서·실사·특수비용처럼 예외가 있을 때만 웹 전용 `WebProfitReport`, `WebCustomsWeekly`, `WebColombiaWeekly`, `WebForwardingWeekly`에 수기 보정값을 저장한다. 비고도 같은 웹 전용 보고서 저장 경로를 사용한다.
- 2026-08-11 정정: 27차 구매현황 시트의 호주 구매환율(918.54)과 이 보고서 R(1068.23)이 다른 것은 오류가 아니다 — 구매현황은 상업(환전) 환율, R은 과세환율이며 원래 서로 다른 두 환율이다. R을 구매현황 환율로 맞추려는 보정은 하지 않는다.
- 주차별 보고서 화면의 기본 상태는 자동값 읽기전용이다. `수기 보정`, `그외통관비 입력`, `포워딩 입력` 패널은 사용자가 예외값을 수정할 때만 펼친다. 통화마스터 환율이 존재하면 청구서 환율을 매번 입력하지 않아도 자동 계산을 정상값으로 인정하며, 통화 원천 자체가 없을 때만 검증 대상으로 표시한다.
- 단, 매입 또는 포워딩 금액이 있는데 R 환율 원천이 없는 행은 검증 배너만 표시하지 않고 해당 행의 R 입력칸을 자동 노출한다. 담당자가 인보이스 과세환율을 입력하고 일반 저장하면 `WebProfitReport.R`로 저장되며, 재조회 후 검증 오류가 사라져야 한다.
- 기말재고 F는 해당 대차수에서 `ProductStock` 행이 실제로 존재하는 세부차수 중 suffix 숫자가 가장 큰 마지막 스냅샷의 `ProductStock.Stock`을 사용한다. 27차라면 27-01/27-02뿐 아니라 27-03 이후도 검색하며, 동일 세부차수 중복행은 ProductStock 행 수와 `StockKey`를 기준으로 하나를 선택한다. 기초재고 E는 같은 규칙으로 같은 `OrderYear`의 전차수(27차라면 26차) 마지막 ProductStock 스냅샷을 사용한다. 단, 01차처럼 대차수가 연도 경계를 넘는 경우에만 전년도 52차를 사용한다. `StockMaster.isFix`는 별도 재고 마감 표시·진단값이며, 27-02처럼 실제 ProductStock 스냅샷과 표시값이 어긋날 때도 스냅샷 자체를 누락으로 판정하지 않는다. ProductStock 스냅샷 자체가 없을 때만 검증 오류로 남긴다.
- 국가별 입력 시작 차수도 원본 업무 기준을 따른다. 호주는 28차부터 H(그외통관비)/R(AUD 환율) 원천을 검증하고, 베트남은 29차부터 H/R 원천을 검증한다. 시작 차수 전의 미입력은 해당 국가가 아직 보고서 입력 대상이 아니므로 감사 오류·경고를 만들지 않는다.
- `OrderWeek`만으로 2025/2026 행을 재사용하지 않는다. 모든 자동 조회와 저장은 `OrderYear`를 별도 파라미터로 유지한다.

## 국가별 그외통관비 입력 규칙

- 관세와 선율은 1차·2차 비용이 여러 번 나뉘어 청구될 수 있으므로 화면에서 각 차수별 `1/2/3` 분할금액을 입력한다. 서버는 각각 `Customs1_1~3 → Customs1`, `Customs2_1~3 → Customs2`, `SunYul1_1~3 → SunYul1`, `SunYul2_1~3 → SunYul2`로 합산해 저장·계산한다.
- 기존 `WebCustomsWeekly.Customs1/2`, `SunYul1/2`만 존재하는 운영 데이터는 첫 번째 분할칸으로 호환 표시하며, 새 입력값이 전달될 때만 서버 합계가 재생성된다.
- 국가별 입력값은 변경된 행만 한 번의 `CUSTOMS_COUNTRY_BATCH_SAVE` 트랜잭션으로 저장한다. 저장 대상은 `WebCustomsWeekly`와 `WebCustomsHistory`뿐이며, 주문·출고·견적·재고 원장은 변경하지 않는다.
- 빈 입력칸은 해당 분할금액을 `NULL`로 저장하고 합계 계산에서는 0으로 취급한다. 따라서 빈 칸을 포함한 여러 국가 입력을 한 번에 저장해도 일부 행만 저장되는 부분 성공을 허용하지 않는다.
- 보고서 비고사항은 품목 행과 분리된 `Category='_note'`, `ColKey='note'`로 `WebProfitReport.TextValue`에 `OrderYear + MajorWeek` 기준 저장한다. 비고만 입력한 경우에도 별도 `비고 저장` 버튼으로 저장할 수 있고, 전체 저장·엑셀 다운로드 전에도 저장 대상에 포함한다.

## 입고 중량·트럭 규칙

`WarehouseDetail`의 `Gross weight`/`Chargeable weight` 행을 우선 읽고, 같은 AWB의 품목 `Product.CounName`과 농장/인보이스 태그로 국가를 판별한다. 특수 중량행이 없을 때만 `WarehouseMaster.GrossWeight`/`ChargeableWeight`를 fallback으로 사용한다.

콜롬비아 국내 운송료 등급은 22~27차 매출원가 원본의 운영값을 재현한다.

| Gross Weight | 트럭 자동값 |
|---:|---|
| 0 초과 ~ 1,000kg | 1t 1대 |
| 1,000kg 초과 ~ 2,500kg | 2.5t 1대 |
| 2,500kg 초과 | 5t 1대 |

이는 물리적 적재한계를 새로 계산하는 규칙이 아니라 원본 양식의 운송료 등급 선택 규칙이다. 중량이 없으면 자동 트럭값을 만들지 않고 검증 대상으로 남긴다.

## downstream 보존

이 기능은 보고서 조회·웹 전용 수기 저장·입고 중량 읽기만 수행한다. `OrderDetail`, `ShipmentDetail.OutQuantity/Amount/Vat/isFix`, `ShipmentDate`, `Estimate`, `ProductStock`, `StockHistory`를 변경하지 않는다. 매출 집계에는 반드시 확정 출고 필터가 있어야 한다.

## 연간 월별 보기 규칙(2026-08-05)

월별 보기는 세법상 월 결산 원장을 새로 만드는 기능이 아니라, 기존 주차별 보고서의 관리 손익을 연간 화면에 재분류하는 읽기 전용 뷰다. 사용자가 월을 하나씩 선택하지 않고 1~12월을 연속으로 본다.

- 차수의 달력 범위는 `PeriodDay`의 `OrderYearWeek`와 `BaseYmd`를 사용한다. 웹에서 임의로 목요일·수요일 날짜를 재생성하지 않는다.
- 한 차수의 `BaseYmd`가 모두 같은 `YYYY-MM`이면 해당 월의 **포함 차수**다.
- 한 차수의 `BaseYmd`가 두 달 이상에 걸치면 **월경계 차수**로 분류하고 `EndDate`가 속한 달(다음 달)에 차수 전체를 귀속한다. 예를 들어 7/30~8/5 차수는 8월에 한 번만 포함한다.
- 월별 집계는 포함 차수의 기존 주차 계산 결과(C/I/J 등)만 합산한다. 기초재고(E)·기말재고(F)를 월 단위로 합산하거나 다시 계산하지 않는다.
- 월경계 차수는 월별 행의 `월경계 차수` 표시와 별도 목록에서 귀속 월을 확인할 수 있다. 한 차수는 두 달에 중복 표시하거나 합산하지 않는다.
- `PeriodDay`가 없는 차수는 0으로 간주하지 않고 `기간 확인 필요`로 표시한다.

### 부작용 표

| 사용자 동작 | OrderMaster/Detail | ShipmentMaster/Detail | ShipmentDate/PeriodDay | ProductStock/StockHistory | Estimate | WebProfitReport |
|---|---|---|---|---|---|---|
| 연도별 월별 보고서 조회 | 보존 | 보존 | 읽기만 함 | 보존 | 보존 | 읽기만 함 |
| 월별 행 펼치기·월경계 차수 확인 | 보존 | 보존 | 읽기만 함 | 보존 | 보존 | 읽기만 함 |
| 기존 주차 보고서의 수기 저장 | 보존 | 보존 | 보존 | 보존 | 보존 | 기존 주차 키로만 저장 |
| `항목별 데이터 기준 보기` 펼치기·접기 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존(조회도 하지 않음) |

## 항목별 데이터 기준 보기(2026-08-11)

보고서 상단에 항목별 원천·계산식 설명을 접기/펼치기로 제공한다. 조회·설명 전용이며 ERP 원장과 웹 전용 수기 테이블 어느 쪽도 읽거나 쓰지 않는다.

- 설명 문구는 `lib/profitReportSourceGuide.js` 한 곳의 상수로만 관리하고, 화면(`components/ProfitReportSourceGuide.js`)과 회귀테스트(`__tests__/profitReportSourceGuide.test.js`)가 그 상수만 참조한다.
- 회귀테스트는 (1) 페이지 `COLUMN_DEFS`·엑셀 `COL_LABEL`·설명 사전의 키/라벨 3중 일치, (2) 설명 문구와 실제 계산 코드의 대조(`C=N+L+O`, `P=Q×R`, `I=E+G+H−F`, noEnding 3개국 예외, D 분모는 공제 포함·U 분모는 공제 제외, 통관비 ÷1.1과 베트남 선율 예외, 27차→26차·01차→전년 52차 경계, 29차 이후 과세환율 상속, `sm.isFix=1` 확정 필터), (3) 기본 접힘·`aria-expanded`/`aria-controls`·가로 스크롤 같은 UI 계약을 함께 고정한다.
- 자동값과 사용자 입력을 배지로 구분해 표시한다. 사용자가 넣은 값(`WebProfitReport`, `WebCustomsWeekly`, `WebColombiaWeekly`, `WebForwardingWeekly`)을 자동 원천처럼 설명하지 않으며, R 원천이 없을 때 해당 행에 입력칸이 나타나는 기존 동작도 설명 대상에 포함한다.
- 접힘 상태는 저장하지 않으므로 새로고침하면 항상 접힌 상태로 시작한다.

월별 화면은 주차 손익을 수정하지 않으며, 나중에 월별 수기 보정이 필요해질 경우에도 `WebProfitReport`의 주차 키와 섞지 않고 별도 월별 원장을 추가해야 한다.

## 재고 평가·재고단가표 비재고 비용행 제외(2026-08-11)

운영 27차 화면에서 F(기말상품재고) 합계가 Excel 원본 13,229,405.2035원 대비 1,941,896,746원으로
폭증한 결함을 확인했다. 원인은 `CASE_CATEGORY`(SQL)가 운송료/SERVICE FEE/현지상차운임 placeholder
Product를 S 포워딩·H 통관 자동분류 원천으로 쓰기 위해 국가/화종으로 "분류"하는 기존 업무 규칙은
정상이지만, 그 분류를 `stockSnapshotByCategory`/`categoryUnitMismatch`/`stockPriceRows`의 재고
집계에도 그대로 적용해 비용행 `ProductStock` 잔량을 상품재고인 것처럼 합산한 데 있다. 새 EXE
Form/메서드 조사가 아니라 이미 문서화된 `ViewWarehouse`/`ViewShipment` 공용 읽기 계약(위 "공용 ERP
읽기 계약" 절)과 `Q 상품구매에서 운송료/SERVICE FEE 제외` 업무 규칙(위 "매입 Q" 절)을 재고
평가·재고단가표·매입 집계 5곳(`stockSnapshotByCategory`, `categoryUnitMismatch`,
`stockPriceRows`, `purchaseByCategory`, `purchaseQtyByCategory`, `invoiceRatesByCategory`)에
일관되게 적용하도록 정리한 버그 수정이며, `forwardingByCategory`(S)·H 통관 자동분류는 이 비용행을
그대로 배분 대상으로 써야 하므로 그대로 유지했다. 상세는
`__tests__/profitReportStockCostExclusionContract.test.js` 참고.

## 사전 확인 기록

공용 조인·확정 기준은 `docs/exe-golden/FormShipmentDistribution.md`, `docs/exe-golden/FormEstimateView.md`, `docs/DB_STRUCTURE.md`, `docs/WEB_VS_ERP_CONFLICTS.md`에 기록된 dnSpy/DB 근거를 재사용한다. 이 기록과 `docs/contracts/weekly-profit-report.json`은 변경 시 회귀 테스트와 배포 manifest 검사의 기준이다.
