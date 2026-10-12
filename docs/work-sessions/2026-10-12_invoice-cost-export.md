# 2026-10-12 인보이스 단계 로그·원가 양식 출력 설계 기록

## 합의

현재 결과 전용 sanitized CN_AIR 단일 시트, 원본 스타일/치수/병합/인쇄 설정 보존, 상세행 동적 확장, 서버 승인값 출력. 역사 금액·미지원 비용 breakup 추정 없음. 다른 profile은 template fidelity 전 unsupported. 역사 workbook 수정 없음. 런타임 소프트웨어 OOXML 기능이다.

## 최종 구현 계약 정정

- Franklin: lib/invoiceReceiptCostExport.js와 cost-export API(context 포함).
- Sartre: lib/invoiceReceiptStageLog.js와 stage-events endpoint.
- Feynman: lib/invoiceReceiptStageLogClient.js·UI. 메인 통합.
- Action WORKFLOW_STAGE, flat AfterJson, statuses running/blocked/failed/unknown/passed. 요청 code whitelist, free-text 없음.
- 비동기 best-effort 로그, ACK시 서버 내구성 표시. 로그 실패 재시도는 로그만 전송하며 업무 mutation을 차단/반복하지 않는다. 시작 gate·attempt terminal 충돌 규칙을 추가하지 않는다.
- 브라우저 passed는 실제 ERP 증거가 아니다. 현재 source/revision·operation 및 readInvoiceCosts MATCH 등 서버 검증 필요. receipt passed 실제검증은 메인이 Sartre에 요청한 상태.
- 저장 전 conversion/matching은 로컬 미저장이다. 기존 draft 성공이 행을 보존하며 별도 소급 영속화를 약속하지 않는다.
- export GET strictly read-only: export 이벤트 INSERT도 없음.
- 배포는 원본 hash로 생성·검증한 sanitized format JSON asset 사용. 운영 private XLSX/Downloads 경로 필요 없음.
- 실제 History.Action은 migration 기준 nvarchar(60), arbitrary nonempty. DDL 없음.

초기 초안의 제안 경로·started-log gate·export GET 감사 쓰기·terminal state machine·원본 XLSX 런타임 필수조건은 철회하고 PRD/계약에서 제거했다.

## 근거와 상태

원본 hash e1bb0315998c2f3550a0edab8353147612cd6c46d7247b287656eca1c3ee4233. layout27-2 CLOUD, 공식 근거26-2 CLOUD. 기존 stageProgress는 메모리, receipt/cost 성공은 서버 이력·snapshot에 보존된다. 실제41-2 테스트는 격리만 확인. 메인 보고 운영GET2026/41-02 docs[]/costrows0이며 본 작성자는 운영조회하지 않았다.

산출물: docs/plans/invoice-cost-export.md, docs/contracts/invoice-cost-export.json, 이 기록. 허용 세 문서 외 수정 없음. JSON 구문/문서 잔존 표현 확인만 수행하고 구현·빌드·SQL·운영·외부 쓰기 없음. INDEX는 소유 범위 밖이다.

## 메인 통합·검증 추가 기록

**Q.** 업로드→매칭→입고 완료 로그→원가 작업 로그→원가 완료→선택 다운로드까지 연결하고, 원본 도착원가 양식·셀 디자인·크기를 적용해야 한다.

**A.** 기존 독립 입고/원가 승인 흐름에 팀 공용 단계 이력과 승인값 XLSX 다운로드를 연결했다. 현재 문서·입고·승인 원가를 서버에서 다시 대조하며, 다른 원본/버전/연도 또는 전산 변경은 다운로드를 차단한다. 로그 실패는 로그만 재전송하고 ERP 등록을 다시 실행하지 않는다.

