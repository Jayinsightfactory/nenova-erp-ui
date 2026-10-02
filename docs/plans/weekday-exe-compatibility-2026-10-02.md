# 주광 요일 저장·인쇄 EXE 호환 보완

## 목적과 근거

요일 셀 편집은 초안이며 명시 ERP 저장만 원장을 변경한다. 사용자의 요청에 따라
기존 분배는 ERP 상세 확정 후에만 저장하고, 인쇄는 메인차수 전체 확정 뒤에만 허용한다.
이는 EXE 자체의 전역 검사가 아니라 웹의 추가 안전 정책이다.

설치 EXE를 dnSpy.Console로 다시 읽은 FormShipmentDistribution.btnSave_Click은
day1(일)부터 day7(토) 순으로 양수 날짜마다 ShipmentDetail.ShipmentDtm을 갱신한다.
따라서 최종 대표 출고일은 날짜 오름차순의 마지막이 아니라 양수 날짜 중 가장 큰
PeriodDay.WeekDay의 정확한 시각이다. SetButton은 rank=A 확정 상태에서 저장을 끄고,
요일 저장 분기 자체에는 확정 필수 검사가 없다. 이 차이를 숨기지 않는다.
FormEstimateView.GetPrintDetail은 DetailFix=1, ViewOrder와 정확한 PeriodDay 연결로
양수 견적을 필터링하며 메인차수 전체 확정을 확인하지 않는다.

## 부작용 계약

| 동작 | 주문·입고·Estimate 원장 | 출고 | 재고 | 확정·최초기준·이월 |
|---|---|---|---|---|
| 셀 편집 | 보존 | 초안만 | 보존 | 보존 |
| 미확정 기존 상세 저장 | 보존 | 전체 거부 | 보존 | 자동 확정 금지 |
| 확정 상세 저장 | 보존 | 날짜·수량·환산·금액·대표 출고일 함께 저장 | 기존 방향별 순변경 + native 재계산 | isFix·최초기준·수동이월 보존 |
| 메인차수 일부 미확정 인쇄 | 보존 | 읽기, 출력 거부 | 보존 | 자동 확정 금지 |
| 전체 확정 인쇄 | 보존 | EXE 공통 조회·양식, 실제 선택 날짜만 | 보존 | 보존 |
| 충돌·중간 실패 | 보존 | 이력까지 전체 롤백 | 전체 롤백 | 초안 유지 |

전체 품종 확정 취소→재확정은 하지 않는다. 기존 방향별 수량 계약을 유지한다.
신규 목적 상세는 기존 확정 master + 확정 source 동일 총량 이동 + 기존 양수 주문 +
유일 단가 검사를 그대로 사용한다. 기존 상세는 상세 isFix를 판정하며 master의
혼합 상태 때문에 확정 상세를 미확정으로 바꾸지 않는다.

## 구현·검증 기준

- 서버 잠금 후 실제 확정 플래그를 재검사한다. 화면·클라이언트의 사전 안내는
  서버 판정을 대신하지 않는다. 대표 출고일을 전체 snapshot digest에 포함한다.
- 최종 양수 날짜에서 EXE 순서로 대표 출고일을 선택하며 정확한 PeriodDay 시각을
  저장하고 readback까지 확인한다. 전량 취소는 기존 정리 정책을 유지한다.
- 인쇄는 요청 연도/메인차수의 모든 세부차수·전체 거래처 양수 상세 확정 및
  선택 업체의 주문·날짜·견적 연결/수량/금액을 일관된 읽기 트랜잭션에서 검사한다.
- 인접 연도 동일 차수, 일요일/토요일 순서, 0 날짜, 전량 취소, 확정 상태 동시 변경,
  대표일 동시 변경, 재고 부족/재계산 실패/감사 실패/동일 UUID 재시도를 검사한다.
- 실제 MSSQL 격리 fixture로 저장과 롤백을 검증한다. 운영 DB 시험 쓰기는 하지 않는다.
- 1920×1080 CSS px / 100%에서 안내·저장 실패·인쇄 실패·모달·스크롤을 검사한다.

고성능 모델은 위험 검토, 중간 구현은 사용 가능 gpt-6-sol로 수행한다
(gpt-5.6-terra 미제공). 병합·배포·외부 쓰기는 메인 작업만 수행한다.

## 판정 항목과 소비자

| 기준 | 근거 | 소비자 |
|---|---|---|
| 명시 year+week+cust+prod, 누락 기본추정 금지 | 실제 SQL/기존 계약 | compare, client payload, locked apply, readback |
| 기존 상세 확정1 / NULL·0 거부 | 사용자 안전 요구 / 운영 상세 flag | 공유 weekdaySaveEligibility, client preview, server plan |
| 신규 상세는 기존 master 확정1 및 유일 단가 fixed source 동일총량, 기존 주문 | 기존 apply 계약 | client masterFixed, locked prepare/materializer |
| 정확한 PeriodDay timestamp, 기존 실제 업무차수 보존 | EXE exact JOIN / 운영 nvarchar 달력 | calendar helper, plan, date write, verify |
| 대표일 = 마지막 양수 WeekDay(day1..7) | 실제 btnSave_Click | shared representative helper, detail write, readback, audit digest |
| 전체 main 모든 고객 양수 isFix, 선택 업체 별도 무결성 | 사용자 추가 인쇄 정책 / EXE query | assessWeekdayPrintEligibility, read-only transaction |
| quote 품목+단가 수량/공급가/VAT = 실제 선택 날짜 집계 | EXE GetPrintDetail | reconcileWeekdayPrintQuote, normal Sort0 only |
| 초안·실패·응답불명 보존 및 인쇄 차단 | 기존 UUID 계약 | client, workspace, print bundle |

운영 SELECT 최신 표본은 40-01 주광 블루20박스가 미확정이고 40차가 부분확정이다.
이는 과거 20박스 확정 표본과 달라졌으므로 자동 확정하거나 과거 상태로 복구하지 않는다.
격리 MSSQL 저장/인쇄 검사와 전체 ERP 회귀로 보호하며 운영 사용자 작업은 읽기만 한다.

최종 검토에서 C# Math.Round(decimal) ToEven과 기존 웹/SQL half-up 저장 금액의
midpoint 차이를 확인했다. 인쇄 원장 검사는 두 방식의 수량·공급가·VAT 완전한 tuple 중
하나와 일치해야 하며 서로 섞거나 잘못된 VAT 분할은 허용하지 않는다. decimal ToEven은
10진 BigInt 비율로 계산한다. 기존 공용 저장 helper를 전역 변경하지 않고 원장 숫자를
그대로 보존한다. 최종 인쇄 수량은 EXE 공통 SQL ROUND(합산EstQuantity,0) 규칙이며
저장된 금액은 실제 날짜 bucket 합계다. qty4.5 및 공급가2.5 경계를 실행형 fixture로 검사한다.
