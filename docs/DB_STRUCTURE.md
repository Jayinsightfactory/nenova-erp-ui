# nenova ERP DB 구조 (확립본)

> 최종 갱신 2026-04-22. 실제 운영 MSSQL 기준 + 13/14차 이후 트러블 이력에서 얻은
> "절대 원칙" 을 합본. 스키마 수정 전 이 문서를 먼저 읽고, 여기 명시된 규칙에
> 어긋나는 수정은 하지 말 것.

---

## 0. 절대 원칙 (트러블 회고 요약)

과거 장애 → 회피 규칙. 이 표의 규칙은 예외 금지.

| # | 과거 트러블 | 확립된 규칙 |
|---|---|---|
| 1 | `OrderKey` 라는 컬럼이 있는 줄 알고 쿼리 실패 | **OrderMaster PK 는 `OrderMasterKey`**. FK 도 동일. `OrderKey` 라는 컬럼 존재하지 않음 |
| 2 | OrderDetail 의 Box/Bunch/Steam 세 값을 합쳐 "111" 같은 무의미한 숫자 표시 | **한 행에 세 값 모두 환산 저장** → `Product.OutUnit` CASE WHEN 으로 **하나만** 선택 |
| 3 | ShipmentDetail 환산을 OutUnit 별로 분기했다가 루스커스 견적 망가짐 | **ShipmentDetail 환산은 단일 공식** (Box=qty, Bunch=qty×B1B, Steam=qty×S1Box). OutUnit 분기 금지 |
| 4 | `SteamOf1Box=0` 이상치를 API 에서 fallback 보정 → 다른 품목 깨짐 | **master 이상치는 master/data 에서 보정**. API 환산 로직에서 우회 금지 |
| 5 | 삭제된 행이 조회/집계에 섞여 나옴 | **모든 SELECT 에 `ISNULL(x.isDeleted,0)=0`** 필수. 모든 공통 테이블에 `isDeleted BIT` 존재 |
| 6 | 매출에 미확정 출고가 섞여 숫자 부풀려짐 | **매출 집계는 `ShipmentMaster.isFix = 1` 만** |
| 7 | 견적서 iframe 이 아닌 Blob+window.open 으로 부모 탭 날아감 | (DB 이슈 아니지만 관련) 견적서 인쇄는 iframe srcdoc 방식 고정 |
| 8 | 13/14차 이후 "똑똑한 새 로직" 추가 → 기존 데이터와 충돌 | **기준점은 `stable-13-14` (`81121fa`)**. 문제 생기면 `git diff stable-13-14` 로 변경점만 되돌림. 새 로직으로 대체 금지 |
| 9 | ShipmentDetail.OutQuantity 를 또 환산한 값으로 혼동 | **ShipmentDetail.OutQuantity 는 예외 — 이미 단일값**. 추가 환산 금지 |

---

## 1. 핵심 테이블 (PK / 주요 컬럼)

### 1.1 주문 (Order)

**OrderMaster** — 주문 헤더
- PK: `OrderMasterKey` INT IDENTITY
- `CustKey` FK → Customer
- `OrderWeek` NVARCHAR — "NN-NN" 포맷 (예: `16-01`). 대차수만 주어지면 `LIKE 'NN-%'` 로 먼저 세부차수 탐색
- `OrderDate`, `CreateDtm`, `CreateID`, `UpdateDtm`, `UpdateID`
- `isDeleted` BIT

**OrderDetail** — 주문 라인
- PK: `OrderDetailKey` INT IDENTITY
- FK: `OrderMasterKey`, `ProdKey`
- **수량 3종 (모두 환산 저장)**:
  - `BoxQuantity` DECIMAL
  - `BunchQuantity` DECIMAL  (= BoxQuantity × BunchOf1Box)
  - `SteamQuantity` DECIMAL  (= BoxQuantity × SteamOf1Box)
