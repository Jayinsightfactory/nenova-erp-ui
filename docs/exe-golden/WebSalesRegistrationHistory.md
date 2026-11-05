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

## 2026-11-05 차이 중심 조회 증거
로컬 실제 dnSpy.Console.exe --no-color -t FormShipmentDistribution 재추출(exit0).
btnShowHistory_Click(1318~1348행): ShipmentHistory→ShipmentDetail→ShipmentMaster,
Customer는 Master.CustKey, UserInfo는 ChangeID=UserID로 JOIN. OrderYear+OrderWeek를 함께 제한.
btnSave_Click는 ClassShipmentDetail 저장을 사용. ClassShipmentHistory 타입은 존재하지 않아
CLI usage 출력 후 실제 Form의 SQL로 확인했다. 원본은 ignored output/sales-history.

운영 SELECT-only probe: 2026/44-02/CustKey680/ProdKey3074/SdetailKey101882,
DetailFix=1, ViewOrder1/ShipmentDate1/ShipmentFarm0/ShipmentHistory1행.
44차 snapshot: TUE_FINAL3/WED_CHECK3/TUE_CLOSE4/CLOSE_CHECK4, REG_CONFIRM0.
실제 ShipmentHistory 10열 확인: ShipHistoryKey/ChangeDtm/ChangeID/ChangeType/
ShipmentDtm/BeforeValue/AfterValue/Descr/SdetailKey. ColumName은 없음.
판매등록 확정본이 없어 화요일 fallback을 이카운트 실조회값으로 표시하면 안 된다.

### 기준 원장 및 부작용 표
| 동작 | Order* | ShipmentDetail/Master/Date/Farm | Estimate | WebProfitReport | WebSales* |
|---|---|---|---|---|---|
| 차이 업체 조회 | 보존 | 읽기/보존 | 읽기/보존 | 보존 | 읽기 |
| 업체 펼침·더 보기 | 보존 | 이력 읽기/보존 | 스냅샷만 읽기 | 보존 | 읽기 |
| 기준 관리(기존 기능) | 보존 | 보존 | 보존 | 보존 | 기존 확정 기능만 |

### 최종 표시 기준 ledger (앞선 임시 스냅샷 비교 설계 대체)
- 기본 화면 비교기준: 수집된 WebEcountRow Dataset=sales, 해당 판매일의 최신 SnapshotKey.
  원본 없음/RED이면 비교 대기, TUE_FINAL/REG_CONFIRM으로 대체하지 않는다.
- 판매일: 공용 orderWeekToDateRange(year,major,2).end(다음 화요일). 대차수만 지원,
  세부차수 입력은 명시적으로 거절. 연말·연초도 공용 달력으로 계산한다.
- 원본 수집시각 WebEcountSnapshot.TakenAt은 KST로 표시, 수집 이후 이카운트 수정은 다음 수집까지 미반영.
- 매출 수량/단가/공급가/VAT/합계 필수 수치검사 및 합계 항등식 검산. RED 차단/YELLOW 주의.
- 업체별 총액차0이어도 품목별 수량/단가/공급가/VAT 불일치0.001 초과면 표시.
- 전산 범위: 기존 captureCurrentRows, 선택 OrderYear+전체 subweeks. 정상출고/Estimate 포함.
- 단가: ECOUNT unitPrice와 실제 Cost(VAT포함). Amount/EstQuantity 역산 금지.
  복수 단가는 모두 표시하고 가격 집합도 비교. 견적수량 EstQuantity/차감 Quantity, 유효0 보존.
- 이름 매칭은 기존 ecount/week-compare.js의 명시 별칭/공백·괄호 정규화 기준.
  같은 고객명에 여러 CustKey가 있으면 자동연결하지 않고 매칭 확인 필요로 분리.
- 타임라인: 세부차수별 TUE_FINAL.takenAt 초과, 판매등록 비교기준과 독립.
  since는 SQL 원문 NVARCHAR→CONVERT(datetime,120)으로 비교해 Node 로컬 timezone 영향 배제.
- 수정자: UserInfo.UserName, 없으면 원본 ChangeID, 없으면 기록없음. 공유계정을 개인으로 추정 금지.
- 관측 이력: 연속 스냅샷 diff 및 현재값. 관측시각과 실제 수정시각을 구분,
  scheduler Actor를 수정자로 사용 금지. 상세 삭제/단가 변경 추적 공백을 명시.
- 조회만 변경. 이카운트 접속/등록/수정 API 호출0, 공유 ERP 원장 쓰기0.

최종 구현 실제 SELECT-only probe(2026-11-05): ECOUNT 판매 수집범위 2026/01/06~10/27.
44차 판매일11/03 원본없음→비교대기/고객0, 43차10/27 GREEN 원본→불일치업체13/품목199.
업체 타임라인 native89/스냅샷관측95, 다음 페이지없음(시점에 따라 변동).
원본 개인정보/업체명 로그 저장 없이 집계만 확인. 41개 SELECT, DDL/ERP/ECOUNT쓰기0.
견적 downstream 실제 ViewShipment+ViewOrder+ShipmentDate+PeriodDay/DetailFix=1 조인44차1382행.
현재 원장/확정매출/Estimate/WebProfitReport 수정 없음. 이는 읽기 결과의 확인이며 원장 보정이 아니다.

시간 검증 정정: 실제 SELECT DATEDIFF(minute,GETUTCDATE(),GETDATE())=540.
DB의 GETDATE/TakenAt/ChangeDtm은 이미 KST이다. DATEADD(+9) 금지, CONVERT(varchar(19),...,120) 원문 표시.
기존 ecount/week-compare의 Date 객체 +9 변환을 이번 화면의 근거로 사용하지 않는다.
