# 선율 정산 ZIP 연결 기준

## 현재 승인 기준 — 아래 초기 설계·중간 중지 기록보다 우선

- 최신 사용자 목적은 ZIP 업로드 후 실제 정산 원천 자동등록과 매출자료의 정확한 소비다. 정확한 동일연도·선택차수 AWB와 검산된 비용은 worker callback에서 자동등록한다. 다른 차수 귀속·합산 입고·실제 수기 차액만 명시 확인한다.
- 검산된 실제 원천은 net/gross를 구분하여 읽기 계산에 우선한다. 기존 DB bytes는 변경하지 않는다. 원문과 기존 값이 net/gross 표현만 다르면 원문 근거로 검산하고, 설명되지 않는 차이는 사용자 확인 없이는 적용하지 않는다. 초기 설계의 '누락 필드에만 보충' 제한은 이 승인 기준으로 대체됐다.
- 연도 전체 활성 입고에서 정확 AWB의 타차수 귀속을 찾되 임의 이동하지 않는다. AWB가 없는 합산 입고는 일반 선택 UI와 원문 통화·결제금액 합계·GW 합계 동시 검산을 요구한다. 특정 실제 AWB 하드코딩은 없다.
- 과거/확정 계산본은 그대로 보존한다. 원천 등록과 보고서 갱신을 구분하며 과거 보고서 갱신은 사용자가 직접 실행한다. 신규 원천 저장으로 ERP 입고·재고·주문·견적·매출 원장을 수정하지 않는다.
- 최종 구현 표적 회귀25개와 기존 frozen/ActualCosts/중량 검사를 통과했다. 실제26건 캡처SQL·임시 원천 저장 replay에서24건 자동+2건 확인,26건 정확1회·잔여0,귀속35차14/36차12를 확인했다. 이는 격리 재현이며 운영 원천 적용은 별도다.
- 저장 파일의 scope·문서 fingerprint·합산·contentDigest를 검증하고 손상을 비용0으로 대체하지 않는다. 연도 전체 문서 중복을 저장 root lock 안에서 확인한다. 워커 재시도·heartbeat·임시PDF TTL·판독한도와 UI 재접속 복구를 유지한다.
- 최신 master 동기화 뒤 전체 ERP/영상/빌드/CI/배포 검증을 수행한다. 아래 16개/24개/미구현 상태는 진행 경과이지 최종 상태가 아니다.

## 범위와 보존

ZIP 업로드 → 첫 페이지 무료 OCR → 문서/금액 검산 → 같은 연도·대차수·AWB 연결 검토 → 명시 확인 → 웹 파일 원천 연결 순서다. ERP 및 웹 DB 테이블에 쓰지 않는다. 기존 packing OCR worker는 변경하지 않는다.

## 최신 구현 기준 — 아래 중간 정지 기록보다 우선

최종 사용자 목적은 매번 ZIP 업로드 후 확실한 정산서를 자동등록하고 실제 원천을 매출 계산에 사용하는 것이다. 과거 저장·확정 계산본은 자동 갱신하지 않는다. 다음 기준이 이전 'DB 입력 항상 우선/전체 명시 연결' 초안을 대체한다.

