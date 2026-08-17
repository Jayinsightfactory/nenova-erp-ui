# 주차별 매출이익보고서 — Nenova 호환 근거

## 기능 성격

주차별 매출이익보고서는 `nenova.exe`에 동일한 별도 입력 Form이 있는 기능이 아니라 웹 전용 보고서다. 따라서 웹이 임의의 주문·출고·견적 원장을 만들거나 수정하지 않고, `nenova.exe`가 사용하는 공용 View/테이블의 의미를 그대로 따라야 한다.

## 공용 ERP 읽기 계약

- 매출 N은 선택 `ShipmentMaster.OrderYear`와 `OrderWeek` 범위에서 `ShipmentMaster.isFix=1`, `ShipmentDetail.isFix=1`, `ShipmentMaster.isDeleted=0`, `ShipmentDetail.OutQuantity <> 0`인 확정 출고만 집계한다. 불량 L·그외매출 O는 같은 연도·차수의 `Estimate` 확정 master 범위를 사용한다.
- 견적/차감은 `Estimate`와 `ShipmentMaster`의 동일 연도·차수 범위를 사용한다.
- 매입 Q, 국가별 GW/CW, 포워딩은 `WarehouseMaster`·`WarehouseDetail`을 `OrderYear + OrderWeek`로 제한한다.
- E/F 수량은 EXE가 계산한 마지막 ProductStock를 사용한다. 원본 workbook 수식이 확인된 콜롬비아 수국·카네이션·장미·루스커스·알스트로와 베트남은 `(Q×R + S×R + H) ÷ 당주 매입수량 × ProductStock 재고수량`으로 평가한다. 나머지는 동일 `OrderYear + OrderWeek + ProdKey`의 `VERIFIED` 시점 단가 근거를 사용하고, 2026년 22~28차에 한해 파일 SHA와 정확한 F 셀이 고정된 원본 workbook 값을 마지막 역사 증거로 사용할 수 있다. 근거가 없으면 `INPUT_REQUIRED`/`UNVERIFIED`이며 `Product.Cost`, 최근 입고단가, 수국 하드코딩, E/F 최종값 직접입력으로 대체하지 않는다. H/R/S는 입고 GW/CW·BILL 시점 환율·포워딩 원천에서 자동 계산하고, 외부 인보이스 확정값만 sourceRef·기준일·확정자·확정시각과 함께 웹 전용 원장에 저장한다. 비고도 같은 웹 전용 보고서 저장 경로를 사용한다.
- 2026-08-11 정정: 27차 구매현황 시트의 호주 구매환율(918.54)과 이 보고서 R(1068.23)이 다른 것은 오류가 아니다 — 구매현황은 상업(환전) 환율, R은 과세환율이며 원래 서로 다른 두 환율이다. R을 구매현황 환율로 맞추려는 보정은 하지 않는다.
- 2026-08-12 정정: R 자동 적용은 정확한 `OrderYear+MajorWeek(+Currency/Category)` 원천만 쓴다 — ①당주 `FreightCost.ExchangeRate` 스냅샷 → ②그 차수에 저장/캐시된 `WebTaxableExchangeRate`(카테고리 지정 값이 통화 기본값보다 우선) → ③2026년 22~27차는 `lib/profitReportHistoricalCustoms.js`의 원본 엑셀 본표 R열. 이전 구현이 하던 "29차 이후 전차수 R 자동 상속"과 "CurrencyMaster 현재 환율 자동 fallback"은 모두 제거했다 — 과거 차수에 오늘의 환율이나 다른 차수 값을 자동으로 채우면 확정 손익이 조용히 바뀌기 때문이다. 전차수 값과 CurrencyMaster 현재 환율은 화면에 참고 제안(`rateSuggestions`)으로만 표시되고, 사용자가 명시적으로 적용·저장(`TAXABLE_RATE_SAVE`)해야 계산에 들어간다.
- 2026-08-12 추가(28차 이후 관세청 공식 과세환율 KCS API): R 자동 우선순위 맨 앞에 행별 수기
  오버라이드(`WebProfitReport.R`, `man.R` — 호출부 `pages/api/sales/profit-report.js`가
  `resolveTaxableRate()` 결과보다 항상 먼저 적용)가 있고, 위 ①~③ 어느 것도 없을 때만 2026년
  28차 이후에 한해 관세청(KCS) 공식 과세환율 API를 4순위로 시도한다. 상세 설계·근거·회귀 목록은
  아래 "2026-08-12 KCS(관세청 과세환율 API) date 기반 자동 조회" 절 참고.