- `UnitPrice`, `Amount`, `Vat`
- `isDeleted`

> **수량 조회 정답 쿼리**
> ```sql
> SELECT
>   CASE
>     WHEN p.OutUnit IN (N'박스','BOX','Box')  THEN od.BoxQuantity
>     WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN od.BunchQuantity
>     WHEN p.OutUnit IN (N'송이','STEAM','STEM') THEN od.SteamQuantity
>     ELSE od.BoxQuantity
>   END AS Qty
> FROM OrderDetail od
> JOIN Product p ON p.ProdKey = od.ProdKey
> WHERE ISNULL(od.isDeleted,0)=0
> ```

**OrderHistory** — 주문 변경 이력
- `OrderDetailKey` 단위로 변경 추적

**OrderRequest / OrderRequestDetail** — 발주 요청

---

### 1.2 출고 (Shipment)

**ShipmentMaster** — 출고 헤더
- PK: `ShipmentKey` INT IDENTITY ← **`ShipmentMasterKey` 아님. `ShipmentKey` 로 통일**
- `CustKey`, `ShipmentDtm`, `isFix` BIT (**1 = 확정 / 매출 집계 대상**, 0 = 미확정)
- `isDeleted`

**ShipmentDetail** — 출고 라인
- PK: `SdetailKey` INT IDENTITY (소문자 d 주의)
- FK: `ShipmentKey`, `CustKey`, `ProdKey`
- **환산 수량 3종** (OrderDetail 과 동일 규칙):
  - `BoxQuantity` / `BunchQuantity` / `SteamQuantity`
- **`OutQuantity`** — OutUnit 기준 **단일값** (환산 아님, 또 환산 금지)
- `Amount` (공급가), `Cost` (원가), `Vat`
- `Descr` NVARCHAR — 메모 + 자동 변경 로그 (TR_ShipmentDetail_OutQty_Log 트리거가 OutQuantity 변경 시 자동 append)
- ⚠️ **`isDeleted` 컬럼 없음** (원본 ShipmentDetail 엔 isDeleted/Cost·아님 주의: Cost/Amount/Vat 는 있음, **isDeleted 는 없음**). `sd.isDeleted` 쿼리하면 `Invalid column name 'isDeleted'` SQL 500. 전산 `ViewShipment` 도 sd.isDeleted 를 안 봄. (2026-06-04 확인)

> **환산 공식 (단일, 절대 바꾸지 말 것)** — `shipment/distribute.js`, `shipment/stock-status.js`
> ```js
> const b1b = pInfo?.BunchOf1Box || 1;
> const s1b = pInfo?.SteamOf1Box || 1;
> BoxQuantity   = qty;
> BunchQuantity = qty * b1b;
> SteamQuantity = qty * s1b;
> ```

**ShipmentHistory** — 출고 변경 이력 (`SdetailKey` 단위)

---

### 1.3 마스터 (Product / Customer / Flower / Country)

**Product** — 품목
- PK: `ProdKey`
- `ProdName` NVARCHAR (영문 원본, **견적서 표시용 — 변경 금지**)
- **`DisplayName`** NVARCHAR(200) NULL — 웹 화면용 한글 자연어명 (2026-04-17 추가)
  - 웹 표시 패턴: `p.DisplayName || p.ProdName`
  - 견적서(buildEstimateHtml)는 ProdName 그대로
- `FlowerName`, `CounName`, `FarmName`
- `OutUnit` NVARCHAR — 박스/단/송이 중 하나. **수량 환산 분기의 기준**
- `BunchOf1Box` DECIMAL — 1박스당 단수
- `SteamOf1Box` DECIMAL — 1박스당 송이수 (0 이상치 시 master 에서 보정할 것)
- `Cost` DECIMAL — 원가 스냅샷
- 🆕 `BoxWeight` DECIMAL(10,3) NULL (2026-04-16, Flower 기본값 fallback)
- 🆕 `BoxCBM` DECIMAL(10,3) NULL
- 🆕 `TariffRate` DECIMAL(10,4) NULL (예: 0.08 = 8%)
- `isDeleted`

