# 인보이스 입고 차수 누락 진단·수정

- 원인: 파일명에 연도가 없고 원문 날짜가 이미 있으면 orderWeekDate가 생성되지 않는다. 어댑터의 orderYear는 빈 문자열이며 toReceiptDraftPayload가 null로 바꿔 서버 문자열 검사에서 영어 오류가 발생한다. 숫자 연도는 기존 normalizeReceiptDocument가 문자열로 정규화하므로 단순 숫자형 오류로 단정하지 않는다.
- 기준: 명시 문서 연도/세부차수 보존. 현재연도나 송장일 연도를 업무연도로 임의 대입하지 않는다. 날짜 보완 근거의 명시 세부차수는 어댑터로 전달한다. 서버의 연도·차수 검증을 완화하지 않는다.
- 동작/부작용: 누락 검사·오류표시·payload 작성은 WebInvoice/Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport 모두 보존. 유효한 초안은 기존 저장 경로만 사용. ERP writer/SP/DDL 변경 없음.
- 설치 EXE dnSpy ExcelLoadingPackingList 재실행: SelectOrderYear와 SelectOrderWeek 문자열 저장 확인. EXE의 현재연도 fallback은 웹에 도입하지 않는다. 직전 SELECT probe에서 2026/43-02 Warehouse7843 확인, 이번 오류 문서와 동일하다고 간주하지 않음.
- 회귀: null/빈칸/누락/잘못된 차수는 저장 요청 전 한국어 안내, 유효2025/2026 범위 보존, 입력 수정 후 재개. 기존 매칭·수량 보존. UI shell/키보드 변경 없음, 실화면 검증은 별도 기록.