- 주차별 보고서 화면의 기본 상태는 자동값 읽기전용이다. `수기 보정`, `그외통관비 입력`, `포워딩 입력` 패널은 사용자가 예외값을 수정할 때만 펼친다. 이 차수에 정확히 저장/캐시된 과세환율이 있으면 자동 계산을 정상값으로 인정하며, 그 차수 원천 자체가 없을 때만 검증 대상으로 표시한다.
- 단, 매입 또는 포워딩 금액이 있는데 R 환율 원천이 없는 행은 검증 배너만 표시하지 않고 해당 행의 R 입력칸을 자동 노출한다. 담당자가 인보이스 과세환율과 sourceRef·기준일을 입력하면 서버가 확정자·확정시각을 기록하고 `WebProfitReport.R` 및 정확한 차수의 `WebTaxableExchangeRate`에 저장한다.
- 22~28차 기말재고 F는 선택 `OrderYear`의 해당 대차수에서 `ProductStock` 행이 존재하는 숫자 세부차수 중 suffix가 가장 큰 스냅샷의 `ProductStock.Stock`을 사용한다. 기초재고 E는 같은 `OrderYear`의 직전 대차수에 같은 규칙을 적용한다. 동일 세부차수 중복행은 ProductStock 행 수와 `StockKey DESC`로 하나를 선택한다. `FormStockView.GetData`는 `StockMaster.isFix`를 조회·필터·표시하지 않으므로 보고서도 이를 재고 마감 조건으로 사용하지 않는다(`docs/exe-golden/FormStockAdd.md`의 판정 정정과 동일). 전년도 동일 차수, NULL/시작재고 마커, 입고-출고 단순추정으로 fallback하지 않으며 ProductStock 스냅샷이 없으면 검증 오류로 남긴다. 재고조정은 `usp_StockCalculation`이 ProductStock 스냅샷에 반영한 값으로만 포함하고 보고서에서 `StockHistory` delta를 다시 더하지 않는다.
- 기초재고 E는 현재 workbook의 E 셀을 복사하지 않고 직전 대차수 F를 위와 같은 공식·원천으로 다시 계산한다. 따라서 원본 26차 F와 27차 E 사이의 베트남 3,658,862.88875원 불연속은 `WORKBOOK_ANOMALY`로 기록하지만 웹 계산에는 자동 이월하지 않는다.
- 국가별 그외통관비(H) 입력화면 도입 차수는 원본 업무 기준을 따른다. 호주는 28차부터, 베트남은 29차부터 H 원천을 검증한다. 시작 차수 전의 H 미입력은 해당 국가가 아직 입력 대상이 아니므로 감사 오류·경고를 만들지 않는다. **R(과세환율)은 이 표와 별개다** — 위 항목 참고.
- `OrderWeek`만으로 2025/2026 행을 재사용하지 않는다. 모든 자동 조회와 저장은 `OrderYear`를 별도 파라미터로 유지한다.
- 백상·트럭·검역 단가를 수정할 때는 적용 `OrderYear + MajorWeek` 이력을 함께 남기고, 과거 보고서는 대상 차수 이하의 최근 단가를 사용한다. 현재 전역 단가로 과거 H를 재작성하지 않는다.
- `CHINA`/`중국` 품명 단서는 화종과 국내/왁스 placeholder보다 우선한다. `샘플/단`·`샘플/송이` 국내 매출은 28차부터 `국내` 행으로 분류한다.
- 보고서·통관·포워딩 GET은 schema contract를 읽기 검증할 뿐 DDL을 실행하지 않는다. Web 전용 테이블/컬럼은 별도 migration으로만 적용한다.

## 국가별 그외통관비 입력 규칙

- 관세와 선율은 1차·2차 비용이 여러 번 나뉘어 청구될 수 있으므로 화면에서 각 차수별 `1/2/3` 분할금액을 입력한다. 서버는 각각 `Customs1_1~3 → Customs1`, `Customs2_1~3 → Customs2`, `SunYul1_1~3 → SunYul1`, `SunYul2_1~3 → SunYul2`로 합산해 저장·계산한다.
- 기존 `WebCustomsWeekly.Customs1/2`, `SunYul1/2`만 존재하는 운영 데이터는 첫 번째 분할칸으로 호환 표시하며, 새 입력값이 전달될 때만 서버 합계가 재생성된다.
- `WebCustomsWeekly`에 직접 저장된 GW·월드운송료는 0을 포함해 자동 입고 중량/차량값보다 우선한다. `WorldFreight*Manual=0`을 명시한 경우에만 자동 차량 금액을 사용한다.
- 국가별 입력값은 변경된 행만 한 번의 `CUSTOMS_COUNTRY_BATCH_SAVE` 트랜잭션으로 저장한다. 저장 대상은 `WebCustomsWeekly`와 `WebCustomsHistory`뿐이며, 주문·출고·견적·재고 원장은 변경하지 않는다.
- 빈 입력칸은 해당 분할금액을 `NULL`로 저장하고 합계 계산에서는 0으로 취급한다. 따라서 빈 칸을 포함한 여러 국가 입력을 한 번에 저장해도 일부 행만 저장되는 부분 성공을 허용하지 않는다.
- 보고서 비고사항은 품목 행과 분리된 `Category='_note'`, `ColKey='note'`로 `WebProfitReport.TextValue`에 `OrderYear + MajorWeek` 기준 저장한다. 비고만 입력한 경우에도 별도 `비고 저장` 버튼으로 저장할 수 있고, 전체 저장·엑셀 다운로드 전에도 저장 대상에 포함한다.

## 입고 중량·트럭 규칙

`WarehouseDetail`의 `Gross weight`/`Chargeable weight` 행을 우선 읽고, 같은 AWB의 품목 `Product.CounName`과 농장/인보이스 태그로 국가를 판별한다. 특수 중량행이 없을 때만 `WarehouseMaster.GrossWeight`/`ChargeableWeight`를 fallback으로 사용한다.

콜롬비아 국내 운송료(월드운송료) 차량은 **추천값**과 **실제값**을 구분한다(2026-08-12 정정 — 이전에는 등급표 1건 선택이 자동값이자 유일값이었다).

- **추천값**(`lib/colombiaTruck.js deriveTruckPlan()`): 1차+2차 Gross Weight를 합산한다. 5t 묶음을 먼저 배정하고 잔여가 1t 이하면 1t 1대, 2.5t 이하면 2.5t 1대, 2.5t 초과면 2.5t 1대와 필요한 1t 차량을 더한다. 예: 1,371kg → 2.5t 1대, 3,000kg → 2.5t 1대+1t 1대, 6,000kg → 5t 1대+1t 1대다. 중량이 없으면 추천값을 만들지 않는다.
- **실제값**: 그 차수에 실제로 사용한 차량 대수·비용(`WebColombiaWeekly.Truck1t/Truck2_5t/Truck5t`, 국가별은 `WebCustomsWeekly.WorldFreight{1,2}` + `WorldFreight{1,2}Manual` 플래그)이다. 저장된 실제값이 있으면 추천값이 그 값을 절대 덮지 않는다. 2026 22~27차 원본 워크북의 실제 청구액도 historical snapshot으로 보존하며, 예를 들어 26-01(GW 6,706kg)은 추천이 5t 1대+2.5t 1대지만 원본 실제 청구는 5t 1대뿐이다.
- 사용자는 실제 차량 대수·비용을 언제든 수정하고 차수별로 저장할 수 있다(입력 화면의 "실제" 칸). 추천값은 참고로만 표시된다.

