---
name: 전산(nenova.exe) 호환 불변식 + 견적 누락(OrderYearWeek) 사건
description: 웹이 공유 DB에 쓸 때 반드시 지켜야 전산 화면(주문/분배/견적)에서 안 사라지는 불변식 모음 + 모든 쓰기 버튼 감사
date: 2026-06-04
type: reference
---

# 전산 호환 불변식 (모든 DB 쓰기 버튼이 지켜야 함)

> 위반하면 데이터는 DB에 있어도 **전산 화면(ViewOrder/ViewShipment/견적)에서 통째로 누락**된다.
> 전산 뷰들이 INNER JOIN + raw 컬럼 필터를 쓰기 때문. (dnSpy 추출물로 확인)

| # | 불변식 | 위반 시 증상 | 근거 |
|---|--------|-------------|------|
| 1 | **OrderMaster.Manager = 유효한 `UserInfo.UserID`** (관리자 계정 UserID=`'admin'`, `SELECT UserID FROM UserInfo WHERE UserName=N'관리자'` 로 해석, fallback `'admin'`/`req.user.userId`). 문자열 `'관리자'`(=UserName) 직접 넣기 금지 | ViewOrder 가 `INNER JOIN UserInfo ON om.Manager=ui.UserID` → 탈락 → 전산 주문/분배 grid/견적에서 거래처·품목 누락 | [[ordermaster-manager-must-be-userid]] |
| 2 | **raw `OrderYearWeek` = `OrderYear + 대차수`** (`orderWeek.split('-')[0]`). 예 23-01 → `'202623'`. full(`replace('-','')` = `'20262301'`) 금지 | 견적서관리(GetData/GetDetail)가 raw `sm.OrderYearWeek` 로 필터 → 웹 full 포맷이면 그 차수 조회 시 누락 (확정해도 견적에 안 뜸) | [[ordermaster-orderyearweek-major-not-full]] |
| 3 | **ShipmentDetail.CustKey = ShipmentMaster.CustKey** (강제 일치, ISNULL-only 갱신 금지) | sd.CustKey 가 0/다른값이면 전산 분배/확정 로직에서 누락. (단 ViewShipment 표시는 sm.CustKey 기준) | distribute-diagnose repairMissingCustKey |
| 4 | **ShipmentDetail.ShipmentDtm = 업체 BaseOutDay 기준 출고일**(weekToShipDateByBaseOutDay), **ShipmentDate 도 같은 날짜로 재생성**, PeriodDay.BaseYmd 와 **정확(시각 포함) 매칭** 가능해야 | 견적 GetData/GetDetail 이 `ShipmentDtm = pd.BaseYmd` INNER JOIN. 6일 밀림/시각 불일치면 누락. 분배 화면(출고일 그룹핑)도 어긋남 | SHIPMENT_IMPORT_DATE_BASE_OUTDAY_FIX |
| 5 | **ShipmentDetail 환산필드 전부**: OutQuantity/EstQuantity/BoxQuantity/BunchQuantity/SteamQuantity. **EstQuantity=OutQuantity 강제 금지**(단/송이 환산 품목은 다름) | 견적 금액 깨짐, "출고수량≠출고일지정수량" 오류 | 루트 CLAUDE.md 규칙 2 |
| 6 | **ShipmentMaster 재사용**: `WHERE CustKey+OrderWeek+isDeleted=0 ORDER BY isFix DESC, ShipmentKey ASC`. 새로 만들지 말고 재사용. WebCreated=1 | 중복 마스터 / 확정 안 됨 / 두 번 보임 | WEB_VS_ERP_CONFLICTS #8 |
| 7 | **isDeleted**: `ShipmentDetail` 엔 컬럼 **없음**(`sd.isDeleted` 쿼리 시 SQL 500). ShipmentMaster/Product/Customer/OrderMaster/OrderDetail 엔 있음 → 필터 필수 | sd.isDeleted 쿼리 시 500; isDeleted 필터 누락 시 고스트 포함 | [[shipmentdetail-no-isdeleted-column]] |
| 8 | **PK 생성 = `safeNextKey` + `tryInsertWithRetry`** (IDENTITY 아님, 전산 race) | PK 충돌 | 루트 CLAUDE.md 규칙 4 |
| 9 | **전산 구조 = 1 `ShipmentDetail` + N `ShipmentDate`**. 출고일별 `ShipmentDate.EstQuantity` = `distributeUnits(ShipmentQuantity)` (usp_DistributeOne 동일). Detail 총량을 각 날짜에 복제·비율배분 금지. `ShipmentDetail` 을 출고일마다 쪼개기(split) 금지 | 목요일 견적 5700송이, 전산/웹 불일치 | `lib/syncShipmentDateEst.js`, `lib/distributeUnits.js` |

