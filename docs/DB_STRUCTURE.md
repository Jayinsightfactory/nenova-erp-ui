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
- `isDeleted`

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

**ProductStock** — 품목 현재고
- `ProdKey`, `CurrentStock`
- 부족 조건: `WHERE ISNULL(ps.CurrentStock,0) <= 0`

**StockMaster / StockHistory** — 재고 이동 이력

**WarehouseMaster** — 입고(AWB/BILL) 헤더
- PK: `WarehouseKey`
- `FarmName`, `ArrivalDtm`
- 🆕 `GrossWeight`, `ChargeableWeight`, `FreightRateUSD`, `DocFeeUSD` (2026-04-16)

**WarehouseDetail** — 입고 라인
- PK: `WdetailKey`, FK: `WarehouseKey`, `ProdKey`
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

---

### 1.6 견적서 / 정산 / 기타

**Estimate** — 견적서 (`EstimateKey`, `CustKey`, `ProdKey`, `ShipmentKey`)

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

**TR_ShipmentDetail_OutQty_Log** (2026-04-17)
- `ShipmentDetail.OutQuantity` UPDATE 시 `Descr` 에 `[YYYY-MM-DD HH:mm] [전산수정] old→new` 자동 append.
- 정의: `docs/migrations/2026-04-17_shipment_detail_trigger.sql`

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