## downstream 보존

이 기능은 보고서 조회·웹 전용 증거 저장·입고 중량 읽기만 수행한다. `OrderDetail`, `ShipmentDetail.OutQuantity/Amount/Vat/isFix`, `ShipmentDate`, `Estimate`, `ProductStock`, `StockHistory`를 변경하지 않는다. 매출 집계에는 반드시 master와 detail의 확정 필터가 있어야 한다.

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
- 회귀테스트는 (1) 페이지 `COLUMN_DEFS`·엑셀 `COL_LABEL`·설명 사전의 키/라벨 3중 일치, (2) 설명 문구와 실제 계산 코드의 대조(`C=N+L+O`, `P=Q×R`, `I=E+G+H−F`, noEnding 3개국 예외, D 분모는 공제 포함·U 분모는 공제 제외, 통관비 ÷1.1과 베트남 선율 예외, 27차→26차·01차→전년 52차 경계, exact-week 환율, `sm.isFix=1`·`sd.isFix=1` 확정 필터), (3) 기본 접힘·`aria-expanded`/`aria-controls`·가로 스크롤 같은 UI 계약을 함께 고정한다.
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

## 22~27차 그외통관비 감사 기준값 + 국가 월드운송료 결합GW + 콜롬비아 영문 분류 (2026-08-12)

원본 "매출원가 양식 - NN차_재고수정.xlsx"(22~27차, Downloads 폴더 6개 파일, read-only 추출) 재분석
결과 발견한 세 결함을 수정했다. 이 기능은 `nenova.exe`에 별도 Form이 없는 웹 전용 보고서이므로
dnSpy 재조사가 아니라 원본 워크북(엑셀) 대조가 근거이며, `__tests__/fixtures/profit-report-22-27.json`
(원본에서 read-only 추출, 테스트 증거)이 대조 기준이다.

### 결함 1 — 국가별 월드운송료 반차수 이중계상

`effectiveCountryWorldFreight()`가 1차 GW와 2차 GW를 각각 별도 트럭으로 계산해, 26차 콜롬비아
수국(GW1 2779 + GW2 1444 = 4223kg)이 "5t(275,000) + 2.5t(187,000) = 462,000원"으로 이중계상됐다
(원본은 결합 4223kg → 5t 1대 275,000원/부가세 제외 250,000원). 국가별(콜롬비아 수국 포함)
그외통관비는 그 대차수 국가의 GW1+GW2 **합산** 중량으로 필요한 차량 조합을 한 번만 계산해 1차 칸에 전액 반영하고
2차는 0으로 둔다. 콜롬비아 4품목(장미/카네이션/알스트로/루스커스)의 국내운송(트럭)은 반차수마다
실제 별도 출고되는 원본 업무 그대로 반차수별 계산을 유지한다(변경 없음, 근거: 22~27차 6개 반차수
GW/총액이 모두 반차수 단위로 대조됨).

- 구현: `lib/customsForwarding.js effectiveCountryWorldFreight()` — 결합 GW로 `deriveWorldFreight()`
  1회만 호출. 명시적 수기 override(`WorldFreight{1,2}Manual=1`)는 그대로 보존한다.
- 회귀: `__tests__/customsForwardingAuto.test.js`(요청사항 2번 원문 예시 — 26차 콜롬비아 수국
  2779+1444kg→5t, 네덜란드 192+520kg→1t, 중국 646+201kg→1t).

### 결함 2 — 콜롬비아 무게배분 영문 품종 누락

`colombiaBoxQtyByCategory()`의 `CASE_COLOMBIA_ALLOC`(SQL)이 `Product.FlowerName`의 한글 리터럴만
매칭해, FlowerName이 영문(ROSE/CARNATION/ALSTROEMERIA/RUSCUS)으로 저장된 품목이 그외통관비/
포워딩 무게배분(박스당무게×박스수량 비율)에서 통째로 빠졌다(카테고리 미배정 → 배분 대상 박스수량
0, 배분 비율이 나머지 품목에 왜곡 귀속). `lib/colombiaFlowerClassification.js`를 SQL·JS 공용
단일 진실 소스로 신설해 FlowerName·ProdName 양쪽에서 한글+영문을 매칭하고, 운송료/SERVICE FEE/
현지상차운임/Gross·Chargeable weight placeholder 행은 항상 제외한다(country-scoped — 호출부가
이미 `CounName LIKE '%콜롬비아%'`로 범위를 좁힌 뒤 사용).

- 구현: `lib/colombiaFlowerClassification.js`(신규) + `lib/customsForwarding.js` `CASE_COLOMBIA_ALLOC`/
  `COLOMBIA_ALLOC_EXCLUDE_SQL`.
- 회귀: `__tests__/colombiaFlowerClassification.test.js`(English ROSE 등 요청사항 6번 명시 케이스,
  SQL↔JS 토큰 일치, 운송료/SERVICE FEE/GW·CW 제외).

### 결함 3 — 22~27차 저장값 부재 + 전역 요율 오염

22~25차는 이 기능 도입 이전 시점이라 `WebCustomsWeekly`/`WebColombiaWeekly`에 저장값이 거의 없어
자동계산이 0 또는 크게 어긋났다. 또한 `BakSangRate`(백상 창고료, 22차만 370원/kg, 23~27차는
460원/kg)가 전역 설정(`WebCustomsRateConfig`) 하나뿐이라 관리자가 나중에 요율을 바꾸면 과거 확정
차수의 계산까지 조용히 바뀌는 결함이 있었다.

