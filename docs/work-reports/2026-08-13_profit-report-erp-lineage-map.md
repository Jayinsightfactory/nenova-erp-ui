# 주차별 매출이익 보고서 ERP lineage map (22~28차)

- 조사일: 2026-08-13 (Asia/Seoul)
- 저장소 기준: `master` / `5ec907d9c582c4351615bc54a3906fae857e265d`
- 조사 방식: 저장소와 지정 Excel 7개에 대한 정적·읽기 전용 분석. DB 접속·SQL 실행·브라우저 로그인·외부 전송은 하지 않았다.
- 기록 범위: 이 문서와 `.verify/reports/profit-report-erp-lineage.json`만 신규 작성했다. 제품 코드와 입력 원본은 수정하지 않았다.

## 1. 판정 기준과 결론

| 판정 | 의미 |
|---|---|
| 자동가능 | ERP/웹 원천, 업무키, 확정 조건, 계산식의 근거가 있어 자동 계산할 수 있음 |
| 현재누락 | 원천 또는 공식은 있으나 현재 제품이 해당 조건·역사 버전·시트/필드를 완전하게 구현하지 않음 |
| 직접입력필수 | 청구서·세금·검역·단가 등 ERP에 확정 원천이 없거나 원본이 리터럴 입력을 사용함 |
| 근거부족 | Excel 항목의 의미 또는 DB 컬럼·확정시점이 문서/dnSpy/코드만으로 확정되지 않음 |

핵심 결론은 다음과 같다.

1. 현재 구현은 28차 본표의 핵심 계산과 고정 재고 스냅샷, 국가별 통관·포워딩 배부를 대부분 구현했다. 다만 22~27차의 마지막 행 `공제`와 28차의 `국내`를 주차별로 버전 관리하지 않고 항상 `국내`를 사용한다.
2. 매출 SQL은 `ShipmentMaster.isFix=1`만 적용한다. 계약/dnSpy golden의 확정 상세 조건인 `ViewShipment.DetailFix=1`은 적용하지 않아 N과 그 파생 C/D/I/J/K/M이 과대 집계될 수 있다. 또한 `OrderWeek LIKE`와 파생 `OrderYearWeek=OrderYear+MajorWeek`는 쓰지만 명시적인 `ShipmentMaster.OrderYear=@year` 조건은 없다.
3. E/F의 재고 수량 선택은 `OrderYear + 대차수 + isFix=1 + ProductStock 존재 + 최신 숫자 세부차수 + 중복 tie-break` 계약을 구현했다. 반면 원본 Excel의 품목별 재고가격과 일부 리터럴 F를 완전히 재현할 확정 원천은 없다. `WebStockPrice`, 수국 하드코딩, `Product.Cost`, 최근 입고단가 순환 fallback은 자동화 장치이지 원본 가격의 증빙은 아니다.
4. H와 R은 완전 자동 열이 아니다. H의 관세·선율·한국방역·콜롬비아 수수료/소독/검역 차감, R의 실제 청구서 과세환율은 직접 입력 또는 확정 스냅샷이 필요하다. 현재 웹은 이 입력을 보존하는 구조를 갖고 있다.
5. Excel 다운로드는 본표만 남기며 10개 보조시트를 생성하지 않는다. 원본 본표는 7~22행/합계 23행이나 현재 템플릿은 설명행을 넣은 8~23행/합계 24행이다. 비고 위치도 원본 B25와 생성 코드 B28이 다르다.
6. 원본 U23은 `SUM(U7:U20)`으로 베트남과 마지막 행을 제외한다. 28차 캐시값은 `0.8637225882938948`이며, 현재 생성 코드는 합계를 `1`로 고정한다.
7. 일반 조회도 DB 관점에서 순수 read가 아니다. `ensureProfitReportTable`, `ensureStockPriceTable`, `ensureCustomsTables` 때문에 GET 경로에서 웹 전용 테이블 `CREATE TABLE`과 `WebCustomsWeekly ALTER TABLE`이 발생할 수 있다. ERP 주문·출고·입고·재고 원장에는 쓰지 않지만, 런타임 DDL 부작용은 존재한다.
8. 저장소의 snapshot registry/acceptance fixture는 22~27차 원본이 없다고 기록한다. 이번 지정 입력에는 22~28차가 모두 있으므로 현재 검증 커버리지 메타데이터가 실제 입력 상태를 따라가지 못한다. 27차 파일 B1은 파일명과 달리 `26차`로 적혀 있어 제목 자체는 근거부족으로 격리해야 한다.

## 2. 입력 원본 식별과 주차별 관찰

