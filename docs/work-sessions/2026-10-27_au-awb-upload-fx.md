# 2026-10-27 호주 인보이스 + AWB 연결 검증

## 범위
- 요청: 44-01 호주 CI와 AWB를 함께 업로드해 65박스, GW/CW 805kg 자동 입력, 업로드일 AUD 시장환율 적용, 입고 초안부터 도착원가 엑셀 생성까지 확인.
- 사용자 경계: 운영 DB 변경 금지. `nenova.exe`, ERP 스키마, SQL writer/프로시저 변경 금지.
- 원본: `44-01 호주 CI.pdf`, `44-01 호주 AWB - 081-63688774.pdf` (로컬 브라우저에서만 열어 확인; 개인정보/결제정보는 복사하지 않음).

## 근거 및 설계
- CI: invoice 41002, 2026-10-26, 65박스, 2,385단, AUD 20,443.75. 문서에 단가가 C+F Seoul Incheon Airport로 표시됨. AU에서는 AWB 운임을 별도 가산하지 않음.
- AWB: 081-63688774, 65 pieces, GW 805.0kg, CW 805.0kg. AWB 원문 페이지 근거가 붙은 번호·박스·GW·CW 대조 후 확인 체크가 있어야 입고 초안으로 이동.
- AUD: 업로드일(한국 날짜)을 기준으로 공개 Yahoo Finance `AUDKRW=X` 일봉 종가를 선택하고, 비거래일은 요청일 이하 가장 최근 시세일을 사용하며 실제 시세일/출처 URL을 기록. 환율은 비교용 도착원가 계산에만 사용.
- 기존 입고 연결이 없는 국가·차수는 신규 입고 등록을 자동 반복하지 않음. 저장·검증·입고 commit 단계는 기존 문서 revision/권한/원자적 writer 게이트를 그대로 사용.
- ERP 호환성 근거: `docs/exe-golden/FormWarehouseUpload.md`; native `ExcelLoadingPackingList.MakeTempTable`의 BoxQuantity/BunchQuantity/SteamQuantity/UPrice/TPrice와 `InsertMaster`→`uspCreateWarehouse`→`uspStockCalculation` 계약은 변경하지 않음.

## 구현/테스트 상태
- 구현: 2 PDF 1회 분석 요청, AU AWB source hash/evidence와 upload-date AUD quote를 초안 metadata에 기록, AU C+F 운임 중복 방지, 서버 입고 검증에서 AWB 확인/파일 지문/중량/박스 합계 강제.
- UI 격리 smoke: 실제 두 로컬 PDF를 Chromium에 선택, 모든 `/api/**`를 in-memory mock으로 대체. 인보이스+A​​WB가 같은 parse 요청에 담김, mock 추출값으로 AWB 65박스·805kg, 업로드일 환율 UI, 분류 대상 Woolly bush 2행 확인. 테스트 API의 ERP/저장/입고는 모두 mock이며 운영 DB·AI API 요청 없음.
- 자동화: `__tests__/auAwbFlow.test.cjs`; 비용/도착원가 exporter 기존 회귀 `__tests__/invoiceReceiptCostExport.test.js`; 접수 writer/AWB 차단. 나머지 통합 테스트/CI/PR/배포 상태는 후속 기록에 추가.
- 주의: 이 로컬 UI smoke는 OCR/실제 AI 결과 자체와 운영 입고 저장을 검증하지 않음. UI상 AWB 흐름은 mock 추출값으로 검증. 운영 영향 0.

## 2026-10-27 검증 결과 보강
- `npm run build`: 통과 (Next 16.4.3 / webpack). 기존 `/ecount/workbench` 대형 페이지 경고만 관찰.
- `npm run test:erp-contract`: 통과. 포함된 `npm run test:import-team`에서 packing-team 120 통과·18 선택 샘플 건너뜀, 전체 관련 import/workbench 테스트도 통과.
- `node __tests__/invoiceReceiptCostExport.test.js`: 35 통과, private 원본 템플릿 parity 9건 선택 생략. `node __tests__/auAwbFlow.test.cjs`: 5/5. `node scripts/test-invoice-receipt-writer-sql.cjs`: 격리 loopback fixture에서 통과. ERP write guard, dnSpy golden, manifest, `git diff --check` 통과.
- 실제 CI/AWB 원본 두 파일을 격리 브라우저의 파일 입력에서 골랐고, 화면은 65박스/805kg·업로드일 AUD quote와 2개 Woolly bush 분류행을 표시했다. `/api/**`는 모두 메모리 mock으로 가로챘다.
- 한계: mock 후속 응답 계약이 불완전해 UI 단계는 입고 초안 이후 자동 재조회에서 막혔고, 실제 브라우저 클릭으로 최종 도착원가 다운로드까지 검증하지 못했다. AI/OCR·입고 저장·원가 승인/다운로드는 운영 환경에서 실행하지 않았고 운영 DB 변경은 0이다. 따라서 다운로드 검증은 기존 exporter 회귀 테스트까지만이며 전체 UI E2E/배포 완료로 표현하지 않는다.
- 배포: 미완료. 최신 `origin/master`는 `459afa7c`로 갱신되어 있어 해당 기반에 통합 후 PR/CI 필요.

## 검색어
AU AWB 44-01 081-63688774 805kg C+F AUDKRW Yahoo upload-date FX 65 boxes
