# 판매등록 히스토리 — 웹 전용 확정 스냅샷 (dnSpy)

Web: `pages/sales/registration-history.js` + `pages/api/sales/registration-history.js` + `lib/salesSnapshot.js`

## EXE 범위

`nenova.exe`에는 판매등록 히스토리 화면과 `REG_CONFIRM` 스냅샷 Form이 없다.
관련 매출 조회는 `FormSalesView`이며, 이 웹 화면의 확정·변경비교와 저장 순서가 같지 않다.

확인(읽기 전용):
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\`
- `dnSpy.Console.exe --no-color -t FormSalesView`
- `dnSpy.Console.exe --no-color -t FormShipmentDistribution`

판매등록 확정본은 웹만 `WebSalesSnapshot(SnapshotType=REG_CONFIRM)`에 INSERT한다.
전산 프로그램은 이 테이블을 모른다.

## 읽기 원장

캡처 SQL(`captureCurrentRows`)은 선택 `OrderYear + OrderWeek`의
`ShipmentMaster` + `ShipmentDetail`(OutQuantity≠0)과 같은 마스터에 붙은 `Estimate`만 읽는다.
변경 로그는 `ShipmentHistory`를 확정 `TakenAt` 이후만 읽는다.

교차연도: 같은 `33-01`이라도 2025와 2026을 한 스냅샷에 섞지 않는다.
`salesCaptureYearPredicateSql()`가 `sm.OrderYear=@yr` (또는 빈 OrderYear일 때 `OrderYearWeek` 앞 4자리)를 강제한다.

## 쓰기 범위

| 동작 | Order* | Shipment* | Estimate | ShipmentDate | WebProfitReport | WebSales* |
|------|--------|-----------|----------|--------------|-----------------|-----------|
| 조회 | preserve | read | read | preserve | preserve | read |
| 판매등록확정 | preserve | read capture | read capture | preserve | preserve | INSERT snapshot+rows+baseline |
| 확정 이후 비교 | preserve | read | read | preserve | preserve | read |
| 최신화(CHANGE) | preserve | read | read | preserve | preserve | INSERT CHANGE snapshot |

스냅샷 행은 INSERT 전용이다. 기존 `TUE_FINAL`/`WED_CHECK`/`TUE_CLOSE`/`CLOSE_CHECK`는 덮어쓰지 않는다.
`REG_CONFIRM`은 재확정 가능하며 최신 `SnapshotKey`가 비교 기준이 된다.

## 업무 키

`OrderYear + OrderWeek + CustKey + ProdKey`.
조회 GET·확정 POST 모두 화면의 `year`를 payload에 전달한다.
`OrderWeek`만으로 Master를 집계하지 않는다.
