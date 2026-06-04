---
name: 출고분배 거래처 누락 / 분배 안 보임 / 취소 차단 종합 수정
description: 웹 주문·분배가 nenova.exe 출고분배 화면에 안 뜨는 문제의 dnSpy 기반 근본원인 규명과 수정·진단도구
date: 2026-06-04
type: incident
---

# 출고분배 가시성 종합 수정 (2026-06-04)

## 증상 (사용자 보고)
1. 붙여넣기 주문등록에서 **일괄 등록+분배**까지 했는데 nenova.exe **출고분배 화면**에서 분배가 확인 안 됨.
2. 주문 취소 시 "이미 분배되어 있어 취소 불가"인데 정작 전산 분배 화면엔 안 보임.
3. 23-01 차에 주문된 거래처(예: **아이엠 / 카네이션 문라이트**, **수아레 / 수국 라벤더**)가 전산 **출고분배 "거래처 분배 정보" grid 에 아예 안 떠서 분배 입력 불가**.

## 근본 원인 (dnSpy `nenova.exe` 추출물 + 실데이터로 확정)
nenova.exe 출고분배 grid 는 **`ViewOrder`** 를 원천으로 거래처/품목을 만든다. `ViewOrder` 는 4개 INNER JOIN 으로 주문 라인을 거른다:

```
JOIN Customer c  ON om.CustKey = c.CustKey AND c.isDeleted = 0
JOIN Product  p  ON od.ProdKey = p.ProdKey AND p.isDeleted = 0
JOIN Country  ct ON p.CounName = ct.CounName            -- CounName 이 Country 에 있어야
JOIN UserInfo ui ON om.Manager = ui.UserID              -- 🔴 Manager 가 UserID 여야
```

**핵심: 웹이 `OrderMaster.Manager` 에 문자열 `'관리자'`(=UserName)를 넣었다.** 여기엔 `UserInfo.UserID`(관리자 계정은 **`'admin'`**)가 들어가야 한다. `'관리자'` 는 UserID 가 아니므로 `INNER JOIN UserInfo` 에서 그 주문이 **ViewOrder 에서 통째로 탈락** → 전산 출고분배 grid 에 거래처가 안 뜸 → 분배 입력 불가.

- 다른 거래처가 멀쩡한 이유: 전산에서 **확정(isFix)** 하면 nenova.exe 가 Manager 를 올바른 UserID 로 덮어쓴다. **웹으로만 만든 미확정 주문**(아이엠/수아레)만 `'관리자'` 로 남아 깨졌다.
- `CreateID` 는 `'admin'` 으로 올바르게 넣고 있었음(전산 호환). **Manager 만** 틀렸다.

## 수정
### 재발 방지 (코드)
- `pages/api/orders/index.js`, `pages/api/shipment/adjust.js`: `OrderMaster.Manager` 를
  `SELECT TOP 1 UserID FROM UserInfo WHERE UserName=N'관리자'` (fallback `'admin'`) 로 **해석해 저장**.
  - 커밋 `e348379`.

### 기존 깨진 주문 정정 (데이터)
- `POST /api/shipment/order-manager-fix { week, action:'fix' }` — 해당 차수에서 `Manager ∉ UserInfo.UserID`
  인 OrderMaster 를 유효 관리자 UserID 로 UPDATE.
- 관리 페이지 `/admin/distribute-repair` → **"① Manager 정정"** 버튼.

## 부수적으로 확인/수정한 것
- **출고일(ShipmentDtm) 강제 정정**: adjust UPDATE 분기가 `ISNULL(ShipmentDtm,@dt)` 로 기존 틀린 출고일을
  유지하던 것을 `@dt`(업체 BaseOutDay 기준)로 강제 → 분배가 다른 출고일에 박혀 안 보이던 문제 예방. 커밋 `0408f06`.
- **ShipmentDetail.CustKey 강제 일치**: adjust UPDATE 가 `CustKey=ISNULL(CustKey,@ck)` → `CustKey=@ck`. 커밋 `de197d0`.
- **비고(ShipmentDetail.Descr) 최신 2건만**: 담당자+수량변경 형식, 무한 누적 방지. 커밋 `b3f1688` 계열.
- **일괄분배 미매칭 경고**: 매칭 안 된 품목이 조용히 빠지던 것을 확인창에 경고. 커밋 `3c62951`.

## 새 진단/보정 도구 — `/admin/distribute-repair`
| 기능 | API | 비고 |
|---|---|---|
| 차수 진단(출고일 6일밀림/CustKey/중복마스터/출고일·수량/Est/키넘버링) | `GET /api/shipment/distribute-diagnose` | 읽기 |
| 출고일 보정 / CustKey 보정 | `POST distribute-diagnose {action}` | 쓰기 |
| **주문 vs 분배 대조**(품목/업체 검색) — 상태/사유 표시 | `GET /api/shipment/item-trace` | 읽기 |
| **Manager 정정**(전산주문숨김 복구) | `GET/POST /api/shipment/order-manager-fix` | 읽기/쓰기 |
| 고스트 ShipmentMaster 정리(취소 차단) | `POST /api/shipment/ghost-master-cleanup` | 쓰기(확정X+표시분배0 재검증) |

### `item-trace` 상태값 의미
- **전산주문숨김** = ViewOrder 탈락(Manager/CounName/업체삭제/품목삭제) → 분배 grid 에 거래처 안 뜸 (**최우선 수정 대상**).
- **농장미배정** = ShipmentFarm 행 없음(웹 미작성). 거래처/수량은 전산에 정상 표시되고 **농장별 배정만 비어있음**.
- ShipmentDate없음/불일치, 분배없음, CustKey불일치, 정상.

## 알아둘 전산 구조 (dnSpy 확정)
- **`ViewShipment`**: `sm.isDeleted=0 AND p.isDeleted=0 AND c.isDeleted=0` 만 표시, **`sd.isDeleted` 는 무시(컬럼 자체가 ShipmentDetail 에 없음)**.
- **주문 취소 게이트**(`FormOrderAdd`): `SELECT COUNT(*) FROM ShipmentMaster WHERE OrderYear+OrderWeek+CustKey` (**isDeleted 무시**) → 빈/숨겨진 고스트 마스터가 취소를 막음.
- **분배 grid 거래처 목록**(`GetCustomerList`): `ViewOrder ⨝ (ViewShipment ⨝ ShipmentDate)` 후 출고일(weekday) 그룹핑.
- **농장별 분배**: `ViewShipment ⨝ ShipmentFarm`. 저장은 ShipmentDetail+**ShipmentFarm**+ShipmentDate 동시(웹은 ShipmentFarm 미작성 — 향후 과제).

## 문서 정정 사항
- `docs/DB_STRUCTURE.md` 의 "ShipmentDetail.isDeleted" 는 **오기**. 실제 원본 테이블엔 isDeleted 없음(쿼리 시 SQL 500).
- 루트 `CLAUDE.md` 의 "전산은 Manager='관리자' 기준" 설명은 부정확 — **Manager 는 UserID('admin')** 여야 함.

## 향후 과제
- 웹 분배가 **ShipmentFarm** 도 작성하도록(농장별 배정) — nenova.exe btnSave 와 동일 구조. ShipmentFarm 스키마/배정 규칙 dnSpy 추가 확인 후 적용.