- 워커 callback에서 같은 선택 연도·현재 귀속 대차수의 유일 활성 AWB를 자동등록한다. 브라우저가 닫혀도 진행하며 부분 실패는 재연결 시 재검증한다. ZIP/파일명 차수는 쓰기 식별자가 아니다.
- 같은 연도 전체 활성 입고를 조회한다. 유일한 타차수 exact AWB는 실제 귀속을 제시하고 사용자가 확인한다. 삭제 입고·전년도·알파벳 오인식은 제외한다. 하이픈·공백·개행만 제거한 정확 11자리 AWB를 쓴다.
- 다른 AWB 합산 입고는 자동 추정하지 않는다. 원문 통화가 확인된 같은 차수 후보를 명시 선택하고, 관련 신고서의 결제금액과 GW 합계가 입고와 동시에 정확히 일치해야 등록한다. 원문 식별자와 선택한 입고 AWB는 별도로 보존한다. 특정 실제 AWB 하드코딩 없음.
- DB raw 합계가 원문 net 또는 gross와 정확히 일치하면 표현 기준 대사로 자동등록한다. 그 원문 증거 없이 과거 DB값을 재해석하지 않는다. 실제 차액·명시 ItemCount 충돌은 사용자 확인 후 파일 원천에만 기록한다.
- 승인된 정산 원천은 읽기 계산에서 우선한다. 국가 선율은 gross(베트남 net), 새 콜롬비아 통관·검역대행은 net. 이전 split 전체를 한 번만 치환하여 중복 합산하지 않는다. DB 원문은 그대로이며 입력표의 다른 필드 저장이 연결 원천을 DB에 자동 복제하지 않는다.
- 태국 최근 수기 net-assumed 소비자에는 새 파일 gross phase만 명시 표시하여 한 번만 VAT를 제거한다. 기존 DB 수기의 기존 정책은 바꾸지 않는다.
- 연도 전체 신고번호 중복을 최종 root lock 안에서 확인한다. 다른 차수에 이미 등록한 신고번호를 재업로드/입고 변경으로 이동하거나 중복 등록하지 않는다. 같은 신고번호 다른 원문 금액은 보류한다.
- source 파일은 year/major/document scope, 실제 유효 날짜, 문서 fingerprint, 원문 비용 재합산=저장 values, 전체 content digest를 검사한다. 정상 양수 정수 1개 손상도 fail closed다. 원천 오류를 H=0 fallback으로 숨기지 않는다.
- 원PDF는 private sidecar(600), manifest는 metadata만 기록한다. 완료/만료 시 원PDF 삭제, claim lease 및 3회 상한, 최초 인증 실패/재인증 backoff, heartbeat를 사용한다. 화면은 실제 연결·대기·귀속 검토·판독 차단을 구분하고 jobId만 보관하여 새로고침 복구한다.
- 첫 페이지 Windows KO 2000/3000 확대 후 식별자 실패에만 같은 페이지 작은 header crop RapidOCR를 1회 사용한다. i/I를 1로 치환하지 않고 두 유효 판독이 다르면 보류한다. 그 밖 페이지 자동 OCR 없음.

## 구현자 최종 표적 검증 (운영 적용 없음)

- 두 신규 파일의 25개 실행형 회귀 PASS, 기존 customsWeightPolicy/ActualCosts PASS. 기존 frozen loader 6개 PASS(과거·확정 금액 보존, 최신 source 파일 전후 지문 변경 시 전체 보류 포함).
- 실제 26PDF의 첫 페이지 비용·식별자 검증 PASS. 이전 신고번호 보류 2개도 실제 전용 worker로 local replay하여 각 첫 페이지만 처리하고 검산 성공했다. 후면 21개 세금계산서 대사는 부모의 독립 보고서 근거이며 중복 비용으로 더하지 않는다.
- 캡처 SQL과 실제 판독 결과를 mock reader/격리 임시 파일 원천에 replay: 35 ZIP 13개 자동등록, 36 ZIP 11개 자동등록+2개 제안 확인 등록. 26개 모두 정확히 1회, 자동 24/확인 2/잔여 0. SQL 귀속은 35차 14개·36차 12개다. 이는 격리 파일 replay이며 운영 원천 등록을 실행했다는 뜻이 아니다.
- 사용 가이드 새 자동 흐름 dry-run PASS, SSR/client 연도·차수 hydration 오류 0, 자동 완료 뒤 입력표 재조회 확인. 영상 실제 촬영·재생 검증은 부모가 최신 master 동기화 후 진행한다.
- `npm run test:erp-contract`의 pretest 고정 목록에 두 신규 회귀를 연결했다. manifest 207 PASS, diff whitespace 검사 PASS. 전체 ERP gate/build/CI/운영 원천/PR/배포는 부모 담당이며 아직 미검증이다.

