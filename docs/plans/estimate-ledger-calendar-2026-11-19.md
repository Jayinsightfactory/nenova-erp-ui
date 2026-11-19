# 원장 대조 기록 달력 (2026-11-19)

사용자: 최초 저장 신고/현재 신고를 달력으로 비교하고 해당 차수 등록·변경이력과 판매등록 날짜까지 확인.

|조작|ERP 주문/출고/견적/재고/손익|웹신고/이력/판매스냅샷|
|---|---|---|
|대조/월 선택/재조회/닫기|SELECT만, 보존|SELECT만, 보존|

기준: 원차수·적용차수는 기존 값 그대로. 신고 ChangedAt은 모든 이력, 현재 생성/수정은 CreatedAt/UpdatedAt. 날짜가 없는 값은 미기록. DB DATETIME을 SQL varchar(19)로 출력하여 브라우저 타임존 이동 방지. 달력은 실제 기록이 있는 월만 이동하며 차수 이후 기록도 포함한다. 선택 연도+대차수로 판매스냅샷을 제한한다. REG_CONFIRM=웹 판매등록확정, TUE_CLOSE=판매등록 마감 스냅샷, CLOSE_CHECK=마감점검 등 원래 종류를 보존. 이 기록은 개별 신고가 아니라 차수 전체임을 표시. 스키마 부재는 조회불가, DB 오류는 조회실패. ensureSnapshotTables/DDL/DML 호출 없음.

실제 근거: 로컬 dnSpy CLI ClassEstimate.EstimateDtm/Insert/Update 확인(2026-11-19). EstimateDtm은 업무일자여서 등록 감사시각으로 사용하지 않음. 웹 handleEcountExcel→GET excelDetail→XLSX.writeFile, 인쇄 엑셀 downloadEstimatePrintWorkbook도 다운로드 감사이력 저장 없음. 파일명 날짜를 이력으로 역산하지 않음. 이카운트 실제 입력일은 본 조회 원천에 없으므로 미기록.
운영 SELECT: 2026/45 신고752 이력3개, 2026-10-06~11-10. WebSalesSnapshot 2026/45: TUE_FINAL2/WED_CHECK2/TUE_CLOSE3/CLOSE_CHECK3, REG_CONFIRM0. 고객/직원 실제값 기록안함.

기준선: 페이지스크롤·키보드·작은 화면·조회오류·원본/현재값 대조·영상 갱신 적용. 입력/원장반영·Rust 핫패스 해당없음(React/DB 조회). desktop/menu.json /estimate 및 components/Layout.js 기존 메뉴로 동일 화면 접근·검색·즐겨찾기 경로 유지; 메뉴 추가는 해당없음. 사용자 전역 동시 연결 기준에 따라 desktop 버전1.3.46 갱신 및 메뉴 생성/스모크 검증 적용. 웹 UI는 기존 URL 로드로 앱에 반영됨.

필수 검증 및 배포 결과는 WORK_MEMORY.md 참조.

검증: 대상14회귀/전체ERP계약/dnSpy/manifest229개/쓰기범위/정식 webpack 빌드 통과. desktop73회귀 및 Electron smoke 통과. 1920/1280/390 합성브라우저·방향키 월이동·Esc 초점복귀·명시조회실패 통과. 최종66.4초 영상 처음/중간/마지막 실제 프레임과 한국어 VTT·3단계 목차·해시 검증. Drive 백업 영상1QqliZgJIwSizKXqmLGVv1CNC1SIuti7U/자막1_ETgzM-q9OXf833URfleGnM1njNkzljV 재조회 확인.
