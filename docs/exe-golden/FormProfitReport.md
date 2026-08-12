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

## 22~27차 그외통관비 감사 기준값 + 국가 월드운송료 결합GW + 콜롬비아 영문 분류 (2026-08-12)

원본 "매출원가 양식 - NN차_재고수정.xlsx"(22~27차, Downloads 폴더 6개 파일, read-only 추출) 재분석
결과 발견한 세 결함을 수정했다. 이 기능은 `nenova.exe`에 별도 Form이 없는 웹 전용 보고서이므로
dnSpy 재조사가 아니라 원본 워크북(엑셀) 대조가 근거이며, `__tests__/fixtures/profit-report-22-27.json`
(원본에서 read-only 추출, 테스트 증거)이 대조 기준이다.

### 결함 1 — 국가별 월드운송료 반차수 이중계상

`effectiveCountryWorldFreight()`가 1차 GW와 2차 GW를 각각 별도 트럭으로 계산해, 26차 콜롬비아
수국(GW1 2779 + GW2 1444 = 4223kg)이 "5t(275,000) + 2.5t(187,000) = 462,000원"으로 이중계상됐다
(원본은 결합 4223kg → 5t 1대 275,000원/부가세 제외 250,000원). 국가별(콜롬비아 수국 포함)
그외통관비는 그 대차수 국가의 GW1+GW2 **합산** 중량으로 트럭 1대만 선정해 1차 칸에 전액 반영하고
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
있었다. 다만 이 항목들은 운영 DB(`WebCustomsWeekly`/`WebColombiaWeekly`)의 입력 필드 형태로 저장된
적이 없어(이 기능 도입 이전 시점이라 아예 입력 화면이 없었음), 그 필드에 채울 "저장됐어야 할 값"을
역산해 발명하지 않기로 했다 — 이는 재추출 불가가 아니라 의도적 설계 선택이다. 대신 아래 감사
기준값(`lib/profitReportAuditedBaseline.js`)은 원본에 실제로 있는 값, 즉 국가별 그외통관비
**최종 합계(H)**와 콜롬비아 반차수 **TOTAL(무게배분 전)** + GW/박스수량(모두 원본 시트에서 그대로
옮겨 적은 검증된 값)만 프로덕션 폴백으로 저장한다. `computeCountryCustomsTotal`/
`computeColombiaCustomsTotal`의 구성요소 기반 공식 자체는 요청사항 1·3번 원문과 이미 정확히
일치하므로 그대로 유지했고(재검증만 함, 코드는 바꾸지 않음), 감사 기준값은 그 공식이 필요로 하는
운영 DB 입력 필드가 아직 저장되지 않은 22~27차 행에만 최종 합계로 폴백한다.

- `lib/profitReportAuditedBaseline.js`(신규, 프로덕션 단일 진실 소스 — 테스트 fixture json을 런타임
  import하지 않는다)에 22~27차 국가별(콜롬비아 수국 포함) H 총액, 콜롬비아 4품목 반차수 GW/박스수량/
  TOTAL(무게배분 전), 대차수별 BakSangRate(22차=370, 23~27차=460)를 원본에서 그대로 옮겨 담았다.
- 우선순위(모든 계산에 공통): **explicit saved row(WebCustomsWeekly/WebColombiaWeekly) >
  audited baseline(2026년 22~27차만) > current auto(입고 GW 자동병합) > global defaults**.
  저장행이 조금이라도 있으면(부분 저장 포함) 감사 기준값은 전혀 적용하지 않는다 — 행 단위 폴백이며
  운영자 입력을 절대 덮어쓰지 않는다. 연도가 정확히 2026과 일치할 때만 적용되므로 2025년 동일
  차수는 절대 오염되지 않는다.
- `lib/customsForwarding.js resolveCountryCustomsTotal()`/`resolveColombiaCustomsAllocation()`이
  이 우선순위의 단일 진입점이며, `computeCustomsAndForwarding()`(매출이익보고서 실계산)과
  `pages/api/sales/customs-clearance.js` GET(그외통관비 입력화면 미리보기)이 함수 하나만
  공유한다 — 두 화면이 항상 같은 총액을 본다.
- `WebCustomsWeekly.BakSangRateApplied`/`WebColombiaWeekly.BakSangRateApplied`(신규 컬럼, 저장
  경로에서 idempotent `ALTER TABLE`)에 저장 시점의 유효 요율을 스냅샷해, 이후 전역 요율이 바뀌어도
  이미 저장된 행의 계산은 그대로 보존한다. 다른 입력 필드가 전혀 없는 저장 요청(빈 클릭)은 요율만
  저장해 빈 행을 만들지 않는다 — 감사 기준값 폴백이 실수로 사라지는 사고를 막기 위함이다.
- 회귀: `__tests__/profitReportAuditedBaseline.test.js`(22~27차 국가/콜롬비아 H 정확값, 요청사항
  5번 그랜드토탈, 교차연도 비오염, 우선순위 3종).

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
- 화면은 자동(감사기준값 포함)·저장값·전차수 참고값 세 가지를 배지/색상으로 구분해 표시한다.
  감사기준값은 저장행이 없을 때만 자동 적용되며 합계에 이미 반영되어 있고, 전차수 참고값은 적용·
  저장 전까지 합계에 전혀 반영되지 않는다.
- 회귀는 코드 리뷰로 확인(순수 UI 상태 로직이라 DB 없는 단위 테스트로 커버하기 어려움) —
  `__tests__/customsForwardingAuto.test.js`/`profitReportAuditedBaseline.test.js`가 서버 쪽
  총액·우선순위를 고정하므로, 화면이 그 총액과 다른 값을 보여주면 수동 스모크에서 즉시 드러난다.

## 사전 확인 기록

공용 조인·확정 기준은 `docs/exe-golden/FormShipmentDistribution.md`, `docs/exe-golden/FormEstimateView.md`, `docs/DB_STRUCTURE.md`, `docs/WEB_VS_ERP_CONFLICTS.md`에 기록된 dnSpy/DB 근거를 재사용한다. 이 기록과 `docs/contracts/weekly-profit-report.json`은 변경 시 회귀 테스트와 배포 manifest 검사의 기준이다.