## 진단/보정 도구 — `/admin/distribute-repair`
- 차수 진단(출고일 6일밀림/CustKey/중복마스터/출고일·수량/Est/키넘버링) + 출고일·CustKey 보정
- **① Manager 정정** (불변식 1)
- **주문 vs 분배 대조** (품목/업체) — ViewOrder 탈락/분배 상태
- **견적서관리 노출 진단** + **🔧 OrderYearWeek 진단/보정** (불변식 2) + **21·22·23차 비교**
- 고스트 ShipmentMaster 정리

---

# 사건: 23-01 베트남 호접난이 확정 후 견적서관리에 안 뜸 (2026-06-04)

## 증상
nenova.exe 에서 23-01 베트남 호접난(ORCHID VIETNAM) 출고분배+확정했는데 **견적서관리에 안 나타남**. 21·22차 동일 품목은 정상.

## 원인 규명 과정 (여러 가설 → 실측)
1. (오진) 국가 '베트남' 미등록 → Country 에 있음(O). 아님.
2. (오진) 출고일 시각 불일치(웹 정오 vs PeriodDay 자정) → 정확매칭 통과(O). 아님.
3. (오진) ViewShipment/ViewOrder 탈락 → 개별조건·실제 조인 모두 통과(O). 아님.
4. **(정답)** 21·22차(전산) vs 23차(웹) 비교 → **raw `OrderYearWeek` 포맷 차이**:
   - 전산: `202621`/`202622` (연도+**대차수**)
   - 웹: `20262301` (연도+**세부차수전체**) ❌
   - 견적 GetData/GetDetail 은 raw `sm.OrderYearWeek` 로 필터 → "23차"(=`202623`) 조회 시 웹의 `20262301` 누락.
   - (뷰의 `OrderYearWeek2` = full 은 별개. 그래서 OrderYearWeek2 로 맞춘 조인 진단이 "통과"로 오진)

## 교훈 (진단 도구 설계)
- 손으로 복제한 조건(OrderYearWeek2/개별 JOIN)이 실제와 다를 수 있음 → **실제 전산 뷰/원본 컬럼을 직접 조회**해야 정확.
- raw 컬럼 vs 뷰 계산 컬럼을 구분할 것 (OrderYearWeek raw=대차수, OrderYearWeek2 view=full).

## 수정
- 코드: adjust/distribute/orders 의 `ywk = orderYear + orderWeek.split('-')[0]` (커밋 `108790f`).
- pivotStats: ShipmentMaster 범위쿼리 raw→`yearWeekExpr`(계산식)로 (포맷 무관).
- 데이터: `/admin/distribute-repair` → 🔧 OrderYearWeek 진단/보정 (`POST /api/shipment/fix-orderyearweek`). OrderMaster 엔 컬럼 없을 수 있어 columnExists 가드(`782c3d9`).

## 부수 발견
- `OrderMaster` 에는 `OrderYearWeek` 컬럼이 **없는 환경**이 있음 (orders 코드가 columnExists 로 가드). ShipmentMaster 엔 있음.

---

# 전수 감사 (모든 DB 쓰기 버튼) — 2026-06-04 완료

전산 테이블(OrderMaster/ShipmentMaster/ShipmentDetail/ShipmentDate/OrderDetail) 쓰는 11개 파일 전수 감사.

## 발견·수정한 위반 (커밋 `a8f643b`)