| 차수 | SHA-256 | B1 제목 | 마지막 행 | C 합계 | E 합계 | F 합계 | 비고 |
|---:|---|---|---|---:|---:|---:|---|
| 22 | `72a8660e93d6593740246ddff5be74da0b10d0b4a07559f3fa06c4ce434252a0` | 22차 | 공제 | 241,416,666.55 | 32,680,452.673468273 | 31,634,617.82964451 | 11개 시트 |
| 23 | `b4ebf36ae4253a8d501bcacc147793a0b037fd933e0a29c3c68d131755dc6f9e` | 23차 | 공제 | 209,293,455.46 | 31,634,617.82964451 | 19,198,741.2603 | 11개 시트 |
| 24 | `6b92bbfa32d1b65aa065c8868e35476b0a471d1d0e1b6c6ec22b8e4036ef8bae` | 24차 | 공제 | 211,987,621.46 | 19,198,741.2603 | 30,405,427.084 | `Sheet1` 포함 12개 시트 |
| 25 | `4d20160a362b7eee3fc0241ce9df880713b1eda2e4c01785a4cb654ce7aebf06` | 25차 | 공제 | 192,096,958.36 | 30,405,427.084 | 16,792,588.526 | 11개 시트 |
| 26 | `b42bcce6779f2b31cfa6fc8393c3dde6827382495b1d63e3d8d01c1a40fe6f5a` | 26차 | 공제 | 231,313,962.20 | 16,792,588.526 | 8,919,590.217 | 11개 시트 |
| 27 | `2906ec876160f7fa2f0fbaeb1c9b89e49bda6a933cad9b7cabad9fbd7dd36689` | **26차** | 공제 | 227,653,408.00 | 12,578,453.10575 | 13,229,405.2035 | 제목 결함. 파일명·연속 재고·다음 차수 링크는 27차를 지지 |
| 28 | `d777e8745b3b1e2fbf89ac782633e9fd654f38fd7684ecbb620032221ecb156b` | 28차 | 국내 | 244,367,497.00 | 13,229,405.2035 | 21,966,629.47508684 | 11개 시트 |

공통 본표는 B:U, 헤더 6행, 품목 7~22행, 합계 23행이다. 시트는 `주차별 매출이익 보고서`, `재고잔량`, `그외통관비`, `구매현황`, `포워딩`, `판매현황`, `불량차감`, `그 외 매출액`, `콜롬비아 1차`, `콜롬비아 2차`, `품목리스트`이며 24차에만 의미가 확인되지 않은 `Sheet1`이 추가된다.

## 3. 업무키·확정시점 계약

| 원천 | 업무키/조인키 | 확정·선택 시점 | 현재 구현 | 판정 |
|---|---|---|---|---|
| 주문/ViewOrder | `OrderYear + OrderWeek + CustKey + ProdKey`; master/detail 조인은 OrderMasterKey | 보고서 직접 집계 원천은 아니나 downstream 보존 필수 | 쓰기 없음 | 자동가능 |
| 출고/ViewShipment | `ShipmentKey`; 업무 식별은 `OrderYear + OrderWeek + CustKey + ProdKey` | `MasterFix=1` 및 계약상 `DetailFix=1` | `ShipmentMaster.isFix=1`, `isDeleted=0`, `OrderWeek LIKE major-%`, `OrderYearWeek=year+major`; DetailFix와 명시 `OrderYear` 누락 | 현재누락 |
| 견적/Estimate | `EstimateKey`; `ShipmentKey + CustKey + ProdKey` | 연결 ShipmentMaster 확정 후, `EstimateType` 해석 | master 확정만 사용 | 자동가능 |
| 입고 | `WarehouseKey`, `WdetailKey`; 범위 `OrderYear + OrderWeek` | `WarehouseMaster.isDeleted=0`; WarehouseDetail에는 isDeleted 없음 | 연도와 대차수 prefix를 명시 | 자동가능 |
| 재고 | `StockKey + ProdKey`; 범위 `OrderYear + OrderWeek` | `StockMaster.isFix=1`, ProductStock 존재, 최신 숫자 subweek; 동률은 ProductStock 행수 DESC, StockKey DESC | 구현됨. 전년도·미확정·flow fallback 없음 | 자동가능 |
| 운송원가 | `FreightCost.WarehouseKey`; active `isDeleted=0` 1건 | BILL 저장 시점의 `ExchangeRate`/상수 스냅샷 | R의 구매금액 가중평균 원천 | 자동가능 |
| 수기 보고서 | `OrderYear + MajorWeek + Category + ColKey` | 사용자가 E/F/H/R/S 또는 note 저장 | `WebProfitReport` MERGE | 직접입력필수 |
| 국가 통관 | `OrderYear + MajorWeek + Category` | 주차 입력 저장 시점 | `WebCustomsWeekly` MERGE + 이력 | 직접입력필수 |
| 콜롬비아 반차수 | `OrderYear + OrderWeek` | 1/2차 입력 저장 시점 | `WebColombiaWeekly` MERGE + 이력 | 직접입력필수 |
| 포워딩 override | `OrderYear + MajorWeek + Category` | 직접 입력 저장 시점 | `WebForwardingWeekly` MERGE + 이력 | 직접입력필수 |
| 확정본 | `OrderYear + MajorWeek`, `State=CONFIRMED` 유일 | 사용자 확정 시점 이후 불변 | `WebProfitReportSnapshot` payload 우선 조회 | 자동가능 |
| 월 귀속 | `PeriodDay.OrderYearWeek`, `BaseYmd` | nenova.exe 기간일자 기준 | 주차 종료일이 속한 월로 읽기 집계 | 자동가능 |

