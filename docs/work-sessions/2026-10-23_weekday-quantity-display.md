# 2026-10-23 주광 소수 한 자리 표시

|항목|내용|
|---|---|
|화면|주광 견적서 일반·윌슨 수량 입력/상세|
|원장 부작용|없음. 표시만 수정. API·환산·금액·확정·재고 불변|
|브랜치|codex/weekday-quantity-display|
|PR/배포|후속 결과 기록|

## 고정 결정
- 실제 박스 소수값을 소수 첫째 자리까지만 표시한다. 정수는 불필요한 .0을 붙이지 않는다.
- 입력 중 문자열은 그대로 유지하며 저장/계산 숫자는 반올림하지 않는다.
- 박스+낱개 창에는 표시 문자열이 아닌 원래 값을 전달한다.
- 이번 변경은 웹 표 표시만. 기존 인쇄/Excel 데이터 및 정책 변경 없음.

### Q. 소수 한 자리로 표시해 달라고 했었는데
A. 박스+낱개 창 이외 일반/윌슨 resting input에 String(raw)가 남아 있었다. 공통 표시 함수를 적용하고, 일반 대화상자로 반올림 표시값이 전달되지 않도록 원본값 경로를 분리했다.

검증: 실행형 컴포넌트 검사에서 일반/윌슨 focus→blur 무저장, Escape 무저장, 1.066666667→1.1 표시/원본 전달 확인. Chrome 격리 화면에서도 동일 결과, F2/Tab/ESC 초점복귀 확인. 윌슨 초안 전달값 1.066666667 유지. 운영 데이터 시험 저장 없음.

메뉴 기준: 적용=키보드/스크롤/표시원본분리, 해당 없음=새 메뉴/권한/SQL, 예외 없음.
빌드/dnSpy 근거/manifest/write guard/layout 통과. 전체 ERP 계약 및 배포 완료 결과는 후속 추가.
로컬 output/에는 검증 화면·로그·fixture가 있으며 커밋하지 않는다.
- 완료 검증: npm run test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest(base3e6846b7), guard:erp-writes, test:ui-layout, build 모두 exit0. UI 표시에만 변경, changed API 0개.