**Customer** — 거래처
- PK: `CustKey`
- `CustName`, `CustArea`, `CounKey`
- `isDeleted`

**Flower** — 꽃 카테고리
- 🆕 `BoxWeight`, `BoxCBM`, `StemsPerBox`, `DefaultTariff` (2026-04-16 운송기준원가용 기본값)

**Country** — 국가 마스터 (`CounKey`, `CounName`)

**Farm** — 농장 마스터 (`FarmKey`, `FarmName`, `CounKey`)

**CustomerProdCost** — 거래처 × 품목 단가
- PK: `AutoKey`, FK: `CustKey` + `ProdKey`

---

### 1.4 재고 (Stock)

**ProductStock** — `StockMaster` 스냅샷별 품목 재고
- `StockKey`, `ProdKey`, `Stock` — 전산 재고현황의 해당 스냅샷 잔량
- `ProductStock.Stock`은 `usp_StockCalculation`이 만든 차수별 스냅샷이다. `FormStockView.GetData`는 `StockMaster.isFix`를 조회·필터·표시하지 않는다. 주차별 매출이익보고서 E/F도 `ProductStock` 행이 존재하는 최신 숫자 세부차수 스냅샷을 사용하며 `StockMaster.isFix`를 재고 수량 선택 조건으로 추가하지 않는다.
- 현재고/부족 조회에서 별도 `CurrentStock` 컬럼으로 가정하지 않는다. 실제 환경의 컬럼명을 확인한 뒤 `Stock` 또는 `Product.Stock`을 사용한다.

**StockMaster / StockHistory** — 재고 이동 이력
- `StockMasterKey/StockKey`, `OrderYear`, `OrderWeek`, `OrderYearWeek`, `isFix`
- `isFix=1`: 재고 마감 표시. 일반 재고 화면과 주차별 매출이익보고서 E/F 수량 선택에서는 실제 `ProductStock` 스냅샷 존재 여부와 별도 축이며 필터로 사용하지 않는다.
- `isFix=2`: 웹 시작재고 입력용 마커(마이그레이션 후 tinyint 환경)
- 주차별 매출이익보고서 세부차수 선택은 `OrderYear + 대차수 prefix + ProductStock 존재` 후 세부차수 숫자 내림차순, 같은 차수는 ProductStock 행 수와 `StockKey DESC`로 결정한다. `StockMaster.isFix` 필터, 전년도 동일 차수, 입출고 단순 추정 fallback은 금지한다.

**WarehouseMaster** — 입고(AWB/BILL) 헤더
- PK: `WarehouseKey`
- `FarmName`, `ArrivalDtm`
- 🆕 `GrossWeight`, `ChargeableWeight`, `FreightRateUSD`, `DocFeeUSD` (2026-04-16)

**WarehouseDetail** — 입고 라인
- PK: `WdetailKey`, FK: `WarehouseKey`, `ProdKey`
- 전체 컬럼 (INFORMATION_SCHEMA 검증, 2026-07-09): `WdetailKey`, `ProdKey`, `OrderCode`, `BoxQuantity`, `BunchQuantity`, `SteamQuantity`, `OutQuantity`, `EstQuantity`, `UPrice`, `TPrice`, `WarehouseKey`, `SteamOf1Box`, `SteamOf1Bunch`
- ⚠️ **`isDeleted` 컬럼 없음** — 삭제 필터는 `WarehouseMaster.isDeleted=0` 으로만 (`WEB_VS_ERP_CONFLICTS.md` §7.6 참조). `wd.isDeleted` 쿼리 시 SQL 오류
- `OutQuantity` — `Product.OutUnit` 기준 단일값 (박스 품목이면 박스수). OrderDetail/ShipmentDetail 의 OutQuantity 와 동일 패턴 — 송이수 아님
- `EstQuantity` — 이카운트 구매현황 "수량" (전표 금액기준 수량, 2026-07-09 26차 실측 확인)
- `TPrice` — 라인 합계 USD (InvoiceTotal 집계 대상)

