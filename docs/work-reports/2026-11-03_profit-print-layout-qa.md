# 주차별 매출이익 인쇄 독립 QA

## 현재 상태

2026-11-03 로컬 실제 Chromium PDF 및 production-build 모의 API 앱 통합 검증 통과. 전체 gate와 PR1447 CI41604410811은 진행 중이며 운영 배포·인쇄 스모크는 미완이다.

## 고정 기준

- 선택 연도와 선택 차수만 출력한다. 1차수는 A4 가로 1장, 3차수는 3장이다.
- 최초 출력 항목은 22개 전체다. 사용자가 저장한 출력 항목 선택은 유지한다.
- 사용자 비고는 보존하고 자동 검증·입력 상태 문구만 인쇄에서 제외한다. 사용자 비고에 같은 단어가 들어 있다고 문장 전체를 삭제하지 않는다.
- 인쇄 버튼에서 추가 미리보기 조작 없이 브라우저 인쇄 대화상자를 요청한다. 실제 프린터 선택·출력은 사용자 장치 영역이다.
- 숫자, 빈 값, 0, 음수, 수익률 및 연도·차수는 기존 출력 payload 그대로 유지한다. 원가 계산이나 정상 여부를 인쇄 변경으로 재판정하지 않는다.
- 메뉴는 1920×1080 및 좁은 화면에서 잘리지 않아야 하며 Tab/Space/방향키/Escape와 초점 복귀가 가능해야 한다.

## 부작용 경계

| 동작 | 보고서·ERP 원장 | 로컬 영향 |
|---|---|---|
| 출력 자료 요청 | 기존 GET만 허용, 저장 API 금지 | 메모리 자료 |
| 항목·차수 선택 | 변경 없음 | 기존 브라우저 선택 저장 |
| 인쇄 HTML/PDF 생성 | 변경 없음 | QA 임시 PDF 및 이미지 |

부모가 설치 EXE의 FormStockView를 실제 dnSpy로 확인했다. StockMaster/ProductStock, ViewWarehouse/ViewShipment의 연도 포함 키 및 StockHistory 연도·차수 읽기를 확인했으며 이번 출력 전용 변경은 이 경로를 바꾸지 않는다. 이번 새 SQL probe는 연결 실패했으므로 신규 SQL 검증 성공으로 기록하지 않는다.

## 검사 계획과 차단 조건

1. 22열·실제 보고서 행수·긴 금액·음수·빈칸·여러 줄 비고 fixture로 Chromium PDF 생성.
2. PDF 페이지 수와 A4 가로 용지 크기, 모든 열 제목과 마지막 열, 비고의 존재를 검사하고 PNG로 렌더링하여 시각 확인.
3. 서로 다른 연도, 중복 차수, 선택 외 차수 반례는 출력 정책 테스트로 거부 확인.
4. 자동 상태 문구 제거와 사용자 비고 보존을 별도 검사한다. Excel 자료의 삭제/값 변경은 허용하지 않는다.
5. 실제 메뉴와 출력 동작은 모의 GET 응답을 사용하는 로컬 UI 또는 인증된 운영 읽기 전용 검사로 확인한다. 모든 GET/HEAD 외 요청은 차단한다.
6. 페이지 수 초과, 셀/비고 잘림, 인쇄 중 금융값 변경, 저장 요청 발생, 선택 연도·차수 혼입은 배포 차단이다.

## 환경 제한

현재 cua.getState 결과는 `Local browser use is disabled in Work settings`이다. 네이티브 앱 목록 조회 성공은 브라우저 제어 성공이 아니다. 설치된 Chrome과 puppeteer-core로 headless PDF 검증을 준비한다. 실제 프린터 드라이버·용지함·물리 출력은 미검증이다.

## 실제 PDF 검증 결과

검사 스크립트: `.verify/print-layout-browser.mjs` (로컬 합성 자료, 커밋 제외).

