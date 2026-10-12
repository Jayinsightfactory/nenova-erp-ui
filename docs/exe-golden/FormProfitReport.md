# 주차별 매출이익보고서 — Nenova 호환 근거

## 기능 성격

주차별 매출이익보고서는 `nenova.exe`에 동일한 별도 입력 Form이 있는 기능이 아니라 웹 전용 보고서다. 따라서 웹이 임의의 주문·출고·견적 원장을 만들거나 수정하지 않고, `nenova.exe`가 사용하는 공용 View/테이블의 의미를 그대로 따라야 한다.

## 공용 ERP 읽기 계약

- 매출 N은 선택 `ShipmentMaster.OrderYear`와 `OrderWeek` 범위에서 `ShipmentMaster.isFix=1` 및 `ShipmentDetail.isFix=1`인 확정 출고만 집계한다. 불량 L·그외매출 O는 같은 연도·차수의 `Estimate` 확정 master 범위를 사용한다.
- 견적/차감은 `Estimate`와 `ShipmentMaster`의 동일 연도·차수 범위를 사용한다.
- 매입 Q, 국가별 GW/CW, 포워딩은 `WarehouseMaster`·`WarehouseDetail`을 `OrderYear + OrderWeek`로 제한한다.
- E/F는 확정 ProductStock와 동일 `OrderYear + OrderWeek + ProdKey`의 `VERIFIED` 시점 단가 근거로만 자동 평가한다. 가격 근거가 없으면 `INPUT_REQUIRED`/`UNVERIFIED`이며 `Product.Cost`, 최근 입고단가, 수국 하드코딩, E/F 최종값 직접입력으로 대체하지 않는다. H/R/S는 입고 GW/CW·BILL 시점 환율·포워딩 원천에서 자동 계산하고, 외부 인보이스 확정값만 sourceRef·기준일·확정자·확정시각과 함께 웹 전용 원장에 저장한다. 비고도 같은 웹 전용 보고서 저장 경로를 사용한다.
- 주차별 보고서 화면의 기본 상태는 자동값 읽기전용이다. `수기 보정`, `그외통관비 입력`, `포워딩 입력` 패널은 사용자가 예외값을 수정할 때만 펼친다. 통화마스터 환율이 존재하면 청구서 환율을 매번 입력하지 않아도 자동 계산을 정상값으로 인정하며, 통화 원천 자체가 없을 때만 검증 대상으로 표시한다.
- 단, 매입 또는 포워딩 금액이 있는데 R 환율 원천이 없는 행은 검증 배너만 표시하지 않고 해당 행의 R 입력칸을 자동 노출한다. 담당자가 인보이스 과세환율과 sourceRef·기준일을 입력하면 서버가 확정자·확정시각을 기록하고 `WebProfitReport.R`로 저장한다.
- 22~28차 기말재고 F는 선택 `OrderYear`의 해당 대차수에서 `StockMaster.isFix=1`이고 `ProductStock` 행이 존재하는 세부차수 중 suffix 숫자가 가장 큰 확정 스냅샷의 `ProductStock.Stock`을 사용한다. 기초재고 E는 같은 `OrderYear`의 직전 대차수에 같은 규칙을 적용한다. 동일 세부차수 중복행은 ProductStock 행 수와 `StockKey DESC`로 하나를 선택한다. 전년도 동일 차수, 미확정/NULL/시작재고 마커, 입고-출고 단순추정으로 fallback하지 않으며 확정 스냅샷이 없으면 검증 오류로 남긴다. 재고조정은 `usp_StockCalculation`이 확정 ProductStock 스냅샷에 반영한 값으로만 포함하고 보고서에서 `StockHistory` delta를 다시 더하지 않는다.
- 국가별 입력 시작 차수도 원본 업무 기준을 따른다. 호주는 28차부터 H(그외통관비)/R(AUD 환율) 원천을 검증하고, 베트남은 29차부터 H/R 원천을 검증한다. 시작 차수 전의 미입력은 해당 국가가 아직 보고서 입력 대상이 아니므로 감사 오류·경고를 만들지 않는다.
- `OrderWeek`만으로 2025/2026 행을 재사용하지 않는다. 모든 자동 조회와 저장은 `OrderYear`를 별도 파라미터로 유지한다.
- 백상·트럭·검역 단가를 수정할 때는 적용 `OrderYear + MajorWeek` 이력을 함께 남기고, 과거 보고서는 대상 차수 이하의 최근 단가를 사용한다. 현재 전역 단가로 과거 H를 재작성하지 않는다.
- `CHINA`/`중국` 품명 단서는 화종과 국내/왁스 placeholder보다 우선한다. `샘플/단`·`샘플/송이` 국내 매출은 `국내` 행으로 분류하며 28차 원본 공급가 합계는 619,546원이다.
- 환율은 현재차수 수기 R, 당주 `FreightCost.ExchangeRate`, 허용된 전차수 확정 R, `CurrencyMaster` 순으로 선택한다. 호주는 AUD이며 29차에서 28차 R을 상속할 수 있다. 베트남은 29차가 최초 입력 차수이므로 30차부터 29차 R 상속이 가능하다.
- 확정 스냅샷은 웹 전용 `WebProfitReportSnapshot` payload로 고정하며, 조회 시 현재 ERP 원장을 재계산해 섞지 않는다. 관련 테이블 DDL은 별도 migration으로만 적용한다.

## 국가별 그외통관비 입력 규칙

- 관세와 선율은 1차·2차 비용이 여러 번 나뉘어 청구될 수 있으므로 화면에서 각 차수별 `1/2/3` 분할금액을 입력한다. 서버는 각각 `Customs1_1~3 → Customs1`, `Customs2_1~3 → Customs2`, `SunYul1_1~3 → SunYul1`, `SunYul2_1~3 → SunYul2`로 합산해 저장·계산한다.
- 기존 `WebCustomsWeekly.Customs1/2`, `SunYul1/2`만 존재하는 운영 데이터는 첫 번째 분할칸으로 호환 표시하며, 새 입력값이 전달될 때만 서버 합계가 재생성된다.
- `WebCustomsWeekly`에 직접 저장된 GW·월드운송료는 0을 포함해 자동 입고 중량/차량값보다 우선한다. `WorldFreight*Manual=0`을 명시한 경우에만 자동 차량 금액을 사용한다.
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

월별 화면은 주차 손익을 수정하지 않으며, 나중에 월별 수기 보정이 필요해질 경우에도 `WebProfitReport`의 주차 키와 섞지 않고 별도 월별 원장을 추가해야 한다.

## 사전 확인 기록

공용 조인·확정 기준은 `docs/exe-golden/FormShipmentDistribution.md`, `docs/exe-golden/FormEstimateView.md`, `docs/DB_STRUCTURE.md`, `docs/WEB_VS_ERP_CONFLICTS.md`에 기록된 dnSpy/DB 근거를 재사용한다. 이 기록과 `docs/contracts/weekly-profit-report.json`은 변경 시 회귀 테스트와 배포 manifest 검사의 기준이다.