---

### 1.5 운송기준원가 (2026-04-16 신규)

**FreightCost** — 원가 스냅샷 헤더
- PK: `FreightKey`
- FK: `WarehouseKey` (UX: `WarehouseKey` 당 `isDeleted=0` 인 것 1건만 — `UX_FreightCost_Warehouse_Active`)
- `WeightBasis` NVARCHAR(10): `'GW'` | `'CBM'`
- `ExchangeRate`, `GrossWeight`, `ChargeableWeight`, `FreightRateUSD`, `DocFeeUSD`, `InvoiceTotalUSD`
- 통관 상수 스냅샷: `BakSangRate`, `HandlingFee`, `QuarantinePerItem`, `DomesticFreight`, `DeductFee`, `ExtraFee`
- `CreateID/Dtm`, `UpdateID/Dtm`, `isDeleted`

**FreightCostDetail** — 품목별 동결 결과 (한 BILL 30~200행)
- PK: `DetailKey`, FK: `FreightKey`, audit FK: `WarehouseDetailKey`
- 입력 스냅샷: `SteamQty`, `FOBUSD`, `BoxQty`, `BoxWeightUsed`, `BoxCBMUsed`, `StemsPerBoxUsed`, `StemsPerBunch`, `SalePriceKRW`, `TariffRate`
- 계산 결과: `FreightPerStemUSD`, `CNF_USD`, `CNF_KRW`, `TariffKRW`, `CustomsPerStem`, `ArrivalPerStem`, `ArrivalPerBunch`, `SalePriceExVAT`, `ProfitPerBunch`, `ProfitRate`, `TotalSaleKRW`, `TotalProfitKRW`
- 계산 공식 및 238건 fixture: `__tests__/freightCalc.test.js` (수정 시 반드시 pass 확인)

**WebArrivalCostImport / WebArrivalCostLine / WebArrivalCostHistory** — 차수별 도착원가 웹 전용 원장
- `WebArrivalCostImport`: 업로드 파일·연도·revision·업로드 사용자·범위
- `WebArrivalCostLine`: 차수·국가·원본 품종/품목/농장명, 전산 `ProdKey`/`FarmKey` 매칭,
  엑셀 표시 원가, 선택 원가, 환율·GW·CW·항공료, 업로드 당시 무게·부피·금액 배분비율,
  배분기준(`SOURCE|WEIGHT|VOLUME|VALUE|EQUAL`)
- `WebArrivalCostHistory`: 업로드로 교체된 현재본, 품목/농장 매칭, 배분기준 변경의 전후 이력
- 같은 `OrderYear + OrderWeek + CountryName`을 재업로드하면 이전 웹 행만 `IsCurrent=0`으로
  만들고 새 revision을 기본 표시한다. 기존 `Warehouse*`, `Product.Cost`, `Shipment*`,
  `Estimate`, `ProductStock`, `WebProfitReport`에는 자동 반영하지 않는다.

**WebStockPriceEvidence** — 주차별 매출이익보고서 재고단가 증거
- 업무키: `OrderYear + OrderWeek + ProdKey`; `Price`, `SourceRef`, `EffectiveAt`, `EvidenceStatus`, 확정자·확정시각을 보존한다.
- E/F는 확정 `ProductStock`과 업무키가 정확히 일치하고 `EvidenceStatus='VERIFIED'`인 단가만 사용한다.
- `Product.Cost`, 최근 입고단가, 도착원가 평균 및 다른 차수 단가를 fallback으로 사용하지 않는다. 값이 없으면 최종 E/F를 직접입력하지 않고 입력 필요로 남긴다.