주의할 문서 충돌은 두 가지다. `WEB_VS_ERP_CONFLICTS.md`의 일부 오래된 문단은 `OrderMaster.Manager='관리자'`를 말하지만 최신 가드/불변식은 `UserInfo.UserID`를 요구한다. 또 현재 `DB_STRUCTURE.md`의 Product 목록에는 코드가 조회하는 `Product.EstUnit`, `Product.SteamOf1Bunch`가 없으므로 실제 운영 스키마 확인 전 해당 환산 분기는 근거부족이다.

## 4. 본표 B:U lineage

파생열은 별도 DB 행을 만들지 않는다. 아래에서 원천이 다른 본표 열로 표시된 경우 업무키와 확정시점은 그 원천열들의 합집합을 상속하며, 모든 원천이 해당 차수에 확정된 뒤 계산된다. 보조시트의 계산 셀도 같은 원칙으로 바로 앞 입력행/블록의 키와 확정상태를 상속한다.

| 열 | Excel 항목 | 원천 테이블·열 / 키 | 확정시점·변환공식 | 현재 구현 | 분류 |
|---|---|---|---|---|---|
| B | 품명 | Product.`CounName`,`FlowerName`,`ProdName`,`ProdKey`; 코드 resolver가 국가/화종/문자열로 카테고리 계산 | 행 순서는 16개 고정. 22~27차 마지막은 `공제`, 28차는 `국내` | 28차 resolver와 `기타(미분류)`는 구현. 모든 차수에 `국내`를 써 역사 버전 누락 | 현재누락 |
| C | 매출액 | N + L + O | `C=N+L+O` | 계산 구현 | 자동가능 |
| D | 매출비율 | 본표 C | 행 `C/합계C` | 화면/Excel 계산 가능 | 자동가능 |
| E | 기초상품재고액 | 전차수 `StockMaster`/`ProductStock.Stock` + Product 환산/가격; 또는 전차수 `WebProfitReport.F` | 전차수 고정 최신 snapshot. 자동값은 전차수 `(Q×R+S×R+H)/매입수량×기말수량`; 현재차수 E 수기 > 전차수 수기 F > 자동 | 선택 정책과 override 구현. 원본 품목가격·리터럴 E의 증빙 불완전 | 근거부족 |
| F | 기말상품재고액 | 현재차수 `StockMaster`/`ProductStock.Stock`; `WarehouseDetail.EstQuantity/TPrice`; Product 환산/가격; `WebStockPrice` | `(Q×R+S×R+H)/매입수량×기말수량`; 매입 없음은 최근 외화단가×수량×R; 최후 `Stock×적용가격/1.1` | 자동/수기 override 구현. 28차에도 수식·리터럴·빈칸 혼재, 원본 가격 증빙 불완전 | 근거부족 |
| G | 매입액(상품+포워딩) | P, T | `G=P+T` | 구현 | 자동가능 |
| H | 그외통관비 | `WarehouseMaster.GrossWeight/ChargeableWeight`; `WebCustomsRateConfig/History`; `WebCustomsWeekly`; `WebColombiaWeekly`; 박스수량은 WarehouseDetail | 국가: `(GW1+GW2)×백상 + 관세 + 선율 공급가 + 월드운송 공급가 + 한국방역 공급가`; 베트남 선율은 /1.1 예외. 콜롬비아: 총 통관비×무게비율 | GW·차량·배부 자동, 수기 항목/override 구현 | 직접입력필수 |
| I | 매출원가 | E,G,H,F | 일반 `E+G+H-F`; 이스라엘/뉴질랜드/일본 `E+G+H` | 구현 | 자동가능 |
| J | 매출이익 | C,I,F | 일반 `C-I`; noEnding 3국 `C-I+F` | 구현 | 자동가능 |
| K | 이익률 | J,C,F | 일반 `J/C`; noEnding와 합계 `J/(C+F)` | 구현 | 자동가능 |
| L | 불량금액 | `Estimate.Amount`, `Estimate.EstimateType`, `CodeInfo(Category='EstimateType').Descr2='불량차감'`, Product; `ShipmentKey` | 연결 ShipmentMaster 확정·미삭제, 대차수 범위 | 집계 구현. 보조시트의 전표 상세는 미생성 | 자동가능 |
| M | 불량율 | L,C | `-L/C` | 구현 | 자동가능 |
| N | 원본 헤더 `매출액` / 현재 UI `순수매출액` | `ShipmentDetail.Amount`, `OutQuantity`, `ProdKey`; ShipmentMaster | 원본 `판매현황!E`를 품명별 SUMIF. 계약상 fixed detail만 | 공급가 집계는 구현. `DetailFix=1`와 명시 OrderYear 누락 | 현재누락 |
| O | 그 외 매출액 | `Estimate.Amount`; `EstimateType` 중 불량차감 외 항목 | 원본 `그 외 매출액!F` SUMIF | 집계 구현. 전표 상세/유형별 설명은 미생성 | 자동가능 |
| P | 상품 금액(구매) | Q,R | `P=Q×R` | 구현 | 자동가능 |
| Q | 원본 헤더 `구매금액` / 현재 UI `구매금액(외화)` | `WarehouseDetail.TPrice`, Product; `WarehouseMaster.OrderYear/OrderWeek/isDeleted` | 운송료·SERVICE FEE·중량 품목 제외, 카테고리 합계 | 구현 | 자동가능 |
| R | 환율 | 우선 `WebProfitReport.R`; `FreightCost.ExchangeRate`를 WarehouseDetail.TPrice로 가중; 같은 연도 전차수 확정 수기 R(29차 이후); `CurrencyMaster.ExchangeRate` | 실제 BILL/과세 시점 환율. 호주는 28차, 베트남은 29차부터 입력 대상 | 우선순위와 누락 경고 구현. 원본 다수 행은 리터럴 | 직접입력필수 |
| S | 포워딩비용(USD) | 운송료/SERVICE FEE `WarehouseDetail.TPrice`; `WarehouseMaster` BILL 메타; `WebForwardingWeekly`; 콜롬비아 `WebColombiaWeekly.AirRateUSD` | 직접 국가행 합계. 콜롬비아는 GW=CW면 무게, 다르면 CBM 비율 배부 | 자동감지+override 구현. 새 농장/인보이스 패턴은 수기 필요 | 자동가능 |
| T | 포워딩 원화환산 | S,R | `T=S×R` | 구현 | 자동가능 |
| U | 상품구매비율 | P | 행 `P/합계P`; 원본 합계는 `SUM(U7:U20)` | 행 계산 가능. 생성 합계를 1로 고정하여 원본 0.8637225883과 불일치 | 현재누락 |