원본 워크북("매출원가 양식 - NN차_재고수정.xlsx", 22~27차 6개 파일) 자체는 전체 시트를 read-only로
완전히 분석했다 — 국가별 백상창고료·관세·선율·월드운송료·방역 개별 항목과 콜롬비아 4품목의
HandlingFee/CustomsFee/DisinfectFee/QuarantineDeductFee 구성요소도 원본 시트에서 값을 읽을 수
있었다. 이 항목들은 운영 DB(`WebCustomsWeekly`/`WebColombiaWeekly`)의 입력 필드 형태로 저장된 적이
없었으므로(이 기능 도입 이전 시점이라 아예 입력 화면이 없었음), **구성요소 그대로**를 프로덕션
historical snapshot 모듈에 옮겨 담고 화면 계산은 항상 운영 데이터와 같은 공식으로 재계산한다.

- `lib/profitReportHistoricalCustoms.js`(신규, 프로덕션 단일 진실 소스 — 테스트 fixture json을 런타임
  import하지 않는다. `scripts/extract-profit-report-workbooks.mjs`가 원본 xlsx에서 생성)에 22~27차
  국가별(콜롬비아 수국 포함) 백상 GW·관세1/2·선율1/2·월드운송료1/2·한국방역1/2 구성요소, 콜롬비아
  4품목 반차수 GW/CW/통관수수료/품목수/**실제 트럭 대수**/관세료/소독/검역 구성요소 + 원본 배분
  박스수량, 카테고리별 과세환율(R)을 원본에서 그대로 옮겨 담았다. (2026-08-12 후속 정정: 이전
  `lib/profitReportAuditedBaseline.js`는 "검증된 최종 H 합계"만 갖고 있어 구성요소 부재를 화면에서
  숨겼다 — 이제는 화면이 백상/관세/선율/월드운송료/방역을 그대로 보여준다.)
- 우선순위(모든 계산에 공통): **explicit saved row(WebCustomsWeekly/WebColombiaWeekly) >
  excel historical snapshot(2026년 22~27차만) > current auto(입고 GW 자동병합) > global defaults**.
  저장행이 조금이라도 있으면(부분 저장 포함) historical snapshot은 전혀 적용하지 않는다 — 행 단위
  폴백이며 운영자 입력을 절대 덮어쓰지 않는다. 연도가 정확히 2026과 일치할 때만 적용되므로 2025년
  동일 차수는 절대 오염되지 않는다.
- 백상 창고료 요율은 **scope별로 분리**된다(2026-08-12 결함수정 — 이전에는 22차 전체에 콜롬비아
  시트의 370원/kg을 잘못 적용했다). 국가 시트(그외통관비 화면)는 22~27차 전부 460원/kg이고, 콜롬비아
  4품목 반차수 시트만 22차 370원/kg·23~27차 460원/kg이다(`lib/customsForwardingCalc.js
  effectiveRatesForWeek(rates, orderYear, major, scope)`의 `scope` 인자로 구분).
- `lib/customsForwarding.js resolveCountryCustomsTotal()`/`resolveColombiaCustomsAllocation()`이
  이 우선순위의 단일 진입점이며, `computeCustomsAndForwarding()`(매출이익보고서 실계산)과
  `pages/api/sales/customs-clearance.js` GET(그외통관비 입력화면 미리보기)이 함수 하나만
  공유한다 — 두 화면이 항상 같은 총액을 본다.
- `WebCustomsWeekly.BakSangRateApplied`/`WebColombiaWeekly.BakSangRateApplied`(idempotent
  `ALTER TABLE`로 추가)에 저장 시점의 유효 요율을 스냅샷해, 이후 전역 요율이 바뀌어도 이미 저장된
  행의 계산은 그대로 보존한다. 다른 입력 필드가 전혀 없는 저장 요청(빈 클릭)은 요율만 저장해 빈
  행을 만들지 않는다 — historical snapshot 폴백이 실수로 사라지는 사고를 막기 위함이다.
- 회귀: `__tests__/profitReportHistoricalCustoms.test.js`(22~27차 국가/콜롬비아 구성요소 →
  `computeCountryCustomsTotal`/`computeColombiaCustomsTotal` 재계산이 fixture 원본 H/TOTAL과
  정확히 일치, scope별 요율, 교차연도 비오염, 우선순위 3종, 과세환율 historical 값),
  `__tests__/profitReportWorkbookFullParity.test.js`(22~27차 전체 카테고리·전체 열 C~U 공식 재현).

### 결함 4(UI) — 전차수 참고값이 유효값처럼 보이던 문제

`components/CustomsClearancePanel.js`의 입력값 표시 함수(`countryValue`/`colValue`)가 저장값이
없으면 전차수 값(carry)을 입력칸에 그대로 채웠는데, 서버의 실제 총액 계산(`computeCountryCustomsTotal`/
`computeColombiaCustomsTotal`)은 그 carry를 반영하지 않았다 — 입력칸에 "보이는 값"과 "합계에
쓰인 값"이 달랐다. 또한 저장 버튼이 필드 단위로 carry를 저장 대상에 함께 포함해, 빈 "저장" 클릭이
전차수 참고값을 조용히 이번 차수 저장행으로 굳혀버릴 위험이 있었다(콜롬비아는 특히 모든 필드를
무조건 전송).

- 수정: `countryValue`/`colValue`는 이제 carry를 절대 반환하지 않는다(수기 편집 > 저장값 > 자동값만).
  전차수 참고값은 `CarryHint` 컴포넌트로 입력칸 아래 별도 표시하고, 클릭(명시적 적용)해야 편집
  상태로 올라가 저장 대상이 된다. `countryOut`/`colombiaOut`은 수기 편집·저장값·자동값이 있는
  필드만 전송한다. 저장 버튼은 변경사항이 전혀 없으면 API를 호출하지 않는다(단, "빈 저장" 자체가
  들어와도 `saveCustomsWeeklyBatch`/`saveColombiaWeekly`가 다른 실제 필드 없이 요율만으로 빈 행을
  만들지 않도록 서버 쪽에서도 방어한다).