**WebCustomsRateHistory** — 백상·트럭·검역 단가 적용시점 이력
- 업무키: `ConfigKey + EffectiveOrderYear + EffectiveMajorWeek`.
- 대상 차수 이하의 가장 최근 이력을 사용해 과거 보고서를 현재 전역 단가로 재작성하지 않는다.
- 런타임 GET에서 테이블을 만들지 않는다. `docs/migrations/2026-08-13_web_customs_rate_history.sql`을 별도 적용한다.

주차별 매출이익보고서의 Web 전용 테이블·컬럼은 런타임 API가 생성하거나 변경하지 않는다. 조회 전 `lib/webSchemaContract.js`가 migration 적용 여부를 읽기 전용으로 검증한다.

---

### 1.6 견적서 / 정산 / 기타

**Estimate** — 견적서 (`EstimateKey`, `CustKey`, `ProdKey`, `ShipmentKey`)

**WebSalesDefectDeduction** — 영업수입 불량/검역 차감 웹 원장
- PK: `DeductionKey`; 업무 키: `OrderYear`, `OrderWeek`, `CustKey`, `ProdKey`
- 입력 스냅샷: 거래처/품목/색상/차감수량/단위/크레딧/농장/비고/차감구분
- 수입부 확인: `ImportConfirmed`, `ImportConfirmedBy`, `ImportConfirmedByName`, `ImportConfirmedAt`, `ImportReviewRequired`
- 견적 등록 후 연결: `EstimateKey`, `EstimateCost`, `EstimateDtm`, `Status`
- 원차수와 실제 견적 적용 차수 분리: `OrderYear/OrderWeek`는 불량 입력 원차수이며,
  `AppliedOrderYear/AppliedOrderWeek/AppliedShipmentKey`는 EXE 판매행이 확인된 견적 적용 대상이다.
  `AppliedCostSourceYear/AppliedCostSourceWeek`에는 실제 사용한 이전 차수 단가 원천을 기록한다.
- 영업지원 전산등록은 `ViewShipment + ViewOrder + ShipmentDate + PeriodDay`와
  `DetailFix=1`, 양수 `EstQuantity`를 통과한 판매행만 대상으로 하며, 대상이 없으면
  Estimate를 만들지 않고 이월 대기 후보로 남긴다.
- 웹 원장 저장만으로 `OrderDetail`, `ShipmentDetail`, `ShipmentDate`, 재고, 손익 원장을 변경하지 않는다.
- 견적서관리 등록을 명시적으로 실행할 때만 dnSpy `ClassEstimate.Insert/Update`와 동일한 `Estimate` 행을 생성·갱신한다.
- 영업지원 수동처리완료는 수기 처리한 웹 원장을 `Status=MANUAL_COMPLETED`로 표시하고 `WebSalesDefectDeductionHistory(ActionType=MANUAL_COMPLETE)`만 남긴다. Estimate를 만들지 않는다.
- 영업지원 처리상태 옆 견적서 캡쳐는 같은 연도·부모차수·업체의 기존 음수 Estimate를 읽기만 해서 견적서 목록처럼 보여 준다. Estimate INSERT/UPDATE는 없다.
- `IsCarryoverLedger=1`은 수동 이월업체 원장이며 `OriginalQuantity`와 `RemainingQuantity`를 분리한다. 부분 처리 후 `RemainingQuantity>0`이면 다음 차수 이월 목록에 계속 표시한다.
- `WebSalesCarryoverApplication`은 이월 원장의 차수별 처리수량·`EstimateKey`·적용 출고키를 보존한다. 이월 등록/조회/잔여수량 갱신은 Order/Shipment/Stock 원장을 변경하지 않는다.