본표 파생열 C/D/G/I/J/K/M/P/T는 원천 열이 정확하다는 전제에서 자동가능하다. N의 fixed-detail 누락은 C/D/I/J/K/M에도 전파되고, E/F/H/R/S의 수기 또는 근거부족은 G/I/J/K/P/T/U에 연쇄된다.

## 5. 보조시트 lineage

### 5.1 재고잔량

| 항목 | 원천·키 / 공식 | 현재 구현 | 분류 |
|---|---|---|---|
| 기초/기말 품목 목록 | 전차수/현재차수 고정 `StockMaster.StockKey + ProductStock.ProdKey`, Product 명칭 | 집계 API에만 존재, 보조시트 미생성 | 현재누락 |
| 박스/단/송이 수량 | `ProductStock.Stock`을 Product.`OutUnit`,`EstUnit`,`BunchOf1Box`,`SteamOf1Box`,`SteamOf1Bunch`로 조건 환산 | 카테고리 합계 구현. 원본의 품목별 박스 표현과 미문서 Product 열은 미검증 | 근거부족 |
| 박스당수량 | Product.`BunchOf1Box` 또는 `SteamOf1Box` | 단가표 API에 일부 노출 | 자동가능 |
| 가격 | `WebStockPrice.Price` > 수국 코드표 > `Product.Cost`; 원본은 품목별 리터럴 다수 | 수기 단가 저장 가능하나 원본 증빙 없음 | 직접입력필수 |
| 송이/총계 | `박스×박스당수량`, `수량×가격`; 시트 전체는 `/1.1` 평가 합계도 사용 | F 평가 계산에만 반영, 보조시트 미생성 | 현재누락 |
| 국가/화종 구간 합계 | 수국·카네이션·호주·미국·콜롬비아 루스커스/알스트로/장미·이스라엘·일본·기타/중국·태국·네덜란드·베트남·에콰도르 | resolver 카테고리 합계로 대체 | 자동가능 |
| P:R 무표제 보조열 | 호주 등 일부 품목의 외화가격, 수량×외화가격, 환율환산으로 보이나 표제·계약 없음 | 미구현 | 근거부족 |

