# 인보이스 단계 로그·CN 항공 승인 원가 출력 PRD

## 2026-10-13 국가별 확장 작업 계약 (진행 중)

- 입력 확인 → 국가·운송별 검증 계산 → 기존 웹 원가 승인·독립 재조회 → 원본 서식 다운로드 순서를 유지한다. 계산 미리보기와 운영 저장 완료를 구분한다.
- 신규 공식은 원본 SHA256·시트·셀, 통화, 가격 단위, 비용 배분 분모를 명시한다. 국가 이름만 보고 다른 국가 공식을 적용하지 않는다.
- GW/CW/운임의 인식값은 확인·직접 수정할 수 있어야 한다. 미입력과 명시 0을 구분하며 비용 중복 가산을 금지한다. 베트남 CNF 포함 운임은 별도 가산하지 않는다.
- 원본의 잘못된 참조·합계·백분율 서식은 정답으로 복제하지 않는다. 원본 스타일 보존과 계산 정확성을 각각 검증한다.
- 기존 승인값과 현재 입고 원장 MATCH 검사, 문서 버전·연도·세부차수·품목·단위 연결을 보존한다. 다른 버전, 단위 환산 누락, 원천 변경 시 출력하지 않는다.
- 이번 확장은 기존 ERP 입고 writer, 주문·분배·재고, EXE, 운영 스키마를 수정하지 않는다. 로컬 fixture 및 원본 읽기 검증만 수행하며 테스트 입고를 운영에 저장하지 않는다.
- 완료 기준: 지원 공식별 정상/누락/0/환산 오류 회귀, 원본 서식 및 승인 출력 값 일치, 기존 ERP gates/build, 1920×1080 UI 확인. 미검증 국가는 명시적으로 확인 필요로 남기며 전체 완료라고 표시하지 않는다.

## 확정 범위

업로드→매칭→기존 명시 입고 저장+로그→원가 처리+로그→승인 저장·독립 재조회→선택 다운로드. 소프트웨어 구현을 실제 운영 등록 승인으로 확대하지 않는다. 실제41-2 검증은 격리 테스트이며 메인 보고의 운영 GET 2026/41-02 문서[]·원가rows0과 구분한다. 이 문서 작성자가 운영 조회를 수행한 것은 아니다.

출력은 sanitized 현재 결과 전용 CN_AIR 단일 시트다. 원본 스타일·열 너비·행 높이·병합·실제 존재 인쇄 설정을 보존하며 상세행을 동적으로 확장한다. 원본 원가 결과 위치에 서버 승인값만 출력한다. 역사 금액·요율·미지원 비용 구성 추정 금지. 역사 workbook 자체는 변경하지 않는다. 런타임 소프트웨어 OOXML export이며 대화용 artifact authoring 절차를 배포 구현 의무로 적용하지 않는다.

## 실제 담당 경로

| 담당 | 소유 |
|---|---|
| Franklin | lib/invoiceReceiptCostExport.js — 승인 context·sanitized format·export API 연계; pages/api/import/receipts/[id]/cost-export.js |
| Sartre | lib/invoiceReceiptStageLog.js; pages/api/import/receipts/[id]/stage-events.js |
| Feynman | lib/invoiceReceiptStageLogClient.js; Workbench/CostReview 단계·로그·다운로드 UI |
| 메인 | 통합·실제 파일/테스트 경로 확인·격리 SQL/빌드/브라우저 검증 |

별도 invoiceCostExportContext/Profile 모듈이나 workflow-events endpoint를 요구하지 않는다. 구현 중인 경로를 이 계약에 맞춘다.

## 현재 근거와 로그 한계

기존 receipt writer는 성공 operation·원장 readback·WebInvoiceHistory를 트랜잭션에 기록한다. 원가 모듈은 승인 revision/full input snapshot/원가 행·승인 이력을 저장하고 live receipt와 현재 문서·operation을 대조해 STALE을 판정한다. stageProgress는 브라우저 메모리이며 pending localStorage는 복구용이지 팀 감사원장이 아니다.

WebInvoiceHistory.Action은 저장소 migration 기준 nvarchar(60), arbitrary nonempty다. 새 action은 WORKFLOW_STAGE 하나다. Operation.Action 제약과 혼동하지 않으며 DDL/새 테이블/새 index를 추가하지 않는다.