**WebSalesDefectDeductionHistory** — 불량/검역 차감 변경 이력
- `MANUAL_COST`의 AfterJson은 직접입력 단가와 원장키·적용연도/차수·업체·품목·단위 범위를 기록한다. 같은 범위의 최신 이벤트만 적용하며 null 단가는 직접입력 해제다. EstimateCost 및 ERP 원장은 이 저장에서 변경하지 않는다.
- PK: `HistoryKey`, 업무 FK: `DeductionKey`
- `CREATE`, `UPDATE`, `MATCH`, `INCOMING_CONFIRM`, `REGISTER_ESTIMATE`, `MANUAL_COMPLETE`, `DELETE`와 거래처명/품명/색상/수량/크레딧/농장/비고 변경 전후 JSON을 보존한다.
- 담당자별 입력자·수정자를 기록하지만 조회 범위는 전체 담당자 공통이다.

**ReceivableLedger** — 미수금 원장

**BankTransaction** — 은행 거래 내역

**TaxInvoice** — 세금계산서

**CurrencyMaster** — 환율
- `CurrencyCode` PK (USD/EUR/CNY 등)
- `ExchangeRate` DECIMAL, `UpdateDtm`, `IsActive`
- 🆕 CNY 추가 (2026-04-17): `INSERT ... VALUES ('CNY', N'중국 위안', 188.0, ...)`

**FarmCredit** — 농장 차수별 크레딧 (2026-04-17 신규)
- PK: `CreditKey`
- `FarmName`, `OrderWeek`, `CreditUSD`, `Memo`, `isDeleted`
- UX: `(FarmName, OrderWeek)` WHERE `isDeleted=0`

**WebImportFarmPaymentDay** — 수입부 Pivot 농장별 결제일 설정 (2026-08-03 신규)
- 웹 전용 PK: `FarmName`
- `PaymentDay` — `5` | `15` | `25` | `30` 중 하나
- `CreateID`, `CreateDtm`, `UpdateID`, `UpdateDtm`
- 농장명별 공통 설정이며 WarehouseMaster/WarehouseDetail 및 주문·출고·재고 원장을 변경하지 않는다.

**WebPreShipmentPlan / WebPreShipmentItem / WebPreShipmentSchedule / WebPreShipmentAllocation** — 주광 선출고 웹 전용 원장 (2026-08-25 신규)
- `Plan`: 등록 연도·대차수·원본 파일/시트. ERP `OrderMaster`/`ShipmentMaster`와 FK로 연결하지 않는다.
- `Item`: 원본 시트의 품종·품목·발주 박스/단·부산윌슨 수량·메모.
- `Schedule`: 실제 출고일·요일/구분·비교할 견적 연도/차수.
- `Allocation`: `ScheduleKey + ItemKey`별 선출고 수량. 0도 유효한 명시값이다.
- 네 테이블의 저장은 `Order*`, `Shipment*`, `ShipmentDate`, `Stock*`, `Estimate`, `WebProfitReport`를 변경하지 않는다.

**UserInfo** — 사용자
**UserFavorite** — 즐겨찾기
**SystemActionLog** — 시스템 동작 로그
**EcountSyncLog** — Ecount 연동 로그
**ImportOrder / ImportOrderDetail** — 수입 주문

---

## 2. 관계도 (주요 FK)

```
Customer(CustKey) ──┬── OrderMaster(OrderMasterKey) ─── OrderDetail(OrderDetailKey)
                    │                                          │
                    ├── ShipmentMaster(ShipmentKey) ── ShipmentDetail(SdetailKey)
                    │                                          │
                    ├── CustomerProdCost                        │
                    ├── ReceivableLedger                        │
                    └── Estimate                                │
                                                                │
Product(ProdKey) ────────────────────────────────────────────────┤
  ├── ProductStock                                               │
  ├── FlowerName → Flower                                        │
  └── CounName  → Country                                        │
                                                                 │
WarehouseMaster(WarehouseKey) ── WarehouseDetail(WdetailKey) ────┘
  └── FreightCost(FreightKey) ── FreightCostDetail(DetailKey)

Farm(FarmKey) ── FarmCredit(CreditKey)
```