### 5.2 그외통관비

| 블록/항목 | 원천·키 / 공식 | 현재 구현 | 분류 |
|---|---|---|---|
| 품목 11개와 1차/2차 | `OrderYear + MajorWeek + Category`; 반차수는 WarehouseMaster.OrderWeek | 활성 입고 국가 자동 노출 | 자동가능 |
| 백상 창고료 | WarehouseMaster/중량 특수 WarehouseDetail의 GW; 단가 `WebCustomsRateHistory.BakSangRate`; `(GW1+GW2)×rate` | GW 자동+override 구현 | 자동가능 |
| 관세 1/2/3 분할 | 청구서 리터럴 → `WebCustomsWeekly.Customs*` | 분할 합계와 이력 구현 | 직접입력필수 |
| 선율 1/2/3 분할 | 청구서 리터럴 → `WebCustomsWeekly.SunYul*`; 일반 `/1.1`, 베트남 예외 | 구현 | 직접입력필수 |
| 월드운송료 | GW로 1t/2.5t/5t 결정; 단가 99,000/187,000/275,000; 공급가 `/1.1` | 자동+명시 override 구현 | 자동가능 |
| 한국방역 | 리터럴 → `WebCustomsWeekly.Quarantine1/2`; `/1.1` | 구현 | 직접입력필수 |
| 국가별 H 합계 | 위 공급가 합계, 원본 I35:I45 | 구현 | 자동가능 |

### 5.3 구매현황과 포워딩

두 시트의 A:M 헤더는 같고 N은 무표제 분류열이다.

| 열/항목 | ERP 후보 원천 | 확정·변환 | 현재 구현 | 분류 |
|---|---|---|---|---|
| A 일자-No. | WarehouseMaster.`ArrivalDtm` + 외부 전표 번호로 추정 | 문자열 결합 규칙의 계약 없음 | 상세 미생성 | 근거부족 |
| B 거래처명 | WarehouseMaster.`FarmName` | 입고 BILL 기준 | 분류 보조에만 사용 | 자동가능 |
| C 품목명(규격) | Product.`ProdName` | `WarehouseDetail.ProdKey` 조인 | 사용 | 자동가능 |
| D 수량 | WarehouseDetail.`EstQuantity` | 0이면 Bunch→Steam→Box fallback | 집계 분모 구현 | 자동가능 |
| E 박스수량 | WarehouseDetail.`BoxQuantity` | 원시 수량 | 콜롬비아 배부에 사용 | 자동가능 |
| F 단가 | WarehouseDetail.`UPrice` | 외화 단가 | 본표에는 직접 미노출 | 자동가능 |
| G 외화금액 | WarehouseDetail.`TPrice` | Q 또는 S 합계 | 구현 | 자동가능 |
| H 공급가액, J 합계 | `TPrice×ExchangeRate`로 보이나 ERP 단일 열 없음 | 원본 28차는 H=J이며 리터럴/캐시 | 상세 미생성 | 근거부족 |
| I 환율 | FreightCost.`ExchangeRate`, fallback CurrencyMaster | BILL 시점 | R 집계에 구현 | 자동가능 |
| K 차수/품목 | WarehouseMaster.`OrderWeek` + 수기 약칭 | 문자열 규칙 계약 없음 | SQL은 OrderWeek와 resolver 사용 | 근거부족 |
| L 인보이스넘버 | WarehouseMaster.`InvoiceNo` | BILL 기준 | 포워딩 국가 추론에 사용 | 자동가능 |
| M 결제일 | 저장소의 해당 입고 열 근거 없음 | 원본 직접 입력 | 미구현 | 직접입력필수 |
| N 분류 | Product 국가/화종/품명, BILL 품목구성, FarmName/InvoiceNo fallback | CHINA/운송료 우선 등 resolver | 본표 집계 구현. Excel N 보조열 미생성 | 현재누락 |

`구매현황`은 운송료/SERVICE FEE를 제외해 Q를 만들고, `포워딩`은 해당 행만 모아 S를 만든다. 현재 `autoForwardingByCountry`는 같은 WarehouseKey의 실제 꽃 국가를 우선하고 FarmName/InvoiceNo 패턴을 fallback으로 사용한다.