| 사례 | 실제 PDF | 내용 검증 |
|---|---:|---|
| 2026/18차, 실제 COLUMN_DEFS 22헤더·18행 | A4 가로 1장 | 마지막 열·쉼표 긴 금액·음수·0·빈칸·사용자 비고 보존 |
| 2026/18·38·39차 | A4 가로 3장 | 선택 순서 및 차수별 독립 한 장 |
| 2026/18차, 비고 50줄 | A4 가로 1장 | 마지막 비고 50까지 PDF 텍스트 존재, 셀 경계 잘림 없음 |

초기 transform-only 및 absolute-only 구현에서 긴 비고가 두 장으로 나뉘었다. 화면 DOM 경계만 검사하면 놓치는 Chromium 인쇄 단편화 문제였다. 전체 내용을 측정·축소한 뒤 인쇄 페이지 overflow를 제어하도록 구현 담당이 수정했고, 동일 PDF 반례 재검사로 해소했다. 비고 문장을 잘라 페이지 수를 맞추지 않았다.

PDF를 `pdftoppm`으로 렌더한 `one-pdf.png`, `long-note-pdf.png`를 직접 시각 확인했다. 원본 합성 PDF/PNG는 `.verify/print-layout-artifacts/`에 있으며 운영 자료가 아니다. 헤더 최소 폭 보완 후 실제 기초/기말재고액 제목이 한 글자씩 세로 분해되지 않는 것도 확인했다. 최신 일반표 축소율은 약 0.847, 긴 50줄 비고는 약 0.561이다. 긴 비고의 작은 글씨는 한 장 제약에 따른 가독성 한계이며 내용 누락은 아니다.

## 운영 검사 준비

`scripts/profit-production-print-smoke.cjs` 및 `.github/workflows/profit-print-smoke.yml`은 수동 실행 전용이다. GET/HEAD 외 요청 차단, 새 브라우저의 22열 기본값, 1920/390px 메뉴 경계·방향키·Escape/초점 복귀, 선택 세 차수와 print 호출 1회, PDF 각 페이지의 22개 헤더·숫자 텍스트·셀 경계·A4 크기를 검사한다. 운영 PDF와 원문, 인증정보는 로그/아티팩트로 업로드하지 않고 결과 메타만 출력한다. 현재 구문 검사 통과, 운영 실행 전이다.

## 독립 코드 회귀

- `node __tests__/profitRangeOutput.test.cjs`: PASS. 연도/선택범위, 확정값·0·스타일, 실패·취소, 비고/상태 분리.
- `node __tests__/profitReportToolbar.test.cjs`: PASS. 기존 50개 action/disabled 쌍, 실제 callback 실행, 출력 불변, 키보드/JSX.
- `node --check scripts/profit-production-print-smoke.cjs`, `git diff --check`: PASS.
- 금융값 변경·원장 쓰기·사용자 비고 삭제에 관한 현재 독립 검토 차단사항 없음. 전체 gate 및 실제 앱/운영 검증은 별도 완료가 필요하다.

## Production-build 앱 통합 결과

구현 담당이 별도 `.next-print-production` 빌드 EXIT0 후 `scripts/profit-output-preferences-smoke.cjs http://localhost:3217`을 실제 Chromium으로 실행하여 EXIT0을 확인했다. 합성 API만 사용했고 API 쓰기는 0이다.

- 직접 인쇄 호출 1회, 현재 41차 한 차수 선택, 전체 41시트, 비연속 27·31 선택.
- 18차 HTTP502 재시도와 2025 연도 격리.
- 화면 v4·출력 v1 선택 지속, 빈 선택 및 화면 컬럼 복사.
- 390px 출력 항목 fieldset·화면 컬럼 popover 경계, End/Escape와 초점 복귀.
- 산출물 `.verify/profit-output-preferences.png`, `.verify/profit-output-preferences-desktop.png`; 별도 빌드 로그 `.verify-print-production-build.log`.

위 결과는 로컬 production-build/합성 자료 검증이며 운영 SQL·물리 프린터 검증으로 확대하지 않는다. 전체 verify session14986 및 PR1447 CI41604410811 진행 중, 배포/운영 결과는 후속 기록한다.