## 최신 master 동기화 후 후속검증·실가이드

- a7a27d79 동기화 후 source-sliced fixture의 새 settlementScopeFence 의존성을 전수 확인했다. 진단 두 파일과 WeeklyCache fixture에 명시 mock/정산 원천만 변한 409 반례를 추가했고 frozen calendar fixture는 새 fence 호출을 금지한다. 관련 7파일 33개 PASS. production guard를 완화하지 않았다.
- `npm run posttest:erp-contract` 1회 exit0 PASS. 전체 ERP의 pretest/main은 부모 실행에서 통과했고, 최종 전체 ERP·정식 build는 부모가 별도로 수행한다.
- 실제 사용 가이드 촬영 완료: `public/guides/customs-settlement-zip/support.mp4` 44.45초/1920×1080/20fps/100%, 약1.36MB. 한국어 VTT·4개 목차·proof JSON 등록, registry ready. 합성 연습자료/API와 격리 파일 원천만 사용, 운영 쓰기0.
- 실제 영상 중간/최종 프레임을 직접 확인했다. `scripts/customs-settlement-guide-player-smoke.cjs`는 실제 MP4 재생·역할 버튼·4목차 seek/초점·한국어 VTT·다운로드 링크·접기 일시정지·Enter/Space/Tab/Shift+Tab·1920/390 폭 검사 PASS. 영상206/VTT200 응답, API 모두 합성, 운영 쓰기0.
- `npm run test:workflow-guides`, `node scripts/check-workflow-guides.cjs --changed-from a7a27d79`: 9 workflow/10 video PASS. UI 소스 hash는 동기화 직후와 동일하며 앱 소스 추가 변경 없이 촬영했다.
- 실제 26건 replay 재현·관측 요약은 비공개 `.verify/replay-customs-captured.cjs`, `.verify/customs-replay-result.json`; 과거 실제 worker 2건 관측 stdout 보존은 `.verify/customs-worker-observed-results.json`에 별도 provenance로 기록했다. 비공개 증거는 Git에 포함하지 않는다.

## 최종 UI 안전보완·재촬영 (앞의 44.45초 영상 기록 대체)

- 국가 비용 연결은 stem 전체를 effectiveRow로 표시한다. 연결된 `_1` 외 기존 DB `_2/_3`를 화면/preview에 다시 섞지 않으며 전체 그룹을 read-only로 둔다. 다른 입력 저장 시 source-covered 그룹은 원DB parts만 보존하고 원문이 없던 part는 전송하지 않는다. 합성 수치로 실제 countryValue/countryOut 함수 body를 실행한 회귀가 이를 검증한다.
- 자동 source 완료 알림만 `load({preserveEdits:true})`로 미저장 국가/콜롬비아/단가 초안을 보존한다. 명시 조회·저장은 기존 초기화 정책을 유지한다. captured year/week와 request sequence로 이전 응답의 data/error/loading을 차단한다. 새 ZIP 뒤에 도착한 구 ZIP polling도 기존 sequence 방어를 실행형으로 검증했다.
- 신규 두 파일 28개 회귀 및 기존 UI 관련 4파일을 합친 표적 32개 PASS. 해당 추가보완 이후 전체 ERP/build는 부모의 최종 실행을 기다린다.
- 앞의 영상은 폐기·대체하고 최종 UI를 다시 촬영했다. 최종 MP4 **50.9초**, 1920×1080/20fps/100%, 한국어 VTT·4목차·4개 source hash(새 presentation helper 포함) ready. 가이드 실제 DOM은 2개 DB 분할값이 연결 합계 1칸으로만 표시되고 연결 그룹 6칸이 read-only인 것을 확인한다.
- 중간·최종 프레임과 실제 player(재생/역할/목차·초점/자막/다운로드/접기 일시정지/키보드/1920·390) 재검증 PASS. 최신 media 응답 MP4 206/VTT 200. 전체 workflow 9개/검증영상10개 및 manifest208/diff-check PASS. 모든 API 합성, SQL/운영 쓰기0, 임시 서버 종료.

