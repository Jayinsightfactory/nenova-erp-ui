# EXE 견적 달력 읽기 정합 — 구현 전 기준

2026-11-09 최신 사용자 승인: DB를 변경하지 않고 웹 견적과 주차 손익의 차감을 EXE 표시 기준으로 맞춘다. 엑셀 값 복사·중복 금액 제거가 아니다.

## 근거·기준

- 부모가 실제 설치 EXE를 `dnSpy.Console.exe --no-color -t FormEstimateView`로 재추출했다. 로컬 비공개 `.verify/FormEstimateView.actual.cs`의 GetData/GetDetail/GetPrintDetail/GetExcelDetail는 모두 `Estimate e JOIN PeriodDay pd ON e.EstimateDtm = pd.BaseYmd`다. GetDetail의 선택 요일은 클라이언트 ActiveFilterString, 나머지는 SQL 필터다.
- exact datetime 비교를 date-only 비교로 바꾸지 않는다. 정상 동일금액 별개 EstimateKey는 모두 보존한다. CodeInfo 미매칭 표시 fallback은 이번 달력 정합과 별개로 유지한다.
- 운영 SELECT-only 연도별 조사에서 초기 차수의 NULL 일자와 날짜는 있으나 시각이 다른 행을 구분했다. 과거 저장본의 NULL/달력 날짜 부재는 진단만 하고 보완하지 않는다. 비공개 업체·행·금액은 공개 fixture에 복사하지 않는다.
- 최신 live 집계는 EXE exact 달력 자격을 적용한다. 기존 연도/차수/확정/품목 필터와 O의 운송매출 합산은 그대로다.
- 독립 SQL lineage의 financeEstimates도 같은 exact 자격을 사용한다. raw 과거 NULL일자 금액과 native 진단의 차이는 원본 보존에 따른 의도된 비교이며 자동 보정하지 않는다.
- 과거 비확정 표시만 제한적으로 복제한다. 같은 날짜의 달력이 존재하는 시각 불일치 행을 대상으로, 같은 연도·대차수·국가품종 전체의 기존 SQL L/O(운송매출 포함)가 저장 auto.L/O 및 calc.L/O와 각각 일치해야 delta를 적용한다. 누락 source, 불일치, SQL 실패는 보완하지 않는다. 현재 원장을 과거 원장으로 주장하지 않는다.
- 확정본은 금액 그대로, 달력 진단만 제공한다. DB snapshot/confirm JSON은 전부 보존한다. 원본에 marker가 있거나 이미 보완된 표시본이면 재적용하지 않는다.
- 허용 변경은 L/O와 그 결과 C/J/K/M/D, 해당 합계뿐이다. N/E/F/G/H/I/P/Q/R/S/T/U/AC/AJ와 재고·원가 근거는 보존한다.

## 부작용 표

| 사용자 동작 | Estimate/PeriodDay | Order/Shipment/Date/Farm | Stock/History | WebProfitReport/Snapshot/Confirm |
|---|---|---|---|---|
| 견적 목록·상세·인쇄·Excel 조회 | SELECT만 | SELECT 또는 보존 | 보존 | 보존 |
| 주차 최신 집계 | SELECT만 | 기존 SELECT만 | 기존 SELECT만 | SELECT 또는 보존 |
| 과거 주차·월별·출력 보완 | 자격 진단 SELECT만 | 운송매출 SELECT만 | 보존 | 원본 SELECT, 메모리 복제만 |

새 API writer/SP/DDL/DML/재계산/자동 저장/원장 삭제는 없다. 신규 화면·탭·업무 순서 변경이 없어 영상 가이드 신규 제작은 해당 없음. 기존 조회·출력 동선과 키보드 기준은 보존한다.

## 검증 계획

합성 실행 fixture: 두 시각 불일치+정상 한 행, 별개 정상 동액행, 주말·선택 요일·차수경계·교차연도, 명시0/누락/불일치 source, 운송매출 O, NULL/미존재 달력 날짜, 확정 보존, 원본 불변·double apply, 주차/월별/출력 공용 표시. 대상 검사는 구현자가, 필수 전체 ERP gate/build·PR/운영 스모크는 부모가 수행한다. 운영 원장 시험 쓰기 없음.

실행 확인: 부모의 SELECT-only 대조에서 같은 시점 원장의 이전/수정 SQL15·16·36차 총계는 모두 같았다. 36차 역사 golden과 현재 총계의 120,000원 차이는 JOIN 변경 전후 양쪽에 동일하므로 이번 패치 영향으로 계산하지 않는다. 비확정33/35/40의 covered off-time 항목은 전체 source L/O 인증을 통과했고 초기 NULL일자 저장금액은 그대로였다. 보호 원장 및 snapshot hash 대조는 부모가 배포 뒤 다시 확인한다. 실제 개인정보·행별 운영 fixture는 Git에 포함하지 않는다.