- 화면은 자동(원본 엑셀값 포함)·저장값·전차수 참고값 세 가지를 배지/색상으로 구분해 표시한다.
  원본 엑셀값은 저장행이 없을 때만 자동 적용되며 합계에 이미 반영되어 있고, 전차수 참고값은 적용·
  저장 전까지 합계에 전혀 반영되지 않는다.
- 회귀는 코드 리뷰로 확인(순수 UI 상태 로직이라 DB 없는 단위 테스트로 커버하기 어려움) —
  `__tests__/customsForwardingAuto.test.js`/`profitReportHistoricalCustoms.test.js`가 서버 쪽
  총액·우선순위를 고정하므로, 화면이 그 총액과 다른 값을 보여주면 수동 스모크에서 즉시 드러난다.

## 2026-08-12 후속 정합화 — 원천 재설계 5건

1차 결함수정(위 결함 1~4) 이후 사용자가 재확정한 업무 규칙에 맞춰 5가지를 추가로 고쳤다. 근거는
동일하게 원본 6개 워크북 read-only 재분석이다.

1. **국가별 백상 요율 scope 분리**: 22차 전체에 콜롬비아 시트 요율(370)을 적용하던 결함을 고쳐,
   국가 시트는 22~27차 전부 460, 콜롬비아 4품목 시트만 22차 370을 쓰도록 분리했다(`effectiveRatesForWeek`
   `scope` 인자, 위 "22~27차 저장값 부재" 절 참고).
2. **차량 자동추천 = 합산 중량의 차량 조합, 실제값이 항상 우선**: `lib/colombiaTruck.js deriveTruckPlan()`이
   5t 묶음 뒤 잔여를 1t/2.5t/2.5t+1t 조합으로 계산하고(1.371t=2.5t, 3t=2.5t+1t), 저장된 실제 차량·비용(국가별
   `WorldFreight{1,2}Manual`, 콜롬비아 `Truck1t/2.5t/5t`, 2026 22~27차 historical snapshot 포함)이
   있으면 그 값을 절대 덮지 않는다. 실제값과 추천값은 UI에서 구분 표시되고 실제값은 언제든 수정·저장할
   수 있다.
3. **기타(미분류)는 본표 합계에서 제외**: `lib/profitReportCalc.js computeProfitTotals()`가
   `TOTALS_EXCLUDED_CATEGORIES`(`['기타(미분류)']`)를 계산 전에 걸러낸다 — 원본 엑셀 본표(7~22행)에는
   그 행 자체가 없으므로 화면 합계·엑셀 다운로드 합계가 항상 원본과 같아야 한다. 검증 목록·비고에는
   여전히 표시되고, 자동으로 정식 카테고리에 합산되지도 않는다.
4. **기말재고(F) 증거 계약 정정**: 28차 원본 workbook에서 공식이 확인된 콜롬비아 5품종과 베트남은
   `(Q×R+S×R+H)÷매입수량×마지막 ProductStock 재고수량`을 적용한다. 그 밖의 카테고리는 정확한
   `OrderYear+OrderWeek+ProdKey`의 `VERIFIED WebStockPriceEvidence` 또는 사용자 확정 도착원가를 쓴다.
   2026년 22~28차는 원본 workbook SHA·시트·F셀을 고정한 값만 마지막 역사 증거로 허용하며 다른 연도나
   미래 차수로 전파하지 않는다. `Product.Cost`, 최근 입고단가, 공식 대상 이외 카테고리 평균과 E/F
   최종값 직접입력은 금지하고, 근거가 없으면 `INPUT_REQUIRED`/`UNVERIFIED`로 남긴다.
5. **과세환율(R) exact-week만 자동 적용, 웹 전용 캐시 테이블 신설**: `lib/taxableExchangeRate.js` +
   `docs/migrations/2026-08-12_web_taxable_exchange_rate.sql`(`WebTaxableExchangeRate`,
   `OrderYear+MajorWeek+Currency+Category` 키)을 추가하고, "29차 이후 전차수 R 자동 상속"과
   "CurrencyMaster 현재 환율 자동 fallback"을 제거했다. R 자동 적용은 이제 ①당주 FreightCost 스냅샷 →
   ②그 차수 저장/캐시값 → ③2026 22~27차 원본 엑셀 값 셋뿐이며, 전차수·CurrencyMaster는 참고 제안으로만
   보이고 사용자가 적용·저장해야 계산에 들어간다. 호주(28차 이전)·베트남(29차 이전)의 H 미입력은
   여전히 정상이지만, R은 구매·포워딩이 있으면 차수와 무관하게 항상 검증한다(`TAXABLE_RATE_MISSING`).

- 회귀: `__tests__/profitReportHistoricalCustoms.test.js`(scope 분리·차량 실제값 보존),
  `__tests__/profitReportWorkbookFullParity.test.js`(F/합계 재현 22~27차 전체),
  `__tests__/profitReportSourceGuide.test.js`(설명 문구가 위 5가지 규칙과 일치하는지 대조).

## 2026-08-13 KCS(관세청 과세환율 API) InputDate 기반 자동 조회 — 2026 28차 이후 4순위

위 "22~27차 저장값 부재" 절의 excel historical snapshot(③)은 2026 22~27차 6개 원본 워크북 범위에만
있다. 28차 이후는 원본 워크북이 없으므로 R 자동 적용이 ①FreightCost 스냅샷 → ②저장/캐시값까지만
있으면 그 다음은 바로 `missing`이었다. 이번 작업으로 관세청(KCS) 과세환율 공식 API를 4순위로
추가했다 — ①~③ 어느 것도 없을 때만 쓰이므로 2026 22~27차 계산은 전혀 바뀌지 않는다(회귀 없음).

