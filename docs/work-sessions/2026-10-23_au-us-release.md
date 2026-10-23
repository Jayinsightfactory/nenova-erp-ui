# 호주·미국 인보이스 변경 분리 배포

## 사용자 결정
- 기존 국가별 작업 중 호주·미국만 이번 배포. 태국은 다른 세션 작업이며 변경하지 않는다.
- 콜롬비아 수국 공식/에콰도르 수량/태국 JSON 분석 변경도 이번 커밋에서 제외.
- 운영 DB 변경 금지. 입고·재고·원가 쓰기 검증은 소유 loopback SQL fixture만 사용.

## 구현
- AU Woolly bush: 매 파일 원본 PDF 옆 품목/박스/단/송이/금액 분류. 공용 별칭 저장과 이전 파일 분류 자동재사용 금지.
- 원본 4개 합계/단가/통화 검증, 잘못된 품목/누락/음수/후속 수정 차단. 분류 후 상단 매칭 상태 동기화.
- US: 다른 국가 동일 품명과 분리하여 국가+ProdKey 매칭. 품명만 조인하는 EXE용 엑셀은 차단 유지, 웹 입고와 도착원가 출력은 허용.
- 시험 환율·비용으로 만든 원가 엑셀은 TEST_ONLY를 두 시트에 표시. 원가 산식 변경 없음.

## 부작용 / 근거
- 분류는 웹 문서와 해당 이력만 변경. Product/공용 매칭/Order/Shipment/Estimate/WebProfitReport는 보존.
- 명시 입고 승인만 기존 writer를 사용. 이번 배포는 코드만, 마이그레이션/운영 데이터 보정 없음.
- EXE ExcelLoadingPackingList.MakeTempTable, CheckData의 Box/Bunch/Steam/UPrice/TPrice 및 품명 조인 근거 사용.
- 매칭 표시/사전검사/서버 검사는 allocationIssues 공통 helper. 2025/2026 동일 차수/새 파일, 0/누락/음수/합계차이/다른국가 테스트 포함.
- 메뉴 기본값: 적용(의미 있는 버튼·select·입력, 모달 Tab/Escape/복귀, 페이지 스크롤), 새 메뉴 등록 해당 없음. 모달 내부 PDF/표 스크롤은 원본 대조 예외.

## 검증
- 기존 브라우저 AU/US 원본 업로드→매칭/분류→입고→원가 승인/재조회→다운로드 확인.
- 최신 master 분리 후 격리 SQL 재검증 통과: AU 56박스/1905단/15500송이/17706.25 AUD, US 70박스/1750단/43750송이/4721.5 USD.
- 시험 비용으로 검증했으므로 실제 청구 원가 검증 아님. 기존 운영 데이터 학습·변경 없음.
- 최초 기록 시 전체 gate/최종 PDF UI/PR/배포 대기. 후속 결과 아래 추가.

## 이어가기
작업트리 C:/Users/USER/nw-au-us-release-1023, branch fix/au-us-release-1023. 원래 nw-invoice-country-1023의 미배포 CO/TH/EC 작업을 포함하지 말 것. local-au-us-contract.log/build.log와 local-au-sql.log/us-sql.log 확인. CI 통과 후 squash merge 및 코드-only 배포, 운영 스모크는 조회만 수행.
