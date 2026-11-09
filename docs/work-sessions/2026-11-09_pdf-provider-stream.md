# PDF 분석 결과불명 수정

## 사용자 요청
46-1 콜카장 CI.pdf 실제 재현 후 원인을 확인하고 해결. 운영 입고·재고·원가 저장은 금지.

## 확인 사실
- 실제 Chrome 팀업로드 원본(4212KB) 복구 성공. 무료분석은 지원하지 않는 양식으로 종료. AI 1회 접수 후 약300초에 PDF_ANALYSIS_UNCERTAIN 오류 재현.
- 서버 executeProviderOnce는 fetch 비스트리밍 응답 전체를 기다림. 앱 timeout600초와 별개로 fetch 하위 헤더 제한300초와 부합. 운영 원본 cause는 기존 catch가 버려서 확정 불가. 300초 transport 제한을 가장 유력한 원인으로 분류하며 서버 원인코드 확인 전 확정 주장 금지.
- InvoiceUploadIssues에 boolean error를 전달하여 실제 오류문구 유실도 확인.

## 수정과 부작용
- stream:true 요청, SSE message_stop까지 모아 기존 content/usage/stop_reason 형식으로 반환. 부분응답/오류스트림은 실패, 자동재호출 없음. 기존 quota/작업잠금/캐시/Docling 경로 보존.
- 서버 로그에는 jobId와 화이트리스트 오류코드만 기록. 문서/키/사용자 개인정보 출력 금지.
- 화면 error 문자열을 이력에 전달. 기존 로그 소급변경 없음.
- SQL/EXE writer/SP/수량/원가공식 변경 없음. Warehouse/Stock/Order/Shipment/Estimate/WebProfitReport 모두 보존.

## 검증 상태
표적 stream/API 테스트12개 PASS. manifest201 PASS, 변경API쓰기guard PASS. 전체ERP/build/실제PDF 재검증/배포는 미완료. 추가유료호출은 아직 실행하지 않음.

검색어: 46-1 콜카장 PDF stream UND_ERR_HEADERS_TIMEOUT PDF_ANALYSIS_UNCERTAIN 오류문구유실
