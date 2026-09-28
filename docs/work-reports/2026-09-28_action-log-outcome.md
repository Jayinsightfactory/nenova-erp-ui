# 액션 로그 결과 해석 기준

구현 전 기준: FAIL/SUCCESS는 HTTP 작업 응답이며 같은 시각·사용자의 다른 로그와 합쳐 저장 완료로 판단하지 않는다. LogKey가 요청 단위다.
운영 읽기 probe(2026-09-22 22:05~22:07): 8577/8575 등 FAIL ResultDesc는 '영업지원 전산등록 권한이 필요합니다.'. 8576 SUCCESS 영향21. 요청 JSON은4000자 절단으로 해석 불가. 오류 사유만으로 업체/품목 또는 이후 해결 여부를 추정하지 않는다.

|동작|SystemActionLog|Estimate/Order/Shipment/Stock/WebProfitReport|
|---|---|---|
|목록/상세|기존 기록 읽기, 사유·대상·보존 근거 표시|모두 보존|
|신규 불량차감 요청 로그|기존 감사 저장의 Payload만 유효한 bounded JSON으로 기록|업무 처리 경로 변경 없음|

기준: 연도는 Payload 명시값, 저장상태는 요청 action과 서버 응답 count, 권한 차단은 해당 API의 정확한 권한 오류만 해석. 누락/잘린 JSON은 불완전 표시. 등록/검증/입력 저장은 분리. 실패 영향0은 미저장 증거로 사용하지 않음. 자동 재시도/원장 보정 없음.
dnSpy CLI `--no-color -t ClassEstimate` 실제 Nenova.exe 재확인: Insert/Update/Delete는 Estimate 대상. 이번 변경은 해당 API나 저장 코어를 호출·수정하지 않는 웹 감사 표시/직렬화만이다.
새 감사는 인증정보·메모 원문을 저장하지 않는 allowlist이며3900자 이내 유효 JSON. 과거 로그는 덮어쓰지 않는다.
