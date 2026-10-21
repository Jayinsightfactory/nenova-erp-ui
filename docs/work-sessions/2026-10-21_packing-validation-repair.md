# 매칭 이후 원문 오류 직접 수정

|항목|내용|
|---|---|
|일자|2026-10-21|
|화면|수입부 패킹리스트|
|원장 부작용|운영 DB 쓰기 없음. SQL/API writer 변경 없음|
|배포|CI 및 Cafe24 결과는 PR/Actions 기록 참조|
|이어받기|packingValidationIssues, PackingEvidenceReview, 아래 실제 파일 검증 한계 확인|

## 고정 결정
- 품목 매칭 완료와 원문 숫자/날짜 검증은 별개다. 매칭으로 수량·총액 오류를 해제하지 않는다.
- 원본 값, 수정 이유를 보존하고 재검산 후 기존 입고 준비로 연결한다.
- 빈 단가/금액을 임의로 0 처리하지 않는다. 날짜 월/일도 추정 확정하지 않는다.
- Order 박스, Bunch 단, PCS/송이 등 기존 국가별 수량 변환과 ERP 저장 경계는 변경하지 않는다.
- 운영 DB 및 유료 AI 호출 없이 테스트한다.

### 1. 매칭 후 중단 원인과 수정
**Q.** 어떤 값이 문제인지 표시하고 직접 수정해 입고 업로드까지 진행하도록 보완, 실제 파일 검증 후 배포.

**A.** 상단에 송장/상품행/문제 필드/현재값·기준값을 표시하고 해당 값 수정 버튼으로 원본 PDF 대조 창의 해당 입력란 또는 상품행을 연다. 공통 오류는 각 행에 긴 내용을 반복하지 않고 상단 안내로 연결한다. 총액 검산은 입력값/계산값/차이를 표시한다. NL Handling 누락도 명시 입력·사유로 복구하며 기존 검증과 ERP 승인은 유지한다.

**실제 파일.** 41-1 중국 해상 ci1.pdf, 7페이지 101행. 날짜 4/10/2026의 월/일 확인 필요, 마지막 Sinensis white 행 단가/금액이 빈 값이어서 총액 대조 불가. 로컬 실제 PDF 업로드/렌더/입력 포커스/수정/재생성 브라우저 검증 통과. 격리 테스트에서만 담당자가 원문 대시를 0으로 확인하는 시나리오를 사용했으며 실제 무료 품목이라는 판정이나 운영 저장은 하지 않았다.

**매칭 한계.** 조회한 팀 공용 카탈로그 3,057품목 기준 이 파일은 확정 매칭 5행, 추가 확인 96행. 실제 101행 전부의 매칭 및 실입고 완료로 주장하면 안 된다. 미매칭 차단 유지 확인. 수정된 101행의 XLSX/입고 초안 payload 생성은 별도 로컬 변환 시험 통과. 기존 입고 승인/중복 방지/원장 writer 회귀 테스트를 유지한다.

**dnSpy.** 저장된 ExcelLoadingPackingList MakeTempTable/CheckData/InsertMaster 소스 및 FormWarehouseUpload golden 재확인. 신규 dnSpy 실행 성공이나 실 DB 저장 검증으로 주장하지 않는다.

## 검증/다음 확인
- 실제 브라우저: scripts/test-packing-validation-browser.cjs (모든 API 격리, 외부 요청 차단), 실제 로컬 PDF 검증 scripts/test-packing-validation-real.cjs.
- 단위 회귀: packingValidationIssues, importPackingReviewMetadata, packingMatchNext, importPackingHardening.
- 전체 ERP/manifest/write guard/build/배포 결과는 실행 로그와 CI로 확인.
- .test-packing-*.json, .validation-* 및 data/generated 빌드 산출물은 커밋 금지. 테스트 스크립트는 로컬 카탈로그 fixture가 필요하며 운영 접속·쓰기하지 않는다.
