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