| 동작 | Warehouse/Product | Order/Shipment/Estimate/Stock | WebCustomsWeekly/WebColombiaWeekly | WebProfitReport/확정/snapshot | 웹 런타임 파일 |
|---|---|---|---|---|---|
| 업로드/OCR | 보존 | 보존 | 보존 | 보존 | 제한된 임시 PDF 작업 |
| 미리보기/재검증 | SELECT | 보존 | SELECT | SELECT/보존 | 읽기 |
| 명시 연결 | 보존 | 보존 | 보존 | 보존 | 원자 연결/감사 |

## 기준 ledger

- 업무키: 선택 OrderYear+MajorWeek+정확한 11자리 AWB. 입고 전체 헤더를 같은 범위에서 읽고 유일한 세부차수/비용 풀만 허용한다. 날짜/파일명만으로 차수를 추정하지 않는다.
- 비용: 정산서 비용코드별 승인 mapping의 net 또는 total만 사용한다. 공급가+VAT=행합계, 행합계=정산총액을 모두 검산한다. 모르는 비용코드는 차단한다.
- 중복: PDF SHA와 발행자+정산서번호를 비교한다. 동일 문서 재압축/재업로드는 no-op, 같은 번호 다른 내용은 차단한다. 별도 정산서번호의 분할은 합산한다.
- 보존: DB 명시 0 포함 기존 입력은 우선한다. 다른 금액은 충돌로 표시하고 자동 대체하지 않는다. 과거 frozen/확정/저장 계산본은 그대로다. 별도 기존 계산본 갱신 경로만 안내하고 자동 실행하지 않는다.
- preflight/apply: 같은 buildSettlementPlan, 저장 직전 원천 재조회와 digest 대조. 잠금 하의 단일 파일 atomic rename이 원자 경계다. DB와 파일 이중 쓰기는 없다.
- 개인정보: OCR 원문 전체/상단 업체/하단 계좌를 서버에 결과로 저장하지 않는다. 첫 페이지 비용·BL·정산일자 영역만 worker에서 추출한다. 계좌·자격증명·실제 PDF는 Git/로그에 넣지 않는다.
- 화면: 기존 shell, 페이지 스크롤, 의미 있는 버튼, 키보드, 선택범위 변경 시 이전 결과 폐기. 업로드 완료와 연결 완료 및 계산본 갱신은 구분한다.
- 가이드: 최종 실제 화면 1920×1080/100%, 합성 자료로 업로드·검토·중복·명시 연결·보존 안내를 녹화한다. 영상/VTT/목차/proof 등록·재생검증 전 완료 아님.

## 실제 근거 및 검증 상태

실제 35/36차 각 13PDF(전체 232쪽)의 첫 페이지가 스캔 정산표임을 확인했다. 각 첫 1쪽, 총 26쪽만 판독하여 페이지 수 88.79%를 줄인다. 2행 세금 전용 분할 정산서와 4행 정산서를 지원한다. 비용합계(a)만 검산하며 미수·이월·입금액은 비용합계와 같다고 강제하지 않는다.

실제 dnSpy.Console.exe로 FormWarehouseView를 재추출(exit 0)했다. GetData는 Master OrderYear/OrderWeek/OrderNo/InvoiceNo, GetDetail은 WarehouseDetail을 조회한다. 삭제·수정의 StockCalculation 호출은 신규 파일 연결에 사용하지 않는다. SELECT-only 2026/35·36 입고 1,452행, 국가 입력 6행/CO 입력 0/활성 확정 0/저장 계산본 17버전, 전년도 같은 차수 헤더 86/116개를 확인했다. 26PDF 중 24개는 정확 AWB로 연결 가능하고 2개는 exact AWB가 없어 보류한다. 비공개 원문·금액·계좌·파일명은 Git에 넣지 않는다.