### 불변식 2 (OrderYearWeek = 대차수) — 7개 파일 위반 → 전부 수정
`week.replace('-','')`(full '20262301') → `week.split('-')[0]`(대차수 '202623'):
- `pages/api/shipment/adjust.js:448` (OrderMaster 분기 — ShipmentMaster 분기는 이미 정상이었음)
- `lib/shipmentImport.js:897, 1195, 1508`
- `pages/api/shipment/stock-status.js:1156, 1438, 1655`
- `pages/api/public/shipments.js:210`
- `pages/api/public/orders.js:241` (이전 커밋에서 처리)
- `pages/api/m/order-request-approve.js:70`
- (이미 정상: `pages/api/orders/index.js`, `adjust.js` ShipmentMaster, `distribute.js`)

### 불변식 1 (Manager = UserInfo.UserID) — 3개 파일 위반 → 수정
- `lib/shipmentImport.js:877` `'관리자'` 리터럴 → `SELECT UserID FROM UserInfo WHERE UserName=N'관리자'` 해석(fallback 'admin')
- `pages/api/public/orders.js` (외부 입력 manager 무검증) → INSERT 에서 `COALESCE((SELECT UserID WHERE UserID=@manager),(SELECT UserID WHERE UserName='관리자'),'admin')` 검증
- `pages/api/m/order-request-approve.js` (req.user.userId 무검증) → 동일 COALESCE 검증

### 불변식 6 (ShipmentMaster 재사용 정렬) — 1개 수정
- `pages/api/public/shipments.js:197` `TOP 1 ... ORDER BY ISNULL(isFix,0) DESC, ShipmentKey ASC` 추가

## 준수 확인 (위반 없음)
- 불변식 3(CustKey=Master): adjust(CustKey=@ck 강제), distribute/shipmentImport/stock-status/public 모두 INSERT 시 @ck. ✓
- 불변식 4(ShipmentDtm BaseOutDay + ShipmentDate 재생성): adjust(@dt 강제+ShipmentDate 재생성), distribute(삭제+재생성), shipmentImport/stock-status(calcShipDate BaseOutDay+정오). ✓
- 불변식 5(환산필드 5종, Est≠Out): 모든 분배 경로 Out/Est/Box/Bunch/Steam 작성, Est=estimateQuantityFromUnits(별도). ✓
- 불변식 7(sd.isDeleted 없음): 전 파일에서 `sd.isDeleted` 참조 0건 확인. ✓
- 불변식 8(safeNextKey+tryInsertWithRetry): 전 PK 생성 준수. ✓

## 별도 검토 대상 — 검증 완료 (2026-06-04, 커밋 후속)
- ✅ **update-cost EstQuantity fallback (불변식 5)** — **위반 아님(과탐지)**. `EstQuantity=ISNULL(NULLIF(sdt.EstQuantity,0), NULLIF(sd.EstQuantity,0), sdt.ShipmentQuantity)` 는 **기존 EstQuantity 가 있으면 보존**하고, 둘 다 0인 (EstQuantity 미설정) 행에서만 ShipmentQuantity 폴백. 정상 분배행은 sd.EstQuantity 가 채워져 Out 강제 안 됨. → 변경 없음.
- ✅ **update-cost ShipmentDetail.Descr 단가로그 누적** — **수정**. 분배 비고(ShipmentDetail.Descr)는 "담당자+수량변경 최신2"(lib/shipmentDescr) 전용. 단가로그 append 제거(Estimate.Descr + changes[] 에 남음). 분배 비고 오염/무한증가 차단.
- ✅ **orders updateOrder Manager 무검증 (불변식 1)** — **수정**. `Manager = COALESCE((SELECT UserID WHERE UserID=@mgr OR UserName=@mgr),(SELECT UserID WHERE UserName='관리자'),'admin')` 로 유효 UserID 해석.
- ⏸ **Estimate.Descr 무한 append** (update-cost:186, update-quantity:110) — 견적 record 메모(견적서 표시 가능)라 임의 절삭 위험. 분배 비고와 무관하므로 **보존**(추후 길이 cap 검토).
- ⏸ **pivotStats.js:90** StockMaster raw OrderYearWeek `< @yws`(full) — StockMaster 포맷 의존 경계이슈(기존, 별개). 추후.
