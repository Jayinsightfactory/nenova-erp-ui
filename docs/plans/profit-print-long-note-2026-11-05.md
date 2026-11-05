# 긴 금융비고 PDF 잘림 (2026-11-05)

## 실제 진단

기능배포41992470900 성공 뒤 운영38~40차 인쇄 검사41996760454에서 DOM비고는 원본출력메타데이터 전체와 일치하고3차수 GET200·제목·22열·숫자·페이지수는 통과했지만 PDF전체비고 일치가 실패했다. 진단브랜치38778921d/검사41997682133의 개인정보 없는 수치: 첫 실패비고8533자, PDF정규화3770자, 비고prefix1752자만 남고 마지막8자도없음. 좌표정렬해도 전체비고가 복구되지 않았다. DOM note top276.6/bottom729/page729.44, unscaled높이870, scale약0.51997로 화면geometry는 맞았다.

이는 paint-only transform이 적용된 자식을 Chromium PDF가 overflow:hidden 부모의 원래좌표에서 먼저 자르는 현상과 일치한다. 원래 note시작276.6/.52≈532px, page729px까지 약197px만남아870px비고 중약23%만 출력된다. 공백/한글/기호 정규화 차이가 아니라 실제 내용 누락이며 기존assert는 유지한다. 원문비고/PDF·품명·개인정보는 로그/아티팩트로 저장하지 않았다.

## 최소 수정·부작용

`fitProfitPrintDocument`는 측정 전에 transform을없애고 zoom=1로초기화한 뒤 기존폭/높이비율을 동일하게계산하여 **layout-aware CSS zoom**으로 적용한다. 그 뒤 overflow:hidden으로차수당한장을보존한다. 인쇄줄임/비고끝부분삭제/수량·금액·환율변경은없다. 보고서/XLSX/원본비고/선택차수/검증상태/API/ERP/DB/확정본은모두보존한다. 재고/원장기능변경이아닌 브라우저인쇄기하수정이므로 기존출력계약의dnSpy/읽기전용근거를그대로재사용한다.

## 실행 회귀

- 기존 `profitRangeOutput.test.cjs`: 순수크기비율, transform=none/zoom값, 원본비고·금융값보존.
- `scripts/profit-long-note-pdf-smoke.cjs`: 실제Chromium으로짧은/8533자초과/매우긴합성금융비고, signed수량·금액·→/−/%p·한글·마지막항목 전체exact확인. fitted iframe HTML을 새 PDF페이지에다시넣는 실제운영QA경로, A4가로/차수당1장/반복fit불변/원본workbook불변도확인한다. PDF/서버/DB/인증정보저장없음.
- 수동 production print workflow에서한국어폰트설치뒤합성PDF회귀를먼저실행하고기존운영전체비고strictassert를그대로실행한다. 현재운영번들은배포전까지이전helper이므로새합성검사성공과새코드배포후운영검사성공을구분한다.

최종 CI·수정배포·운영인쇄 재검증은 별도결과로기록한다. 운영44차수읽기감사41996746280 및4차수다운로드41996750902는부모확인PASS이며이PDF잘림검사와혼동하지않는다.
