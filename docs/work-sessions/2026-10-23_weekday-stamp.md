# 2026-10-23 주광 견적서 직인

## 요청과 답변
- 요청: 제공한 네노바 직인을 종이 견적서 사진처럼 회사정보 오른쪽에 배치.
- 처리: 원본 PNG를 변형 없이 배포 secret NENOVA_ESTIMATE_SEAL_PNG에 저장. 공개 저장소에는 이미지/원문 base64를 커밋하지 않음. 인증된 기존 출력 API가 data URI 전달, native 주광 헤더에서 21mm 크기/right 11mm/top 22mm로 표시. multiply 합성으로 표 선/주소 유지. 날짜별 한 번.
- 수량/금액/재고/확정/적요 저장 SQL 변경 없음. 원장 모든 쓰기 보존. 기타 legacy 인쇄 양식은 변경하지 않음.

## 검증
- 기존 ReportEstimate 실제 dnSpy 좌표 근거는 weekday-print-native 세션/WeekdayPrintNotes golden 재사용. 같은 연도+차수+업체+품목 읽기 전용 DB probe 재실행.
- 출력 API fixture, 복수 날짜 직인 개수, 직인 제거 시 기존 HTML 완전 일치(수량/금액 보존), non-native 미표시, 비정상 자산 거부 테스트 통과.
- Chrome 실제 WeekdayPrintPreview 85행에서 직인 표시와 텍스트/표 겹침 확인. output/seal-preview-proof.png (로컬, 계좌 행 제외).
- ERP 전체/빌드 및 배포는 PR 결과 참조. 실제 종이 출력 미검증.
- 앞선 PR1266 Cafe24 배포39901148523 성공 확인.

## 기준선
적용: 기존 메뉴 shell/페이지 스크롤/모달 키보드 유지. 해당 없음: 신규 메뉴/ERP 쓰기/수량 계산 변경. 예외 없음.

검색어: weekday-stamp 네노바 직인 인쇄 회사정보 NENOVA_ESTIMATE_SEAL_PNG