---

## 3. 트리거

**TR_ShipmentDetail_OutQty_Log** (2026-08-25)
- `ShipmentDetail.OutQuantity` UPDATE 시 Descr 자동 append.
- 웹(`.Net SqlClient` / Node) APP_NAME이면 append하지 않는다. 웹은 `lib/shipmentDescr.appendDescr`의 `재용3>2` 형식만 남긴다.
- Nenova.exe 등 전산 앱만 짧은 `이전>이후` 한 줄을 붙인다. SqlClient 드라이버명·로그인 감사줄은 쓰지 않는다.
- 정의: `docs/migrations/2026-08-25_shipment_detail_trigger_skip_sqlclient.sql`

---

## 4. 인덱스 / 유니크 제약

- `UX_FreightCost_Warehouse_Active` — `FreightCost(WarehouseKey) WHERE isDeleted=0` 유일
- `UX_FarmCredit_Farm_Week` — `FarmCredit(FarmName, OrderWeek) WHERE isDeleted=0` 유일
- `IX_FreightCostDetail_Freight` — `FreightCostDetail(FreightKey)`

---

## 5. 마이그레이션 파일 위치

수동 실행 (SSMS). 모두 idempotent.

- `docs/migrations/2026-04-16_freight_cost.sql` — Product/Flower/WarehouseMaster 컬럼 추가 + FreightCost/FreightCostDetail 생성
- `docs/migrations/2026-04-17_currency_cny.sql` — CurrencyMaster CNY 추가
- `docs/migrations/2026-04-17_display_name.sql` — Product.DisplayName 추가 + 콜롬비아 4종 일괄 세팅
- `docs/migrations/2026-04-17_farm_credit.sql` — FarmCredit 테이블 생성
- `docs/migrations/2026-04-17_shipment_detail_trigger.sql` — OutQuantity 자동 로그 트리거
- `docs/migrations/2026-07-22_web_sales_defect_deduction.sql` — 영업수입 불량/검역 차감 웹 원장·이력 테이블 생성
- `docs/migrations/2026-08-03_web_import_farm_payment_day.sql` — 수입부 Pivot 농장별 결제일 설정 테이블 생성

---

## 6. 쿼리 체크리스트 (작성 전 필독)

- [ ] `OrderMasterKey` 썼는가 (`OrderKey` ❌)
- [ ] `ShipmentKey` 썼는가 (`ShipmentMasterKey` ❌)
- [ ] `SdetailKey` 대문자/소문자 (`SdetailKey` — 소문자 `d`)
- [ ] `ISNULL(x.isDeleted,0)=0` 모든 테이블에 적용했는가
- [ ] 매출 집계면 `sm.isFix=1` 필터 있는가
- [ ] OrderDetail 수량이면 `p.OutUnit` CASE WHEN 으로 **하나만** 뽑았는가 (합산 X)
- [ ] ShipmentDetail 수량이면 `OutQuantity` 직접 쓰거나, 환산 수정이면 단일 공식(OutUnit 분기 X)
- [ ] 품목명 웹 노출이면 `p.DisplayName || p.ProdName`, 견적서면 `p.ProdName` 고정
- [ ] 변경 전 `git diff stable-13-14 -- <파일>` 먼저 확인

---

## 7. 참고

- 스키마 실시간 조회 API: `POST /api/m/catalog?refresh=1`, `POST /api/m/biz?refresh=1`
- 스키마 캐시 (10분): `lib/chat/schema.js` → `getSchema({force:true})`
- 진단 대시보드: `/m/admin/status` (카탈로그/비즈/사용량/환경 6종 헬스체크)
- 운송원가 fixture: `__tests__/freightCalc.test.js` (238건, lib/freightCalc.js 수정 시 필수 pass)
