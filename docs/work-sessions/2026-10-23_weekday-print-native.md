# 2026-10-23 주광 인쇄 차수 편집·페이지 나눔

## 질문 → 처리
- 차수 표시도 적요처럼 수정: 미리보기 입력칸, blur 및 인쇄 전 저장, 문서별 별도 CAS 파일. 실제 차수 변경 없음.
- TEL/FAX 누락: Customer.Tel 읽기 연결. Fax 컬럼 없음, 추정 금지. 공급자 정보행 native 비율 보완.
- 품목명 너비: 실제 dnSpy 58.235287mm 대조. 기존 폭 유지 및 A4 반복 여백으로 인쇄 폭 보존.
- 페이지 잘림: @page 좌우15/상하10mm 반복, 품목 행 break-inside avoid, 머리글 반복, 날짜 문서는 새 페이지. 긴 적요 개행 보존.
- 직인: 실제 설치 ReportEstimate 리소스는 로고뿐. 직인 원본 확인 사용자 질문 중. 임의 생성/완료 주장 안 함.
- 적요 견적서관리 연동: 현 기능은 주광 출력 전용이며 ERP 적요 보존(연동 요청 아님).

## 근거/검증
사전 계획 docs/plans/weekday-print-native-2026-10-23.md. 실제 EXE dnSpy ReportEstimate + 이전 FormEstimateView/FormPrintEstimate 기록, 2025/2026 43-01 Cust533 read-only probe. Quantity/Amount/Vat/isFix/Stock/Estimate/WebProfitReport 변경 없음.
순수 저장/CAS/빈값/교차연도/HTML escaping 검사 통과. Chrome 실제 컴포넌트 85행/긴품목/적요, 차수 편집→Tab저장→닫기재열기 유지 확인. 인쇄 대화상자 내부 접근 불가로 실제 페이지 분할/종이 출력은 미검증. 필수게이트/CI/배포 결과는 PR에 기록.
메뉴 기준: shell/키보드/실패입력보존 적용; 신규메뉴 해당없음; A4 인쇄모달 명시예외.

이전 PR1263 f7862bff 배포39899469811 성공, Chrome 최초 메뉴 진입 조회 없음/43입력만으로 조회 없음/조회 클릭 후2026-43 로드 확인.
검색어: weekday-print-native 차수표시 TEL FAX 페이지나눔 직인
