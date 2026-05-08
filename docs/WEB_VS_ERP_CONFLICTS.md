# nenovaweb ↔ 전산(이카운트) DB 충돌 이슈 정리

> 같은 MSSQL DB 를 **웹(nenovaweb)** 과 **전산(이카운트 데스크톱 ERP)** 이 동시 사용.
> 서로 다른 패턴으로 INSERT/UPDATE 하면서 발생하는 충돌과 해결 내역.
> 신규 기능 작성 시 반드시 이 문서 확인.

최종 갱신: 2026-04-24 (master `2d20d2b`)

---

## 0. 충돌의 근본 구조

| 구분 | 웹 (nenovaweb) | 전산 (이카운트) |
|---|---|---|
| PK 생성 방식 | `MAX(Key)+1` (수동) | 동일 (IDENTITY 아님) |
| 트랜잭션 격리 | `withTransaction` (HOLDLOCK 적용) | 자체 세션 (HOLDLOCK 인식 X) |
| `CreateID` | `req.user.userId` (예: nenovaSS3) | `'admin'` 고정 |
| `Manager` | userId | `'관리자'` |
| `OrderWeek` 형식 | `YYYY-WW-SS` (신형식) | `WW-SS` (구형식) |
| `OutQuantity` | 단일값 (이미 환산된 수량) | 동일하지만 NULL 인 경우 많음 |
| `LastUpdateID/Dtm` | 트리거가 변경 감지 → 표시 안 함 | 트리거가 무시 |
| 카테고리(`FlowerName`) | 사용자 자유 입력 | 고정 분류 |

→ **웹이 전산 패턴을 모방해야** 전산 화면에서 정상 표시. 그렇지 않으면 "주문이 안 뜬다", "출고 확정 안 된다", "관리자 화면 숨김" 같은 증상.

---

## 1. 반복 발생 충돌 이슈 9건 + 해결 내역

### 🔴 #1. OrderDetail/OrderMaster PK duplicate key (예: 54255)

**증상**: `Violation of PRIMARY KEY constraint 'OrderDetail_PK'. duplicate key value is (54255)`

**원인**: 웹이 `SELECT MAX(Key)+1 WITH (HOLDLOCK)` 로 키 계산 → INSERT 사이에 **전산이 같은 키 먼저 점유**. HOLDLOCK 은 웹 트랜잭션끼리만 직렬화, 전산 세션은 그 범위 밖.

**해결**: [`pages/api/orders/index.js`](../pages/api/orders/index.js) `tryInsertWithRetry(maxRetry=5)` — PK 충돌(2627)/UNIQUE(2601) 감지 시 `MAX+1` 재계산 후 INSERT 재시도.

**커밋**: `d026823` (dangling `0c03b9d` 복구), 이전 시도 `48f567f` `0bd073c`

**적용 위치**: OrderMaster INSERT, OrderDetail INSERT 두 지점 모두

---

### 🔴 #2. CreateID = 'admin' 고정 (전산 호환)

**증상**: 웹에서 등록한 주문이 전산 화면에 안 뜸 / 필터링됨

**원인**: 전산은 `CreateID = 'admin'` 인 행만 본인이 만든 것으로 인식. 웹이 `req.user.userId` 로 저장하면 전산 입장에서 "외부 데이터" 로 무시.

**해결**: OrderMaster / OrderDetail INSERT 시 **CreateID 무조건 `'admin'`** 으로 저장.

```js
createId: { type: sql.NVarChar, value: 'admin' }, // 전산 호환
```

**커밋**: `8b98746`, `cdd8ca4`, `098bc7a`, `3d5ff52`

---

### 🔴 #3. Manager = '관리자' 고정 (전산 호환)

**증상**: 전산에서 주문 조회 시 Manager 필터에 '관리자' 만 있음 → 웹에서 만든 주문이 안 보임

**원인**: 전산은 Manager 컬럼을 한글 '관리자' 로 만 사용. userId(영문) 들어가면 필터에서 제외.

**해결**: createOrder 에서 `mgr = '관리자'` 고정.

```js
const mgr = '관리자'; // 전산은 Manager='관리자' 기준으로 주문 표시
```

**커밋**: `3d5ff52`, `f13ba13` (uid 시도 후 다시 '관리자' 로), `2ba6c08` (`nenovaSS3` 시도 → 폐기)

**유의**: `LastUpdateID` 도 동일 — 기존 전산 주문은 덮어쓰기 금지 (`24070f9`)

---

### 🔴 #4. OrderWeek 형식 정규화 (`YYYY-WW-SS` → `WW-SS`)

**증상**: 웹에서 16-01 차수 주문 등록했는데 전산에서 검색 안 됨. DB 에 `2026-16-01` 로 저장돼서.

**원인**: 웹 신형식 `YYYY-WW-SS` ≠ 전산 DB 의 `WW-SS`.

**해결**: API 받을 때 `WW-SS` 부분만 추출:

```js
const orderWeek = rawWeek.match(/^\d{4}-(\d{2}-\d{2})$/)
  ? rawWeek.match(/^\d{4}-(\d{2}-\d{2})$/)[1]
  : rawWeek;
```

**커밋**: `09cfb73` (Reapply), `d13bd60` (원본), `098bc7a`

**적용**: `pages/api/orders/index.js`, `pages/api/shipment/distribute.js`

---

### 🟠 #5. LastUpdateID/Dtm 기록 회피 (전산 숨김 트리거 회피)

**증상**: 웹에서 ShipmentMaster 수정하면 전산 화면에서 그 출고 건이 사라짐

**원인**: 전산에는 "최근 수정된 행" 을 별도 표시하는 트리거 또는 필터가 있어서, `LastUpdateID/LastUpdateDtm` 채워진 행을 "외부 수정됨" 으로 분류해 숨김.

**해결**: ShipmentMaster 의 소유권 인수 INSERT/UPDATE 시 `LastUpdateID/Dtm` 기록 **제거** (생략).

**커밋**: `6b8ddf4` (ShipmentMaster), `83efa53` (OrderMaster INSERT, OrderDetail UPDATE)