- 중국 항공 `27-2 CLOUD`의 원본 styles/theme/열너비/행높이/병합/뷰/인쇄 여백을 format-only JSON으로 보존한다. 28행으로 확장하고 현재 승인값을 출력한다. 과거 시트·금액·오류 수식은 포함하지 않는다. 파일은 승인값 보고서이며 편집 후 원가를 재계산하는 수식 파일이 아니다.
- SEA/NL은 기존 계산을 유지하나 원본 서식 다운로드는 아직 지원하지 않는다. UI에서 양식 준비 중으로 명시한다.
- 실제 41-2의 28행/159박스/2380단/30900송이와 상품금액 57330CNY를 격리 SQL에 등록한 후 원가·단계 이력·XLSX까지 검증했다. 품목키, CW=GW, FX230, 관세0, 통관1000, 운임 분류는 TEST_ONLY이며 실제 운영 승인값이 아니다.
- 실제 SQL 연결 테스트가 `단`/`BUNCH`의 직접 비교 오류를 발견하여 명시적 단위 이름 대응으로 수정했다. 수량은 환산하지 않는다. 원본 렌더 비교에서 K6 금액에 퍼센트 서식이 적용되는 문제를 찾아 텍스트 헤더로 수정했다. 통관합계는 원래 금액 칸 P10에 출력한다.
- 서버 단계 로그 10개, 클라이언트/UI 8개, 원가 export 8개 테스트 통과. 기존 ERP manifest 검사에 이 테스트를 포함하여 CI에서도 실행한다. 통합 manifest 161개, 전체 ERP 계약, dnSpy 근거, manifest/write guard 및 첫 production build 통과. 최종 UI 수정 뒤 build 및 배포 결과는 아래에 추가한다.
- Chrome 컴포넌트 하네스는 1920×1080·1280×800/100%에서 로그/다운로드 성공·409 오류·관리 조회를 검증했다. 모의 API/다운로드 bytes 테스트이며 실제 XLSX 정확성은 별도 SQL/OOXML/렌더 검사로 확인했다.
- 운영 GET 확인 결과 2026/41-02 문서와 승인 원가 모두 0건. 운영 입고·재고·원가 승인 SQL 쓰기는 하지 않았다. 격리 컨테이너는 작업 전부터 실행 중이어서 실행 상태를 유지했다.
- 기존 하위 에이전트를 설계/구현/검증 역할로 재사용했다. 모델별 재지정 기능이 해당 재사용 도구에 없어 실행 모델명/추론강도는 확인되지 않았으며 임의로 기재하지 않는다. 외부 쓰기·병합·배포는 메인만 수행한다.
- ERP 가드 스킬로 native writer·주문/출고/재고/견적/매출 보존 범위를 확정했고, spreadsheets 스킬로 원본 및 생성 XLSX를 artifact-tool로 렌더 비교했다. 세션 백업 스킬 기준으로 본 기록과 INDEX를 갱신한다.

### 보존 및 후속

`outputs/`의 실제 업무 파일·스크린샷·로그와 원본 Excel은 커밋하지 않는다. `nenova.exe`, native SP, 운영 DB 스키마 변경 없음. 새 웹 업무 동작은 기존 WebInvoiceHistory에 로그만 추가한다. 이전 `packing-team-matching` 작업 사본의 변경은 보존했다.

새 대화에서는 본 기록 및 `docs/plans/invoice-cost-export.md`, `docs/contracts/invoice-cost-export.json`을 읽는다. 실제 41-2의 미매칭12행·CW 누락·실비 확인과 테스트 합성값을 혼동하지 않는다. 운영 원가를 이미 생성했다고 보고하지 않는다.

### 배포 전 최종 검증

2026-10-12: K6 표시 수정 후 실제 28행 SQL 전체 시나리오 재실행 PASS, 생성 파일 재렌더 확인. 다운로드 버튼 스타일 및 저장 승인값/현재 편집값 구분 후 1920/1280 Chrome 재검증 PASS. 통합 manifest 161/161 및 최종 production build PASS. 비교 기준 8f5c8b2c, 변경 API 2개에 대한 쓰기 guard PASS. 빌드가 생성한 무관한 development-history 파일은 이 작업 커밋에 포함하지 않았다. PR/배포 확인은 실제 완료 후 추가 기록한다.
