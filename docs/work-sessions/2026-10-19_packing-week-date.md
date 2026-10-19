# 날짜 없는 패킹리스트 — 기준과 검증

Q. 차수가 있으니 날짜를 자동 적용하고 중국 원본으로 다음 단계 검증·배포. 기존 입고 중복 금지.

## 기준 ledger (구현 전)
- 원본 raw_date/date 있으면 보존. 모호한 원문 날짜는 자동 대체하지 않는다.
- 연도: 파일명 명시 연도 우선, 없으면 화면에 보이는 한국 현재 연도(수정 가능). 차수는 파일명 추출. 복구한 자동 날짜의 연도는 보존.
- 수입 차수 기준일: 기존 orderWeekDate의 사용자 확인 수요일/토요일 기준. 날짜 산술 추정 대신 PeriodDay의 같은 OrderYearWeek와 WeekDay 4/7 행을 SELECT. 출고 목요일/월요일 규칙과 혼용하지 않는다.
- 달력 조회 실패/없음/중복/불일치이면 차단; 원본 DATE_SOURCE_UNAVAILABLE만 해소. 숫자/통화/총액/단위 오류는 보존.
- 자동 적용 이력 AUTO_ORDER_WEEK, 원문 raw_date null 보존. 화면·엑셀 보조 시트·입고 초안 rawMetadata에 근거 보존. 전산 저장은 기존 명시 승인 경로.
- 조회/날짜 적용/다음: Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport 모두 보존. API는 PeriodDay SELECT만.

## 선검증
- 실제 dnSpy CLI ExcelLoadingPackingList: G3→InputDate, 그 날짜 연도→SelectOrderYear, G2→SelectOrderWeek, 최종 native 재고호출. 웹의 명시 orderYear는 별도 보존하며 원본 발행일로 가장하지 않음.
- 운영 SELECT: 202542 수요일 2025-10-15/토요일 2025-10-18; 202642 수요일 2026-10-14/토요일 2026-10-17. PeriodDay.OrderYearWeek는 6자리, BaseYmd nvarchar.
- 기존 중국 PDF 실제 13/13 매칭이나 DATE_SOURCE_UNAVAILABLE 차단 재현. 원본 7쪽 날짜 미기재.
- 기존 서버/작업트리 변경 보존, 새 origin/master worktree. 임시 probe는 커밋 제외.

## 메뉴 기본값
- 적용: 명확한 자동 적용 출처, 키보드 입력/버튼, 초안·이력 보존, 원장 변경 전 기존 확인, 오류 안내.
- 해당 없음: 새 메뉴/shell/전체 레이아웃 변경.
- 검증/배포: 진행 중. 실입고 쓰기 금지.