**유의**: OrderDetail UPDATE 일부에는 `LastUpdateID=@uid, LastUpdateDtm=GETDATE()` 가 살아있음 (`pages/api/orders/index.js:267-273`). 출고/견적과 별개로 주문은 ID 추적이 필요해서 유지. **상황별 구분 필수**.

---

### 🟠 #6. OutQuantity 환산 — 13/14차 단일 공식 유지

**증상**: 출고 분배 후 견적서 또는 재고 화면에서 수량이 0 으로 표시 / 잘못 표시

**원인**: 전산 14차 시점은 `OutQuantity = qty` 단일 저장. OutUnit 별 분기 로직(박스/단/송이) 추가했더니 기존 데이터와 충돌해 Ruscus, 진그린 같은 품목 0 표시.

**해결**: 환산 로직을 13/14차 패턴 유지:
- ShipmentDetail: `Box=qty`, `Bunch=qty*B1B`, `Steam=qty*S1Box` (단일 공식, OutUnit 분기 X)
- OrderDetail OutQuantity: stored value 직접 사용 (CASE WHEN 재계산 X)
- 전산 호환 위해 **OrderDetail INSERT 시 OutQuantity=qty** 무조건 저장

**커밋**: `3163fd7`, `a54887a`, `b63cd0a`, `314ce17`, `36106cd`/`009a6c6` Reapply

**커밋 메모리**: `feedback_conversion_logic.md`, `feedback_rollback_strategy.md`

**금지 사항**: SteamOf1Box=0 fallback 보정 같은 새 로직 추가 금지. master/data 에서 보정. (`81121fa` Revert)

---

### 🟠 #7. OrderMaster 중복 행 처리 (TOP 1 ORDER BY ASC)

**증상**: 같은 거래처/같은 차수에 OrderMaster 여러 행 생성됨 → 주문이 두 군데로 분산

**원인**: 전산이 먼저 만든 OrderMaster 가 있는데 웹이 새로 만들어서 충돌. 전산은 가장 오래된 것을 정본으로 봄.

**해결**: 신규 INSERT 전에 같은 (CustKey, OrderWeek) 의 **가장 오래된 행 재사용**:

```sql
SELECT TOP 1 OrderMasterKey FROM OrderMaster
 WHERE CustKey=@ck AND OrderWeek=@wk AND ISNULL(isDeleted,0)=0
 ORDER BY OrderMasterKey ASC
```

**커밋**: `9168a74`, `9b7b05a`

---

### 🟠 #8. ShipmentMaster 중복 + isFix 표시

**증상**: 출고 확정 안 됨 / 두 번 보임

**원인**: 전산이 먼저 만든 ShipmentMaster 가 있는데 (`isFix=1` 또는 `NULL`) 웹이 또 만듦.

**해결**: ShipmentMaster 결정 시 **`isFix=1` (전산 확정) 우선** → 없으면 가장 오래된 것 재사용. 새로 만들지 않음.

**커밋**: `889f8af`, `368ce78`, `8a30a44`

**관련**: 빈 `OutQuantity=0` ShipmentDetail 은 전산 확정 차단 원인 → 정리 로직 추가 (`pages/api/shipment/stock-status.js:677`)

---

### 🟢 #9. 카테고리(FlowerName) UPDATE 금지 (전산 데이터 보존)

**증상**: 운송기준원가 화면에서 카테고리 수정 → 전산 ERP 화면에서도 카테고리 바뀜 → 전산 운영 혼란

**원인**: 웹과 전산이 같은 `Product.FlowerName` 컬럼을 봄. 웹에서 수정하면 전산에 그대로 반영.

**해결**: **웹 전용 오버라이드 시스템** — `data/category-overrides.json` 파일에 별도 저장. `Product.FlowerName` UPDATE 절대 안 함.

**커밋**: `f6fb4ec` (dangling `4de31a5`/`dbf9c18`/`adef02d` 복구), 위험 엔드포인트 `/api/master/product-category` 도 제거 대상

**관련 파일**:
- `lib/categoryOverrides.js`
- `pages/api/freight/category-override.js`
- `pages/admin/category-overrides.js` (전용 관리 페이지)

---

## 2. 추가 운영 패턴

### 출고일 계산 — 전산 동일 로직 유지

차수 → 출고일 변환은 전산 패턴을 그대로 (월/목/토 매핑):
```js
// 01차→월요일, 02차→목요일(+3), 03차→토요일(+5)
const offsets = [0, 0, 3, 5];
```
**커밋**: `c6d927a`

### 시작재고(negativeStock) — 전산 확정본 기준

`isFix=NULL` (전산 생성) 또는 `isFix=1` (확정) 인 ProductStock 만 시작재고로 인정.

**커밋**: `b5f673b`, `29682e7`, `c78c0d6`

### Amount/Vat 계산 — 13/14차 패턴 (Bunch×Cost/1.1)

전산 견적서/세금계산서 매칭. 새 공식 적용 금지.

**커밋**: `de94d11`, `dc3196a`

### 단가 수정 — 다중 ShipmentKey 단일 트랜잭션

원자성 보장. 동시성 충돌 시 낙관적 락(snapshot 비교).

**커밋**: `ae7e1c5` (낙관적 동시성), `4e2a626` (단일 트랜잭션)

---

## 3. 전산 트리거 동기화

**견적서 비고 줄 수정/삭제** + 전산 측 트리거 SQL 별도 운영.

**커밋**: `5c81fa1`

**트리거 정의 위치**: `docs/migrations/2026-04-17_shipment_detail_trigger.sql` 등

---

## 4. 신규 기능 작성 시 체크리스트

웹에서 OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail 또는 그 자식 테이블에 INSERT/UPDATE 하기 전에:

- [ ] PK 가 IDENTITY 가 아니면 **`tryInsertWithRetry` 또는 `safeNextKey`** 사용
- [ ] `CreateID = 'admin'` 으로 저장 (재고/주문/출고)
- [ ] `Manager = '관리자'` 로 저장 (OrderMaster)
- [ ] `OrderWeek` 입력값에서 `YYYY-` 프리픽스 제거 (`WW-SS` 로 정규화)
- [ ] 전산이 만든 행(`isFix=1`, `LastUpdateID=NULL`) 은 **새로 만들지 말고 재사용**
- [ ] LastUpdateID/Dtm 은 출고 관련 INSERT/UPDATE 에선 **생략**
- [ ] OutQuantity 환산은 13/14차 단일 공식 유지 (OutUnit 분기 X)
- [ ] Product/Customer 마스터 컬럼은 **웹 전용 오버라이드** 가 가능한지 먼저 검토
- [ ] 변경 전 `git diff stable-13-14 -- <파일>` 로 변경점 확인 (롤백 기준점)

---

## 5. 참조

- [docs/DB_STRUCTURE.md](DB_STRUCTURE.md) — 전체 DB 구조 + 트러블 회고 9건
- [docs/migrations/](migrations/) — 마이그레이션 SQL 파일 5건
- 메모리: `memory/feedback_conversion_logic.md`, `memory/feedback_rollback_strategy.md`, `memory/session_2026-04-22.md`
- 백업 태그: `stable-13-14` (`81121fa`), `backup-before-recovery-20260422-1109` (`b6189d0`), `backup-before-rollback-2026-04-21`

---

## 6. 전산 (Nenova.exe) 정적분석 결과 (2026-05-07)

> **방법**: dnSpy 로 `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe` 디컴파일 + UTF-16 문자열 풀 추출.
> **수집물**: SQL 209건, 일반 문자열 1,633건. 결과 파일은 git 외부 (`C:\Users\cando\nenova-erp-ui\nenova-sql.txt` 등).
> **목적**: 웹 작업 시 충돌 회피.

### 6.1 전산이 INSERT/UPDATE/DELETE 하는 테이블 전체

| 테이블 | INS | UPD | DEL | 웹 충돌 위험 |
|---|---|---|---|---|
| OrderMaster | ✓ | ✓ | | 🔴 (붙여넣기 주문등록) |
| OrderDetail | ✓ | ✓ | | 🔴 |
| OrderHistory | ✓ | | | ⚠ audit 이중 |
| ShipmentMaster | ✓ | ✓ | | 🔴 (출고분배) |
| ShipmentDetail | ✓ | ✓ | ✓ | 🔴 |
| ShipmentDate | ✓ | ✓ | ✓ | ⚠ |
| ShipmentFarm | ✓ | ✓ | ✓ | ⚠ (견적서) |
| WarehouseMaster | ✓ | ✓ | | ⚠ |
| WarehouseDetail | ✓ | ✓ | ✓ | ⚠ |
| StockHistory | ✓ | | | 🔴 audit |
| Estimate | ✓ | | ✓ | 🔴 (견적서 관리탭) |
| CustomerProdCost | ✓ | | ✓ | ⚠ |
| Customer / Product / Country / UserInfo | ✓ | | | ⚠ 마스터 |

### 6.2 전산이 의존하는 VIEW (웹은 안 보는 곳)

전산은 정규 테이블이 아닌 **DB VIEW** 기준으로 화면을 구성. 웹이 동일 데이터를 다른 경로로 조회 → 결과 불일치.

| VIEW | 용도 | 웹 사용 | 갭 |
|---|---|---|---|
| **`ViewOrder`** | 주문 통합 | ❌ | OrderMaster/Detail 직조회 — 누락 컬럼 가능 |
| **`ViewShipment`** | 출고 통합. `EstQuantity` / `OutQuantity` / `Amount` / `OrderYearWeek2` 노출 | ❌ | 같음 |
| **`StockList`** | 재고 통합 (잔량 계산 본체) — ProductStock 합산 + 차수별 누적 | ❌ | 다른 DB/스키마 가능. `sp_helptext` 미발견 |
| **`Shipments`** | 출고 단순 별칭 | ❌ | |
| **`dbo.GetCustomWeek`** | 차수 계산 사용자정의 함수 | ❌ | 미발견. 웹은 자체 차수 로직 |

### 6.3 전산만 쓰는 컬럼 (웹이 모르면 데이터 미스매치)

| 컬럼 | 의미 | 웹 위험 |
|---|---|---|
| **`OrderYearWeek`** (`'20261702'`) | 전산의 주 키 (year+week 결합) | OrderYear/OrderWeek 따로 쓰면 인덱스/JOIN 미스 |
| **`OrderYearWeek2`** | 보조 차수키 | 같음 |
| **`EstQuantity`** | 견적 수량 (출고와 별개) | 웹 OrderDetail 작성 시 안 채우면 견적서 계산 깨짐 |
| **`EstUnit`** | 견적 단위 (OutUnit 과 다름) | 웹은 OutUnit 분기만 — `EstUnit` 분기 누락 |
| **`SteamOf1Bunch`** | 단당 송이수 | 웹은 SteamOf1Box / BunchOf1Box 만 사용 |
| **`ProductSort`, `ProductSortLookup`** | 견적서 정렬 순서 | 웹 견적서 정렬과 다를 수 있음 |
| **`AuthorityFormMapping`** | 권한별 폼 매트릭스 | 웹 권한과 별개 |
| **`PeriodDay`** | 차수별 요일 매핑 (출고일 자동) | 893e294 와 연관 |
| **`CodeInfo`** | 코드 마스터 | 웹 미사용 |

### 6.4 전산이 쓰는 잔량 계산 패턴

```sql
;WITH stock AS (
   SELECT sm.OrderYear, ...
   FROM ProductStock ps
   JOIN StockList sl
)
SELECT ...
JOIN      stock ns
LEFT JOIN stock bs   -- 직전 차수 비교
```

→ **`StockList` view 정의가 잔량 공식의 본체**. ProductStock 17-XX 행에 큰 값이 박혀있는 것도 이 view 가 채우는 결과로 추정. view 정의 확보 필요.

### 6.5 즉시 보호해야 할 웹 영역

