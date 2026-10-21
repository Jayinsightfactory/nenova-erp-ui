# 선택 차수 출력 및 원본 비교

## 구현 전 기준
- 최신 사용자 지시가 과거 1~현재차수 강제 다운로드 계약보다 우선한다. 엑셀과 인쇄는 동일한 선택 차수 배열을 사용한다. 초기값은 현재 차수 하나, 전체 선택은 01~조회된 현재 차수, 빈 선택은 출력 금지다.
- 연도/조회 차수 변경 시 취소하고 현재 차수로 초기화한다. 출력 항목의 기존 localStorage 저장과 빈 선택 의미는 유지한다.
- 파일명과 완료 건수는 실제 응답 차수 목록에서 만든다. 비연속 선택을 연속 구간으로 오인시키지 않는다. 하나라도 실패하면 부분 파일을 생성하지 않는다.
- 2026-10-21 실제 설치 EXE를 `dnSpy.Console.exe --no-color -t FormStockView`로 다시 확인했다. GetData는 StockMaster/ProductStock 및 ViewWarehouse/ViewShipment를 읽는다. 출력 선택 변경은 SQL/SP/EXE 저장 흐름을 바꾸지 않는다.
- 같은 날짜 운영 DB read-only probe: 현재 코드의 loadWeeklyReportPayload(18,2026,preferLive=true)는 476개 SELECT, 약 6.1초로 16개 카테고리를 반환했다. 이는 로컬에서 운영 DB를 읽은 결과이며 운영 nginx HTTP502 재현 또는 실제 인증 다운로드 완료의 증거는 아니다.

## 부작용과 소비자
| 동작 | Order/Shipment/Estimate/Warehouse | StockMaster/ProductStock/History | WebProfitReport/확정 snapshot |
|---|---|---|---|
| 선택/미리보기/다운로드 | 보존, GET만 | 보존 | 읽기 전용, 자동 갱신 없음 |
| 원본 Excel/SQL 비교 | SELECT만 | SELECT만 | SELECT만 |

공통 helper outputWeeks가 엑셀/미리보기/인쇄 범위를 검증한다. collectOutput은 명시 연도와 선택 차수만 숫자순으로 조회한다. 기존 수기 초안 저장은 beforeOutput의 기존 사용자 저장 경로만 유지한다.

## 검증 기준
- 2025/2026 동일 차수, 한 개/비연속/전체/빈 선택, 누락·범위 밖 차수, 18차 502 자동재시도 및 반복실패/취소.
- 실제 원본 27~31차 셀 값·수식과 현재 SQL 보고서를 국가/품종 키로 비교. 동일 입력 산술 일치와 실제 원천 금액 차이는 구분한다. 원본 파일과 운영 원장은 수정하지 않는다.
- 메뉴 기본값: 반응형·키보드·페이지 스크롤·진행률·범위 명시 적용. 입력/매칭/ERP 적용 승인 해당 없음. 인쇄 iframe만 기존 내부스크롤 예외.