- **단일 게이트**: `lib/taxableExchangeRate.js isKcsRateEligibleWeek(orderYear, major)` —
  `2026-28` 이상인 연도+차수 결합키에서만 참이다. 따라서 2026년 22~27차는 기존 원본값을
  보존하고, 2027년 이후도 정상 조회 대상이다. 범위 밖이면 DB 조회와 KCS 네트워크 호출을 하지 않는다.
- **신고일자·가중치 산출**: `lib/kcsRateDateWeights.js loadWarehouseDateWeights(orderYear, major)`가
  사용자가 입고에 명시한 `WarehouseMaster.InputDate`만 사용해 카테고리(국가/화종)×날짜별
  `wd.TPrice` 합계 목록을 반환한다. `InputDate`가 없으면 `ArrivalDtm`이나 `UploadDtm`으로 대신하지
  않고 해당 카테고리를 `입력 필요`로 남긴다. 날짜를
  먼저 평균해 대표일자 하나로 줄이지 않는다. "관세청 신고환율은 각 실제 신고일자의 실제 환율을
  TPrice로 가중평균한다"는 요구사항을 정확히 지키려면 날짜를 먼저 평균(pseudo-date)하는 방식은
  실제 신고일자가 아닌 날의 환율을 끌어오는 오차가 생기기 때문이다(2026-08-12 설계 정리 — 초기
  구현은 날짜를 먼저 가중평균하는 `declarationDateByCategory()`였으나 이 방식으로 교체하며
  제거했다). `CASE_CATEGORY`/`stockablePurchaseItemSql`/`currencyCodeForCategory`는
  `lib/profitReport.js`에서 그대로 `export`해 재사용하며(중복 구현 금지), `OrderWeek LIKE
  'major-%' AND ISNULL(OrderYear,'')=@yr` 조합으로 교차연도 오염을 막는다. 두 모듈 모두 SELECT만
  하며 쓰기 계열 SQL이 없다(GET 읽기 전용 규칙).
- **입고 스냅샷 완전성**: 당주 `FreightCost.ExchangeRate`는 해당 카테고리 상품매입의 TPrice가
  100% 환율 스냅샷으로 덮일 때만 자동 원천으로 인정한다. 일부 입고만 환율이 있으면 그 일부의
  평균값을 전체 환율처럼 쓰지 않고 저장된 공식값/KCS/직접입력 단계로 넘긴다.
- **KCS 공식 조회 + 환율 자체를 TPrice 가중평균**: 카테고리별로 서로 다른 (통화,날짜) 조합마다
  `lib/kcsTaxableRate.js getKcsTaxableRate({currency, declarationDate})`를 정확히 1회만 호출(중복
  제거)해 `https://unipass.customs.go.kr/clip/com/bsopcomn/baseinfo/retrieveCOM0101049Q.do`에
  `aplyBgnDt`(YYYYMMDD)·`currCd`·`summary`·`pageIndex`·`pageUnit` 파라미터로 GET하고, 응답 후보 중
  요청 통화와 요청일이 적용기간에 정확히 포함되는 유일한 `weekFxrtIm` 양수만 채택한다. 통화·기간이
  다르거나 후보가 모호하면 절대 추측/0-fallback하지 않고 실패 처리한다. 그 다음
  `lib/kcsRateDateWeights.js weightedRateFromDatePoints(datePoints, rateByDate)`(순수 함수)가 카테고리
  안의 날짜별 `(rate, weight)`를 `wd.TPrice`로 가중평균해 카테고리당 최종 환율 1개를 만든다.
  날짜 누락 또는 공식 환율 조회 실패가 하나라도 있으면 일부 날짜만으로 계산하지 않고 카테고리
  전체를 `입력 필요`로 둔다.
  `KCS_TAXABLE_RATE_ENABLED`가 명시적으로 `'false'`가 아니면(미설정 포함) 기본 활성이며, API 키
  (`KCS_EXCHANGE_RATE_API_KEY`)가 없어도 조회를 시도한다(공개 조회 가능성).
- **타임아웃/검증/캐시**: `AbortSignal.timeout(KCS_TAXABLE_RATE_TIMEOUT_MS)`(기본 8000ms)로 응답
  지연을 차단하고, HTTP 401/403은 `auth_failed`, 그 외 비정상 응답은 `http_error`로 구분해 원인을
  숨기지 않는다. 성공 응답은 프로세스 메모리 TTL 캐시(`KCS_TAXABLE_RATE_TTL_MS`, 기본 21600000ms=6h)에
  저장해 같은 통화+신고일자 재조회 시 네트워크를 다시 타지 않는다(`lib/importApplyProgress.js`의
  global 싱글톤 Map + TTL prune 패턴과 동일).
- **`resolveTaxableRate()` 통합**: 순수 함수(DB 의존 없음)에 `kcsRate`/`kcsDetail` 입력을 추가하고,
  기존 우선순위(①스냅샷 → ②저장 카테고리 지정 행 → ③historical → ④저장 통화 기본 행) 맨 뒤에
  KCS를 5번째로 삽입했다 — ①~④ 중 어느 것도 없을 때만 KCS 값을 쓴다. 행별 수기 오버라이드
  (`WebProfitReport.R`, `man.R`)는 이 함수보다 먼저 `pages/api/sales/profit-report.js`에서 적용되어
  있어 여전히 최우선이다("manual R first"는 호출부 책임, 이 함수는 그 다음 자동 원천만 고른다).
  KCS로 채택된 값은 `RATE_SOURCE.KCS_API`이며 기존 `EXACT_WEEK_RATE_SOURCES`에 이미 포함돼 있어
  "정확히 그 주차 원천"으로 즉시 자동 적용된다 — 별도 `TAXABLE_RATE_SAVE` 없이도 계산에 들어간다
  (기존 저장 POST 경로는 담당자가 명시적으로 확정·고정하고 싶을 때 쓰는 용도로 그대로 유지).