### 5.4 판매현황

| 항목 | 원천·키 / 공식 | 현재 구현 | 분류 |
|---|---|---|---|
| 거래처 | ShipmentMaster.`CustKey` → Customer.`CustName` | 고정 출고 기준 | 본표에 불필요해 상세 미생성 | 현재누락 |
| 품목별 | ShipmentDetail.`ProdKey` → Product.`ProdName` | fixed detail 필요 | resolver에서 사용 | 자동가능 |
| 수량 | ShipmentDetail.`OutQuantity` | 이미 OutUnit 단일값, 재환산 금지 | 0 제외 조건에 사용 | 자동가능 |
| 단가 | `Amount/OutQuantity` 또는 출고 저장 단가 후보 | 확정 컬럼 계약 불충분 | 미생성 | 근거부족 |
| 공급가액 | ShipmentDetail.`Amount` | 원본 N은 `판매현황!E` SUMIF | 집계 구현, DetailFix 누락 | 현재누락 |
| 부가세/합계 | ShipmentDetail.`Vat`; `Amount+Vat` | fixed detail | 보고서 미사용, 상세 미생성 | 현재누락 |
| I 품명 분류 | Product master + 문자열 fallback | 품목리스트 lookup/문자 규칙 | 중앙 resolver로 구현 | 자동가능 |

### 5.5 불량차감 / 그 외 매출액

| 항목 | 원천·키 / 공식 | 현재 구현 | 분류 |
|---|---|---|---|
| 일자-No., 거래처, 품목명, 수량, 단가, 부가세, 합계, 적요 | Estimate와 연결 Shipment/Customer/Product에 일부 후보가 있으나 DB_STRUCTURE는 Estimate 상세 열을 열거하지 않음 | 전표 레이아웃의 완전한 DB 매핑 불가 | 상세 미생성 | 근거부족 |
| 공급가액 F | Estimate.`Amount` | `CodeInfo.Descr2='불량차감'`이면 L, 나머지는 O | 집계 구현 | 자동가능 |
| J 분류 | Estimate.`ProdKey` → Product resolver; 운송료 문자열 예외 | 카테고리 SUMIF | 구현 | 자동가능 |

### 5.6 콜롬비아 1차 / 2차

| 항목 | 원천·키 / 공식 | 현재 구현 | 분류 |
|---|---|---|---|
| 환율 D4 | 본표 R, 최종은 FreightCost/전차수/CurrencyMaster/수기 | 반차수 공통 환율 | 구현 | 직접입력필수 |
| 항공료 D6 | 운송료 WarehouseDetail.TPrice 또는 `WebColombiaWeekly.AirRateUSD` | 반차수 USD 총액 | 자동감지+override | 자동가능 |
| GW/CW | WarehouseMaster/중량 품목의 Gross/Chargeable | `OrderYear + OrderWeek` | 자동+override | 자동가능 |
| 1t/2.5t/5t 대수·금액 | GW 임계값과 단가 history | 차량 등급×단가 | 구현 | 자동가능 |
| 창고비 | `GW×BakSangRate` | 반차수 | 구현 | 자동가능 |
| 통관수수료, 소독비용, 관세료, 검역비용 | `WebColombiaWeekly.HandlingFee/CustomsFee/DisinfectFee/QuarantineDeductFee` | 청구서 입력 시점 | 구현 | 직접입력필수 |
| 검역대행수수료 | `ItemCount×QuarantinePerItemRate` | 품목수와 단가 | 구현 | 직접입력필수 |
| TOTAL | 위 비용 합계 | C17 | 구현 | 자동가능 |
| 4품목 박스수량 | WarehouseDetail.`BoxQuantity`, Product 국가/화종 | `OrderYear + OrderWeek` | 구현 | 자동가능 |
| 무게/CBM 비율 | 박스수×품목별 BoxWeight/BoxCBM; GW=CW면 S도 무게, 아니면 CBM | H는 항상 무게비율, S는 조건 분기 | 구현 | 자동가능 |
| 농장별 인보이스 금액 C:F31 이하 | WarehouseMaster.`FarmName`,`InvoiceNo` + WarehouseDetail.TPrice 후보 | 농장×품목 피벗 | 현재 미구현 | 현재누락 |
| 품목 요약 E:N | invoice, air, 환율, H, 판매금액으로 CNF/도착/이익 계산 | `G=(E+F)×R`, `K=G+H+I+J`, `M=L-K`, `N=M/L` | H/S 배부만 구현, 전체 도착·판매·이익 표 미구현 | 현재누락 |
| 검역 차감 stems/금액 행 | 원본 직접 입력이나 aggregate `QuarantineDeductFee` 외 상세 원장 근거 없음 | 품목별 차감 | 미구현 | 직접입력필수 |

