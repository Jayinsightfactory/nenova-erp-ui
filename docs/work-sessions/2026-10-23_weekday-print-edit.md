# 주광 수량 보존과 인쇄 적요 (2026-10-23)

## 사용자 요청 → 처리
- 박스+단/송이 입력이 분배 적용·Excel·요일 인쇄까지 유지되는가? → 격리 SQL에서 15단 포장 카네이션 1단/18단, 30송이 포장 수국 1송이/33송이를 두 날짜에 저장, 재조회→윌슨 분리→합계/잔량→실제 XLSX 숫자→요일 견적 수량 대조 통과. 운영 재고 임의 조정 없음.
- 비고는 차수만 → 출력 서식의 유효기간 아래 `43차` 등 대차수만 표시.
- 박스 수 표시 선택 → 출력/선택요일 출력 진입 때 예/아니오/취소. 숨김은 기존 단/송이 수량 유지.
- 미리보기 품목 적요 수정·저장 → 적요 textarea, blur 자동 저장 및 인쇄 전 저장. 날짜·연도·차수·업체·품목·단가·구분별 web runtime 메타데이터로 보존. ERP ShipmentDate.Descr, Estimate와 수량/금액/재고는 변경하지 않음.

## 근거와 검증
- 실제 dnSpy CLI FormEstimateView.GetPrintDetail, FormPrintEstimate.btnPrint_Click 재확인: docs/exe-golden/WeekdayPrintNotes.md.
- 운영 SELECT probe로 float 수량과 EstQuantity 단위 확인, 교차연도 분리.
- 서비스 실제 임시 파일 저장/재열기/CAS/빈 적요/XSS/범위 분리 단위 테스트 통과.
- Chrome 실제 Preview 컴포넌트 + 격리 HTTP fixture: 18단(1.2)/18단, 비고43차, 셀 입력·Tab 자동저장·재열기 유지, 실패 시 입력 유지 및 인쇄 차단 확인. 마지막 Tab 후 저장 버튼에 초점 유지 확인.
- Excel subtotal 3자리 반올림과 remainder 6자리 절삭을 저장과 같은 9자리로 통일. 화면 한 자리 박스 표시와 저장 정밀도 구분.
- 실제 종이 출력과 운영 ERP 쓰기 검증은 수행하지 않음. 배포/필수검사 결과는 WORK_MEMORY 및 PR 참조.

## 메뉴 기준선
- 적용: 기존 shell 재사용, 키보드 Tab/Escape/초점 복귀, 오류 입력 보존, 기존 인쇄 양식.
- 해당 없음: 신규 메뉴 등록, 모바일 네이티브 호환, ERP 수량 쓰기 변경.
- 예외: 인쇄 미리보기는 명시적 모달로 내부 스크롤 유지.

검색어: weekday-print-edit 박스 송이 단 적요 저장 43차 인쇄 선택요일 XLSX 정밀도