첫 draft 저장 전 conversion/matching 이벤트 서버 영속화는 구현 범위가 아니다. 기존 draft 성공은 저장 행과 검토 근거를 보존한다. 저장 전 로컬 상태는 '미저장/서버 이력 없음'으로 명확히 표시하며 과거 이벤트를 서버가 당시 검증한 것처럼 소급 생성하지 않는다.

## 단계 이벤트 고정 계약

POST /api/import/receipts/[id]/stage-events. AfterJson은 nested stageEvent 없이 flat envelope다. 요청 필드는 documentRevision, sourceHash, stage, status, attemptId, eventId 및 선택 code. actor·기록시각은 서버가 부여한다. code는 서버 whitelist만 허용하고 free-text message/detail/stack/payload는 받지 않는다.

stage: draft, validation, receipt, receiptVerify, cost, costSave, costVerify.
status: running, blocked, failed, unknown, passed.
같은 시도의 이벤트는 attemptId로 연결하고 eventId로 멱등 저장한다. 동일 이벤트 동일 요청은 기존 기록 반환, 동일 eventId 다른 payload는409. 이 계약은 attempt terminal 상태 머신이나 terminal 뒤 running 금지 등 추가 충돌 규칙을 요구하지 않는다.

로그 전송은 비동기 best effort다. ACK된 이벤트만 서버에 내구성 있게 저장됐다고 표시한다. 실패·대기 이벤트와 명시 로그 재시도 버튼을 제공한다. 로그 저장 실패는 업무 시작을 막지 않으며 입고·원가 쓰기를 반복하지 않는다. 별도 started-log gate 없음. 로그 재시도는 같은 eventId/payload만 전송한다. ERP 응답 불명은 기존 operation/cost recovery로 확인하고 browser failure report를 rollback 증거로 취급하지 않는다.

서버는 withAuth·활성 계정·canManageInvoiceReceipt와 현재 document sourceHash/revision을 확인한다. 브라우저 passed는 ERP 성공 증거가 아니다. draft/validation 등은 서버가 확인 가능한 저장/검증 근거에만 성공 의미를 부여한다. receipt/receiptVerify passed는 현재 revision의 COMMITTED operation과 documentId/revision/WarehouseKey 및 실제 검증 경로로 확인해야 한다. 메인이 Sartre에 해당 서버 검증을 요청했으며 구현 검증 완료로 선기록하지 않는다. 원가 승인·재조회 passed는 readInvoiceCosts의 정확한 현재 ACTUAL/APPROVED, storedStatus APPROVED, liveReceiptStatus MATCH와 현재 scope로 확인한다. 계산 미리보기 통과는 저장 승인과 구분한다.

실패 이벤트는 웹 로그 경로로 저장하고 기존 ERP transaction·성공 이력은 변경하지 않는다. ACK 실패를 성공 저장으로 표시하지 않으며 이전 passed 로그가 현재 stale을 숨기지 않게 한다.

## export API와 보안

GET /api/import/receipts/[id]/cost-export?warehouseKey=…&costRevisionId=… . GET은 엄격히 읽기 전용이며 WebInvoiceHistory export 이벤트도 쓰지 않는다. ERP writer/원가 승인/StockCalculation/WebArrivalCost 복제 호출 금지.

- withAuth + 활성 계정 + canManageInvoiceReceipt.
- 클라이언트는 식별자만 전달한다. 값·수식·셀 좌표·파일 경로·임의 template URL은 받지 않는다.
- 서버 문서/sourceHash/revision/현재 operation/WarehouseKey/정확 costRevisionId를 검증한다.
- 내부 승인 full snapshot과 저장 원가 행을 사용한다. 확인 false로 만든 editableInput은 export 원천이 아니다.
- readInvoiceCosts currentActual ACTUAL/APPROVED/MATCH와 snapshot/원가 line 신원을 확인한다. stale/조회 실패/다른 revision은 파일 없음.
- 렌더 뒤 응답 직전 현재 scope/live MATCH를 다시 확인한다. 응답 이후 원장 변화까지 방지한다고 주장하지 않는다.
- no-store·XLSX MIME·안전한 Content-Disposition. 다운로드는 선택 사항이며 원가 완료 조건이 아니다. 응답 제공은 디스크 저장 완료 증거가 아니다.
- 다른 공식/양식은 EXPORT_TEMPLATE_UNSUPPORTED. 원가 승인 자체는 유효하며 미지원 export 때문에 재승인/재입고하지 않는다.

## sanitized format JSON 배포