| 웹 화면 | 위험 | 권장 보강 |
|---|---|---|
| 붙여넣기 주문등록 (`/orders/paste`) | OrderYearWeek 안 채우면 전산 화면 미표시 | INSERT 시 `OrderYearWeek=YYYY+WW-SS` 같이 채우기 |
| 견적서 관리 (`/estimate`) | Estimate + 보조 ShipmentFarm | ShipmentFarm 갱신 정책 검토 |
| 출고분배 (`/shipment/distribute`) | ShipmentMaster/Detail + ProductStock 직접 수정 | `EstQuantity`, `EstUnit` 함께 갱신 |
| 출고확정/취소 (`/shipment/fix`) | 277a0e4 의 `DELETE FROM ProductStock` | StockList view 가 ProductStock 의존 — 삭제 시 전산 잔량 0 |

### 6.6 다음 진단 단계 (DB 권한 필요)

```sql
-- StockList / ViewShipment / ViewOrder 정의 확보
EXEC sp_helptext N'ViewShipment';
EXEC sp_helptext N'ViewOrder';

-- 다른 스키마/DB 에 있을 수 있는 객체 검색
SELECT s.name AS schemaName, o.name, o.type_desc
FROM sys.objects o JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE o.name IN ('StockList','GetCustomWeek','ViewShipment','ViewOrder','Shipments')
   OR o.name LIKE '%Stock%' OR o.name LIKE '%Shipment%';

-- 전체 view/function 카탈로그
SELECT s.name+'.'+o.name AS objName, o.type_desc, o.create_date, o.modify_date
FROM sys.objects o JOIN sys.schemas s ON o.schema_id = s.schema_id
WHERE o.type IN ('V','FN','IF','TF','P')
ORDER BY o.modify_date DESC;
```

이 결과로 view 정의 확보되면 **전산의 잔량 계산 공식 100% 파악** 가능.

### 6.7 추출 산출물 (분석 reference)

git 외부 파일 (PC 로컬):
- `C:\Users\cando\nenova-erp-ui\nenova-sql.txt` — SQL 텍스트 209건
- `C:\Users\cando\nenova-erp-ui\nenova-strings.txt` — 30+ 글자 의미있는 문자열
- `C:\Users\cando\nenova-erp-ui\nenova-strings-all.txt` — 모든 ASCII 문자열 1,633건
- `C:\Users\cando\nenova-erp-ui\extract-strings.py` — 추출 스크립트 (재실행 가능)

---

## 7. 잔량 계산 공식 — 전산의 본체 SP `usp_StockCalculation` (2026-05-07)

### 7.1 SP 시그니처
```sql
EXEC dbo.usp_StockCalculation
     @OrderYear = '2026',
     @OrderWeek = '17-02',
     @ProdKey   = NULL,        -- NULL 또는 0 이면 전 품목
     @iUserID   = 'admin',
     @oResult   OUT,
     @oMessage  OUT;
-- 가드: @OrderYear <= 2025 면 -1 반환 (작년 이전 차수 수정 차단)
```

### 7.2 잔량 공식

```
NewStock(현차수) = PrevStock(전차수 마감 ProductStock.Stock)
                 + SUM(ViewWarehouse.OutQuantity)              -- 현차수 입고
                 - SUM(ViewShipment.OutQuantity, DetailFix=1)  -- 현차수 확정 출고
                 + SUM(StockHistory.AfterValue - BeforeValue)  -- 재고조정 (StockType='재고조정' 등)
```

→ 결과를 `ProductStock` 에 UPDATE (있으면) 또는 INSERT (없으면). **그리고 후속 모든 차수에 cascade 재계산** (커서 루프).

### 7.3 핵심 동작 특성

1. **선택 차수 + 후속 차수 전부 재계산** — `WHERE OrderYearWeek >= @OrderYearWeek` 커서 → 17-2 호출하면 17-2, 18-1, 18-2, ... 모두 재산출
2. **전차수 = `OrderYearWeek < 현차수` ORDER BY DESC TOP 1** — `MasterFix(isFix)` 무관. 즉 미확정 차수도 chain 의 한 노드
3. **신규 ProductStock INSERT 시 isFix 안 채움** (NULL) — 우리가 본 17-02 StockKey 117 Stock=492 가 이렇게 만들어진 것
4. **ViewShipment 필터**: `DetailFix = 1` (출고 라인 단위). 즉 master 가 isFix=0 이라도 detail 이 isFix=1 이면 잔량에 반영

### 7.4 ViewOrder 정의 (전산이 주문으로 보는 것)

```sql
CREATE VIEW dbo.ViewOrder AS
SELECT om.OrderMasterKey, om.OrderYear, om.OrderWeek,
       SUBSTRING(om.OrderWeek,0,3)                 AS OrderWeek2,
       om.OrderYear + SUBSTRING(om.OrderWeek,0,3)  AS OrderYearWeek,
       om.OrderYear + REPLACE(om.OrderWeek,'-','') AS OrderYearWeek2,
       om.OrderDtm,
       ui.UserName                                 AS Manager,    -- ⚠ INNER JOIN UserInfo
       om.CustKey, c.CustName, c.CustArea,
       c.Manager  AS BusinessManager,
       c.Descr    AS CustDescr,
       ct.isUseOrderCode,
       om.OrderCode, om.Descr,
       od.OrderDetailKey, od.ProdKey,
       p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
       od.Descr   AS DetailDescr,
       od.BoxQuantity, od.BunchQuantity, od.SteamQuantity,
       od.OutQuantity, od.EstQuantity, od.NoneOutQuantity
FROM OrderMaster om
JOIN OrderDetail od ON om.OrderMasterKey = od.OrderMasterKey
JOIN Customer    c  ON om.CustKey = c.CustKey AND c.isDeleted = 0
JOIN Product     p  ON od.ProdKey = p.ProdKey AND p.isDeleted = 0
JOIN Country     ct ON p.CounName = ct.CounName        -- ⚠ INNER JOIN Country
JOIN UserInfo    ui ON om.Manager = ui.UserID          -- 🔴 INNER JOIN UserInfo
WHERE om.isDeleted = 0
  AND od.isDeleted = 0   -- ShipmentDetail view 와 달리 isDeleted 필터 있음
```

