# 주광 ERP 저장 달력 시각 오차단 수정

## 요구·근거

2026/40-01 주광농원 Hydrangea Blue의 10/4 20→15박스, 10/1 0→5박스
날짜 이동이 CALENDAR_TIMESTAMP_MISMATCH로 저장 전 차단된다.
운영 SELECT에서 PeriodDay.BaseYmd는 **nvarchar**, ShipmentDate.ShipmentDtm은
datetime이다. 직접 문자열 변환하면 각각 `2026-10-04`와
`2026-10-04 00:00:00.000`이지만 EXE의 정확한 SQL JOIN은 정상이다.

실제 dnSpy CLI ClassShipmentDate.Insert는 ToShortDateString으로 날짜를 저장한다.
저장된 FormEstimateView.GetDetail/GetPrintDetail은
`sdd.ShipmentDtm = pd.BaseYmd`의 datetime 암묵변환 JOIN을 사용한다.

## 기준 원천·소비자

| 기준 | 원천 | 소비자·정책 |
|---|---|---|
| 달력 시각 | 실제 PeriodDay.BaseYmd | 저장 트랜잭션 readCalendar에서 datetime 명시변환 후 style121 직렬화 |
| 기존 출고 시각 | ShipmentDate.ShipmentDtm | 동일 style121, 시각 포함 정확 비교 유지 |
| 업무주 | 선택 연도+대차수의 유일 목요일 anchor | 기존 7일 범위, 연도·세부차수·업체·품목 잠금 보존 |
| 새 날짜 | 검증된 PeriodDay 시각 | 기존 finalDates→ShipmentDate/History 저장 그대로 사용 |
| 변경 방향·합계·단가·확정·재고 | 기존 weekday 저장 코어 | 변경 금지; 20→15+5의 총량 유지 검증 |

날짜만 자르거나 JS 시간대 변환으로 불일치를 숨기지 않는다. 서로 다른 시각,
누락/중복 달력, 업무주 밖 날짜는 계속 차단한다. 새 기본값이나 fallback 없음.

## 부작용·downstream

| 사용자 동작 | Order/Shipment/Farm/Stock/Estimate/WebProfitReport/최초기준 |
|---|---|
| 이번 진단·운영 확인 | SELECT only, 전부 보존 |
| 달력 읽기 비교 수정 | SELECT 표현식만 수정, DB/스키마/SP 변경 없음 |
| 사용자의 명시 ERP 저장 | 기존 weekday-distribution-apply 계약 그대로; 같은 트랜잭션·감사·확정 유지 |

실제 운영 고객 수량을 테스트로 저장하지 않는다. 운영 표본은 2026/40-01/533/866,
SdetailKey93742/SdateKey124386, 분배20박스, Amount1363636/Vat136364/isFix1,
ViewOrder1/ViewShipment1/PeriodDay WeekDay1/ShipmentFarm0이다.

후속 SELECT-only 공통 calendar helper 재검증에서 날짜 두 개 모두 자정 형식으로
일치했다. 저장 분배20/Amount/Vat는 동일하나 당시 DetailFix는0으로 관찰됐다.
다른 작업의 확정상태를 원복하거나 저장하지 않았다. 해당 시점 견적 확정 노출은0이며,
정상 exact 날짜 JOIN과 견적 확정 상태는 별도 조건으로 보고한다.

## 수용 기준

- nvarchar BaseYmd 날짜만 있는 실제 형식의 positive 실행 fixture가 통과한다.
- 실제 SQL datetime/nvarchar 형식에서 20→15+5 날짜 이동과 정확 JOIN을 검증한다.
- 실제 다른 시각, 중복/누락/업무주 밖 달력은 오류 유지, 실패 전체 롤백.
- 이전 연도 동일 차수 sentinel·주문·최초기준·다른 품목·단가·확정 상태 보존.
- ERP 전체 회귀, 격리 MSSQL 두 harness, manifest/write guard, dnSpy 근거, 빌드 통과.
- 고성능 독립 검토 후 PR/병합/Cafe24 성공 및 1920×1080 운영 read-only 확인.

## 하위 작업

구현은 범위 확정 중간 모델 등급의 사용 가능 gpt-6.1-sol/high,
최종 검토는 gpt-6-astra/high. 운영 읽기·외부 쓰기는 메인만 수행한다.
