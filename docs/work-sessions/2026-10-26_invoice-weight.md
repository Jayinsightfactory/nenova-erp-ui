# GW 자동 연결·CW 직접 입력

## 요청
GW 자동입력 복구, CW 없으면 원문 확인 후 직접 입력. 44-1 격리 입고→원가 검증 후 코드 배포. 운영 입고/원가 수정 금지.

## 원인과 변경
원문 검증창은 review_evidence.gross_weight=759.7kg을 표시했지만 입고 adapter는 legacy 필드만 읽었다. 저장 초안 재개도 빈 중량을 보충하지 않았다. 공통 packingWeight로 미리보기/생성 결과/입고를 통일했다. 같은 문서·원본·연도·차수의 빈 미등록 초안만 채우며 수기값, 0, 수기 삭제, 등록 완료, 결과 불명을 보존한다. CW는 GW/NET으로 추정하지 않는다.

## 검증
- 실제 dnSpy ExcelLoadingPackingList MakeTempTable/InsertMaster 재확인. EXE/SP/writer 변경 없음.
- 집중 검사50개, 최종 preview/auto-fill16개 통과. SQL writer 전체 회귀검사 통과.
- 44-1 실제 PDF 업로드, SHA 확인 후 1페이지 송장25529 전사 fixture로 검증. 12페이지 전체 AI 재분석은 하지 않음.
- Chrome 격리 UI: GW759.7 자동, CW 공란 안내→TEST_ONLY800 입력→7행107박스3210송이 입고91001→원가 APPROVED 재조회→엑셀 다운로드.
- 다운로드 invoice-cost-2026-44-01-r1-966a9e13 (1).xlsx 34486bytes. 2시트 모두 GW759.7/CW800, TEST_ONLY 표시 확인. 시험 환율1400/운임100USD/통관비10000KRW. 실제 원가 검증 아님.
- 격리 종료 시 PROTECTED_ORDER_SHIPMENT_UNCHANGED 확인. 운영 업로드/입고/원가 저장 없음.
- 다운로드 후 브라우저 도구 커널 경로 오류로 최종 캡처 재취득 불가. 다운로드 파일은 실제 생성 확인. 마지막 요약 중량 변경은 단위검사/최종 빌드로 검증, 브라우저 재실행 미검증.
- 최종 전체 gate/배포 결과는 후속 기록. 완료 전 배포 성공으로 간주하지 않는다.

검색어: GW CW review_evidence 44-1 25529 759.7 packingWeight weightManual TEST_ONLY