**🔴 결정적 충돌 포인트** (이미 문서 #5 의 "관리자 화면 숨김" 이슈와 직결):
1. `JOIN UserInfo ui ON om.Manager = ui.UserID` — **웹이 `OrderMaster.Manager` 안 채우면 그 주문은 ViewOrder 에서 사라짐** (전산 화면에서 "주문이 없는 것처럼" 보임). `req.user.userId` 가 UserInfo.UserID 에 존재해야 함.
2. `JOIN Country ct ON p.CounName = ct.CounName` — **Product.CounName 과 Country.CounName 동기 필수**. 새 국가 추가 시 Country 마스터 먼저.
3. `od.isDeleted = 0` 포함 — 웹의 OrderDetail isDeleted 토글이 즉시 ViewOrder 에서 사라짐
4. `NoneOutQuantity` 노출 — **미출고 수량 컬럼**. 웹이 채우지 않으면 전산 견적/잔량 계산이 어긋남
5. `OrderYearWeek` 두 가지 포맷:
   - `OrderYearWeek` = `OrderYear + SUBSTRING(OrderWeek,0,3)` → 예: `'2026' + '17-'` = `'202617-'`
   - `OrderYearWeek2` = `OrderYear + REPLACE(OrderWeek,'-','')` → 예: `'20261702'`
   - 웹이 OrderMaster INSERT 시 OrderYearWeek 안 채우면 인덱스 이용 못함

### 7.5 ViewShipment 정의 (전산이 출고로 보는 것)

```sql
CREATE VIEW dbo.ViewShipment AS
SELECT sm.ShipmentKey, sm.OrderYear, sm.OrderWeek,
       SUBSTRING(sm.OrderWeek,0,3)             AS OrderWeek2,
       sm.OrderYearWeek,
       sm.OrderYear + REPLACE(sm.OrderWeek,'-','') AS OrderYearWeek2,
       sm.isFix                                AS MasterFix,
       sd.ProdKey, p.ProdName, p.ProdCode, p.FlowerName, p.CounName, p.CountryFlower,
       sm.CustKey, c.CustCode, c.CustName, c.CustArea, c.Manager, c.Descr AS CustDescr,
       sd.ShipmentDtm,
       sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity,
       sd.OutQuantity, sd.EstQuantity, sd.EstQuantity2, sd.EstDescr,
       sd.Cost, sd.Amount, sd.Vat, sd.Descr,
       sd.isFix AS DetailFix,
       sd.SdetailKey
FROM ShipmentMaster sm
JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
JOIN Product p         ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
JOIN Customer c        ON sm.CustKey = c.CustKey AND c.isDeleted = 0
WHERE sm.isDeleted = 0
```

**주의**: `sd.isDeleted` 필터 없음! ShipmentDetail 의 isDeleted 는 view 가 무시. 웹은 `sd.isDeleted=0` 조건 빈번하게 추가하는데 view 와 결과가 다를 수 있음.

### 7.6.0 CountryFlower 카테고리 매트릭스 (2026-05-08 기준)

전산 SP `usp_ShipmentFix` / `usp_ShipmentFixCancel` 가 `@CountryFlower` 단위로 작동.
운영 중 활성 카테고리 35종:

| 국가 | 카테고리 | 활성품목 | 비고 |
|---|---|---|---|
| 콜롬비아 | 카네이션 | 297 | 가장 많음 |
| 콜롬비아 | 장미 | 356 | |
| 콜롬비아 | 알스트로 | 82 | |
| 콜롬비아 | 수국 | 40 | |
| 콜롬비아 | 미니카네이션 | 17 | |
| 콜롬비아 | 루스커스/리모니움/아나나스/코쿨루스 | 4/9/1/1 | 소량 |
| 중국 | 기타 | 181 | |
| 중국 | 장미 | 159 | |
| 중국 | 카네이션 | 80 | |
| 중국 | 미니카네이션/유칼립투스/디디스커스/귀리 | 0/0/0/0 | **활성 없음** (DB만 존재) |
| 에콰도르 | 장미 | 77 | |
| 에티오피아 | 장미 | 142 | |
| 일본 | 스위트피 | 61 | |
| 일본 | 샌더소니아 | 3 | |
| 일본 | 기타 | 0 | 활성 없음 |
| 베트남 | 퐁퐁/호접난 | 7/5 | |
| 이스라엘 | 그레비/루스커스/목화/유칼립투스 | 1/1/3/1 | 소량 |
| 미국 | 더글라스/레몬잎 | 2/1 | 소량 |
| 뉴질랜드 | (분류없음) | 43 | |
| 호주 | (분류없음) | 42 | |
| 태국 | (분류없음) | 105 | |
| 네덜란드 | (분류없음) | 1223 | **최다** |
| 국내 | 왁스 | 43 | |
| 국내 | 기타/장미 | 3/1 | 소량 |

**총 35종**. 차수 1개 확정 시 SP 가 카테고리별 N번 호출됨 (네덜란드 + 콜롬비아 카네이션 + 콜롬비아 장미 + ... = 보통 5~15회).

**부분 확정 발생 메커니즘**:
- 카테고리 N개 중 일부는 잔량 마이너스/출고일 불일치로 SP 차단
- 통과한 카테고리만 isFix=1, 차단된 카테고리는 isFix=0
- → 같은 차수 안에 mixed state 발생 (차수피벗에서 ⚠ 부분확정 표시)

### 7.6 ViewWarehouse 정의 (전산이 입고로 보는 것)

```sql
CREATE VIEW dbo.ViewWarehouse AS
SELECT wm.WarehouseKey, wm.UploadDtm, wm.FileName,
       wm.OrderYear, wm.OrderWeek,
       SUBSTRING(wm.OrderWeek,0,3)                  AS OrderWeek2,
       wm.OrderYear + REPLACE(wm.OrderWeek,'-','')  AS OrderYearWeek2,
       wm.FarmName, wm.OrderNo, f.CounKey, wm.InvoiceNo,
       wd.OrderCode, wm.InputDate,
       wd.WdetailKey, wd.ProdKey,
       p.ProdName, p.FlowerName, p.CounName, p.CountryFlower,
       wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity,
       wd.OutQuantity, wd.EstQuantity,
       wd.UPrice, wd.TPrice
FROM WarehouseMaster wm
JOIN WarehouseDetail wd ON wm.WarehouseKey = wd.WarehouseKey
JOIN Product p          ON wd.ProdKey = p.ProdKey         -- ⚠ p.isDeleted 안 봄
LEFT JOIN Farm f        ON wm.FarmName = f.FarmName AND f.isDeleted = 0
WHERE wm.isDeleted = 0                                    -- wd.isDeleted 안 봄
```

**주의 포인트**:
1. `WarehouseDetail.isDeleted` 필터 없음 — 라인 단위 삭제는 view 가 무시. 웹은 `wd.isDeleted=0` 추가하면 결과 다를 수 있음.
2. `Product.isDeleted` 필터 없음 — 삭제된 품목 입고도 표시. ViewOrder/ViewShipment 와 불일치.
3. `Farm` 은 LEFT JOIN — FarmName 매칭 안 돼도 행 유지. CounKey 만 NULL.
4. `OrderYearWeek2` 만 노출 (OrderYearWeek 없음).

### 7.7 신규 발견 보조 객체

| 객체 | 용도 |
|---|---|
| `usp_ShipmentFix` | 출고확정 SP (정의 미확보) |
| `usp_ShipmentFixCancel` | 출고확정 취소 SP (정의 미확보) |
| `UpdateStockHistory` | StockHistory 의 BeforeValue/AfterValue 누적 재계산 (cursor 기반) |
| `ShipmentAdjustment` 테이블 | 출고 조정 이력 (`RemainBefore/After` 등 잔량 변동 추적) |
| `StartStock` 테이블 | 시작재고 기준점 (UQ 제약) |
| `_new_ShipmentDetail/Master/StockHistory` | 마이그레이션 그림자 테이블 (의도/시점 미파악) |
| `ShipmentHistoryTemp` | 출고이력 임시본 |
| `tempstock` | 재고 임시본 |
| `ShipmentDetail_20260429` 등 | 4/29 시점 백업 (사고 직전?) |

## 8. 충돌 정리 + 신규 정책

### 8.1 출고확정 / 잔량 작업은 SP 호출로 통일

지금까지 웹 [fix.js](pages/api/shipment/fix.js) 가 직접 INSERT/UPDATE/DELETE → 전산 cascade 깨짐.

**권장 전환**:
```js
// 잔량 재계산
await query(`EXEC dbo.usp_StockCalculation
              @OrderYear=@yr, @OrderWeek=@wk, @ProdKey=NULL, @iUserID=@uid,
              @oResult=@r OUTPUT, @oMessage=@m OUTPUT`, params);
```

이러면 ProductStock cascade 가 전산과 동일 패턴으로 작동. 직접 ProductStock 만지지 말 것.

### 8.2 web prevStock SQL 도 이 식과 일관되게

웹 [stock-status.js](pages/api/shipment/stock-status.js) 의 prevStock 은 단순 `SELECT TOP 1 ps.Stock ... WHERE OrderWeek < @weekFrom` 인데,
전산 SP 는 `OrderYearWeek` 결합 키로 비교. **일관성 위해 OrderYear+OrderWeek 둘 다 비교 권장** — 차후 fix 대상.

### 8.3 ShipmentAdjustment 추적 활용

데이터 사고 발생 시 가장 먼저 확인:
```sql
SELECT TOP 100 *
FROM ShipmentAdjustment
WHERE ABS(RemainAfter - RemainBefore) >= <threshold>
ORDER BY CreateDtm DESC;
```

`RemainBefore/After` 가 잔량 점프의 직접 흔적.

### 8.4 ViewShipment 와 웹 코드의 isDeleted 차이

전산 ViewShipment 는 `sd.isDeleted` 무시 → 웹이 `sd.isDeleted=0` 추가하면 출고 합계가 다를 수 있음. **JOIN 직접 쓸 때 일관 유지**.

---

## 9. 🔴 결정적 발견 — 두 가지 Stock 시스템이 동시 운용 (2026-05-07)

`usp_ShipmentFixCancel` 분석에서 드러남.

### 9.1 두 테이블 모두 잔량 보유

| 시스템 | 테이블.컬럼 | 의미 | 갱신 |
|---|---|---|---|
| **단일 누적값** | `Product.Stock` | 현재 시점 한 품목 전체 누적 잔량 (단일 값) | `usp_ShipmentFix/Cancel` 가 직접 +/- |
| **차수별 스냅샷** | `ProductStock.Stock` (StockKey별) | 차수 마감 잔량 (차수마다 행) | `usp_StockCalculation` cascade |

### 9.2 `usp_ShipmentFixCancel` 핵심 동작

```sql
-- 1) 확정된 출고 detail 찾기 (DetailFix=1)
SELECT vs.ShipmentKey, vs.ProdKey, vs.SdetailKey, vs.OutQuantity
INTO #ShipmentList FROM ViewShipment vs
WHERE vs.OrderYear=@yr AND vs.OrderWeek=@wk
  AND vs.CountryFlower=@cf AND vs.DetailFix=1;

-- 2) Detail.isFix = 0
-- 3) Master.isFix = 0
-- 4) StockHistory 에 ChangeType='출고', BeforeValue=Product.Stock, AfterValue=Product.Stock+OutQuantity
-- 5) Product.Stock += SUM(OutQuantity)   ← 직접 +
```

→ **확정 취소를 호출할 때마다 `Product.Stock` 이 출고수량만큼 증가**.

### 9.3 웹과의 충돌 메커니즘

웹은 `Product.Stock` 의 존재 자체를 모르고 `ProductStock` 만 수정. 전산은 둘 다 수정. 결과:

- **웹에서 출고확정/취소** → `Product.Stock` 안 바뀜, 전산 화면에서 잘못된 값
- **전산에서 출고확정/취소** → `Product.Stock` 변동, 그러나 웹이 이를 모름
- 사이클 반복 → `Product.Stock` 점진적 누적 차이

### 9.4 1000→3000 점프 의심 메커니즘

5/4 13:53~13:55 nenovaSS1 작업 (메모리에 기록):
- 13:53:40 `usp_ShipmentFixCancel` 호출 → `Product.Stock += SUM(OutQty)` (88품목)
- 13:55:47 `usp_ShipmentFix` 호출 → `Product.Stock -= ?` (검증 필요)

만약 사이에 수량이 변경됐거나, 취소만 여러 번 호출됐다면 `Product.Stock` 영구 누적.

### 9.5 검증 SQL — 즉시 진단 가능

```sql
-- 17-02 카네이션의 Product.Stock 변동 이력
SELECT TOP 100
    sh.ChangeDtm, sh.ChangeID, sh.ChangeType,
    p.ProdKey, p.ProdName,
    sh.BeforeValue, sh.AfterValue,
    (sh.AfterValue - sh.BeforeValue) AS delta,
    sh.Descr
FROM StockHistory sh
JOIN Product p ON sh.ProdKey = p.ProdKey
WHERE sh.OrderYear=2026 AND sh.OrderWeek='17-02'
  AND sh.ChangeType IN (N'출고', N'재고조정', N'확정취소')
  AND p.FlowerName LIKE N'%카네이션%'
ORDER BY sh.ChangeDtm DESC;

-- Product.Stock 의 현재 값 vs ProductStock 17-02 비교
SELECT
    p.ProdKey, p.ProdName,
    p.Stock                                AS productStock_live,
    ISNULL(ps.Stock, 0)                    AS productStock_17_02_snapshot,
    p.Stock - ISNULL(ps.Stock, 0)          AS gap
FROM Product p
LEFT JOIN ProductStock ps
  ON ps.ProdKey = p.ProdKey
  AND ps.StockKey = (SELECT TOP 1 StockKey FROM StockMaster WHERE OrderYear=2026 AND OrderWeek='17-02')
WHERE p.FlowerName LIKE N'%카네이션%'
  AND p.CounName LIKE N'%콜롬비아%'
  AND ABS(p.Stock - ISNULL(ps.Stock, 0)) >= 10
ORDER BY ABS(p.Stock - ISNULL(ps.Stock, 0)) DESC;
```

→ Product.Stock 이 ProductStock 17-02 와 큰 차이 나는 카네이션 = 문제 품목.

### 9.6 정책 권장 (긴급)

1. **웹 [fix.js](pages/api/shipment/fix.js) 의 출고확정/취소 로직 즉시 검토**
   - Product.Stock 갱신 코드 누락 확인
   - `usp_ShipmentFix` / `usp_ShipmentFixCancel` SP 호출로 전환 검토
2. **Product.Stock 의 정확한 값 재계산 SP 작성** — 모든 ShipmentDetail (DetailFix=1) 출고합 + 입고합 재집계
3. **모든 Stock 시스템을 단일 source of truth 로** — 가능하면 ProductStock 만 사용

### 9.7 실측 결과 — Product.Stock 전부 음수 (2026-05-07)

진단 SQL 실행 결과 콜롬비아 카네이션 전 품목이 비정상:

| 품목 | Product.Stock | ProductStock(17-02) |
|---|---|---|
| Doncel | **−376** | +532 |
| Moon Light | **−329.01** | +492 |
| Don pedro | **−334** | +426 |
| Novia | **−219** | +274 |
| Cherrio | **−239** | +234 |
| ... 50+ 품목 동일 | 모두 음수 | 모두 양수 |

**해석**: 두 시스템 부호 정반대.
- Product.Stock 음수 = 출고가 입고+이월보다 누적 우세 (정상 아님)
- ProductStock(17-02) 양수 = 17-02 마감 스냅샷은 정상

가능 원인:
- 입고 SP 부재 또는 실행 누락 (출고만 차감, 입고 미반영)
- usp_ShipmentFix 와 usp_ShipmentFixCancel 호출 비대칭 누적
- 5/4 일제 취소→재확정 사이클의 수량 변경분 누적

→ 사용자가 보고한 "1000→3000 잔량 점프" 의 정확한 출처는 **화면 컬럼 식별 + usp_ShipmentFix 정의** 확보 후 확정. 작업 보류 상태.

---

## 10. usp_ShipmentFix 분석 — 사이클 양방향 식 완성 (2026-05-07)

### 10.1 시그니처

```sql
EXEC dbo.usp_ShipmentFix
     @OrderYear = '2026',
     @OrderWeek = '17-02',
     @CountryFlower = '카네이션',
     @iUserID = 'admin',
     @oResult OUT, @oMessage OUT;
```

### 10.2 핵심 동작 흐름

1. **미확정 출고 수집** — `ViewShipment WHERE DetailFix=0`
2. **잔량 마이너스 검증** ⭐
   ```sql
   WITH stock AS (SELECT ps.ProdKey, ps.Stock, sm.OrderYearWeek
                  FROM StockMaster sm JOIN ProductStock ps ON sm.StockKey=ps.StockKey)
   ...
   WHERE ROUND(ISNULL(ns.Stock,0) - ISNULL(sl.OutQuantity,0), 0) < 0
   -- → 마이너스 나오면 ROLLBACK + '잔량 마이너스 출고 존재' 오류
   ```
   **주의**: stock CTE 에 `isFix` 필터 없음. 모든 ProductStock 봄.
3. **출고일 합산 검증** — `ShipmentDate.ShipmentQuantity` 합과 `OutQuantity` 일치 확인
4. **isFix 설정** — Detail 1, Master 는 미확정 detail 없으면 1 / 있으면 0
5. **StockHistory 기록** — `BeforeValue=p.Stock, AfterValue=p.Stock-OutQuantity, ChangeType='출고'`
6. **Product.Stock -= SUM(OutQuantity)** ← Stock 차감
7. **ShipmentHistory 기록** — 신규/삭제/수정 출고일 이력

### 10.3 Fix vs FixCancel 대칭

| 구분 | usp_ShipmentFix | usp_ShipmentFixCancel |
|---|---|---|
| 대상 | DetailFix=0 (미확정) | DetailFix=1 (확정된 것) |
| isFix | → 1 | → 0 |
| Product.Stock | **-= OutQuantity** | **+= OutQuantity** |
| StockHistory.Descr | '출고확정' | '출고확정 취소' |
| 잔량 검증 | ProductStock 마이너스 차단 | 검증 없음 |
| 출고일 이력 | 기록 | 기록 안 함 |

→ **이론상 정확히 대칭**. 사이클 돌면 Product.Stock = 0 으로 복원되어야 함.

### 10.4 그러나 실측은 전부 음수 — 비대칭 누적 시나리오

| 가설 | 메커니즘 |
|---|---|
| **A** | 출고확정 → 출고수량 증가 변경 (ShipmentDetail.OutQuantity UPDATE) → 재확정 — 이때 변경분만큼 추가 차감 |
| **B** | 같은 ShipmentDetail 이 SP 외부에서 isFix 토글되면서 Product.Stock 갱신 누락 |
| **C** | 웹 [fix.js](pages/api/shipment/fix.js) 가 SP 안 거치고 직접 ShipmentMaster.isFix = 0/1 토글 — Product.Stock 안 건드려서 점진적 차이 누적 |
| **D** | SP 가 한 번 실행 중 오류 → ROLLBACK 후 부분 재실행 |

가설 C 가 가장 유력. 웹 fix.js 가 직접 SQL 만짐 ([memory: 277a0e4 `unfix 트랜잭션화 + ProductStock 정리`]).

### 10.5 종합 — 모든 SP/View/테이블 매트릭스

| 객체 | 종류 | 핵심 부작용 |
|---|---|---|
| **`usp_StockCalculation`** | SP | ProductStock cascade 재계산 (전·후속 차수) |
| **`usp_ShipmentFix`** | SP | Product.Stock -= / isFix=1 / StockHistory / ShipmentHistory |
| **`usp_ShipmentFixCancel`** | SP | Product.Stock += / isFix=0 / StockHistory |
| **`UpdateStockHistory`** | SP | StockHistory.BeforeValue/AfterValue cumulative re-calc (cursor) |
| `ViewOrder` | VIEW | OM/OD/Customer/Product/Country/UserInfo INNER JOIN |
| `ViewShipment` | VIEW | SM/SD/Product/Customer INNER (sd.isDeleted 무시) |
| `ViewWarehouse` | VIEW | WM/WD/Product INNER (wd, p.isDeleted 둘 다 무시) |
| `ShipmentAdjustment` | TABLE | RemainBefore/After 잔량 변동 audit |
| `StartStock` | TABLE | 시작재고 기준 (UQ) |
| `_new_*`, `*_20260429`, `tempstock` | TABLE | 마이그레이션/백업 그림자 |

## 11. 종합 보호 가이드라인 — 신규 웹 작업시 체크리스트

### 11.1 OrderMaster INSERT/UPDATE 시

- [ ] `Manager` 컬럼에 UserInfo.UserID 매칭값 채우기 (없으면 ViewOrder 에서 사라짐)
- [ ] `OrderYearWeek` (= OrderYear + REPLACE(OrderWeek,'-','')) 채우기 → 인덱스 활용
- [ ] `CustKey`/`ProdKey` 가 isDeleted=0 인지 확인
- [ ] Country 마스터에 CounName 존재 확인 (ViewOrder JOIN 차단 방지)

### 11.2 OrderDetail INSERT/UPDATE 시

- [ ] `EstQuantity` 채우기 (전산 견적 계산용)
- [ ] `NoneOutQuantity` 채우기 (미출고수량, 견적/잔량용)
- [ ] `BoxQuantity`, `BunchQuantity`, `SteamQuantity` 모두 환산 채우기 (단일 공식)
- [ ] OutUnit 분기 금지 (이미 메모리 정책)

### 11.3 ShipmentDetail / Master 작업 시

- [ ] `isFix` 토글은 가능하면 SP (`usp_ShipmentFix/Cancel`) 호출
- [ ] 직접 토글 시 `Product.Stock` 갱신 누락 주의
- [ ] `EstQuantity`, `EstQuantity2`, `EstDescr` 채우기
- [ ] ShipmentMaster.OrderYearWeek 채우기
- [ ] StockHistory INSERT 시 BeforeValue/AfterValue/ChangeType 형식 SP 와 일치

### 11.4 ProductStock / StockMaster 작업 시

- [ ] **직접 INSERT/UPDATE 금지** — `usp_StockCalculation` 호출이 정공
- [ ] StockKey = MAX+1 패턴 유지
- [ ] OrderYearWeek 채우기
- [ ] `'17-01B'`, `'470-01'` 같은 형식 오류 데이터 절대 생성 금지 (LIKE '__-__' 만)

### 11.5 견적서 (Estimate) 작업 시

- [ ] ShipmentFarm 보조 테이블 갱신 정책 검토 필요
- [ ] ProductSort/ProductSortLookup 정렬 우선순위 따르기

### 11.6 입고 (WarehouseMaster/Detail) 작업 시

- [ ] OrderYearWeek2 컬럼 채우기 (ViewWarehouse 노출 키)
- [ ] FarmName 이 Farm.FarmName 과 매칭 (LEFT JOIN 이라 없으면 CounKey NULL)

### 11.7 데이터 사고 시 우선 진단 순서

1. `ShipmentAdjustment` 테이블 — `RemainBefore/After` 변동 추적
2. `StockHistory` 의 `ChangeType='출고'/'재고조정'` 행 추적
3. `ShipmentHistory` 의 isFix/OutQuantity 변경 추적
4. Product.Stock vs ProductStock(차수) gap 진단 (섹션 9.5 SQL)
5. ViewShipment vs ShipmentDetail 직접 합산 비교