- **쓰기 범위**: 이 4순위 전체(신고일자 조회·KCS API 호출·`resolveTaxableRate`)는 SELECT/외부
  GET만 하고 DB에 INSERT/UPDATE/DELETE/DDL을 전혀 하지 않는다. 기존 `TAXABLE_RATE_SAVE`(POST,
  `saveTaxableRate`)는 이번 작업으로 변경하지 않았다.
- 회귀: `__tests__/taxableExchangeRateKcs.test.js` — `resolveTaxableRate`의 kcsRate 우선순위(①~④가
  항상 kcsRate보다 우선, 특히 22~27차 historical이 이김), `isKcsRateEligibleWeek` 단일 게이트,
  `kcsRatesByCategory`가 범위 밖에서 DB·네트워크를 건드리지 않음. `__tests__/kcsRateDateWeights.test.js`
  — `lib/kcsRateDateWeights.js`의 `mapCategoryDateRowsToWeights`(미분류/weight<=0 제외, 날짜없음은
  카테고리 실패 사유로 보존)·`weightedRateFromDatePoints`(환율 자체의 TPrice 가중평균, "날짜
  평균 후 1회 조회"와 다른 결과가 나옴을 증명하는 케이스 포함) 순수 함수.
  `__tests__/kcsRatesByCategoryWeighting.test.js` — `kcsRatesByCategory()` 전체 흐름을 fetch/날짜
  가중치 mock으로 end-to-end 검증(2개 날짜 가중평균, 1개 날짜 실패 시 카테고리 전체 제외,
  같은 통화+날짜 fetch 중복 제거). `__tests__/profitReportAnalysisGetReadOnlyDdl.test.js`
  — KCS/분석 관련 신규 lib·API 파일 전부에 쓰기·DDL 키워드 없음 + `profit-analysis.js` GET 전용 정적 검증.
  `lib/kcsTaxableRate.js`의 `weekFxrtIm` 파싱·타임아웃·HTTP 오류 구분·TTL 캐시는
  `__tests__/taxableExchangeRateKcs.test.js`가 fetch mock으로 검증(실네트워크 없음).

## 2026-08-12 이익률 분석 패널(analysis) + 검증·입력 패널 표 하단 재배치

주차별 매출이익 보고서 표 아래에 두 영역을 추가·재배치했다. 둘 다 웹 전용 부가 기능이며 ERP 원장을
전혀 쓰지 않고, 표 자체의 조회/저장/엑셀 다운로드 로직과 계산식은 이번 작업으로 바뀌지 않았다.

- **패널 재배치**: 검증 배너(자동값 확인/오류), 실사 시작재고 확인 배너, 과세환율(R) 입력 필요
  배너, 기타(미분류) 검증 배너, `📦 그외통관비 입력`(`CustomsClearancePanel`)·`🚢 포워딩 입력`
  (`ForwardingClearancePanel`) 패널을 본표(카테고리별 표+합계 행) **아래**로 옮기고, "검증·입력"
  이름의 접기/펼치기 그룹 하나로 묶었다(`components/ProfitReportSourceGuide.js`와 같은
  `aria-expanded`/`aria-controls`/`hidden` 패턴). 검증 오류·미분류행·R 입력 필요 중 하나라도 있으면
  기본 펼침, 없으면 기본 접힘이며 접힌 헤더에도 건수를 표시한다. 각 배너·패널 자체의 표시 조건과
  내용, `📦`/`🚢`/`🛠` 툴바 버튼과 그 토글 상태(`showCustoms`/`showForwarding`/`showOverrides`)는
  그대로다 — 화면상 위치만 이동했다. `수기 보정`(`showOverrides`)은 별도 패널이 아니라 본표 셀 자체를
  편집 가능하게 바꾸는 기존 동작이라 이동 대상이 아니다(표 자체이므로).
- **이익률 분석 패널(신규, `analysis`)**: "검증·입력" 그룹보다 아래, 기본 접힘. 펼치면 본표 조회
  (`load()`)와 **별도의** GET 요청(`GET /api/sales/profit-analysis?year=&week=`)을 보내
  (`pages/api/sales/profit-analysis.js`, read-only, `withAuth`), 이 차수 이익률(K)과 **같은
  `OrderYear` 안의** 직전 최대 4개 차수 평균을 비교해 %p 차이를 보여준다(연도 경계를 넘지 않음 —
  major가 작아 직전 차수가 4개 미만이면 있는 만큼만 쓰고 그 사실을 명시). 각 차수 값은 그 차수의
  활성 확정 스냅샷(`REPORT_CONFIRM_SNAPSHOT`)이 있으면 그 값을 "확정"으로, 없으면
  `loadReportData`+`computeProfitTotals`로 즉시 계산한 값을 "실시간 계산"으로 표시한다
  (`lib/profitReportRateAnalysis.js loadWeekK`/`loadRateTrend`). 검증 오류·과세환율 원천 누락·재고
  스냅샷 누락이 관련 차수 중 하나라도 있으면 패널 전체에 "잠정" 배지와 사유를 표시한다
  (`isProvisional`). 이 패널은 별도 요청이므로 느리거나 실패해도 본표 렌더링을 막지 않는다.
- **변동 요인(C/E/F/P/H/T/L)**: 이번 차수 값과 직전 평균의 증감·증감률을 절대 증감 크기 내림차순으로
  보여준다(`lib/profitReportDriverExplanation.js explainDrivers`, 순수 함수, DB 의존 없음).
- **거래처·품목 후보 탐지**: `ShipmentMaster`/`ShipmentDetail`/`Customer`(고정, 확정 출고만,
  `lib/profitReport.js#salesByCategory`와 동일 필터 — `lib/pivotStats.js`의 `sd.isFix=1`이 아니라
  `sm.isFix=1`)에서 거래처×품목별 수량/부가세포함 분배단가(단가 기준수량은 `EstQuantity`)를 읽어
  (`lib/profitReportCustomerMixSql.js loadCustomerProductSales`) 두 후보를 순수 함수로 탐지한다
  (`lib/profitReportPriceMixCandidates.js`): **단가 하락 후보** = 같은 거래처+품목의 단가가 직전
  차수 대비 3% 이상 하락. **저가 구성비 후보** = 같은 품목의 단가가 이번 차수 동종 가중평균과
  중앙값 **둘 다**보다 5% 이상 낮고, 그 거래처의 그 품목 판매 비중이 2%p 이상 상승. 두 탐지 모두
  거래처명을 코드에 하드코딩하지 않고(응답 데이터의 `custName`만 그대로 표시), 원인을 단정하지
  않으며 비고는 항상 고정 문구 `특가·재고소진 여부 확인` 그대로다.
- **쓰기 범위**: `pages/api/sales/profit-analysis.js`와 이 절의 모든 `lib/*` 파일은 SELECT/파라미터화
  쿼리만 하며 INSERT/UPDATE/DELETE/MERGE/DDL이 전혀 없다(`__tests__/profitReportAnalysisGetReadOnlyDdl.test.js`).
- 회귀: `__tests__/profitReportRateAnalysis.test.js`(추세 요약·연도 경계 미월경·잠정 판정),
  `__tests__/profitReportPriceMixCandidates.test.js`(3%/5%/2%p 경계값·고정 비고 문구·거래처명
  비하드코딩), `__tests__/profitReportDriverExplanation.test.js`(증감·증감률·정렬),
  `__tests__/profitReportPanelOrderContract.test.js`(본표 → 검증·입력 → 이익률 분석 순서, 통관/포워딩
  패널이 본표보다 아래에 있음을 정적 소스 검사로 고정, 구 배치 회귀 가드 포함).

## 사전 확인 기록

공용 조인·확정 기준은 `docs/exe-golden/FormShipmentDistribution.md`, `docs/exe-golden/FormEstimateView.md`, `docs/DB_STRUCTURE.md`, `docs/WEB_VS_ERP_CONFLICTS.md`에 기록된 dnSpy/DB 근거를 재사용한다. 이 기록과 `docs/contracts/weekly-profit-report.json`은 변경 시 회귀 테스트와 배포 manifest 검사의 기준이다.

## 2026-08-17 포워딩 원천 완전성 보강

- EXE 공유 입고 원천과 동일하게 `WarehouseMaster.OrderYear + OrderWeek`를 먼저 고정하고
  `WarehouseDetail`과 `Product`를 결합한다. 다른 연도의 동일 차수는 포함하지 않는다.
- 29차 이후 포워딩은 입고 전표가 원천이다. 품목명에 화종·국가가 명시되면 그 값을 우선하고,
  일반 `AIR FREIGHT`/`SERVICE FEE` 행은 같은 `WarehouseKey`(BILL), 같은 AWB의 실제 상품 국가·화종으로
  연결한다. 근거가 없는 행은 임의 USD로 귀속하지 않는다.
- `Gross weight`/`Chargeable weight`는 포워딩 금액이 아니며 S 합계에서 제외한다.
- 원천 전표 한 행도 조용히 버리지 않는다. 원천합계·분류합계·미분류합계를 통화별로 대조하고,
  구매가 있는 세부차수·국가·화종에 항공료가 연결되지 않으면 29차 이후 보고서 검증을 중단한다.
- 이 보강은 SELECT 전용이다. Order/Shipment/Estimate/ProductStock/StockHistory/WebProfitReport의
  수량·단가·확정·재고·과거 확정값을 수정하지 않는다.

## 2026-08-17 재고잔량 품목단가 원천 승격

- 2026년 22~28차 원본 workbook 7개의 전체 78개 시트를 다시 검사했다. `재고잔량`은 단순 참고
  시트가 아니라 기초 B:G·기말 J:O의 품목별 수량·표시단가·총계를 보존하는 평가 원천이다.
- 콜롬비아 수국·카네이션·장미·루스커스·알스트로와 베트남은 기존 카테고리 평균원가 공식이
  우선한다. 이 여섯 카테고리를 품목단가 catalog로 덮어쓰지 않는다.
- 그 밖의 정확히 승인된 ProdKey는 `data/profit-report-inventory-catalog/v1/index.json`에서 원본
  workbook SHA·시트·셀·단위와 함께 읽는다. 원화 표시단가는 VAT 포함값이므로 공급가 단가로
  `/1.1`한다. 호주는 P열 외화단가에 원본 O37의 AUD 과세환율을 곱한 원본 취득원가를 사용한다.
- 적용 우선순위는 정확한 같은 스냅샷의 `WebStockPriceEvidence` → 같은 품목·단위의 사용자 확정
  `WebArrivalCostLine` → 정확한 ProdKey·EstUnit의 workbook catalog다. 품명 fuzzy 매칭과 다른
  품목·카테고리 평균은 금지한다.
- catalog 기준일은 2026-28차이며 그 이전 및 다른 연도에 역전파하지 않는다. 이후 업로드에서
  더 최신의 확정 도착원가 또는 직접 단가가 생기면 그 근거가 항상 우선한다.
- 모든 workbook에서 기초 F30=11,000원과 달리 기말 N30=110,000원인 카네이션 10배 이상값은
  `quarantined`로 기록하고 자동 catalog에 포함하지 않는다.
- 이 경로는 저장소의 버전관리 데이터만 읽으며 GET 중 DB 복사·DDL·ERP/Web 쓰기를 하지 않는다.
  신규 품목 또는 단위가 달라 정확한 근거가 없으면 기존대로 `INPUT_REQUIRED`를 유지한다.
