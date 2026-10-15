# ViewShipment / ViewOrder — 삭제 거래처·품목 매출 누락 DDL 제안 (실행 안 함)

> 2026-10-15 · 출고→견적서/매출 누락 방지 보호장치 작업 중 정리. **ViewShipment·ViewOrder 는 nenova.exe 와 공유하는 객체이므로 웹에서 바꾸지 않는다.** 아래는 사장님·전산 담당 승인 후 SSMS 에서 검토할 제안일 뿐이다.

## 현재 정의 (운영 DB `OBJECT_DEFINITION` 2026-10-15 조회)

```sql
CREATE VIEW [dbo].[ViewShipment] AS
   SELECT sm.ShipmentKey, sm.OrderYear, sm.OrderWeek,
          SUBSTRING(sm.OrderWeek,0,3) OrderWeek2,
          sm.OrderYearWeek,
          sm.OrderYear + REPLACE(sm.OrderWeek,'-', '') OrderYearWeek2,
          sm.isFix MasterFix, sd.ProdKey, p.ProdName, p.ProdCode, p.FlowerName, p.CounName, p.CountryFlower,
          sm.CustKey, c.CustCode, c.CustName, c.CustArea, c.Manager, c.Descr CustDescr,
          sd.ShipmentDtm, sd.BoxQuantity, sd.BunchQuantity, sd.SteamQuantity, sd.OutQuantity, sd.EstQuantity,
          sd.Cost, sd.Amount, sd.Vat, sd.Descr, sd.EstQuantity2, sd.EstDescr, sd.isFix DetailFix, sd.SdetailKey
     FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
     JOIN Product p  ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0      -- ← 삭제 품목의 확정 출고가 매출에서 사라짐
     JOIN Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0     -- ← 삭제 거래처의 확정 출고가 매출에서 사라짐
    WHERE sm.isDeleted = 0
```

`ViewOrder` 도 같은 조건(`c.isDeleted = 0`, `p.isDeleted = 0`, `om.Manager = ui.UserID` INNER JOIN)이다.

## 영향 (2026-10-15 운영 SELECT, 읽기 전용)

| 항목 | 2026년 | 2025~2026년 |
|---|---|---|
| 삭제 거래처·품목에 걸린 확정 출고(`ShipmentDetail.isFix=1`) | 21줄 / 5,292,463원 | 352줄 / 151,763,738원 |
| 대표 사례 | '신라호텔 발주용 코드' 2026-01-13 삭제 → 1차 8,408,880원 매출 누락, Eucalyptus 다이브 등 품목 | |

## 제안 A — 뷰는 그대로 두고 웹 보호장치로만 재발 방지 (채택, 이번 PR)

- 웹 거래처/품목 삭제(`DELETE /api/master?entity=customers|products&key=`)는 `assertMasterDeletable` 이 확정 출고 건수·차수를 응답하며 거부한다.
- 기존 삭제분은 `GET /api/shipment/estimate-guard-diagnose?view=deletedMasterFixed` / `npm run scan:integrity` G3 로 상시 노출.
- exe 쪽 삭제 버튼은 막을 수 없으므로 전산 담당에게 "확정 출고가 있는 거래처·품목은 삭제 대신 사용중지" 운영 규칙을 공유한다.

## 제안 B — 뷰에서 isDeleted 조건을 제거 (전산 담당 승인 필요, 실행 금지)

```sql
-- 검토용. ViewShipment 를 참조하는 exe 화면(FormEstimateView, FormSalesDefectView, 재고/분배 화면)과
-- 웹 API(lib/exeEstimateViewSql.js 등)의 숫자가 모두 바뀌므로 변경 전후 골든(15·16·36차 총매출) 재측정 필수.
ALTER VIEW [dbo].[ViewShipment] AS
   SELECT ... (동일) ...
     FROM ShipmentMaster sm
     JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
     JOIN Product p  ON sd.ProdKey = p.ProdKey          -- isDeleted 조건 제거
     JOIN Customer c ON sm.CustKey = c.CustKey          -- isDeleted 조건 제거
    WHERE sm.isDeleted = 0
```

- 장점: 삭제된 거래처·품목의 과거 확정 매출이 다시 집계된다(2026년 +5.29M, 2025~2026 +151.8M).
- 위험: exe 화면에서 삭제 거래처·품목이 다시 보이며, 이카운트 재업로드 시 중복 가능. `ViewOrder` 도 함께 바꾸지 않으면 견적서(ViewShipment⋈ViewOrder)에는 여전히 안 나온다.
- 대안: 과거 집계 전용 `ViewShipmentAll` 을 새로 만들고(기존 뷰 불변) 웹 매출 보고서만 그 뷰를 선택적으로 읽는다.

## 제안 C — 삭제 대신 복구

- 확정 출고가 걸린 삭제 거래처/품목은 `isDeleted=0` 복구 후 `UseType`/`Descr` 로 "사용중지" 표기. 전산 담당 판단 영역이며 웹은 실행하지 않는다.