새 비용/VAT 승인: 관세는 H 포함, 수입 부가세는 제외. 국가 선율은 통관+검역대행 합계 gross(베트남 net), 한국방역에는 넣지 않는다. 콜롬비아 신규 통관/검역대행만 net로 연결한다. 기존 HandlingFee 의미를 일괄 net/gross로 재분류하지 않는다. 명시 ActualQuarantineAgencyFee=0 유효, 기존 ItemCount 명시값이 있으면 충돌 보존한다. VAT 숫자만 판독불가이고 net/total이 엄격 인식되어 정확 10% 관계·전체 정산합계까지 일치하면 차액 검산 VAT_DERIVED_FROM_NET_TOTAL을 명시 표시한다. net/total/tax/grand total 추정은 금지한다.

report replay/context에서 externalEvidence 미제공이고 외부읽기 금지이면 파일 원천은 bypass/진단한다. live는 erpContextCache 단일 Promise snapshot으로 국가/CO의 revision 혼합을 막으며 최신 보고서의 전후 원천 지문에 연도별 연결파일 digest를 포함한다. frozen/확정 계산본은 재계산하지 않는다.

현재 구현 진행 중이며 운영 적용/배포/영상은 미검증이다. 워커 설치는 전용 TaskName과 pythonw로 기존 packing 작업을 보존하며 운영 연결 적용은 시험하지 않는다.

## 2026-11-10 사용자 추가 설명 후 중간 정지

사용자는 전체 PDF와 웹 통관비가 100% 일치하는지 대조를 요청했다. 첫 페이지 4종 정산비용만 확인한 결과를 웹 H 전체(백상창고료·국내운송·한국방역 포함)의 100% 검증이라고 해석하지 않는다. 부모가 뒤 증빙과 전체 H 구성요소를 대사하는 동안 추가 구현·배포 준비를 중지한다. 사용자는 원천 연결만 수행하고 보고서 계산본 갱신은 직접 실행하는 흐름을 확정했다.

- 대상 `node --test __tests__/customsSettlement.test.cjs`: 16개 PASS. 전체 ERP gate/build/CI/배포 미실행.
- 비공개 실제 OCR+캡처 SQL offline 검증: 26개 중 24개 첫 페이지 정형 검산 통과, 2개 신고번호 ASCII 판독 보류. 숫자 i/I를 1로 추정하지 않는다. 메타데이터 전용 추가 RapidOCR는 미구현이다.
- 35차 13개: OCR 검산 11/보류 2, 매칭 보류 1, 기존 DB 충돌 대상 5, 충돌 대상 제외 연결 가능 문서 3/필드 6. DB 동액 보존 필드 5.
- 36차 13개: OCR 검산 13/보류 0, 정확 AWB 미매칭 2, DB 충돌 0, 연결 가능 문서 11/필드 20.
- 위 집계는 해당 문서의 선택·검산·원천 연결 가능성이고 H 전체 완전성이나 실제 적용 성공은 아니다. 문서별 실제 금액/원문/계좌는 Git에 보관하지 않는다.
- 가이드 dry-run은 합성 브라우저 단계 timeout으로 실패했다. standalone 통관 화면의 SSR 연도/차수 hydration 경고도 관측했다. 가이드 상태 draft, 실제 영상 미제작. 최종 UI 검증·촬영·재생·완료 판정 금지.
- 운영 DB 접속/쓰기/SP/원천 연결 시험/커밋/푸시 없음. 테스트 서버는 종료했고 변경 소스는 작업트리에 미커밋 보존했다.

검색어: 선율 정산 ZIP 첫페이지 100% 통관비 대사 미완료 H 창고료 운송비 한국방역 24 26 source-only 직접계산본갱신