### 5.7 품목리스트

| Excel 열 | DB 매핑 | 현재 구현 | 분류 |
|---|---|---|---|
| A 품목번호 | Product.`ProdKey` 후보이나 원본 순번과 동일하다는 계약 없음 | 미생성 | 근거부족 |
| B 품목코드 | Product 코드 컬럼 후보가 DB_STRUCTURE에 명시되지 않음 | 미생성 | 근거부족 |
| C 품목명 | Product.`ProdName` | resolver 사용 | 자동가능 |
| D 꽃 | Product.`FlowerName` | resolver 사용 | 자동가능 |
| E 국가 | Product.`CounName` | resolver 사용 | 자동가능 |
| F 출고단가 | Product.`Cost`는 원가이며 출고단가와 동일하지 않음 | 미생성 | 근거부족 |
| G 출고단위 | Product.`OutUnit` | 재고 환산 사용 | 자동가능 |
| H 견적단위 | 코드가 Product.`EstUnit`을 가정하나 DB_STRUCTURE 미기재 | 재고 환산 사용 | 근거부족 |
| I 비고 | Product 설명 열 후보가 현재 계약에 없음 | 미생성 | 근거부족 |

24차의 `Sheet1`은 표제·계약·코드 참조가 없어 전체가 근거부족이다.

## 6. 현재 구현 누락·불일치 목록

| 심각도 | 항목 | 영향 |
|---|---|---|
| 높음 | `ViewShipment.DetailFix=1` 미적용 | N과 C/D/I/J/K/M이 미확정 상세를 포함할 가능성 |
| 높음 | 22~27 `공제` / 28 `국내` 역사 버전 미지원 | 과거차수 행 정체성, 합계 제외 규칙, Excel parity 불일치 |
| 높음 | 조회 경로 runtime DDL | REPORT_READ가 웹 스키마를 변경할 수 있어 read-only 기대와 불일치 |
| 중간 | 명시 `ShipmentMaster.OrderYear=@year` 없음 | 파생 `OrderYearWeek` 품질에 의존; 연도 충돌 방어가 계약보다 약함 |
| 중간 | 보조시트 10개 미생성 | 원본의 전표 추적성과 감사 가능한 SUMIF 근거가 다운로드에서 사라짐 |
| 중간 | 원본/템플릿 행 구조, 비고 위치, U 합계 불일치 | Excel 100% 동일 주장과 불일치 |
| 중간 | E/F 가격·리터럴 근거 불완전 | 같은 재고수량에서도 원본 금액과 차이 가능 |
| 중간 | registry/fixture가 22~27 원본 부재로 기록 | 현재 입력 7개를 회귀검증에 사용하지 못함 |
| 낮음 | 27차 B1이 26차 | 제목만으로 차수 판정 불가 |
| 낮음 | Product.EstUnit/SteamOf1Bunch 문서 공백 | 운영 스키마에 없으면 재고 SQL 실패 가능; 있더라도 lineage 문서 미완성 |
| 낮음 | UI 열 설명이 C~K만 제공 | L~U의 사용자-visible 근거 설명 누락 |

## 7. Side-effect matrix