원본 SHA256 e1bb0315998c2f3550a0edab8353147612cd6c46d7247b287656eca1c3ee4233. layout 27-2 CLOUD, 공식 근거26-2 CLOUD/27-2 CLOUD. formula CN_AIR_WEIGHT_CBM_V1 1.0.0.

빌드/준비 단계에서 원본을 읽어 sanitized format JSON asset을 생성하고 source hash·asset hash·profile version·layout metadata를 고정한다. 운영 서버는 이 JSON asset만으로 출력하며 원본 private XLSX/사용자 Downloads 경로를 배포 필수조건으로 요구하지 않는다. 임의 template 자동 활성화는 하지 않는다. 국가 profile registry는 export 모듈의 재사용 가능한 계약이며 검증된 CN_AIR만 enabled다.

format은 셀 style·theme·width·row height·merge·인쇄 설정·허용 출력 위치를 보존하되 역사 셀 값·sharedStrings·comments/VML·숨은 값·수식/cache·외부 관계·docProps를 포함하지 않는다. 출력 OOXML은 단일 결과 시트로 구성한다. 문자열은 typed string으로 기록해 formula injection을 막는다. 원본 style index 보존과 필요한 styles/theme part를 검증한다.

24행부터 상세행 prototype을 동일 스타일·높이·병합 패턴으로 복제하고 dimension/filter/print references를 확장한다. 원본 없는 pageSetup을 추정 생성하지 않는다. 행 증가에 따른 페이지 수 증가는 허용하며 글꼴/열 너비를 축소하지 않는다.

## 값·단위 ledger

원본 결과 위치를 approved report로 사용하며 원본 역사 수식을 실행하지 않는다. 단수량·원문 priceUnit·ERP OutUnit을 구분한다. J/K/L/M/O 등 각 셀의 정확 분모와 component mapping은 exporter 테스트로 고정한다. 단 기준 칸에 STEM/BOX 값을 묵시 대입하지 않는다. 환산이 필요하면 저장된 검증 근거만 사용한다.

C7/C8/E8/C11/P10에는 현재 승인 환율/GW/CW/effective freight/통관총액만 사용한다. source freight에 share를 두 번 적용하지 않는다. P6:P9/R6:R7 비용 breakup은 근거 없으면 비우며 총액에서 역산하지 않는다. 별도 기타비가 있으면 총원가와 표시 component가 일치하도록 명시 매핑하고 누락/중복합산하지 않는다. 판매가·이익·역사 요율은 승인 근거 없으면 비운다.

원본 모순: 초기 AI SUMPRODUCT 분모와 후기 CW 분모 상이,17-1 MEL U9=T9/L11 오참조, 빈 그룹 t=e/v=7 오류,27-2 비활성 용적 음수 residual, 일부 P6=604*460 고정, '관세 없음'과 실제 관세 계산 공존. 양식 fidelity는 오류/역사 금액 보존을 의미하지 않는다.

## 수용 검증

- 로그 ACK 이후 재조회 보존·eventId 멱등·whitelist/free-text 거부·서버 actor·source/revision scope·위조 passed 차단.
- 로그 실패 중에도 기존 업무 진행, 명시 로그 재시도만 수행하며 ERP/cost write 횟수 증가 없음. 미저장 conversion/matching 서버 영속화 주장 없음.
- 현재 승인 CN_AIR만 export, 권한/비활성/다른 WarehouseKey·costRevisionId·source·revision·live STALE 차단.
- GET의 DB/ERP 쓰기 0, 다운로드 실패가 승인 원가·입고를 변경하지 않음.
- 실제28행 격리 승인 snapshot→export→재읽기 단위/행/component/합계 일치,0/null/false·취소행·교차연도 분리.
- sanitized JSON에 역사 값 없음, 원본 XLSX 없는 런타임 출력 가능, hash·single sheet·OOXML style/width/height/merge/print fidelity와 동적 행 검증.
- 기존 receipt/cost/STALE/응답불명 회귀, ERP gates/build,1920×1080/100% UI와 파일 렌더 확인.

## 상태

초기 worker 구현 계약을 바탕으로 구현 및 격리 SQL·원본 서식·UI·빌드 검증을 완료했다. PR #1023은 2026-10-12 master에 병합했다. 실제 운영 41-02 입고·원가 승인은 미매칭 및 CW 확인 전이므로 완료되지 않았다. 배포와 운영 읽기 확인 결과는 `docs/work-sessions/2026-10-12_invoice-cost-export.md`를 기준으로 한다.