| 동작 | 읽기 | 웹 전용 쓰기/외부 효과 | ERP 원장 효과 | 판정 |
|---|---|---|---|---|
| 주차 REPORT_READ / Excel 다운로드 | Shipment*, Estimate, CodeInfo, Warehouse*, Product, Stock*, FreightCost, CurrencyMaster, Web* | 테이블 부재 시 `WebProfitReport`, `WebStockPrice`, 5개 customs 테이블 CREATE 및 `WebCustomsWeekly` ALTER 가능 | 없음 | 원장 안전, 스키마 부작용 있음 |
| 연간/월별 조회 | PeriodDay + 각 주차 REPORT_READ 원천 | 주차 조회와 같은 runtime DDL 가능 | 없음 | 원장 안전, 스키마 부작용 있음 |
| 재고단가 목록 조회 | Stock*, Product, WebStockPrice, snapshot | WebStockPrice CREATE 가능 | 없음 | 원장 안전, 스키마 부작용 있음 |
| 수기 E/F/H/R/S 저장 | snapshot 확인, WebProfitReport | `WebProfitReport` MERGE | 없음 | 웹 전용 |
| 비고 저장 | snapshot 확인, WebProfitReport | `Category='_note', ColKey='note'` MERGE | 없음 | 웹 전용 |
| 재고단가 저장/해제 | snapshot 확인, Product/Stock | `WebStockPrice` MERGE/DELETE | 없음 | 웹 전용 |
| 통관 단가 저장 | WebCustomsRateConfig/History | config/history MERGE + `WebCustomsHistory` INSERT | 없음 | 웹 전용 |
| 국가 통관 저장 | Warehouse GW, WebCustomsWeekly | `(OrderYear,MajorWeek,Category)` MERGE + 이력 INSERT | 없음 | 웹 전용 |
| 콜롬비아 저장 | Warehouse 박스/GW, WebColombiaWeekly | `(OrderYear,OrderWeek)` MERGE + 이력 INSERT | 없음 | 웹 전용 |
| 포워딩 저장 | Warehouse transport rows, WebForwardingWeekly | `(OrderYear,MajorWeek,Category)` MERGE + 이력 INSERT | 없음 | 웹 전용 |
| 확정 snapshot | live 보고서 전체 원천 | `WebProfitReportSnapshot` INSERT; 이후 해당 차수 수정 차단 | 없음 | 웹 전용·불변 |
| MOYI 전송 목록 GET | WebMoyiReportPush | 테이블 부재 시 CREATE | 없음 | 스키마 부작용 있음 |
| MOYI 전송 POST | 보고서 원천 + WebMoyiReportPush | pending INSERT, 상태 UPDATE, 외부 HTTPS POST 및 파일 내용 전송 | 없음 | 명시적 외부 부작용. 이번 조사에서는 실행 안 함 |
| `2026-04-16_freight_cost.sql` 적용 | 기존 Product/Flower/Warehouse | ERP master ALTER/UPDATE, FreightCost* CREATE | **Product/Flower 값 변경 가능** | 배포 전 별도 승인 필요 |
| `2026-04-17_currency_cny.sql` 적용 | CurrencyMaster | CNY INSERT | 환율 master 변경 | 배포 전 별도 승인 필요 |
| `2026-07-10_stockmaster_isfix_tinyint.sql` 적용 | StockMaster | `isFix` 타입 변경 | 재고 master 스키마 변경 | 배포 전 별도 승인 필요 |
| `2026-08-13_profit_report_country_resolver_dry_run.sql` | Product/업무 원천 | 없음(SELECT only) | 없음 | 읽기 전용 |
| `2026-08-13_web_customs_rate_history.sql` 적용 | 없음 | WebCustomsRateHistory CREATE | 없음 | 웹 스키마 migration |
| `2026-08-13_web_profit_report_snapshot.sql` 적용 | 없음 | WebProfitReportSnapshot CREATE | 없음 | 웹 스키마 migration |

주문·출고·입고·재고·견적·정산·수금·원가 downstream 보존 대상은 `OrderMaster/Detail`, `ShipmentMaster/Detail`, `ShipmentDate`, `Estimate`, `WarehouseMaster/Detail`, `StockMaster`, `ProductStock`, `StockHistory`, `FreightCost/Detail`이다. 보고서 API의 save 경로는 이 테이블들을 쓰지 않는다. 단, 위 migration SQL은 실행 시 별도의 명시된 스키마/데이터 효과가 있으므로 보고서 API 안전성과 구분해야 한다.

## 8. 근거 파일과 검증

주요 근거는 `AGENTS.md`, `docs/DB_STRUCTURE.md`, `docs/ERP_FEATURE_CHANGE_CHECKLIST.md`, `docs/ERP_CHANGE_GUARD.md`, `docs/ERP_COMPAT_INVARIANTS_2026-06-04.md`, `docs/WEB_VS_ERP_CONFLICTS.md`, `docs/contracts/weekly-profit-report.json`, `docs/exe-golden/FormProfitReport.md`, 관련 freight/arrival contract·golden, 위 6개 migration, `lib/profitReport*.js`, `lib/customsForwarding.js`, `pages/api/sales/profit-report.js`, customs/forwarding API, `pages/api/moyi/report-push.js`, 현재 UI/Excel generator, snapshot registry와 acceptance fixture다.

읽기 전용으로 다음 6개 회귀 테스트를 실행했고 모두 통과했다.

- `__tests__/profitReportWorkbookParity.test.js`
- `__tests__/profitReportWeek28Customs.test.js`
- `__tests__/profitReportStockLinkContract.test.js`
- `__tests__/profitReportSnapshot.test.js`
- `__tests__/profitReportCountryResolver.test.js`
- `__tests__/customsForwardingAuto.test.js`

이 통과는 현재 테스트가 확인하는 계산/정적 문자열 계약을 뜻한다. DetailFix 누락, 22~27 입력 미등록, 보조시트 미생성, U 합계와 템플릿 행 위치 불일치는 현 테스트가 잡지 않는다.
