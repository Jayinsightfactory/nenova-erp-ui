# PDF 분석 504 복구

## 확인된 원인과 범위
parse-pdf가 전체 PDF를 단일 provider 요청으로 보내고 AbortSignal.timeout(180000)으로 중단하면 사용자와 동일한 504 문구가 발생한다. UI catch는 steps를 종료하지 않아 읽는 중이 남는다. 사용자가 지정한 41-1 중국 해상 ci1.pdf는 로컬 522104 bytes/7페이지이며 텍스트 추출 가능하다. 실제 provider 지연의 내부 원인까지 확인한 것은 아니다.

## 계약 / criteria ledger
- UI가 명시 유료 분석 버튼을 누를 때만 POST한다. 자동 재시도/분할/다중 유료 호출은 추가하지 않는다.
- POST async=true: 기존 PDF validation/auth/cache/quota/model/prompt 그대로, 작업 접수 후 202. GET jobId는 같은 인증 사용자만 조회. URL/응답에 원문 PDF/키/내부 오류를 노출하지 않는다.
- 원본 PDF는 디스크에 저장하지 않는다. 런타임 작업은 사용자 해시 디렉터리/UUID, 원본+국가+prompt/model cacheKey로 식별한다. 결과와 status는 atomic JSON으로 기록. 보관 건수/TTL/크기 제한.
- 계정당 실행 1개. 파일 기반 exclusive lock으로 중복 POST/다른 프로세스도 같은 실행을 재사용. 같은 key RUNNING이면 기존 jobId, 다른 key는 BUSY. 완료 결과 재사용은 추가 비용 없음. 시작/스토리지 실패는 외부 호출 전에 fail closed.
- provider 1회 제한, 최대 10분. GET은 짧은 조회만. 기존 sync 호출 호환 보존. timeout/중단은 FAILED, 성공 응답 전에 결과 저장. lock은 소유 jobId/token이 같을 때만 해제. 오래된 RUNNING은 deadline 이후 소유 프로세스 종료가 확인될 때만 중단으로 표시하며 live owner는 탈취하지 않고 자동 재실행하지 않는다.
- polling은 GET만, 최대 11분. 실패/네트워크 중단은 파일 유지와 명시 재확인 안내. 같은 파일의 POST 재접수는 진행 작업/성공 결과 재사용, 자동 유료 재시도 금지.
- 화면 진행 상태는 'AI 분석 중 / 결과 확인 중' 실단계만, 오류 후 active steps 제거. 완료는 기존 parse/원문 검토/매칭/입고 단계가 그대로 검증한다.
- 원본 hash/page numbering은 동일 PDF 그대로 유지. 부분 결과를 합치지 않는다. 0/false/명시값과 금액/품목을 변경하지 않는다.

## 부작용
| 동작 | 웹 runtime job/cache/quota | ERP Product/Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport |
|---|---|---|
| 명시 분석 시작 | 작업/한도 기록, provider 최대1회 | 보존 |
| 결과 조회/동일 작업 재연결 | 읽기, 만료 표시 | 보존 |
| 성공 | 검증 결과 cache/job 저장 | 보존 |
| 실패 | 실패 상태와 lock 정리 | 보존 |

dnSpy 입고 InsertMaster 및 ERP 저장 API는 호출하지 않는다. SQL/dnSpy 단위/저장 로직 변경 없음. 기존 FormWarehouseUpload 근거와 ERP 가드는 보존.

## 검증
동시 접수/다른 사용자 조회 차단/다른 key busy/성공 재사용/provider timeout/스토리지 실패/expired lock/잘못된 jobId/한도 실패/캐시 실패/정상 및 nonJSON 응답/GET만 재조회/화면 stale 보호. 1920×1080 및1280 UI. ERP 전체 gates/build 후 배포.

## 실검증 승인
2026-10-13 사용자 승인: 지정한 PDF 전체 7페이지, 추가 유료 AI 최대1회, 입고/재고 저장 없음. 캐시와 기존 작업은 먼저 재사용. 호출 전 private ledger 기록. 추가 실패 재호출은 하지 않는다.

## 독립 검토 후 필수 보강
- sync/async 모두 하나의 durable admission/runner 사용. lock 안에서 cache/same-key 결과 재검사 후 job 생성.
- provider 호출 직전 attempt 시작 표식을 원자 저장. dispatch 이후 결과불명은 FAILED + error.code=PDF_ANALYSIS_UNCERTAIN + retryJobId; 같은 파일의 기본 재접수로 새 분석 금지.
- 사용자가 추가 비용 경고를 별도 확인한 경우에만 retryJobId를 POST에 보내 새 attempt를 생성. 운영 실검증은 이 재시도를 실행하지 않는다(승인1회).
- per-uid 변경 직렬화 및 owner fencing. deadline만으로 live owner를 탈취하지 않는다. 이전 finally가 후속 lock을 삭제하거나 GET의 stale 판정이 SUCCEEDED를 덮으면 안 된다.
- jobId는 UUID, uid와cacheKey 일치/실패terminal/활성작업없음 검증. pre-dispatch 실패와 post-dispatch 결과불명을 구분한다.
- 결과 저장 실패는 성공/무료 재시도 근거가 아니다. 보관 정리는 terminal record만; runtime 저장실패는 구조화503 및 no-store.
- 추가 검토에서 recovery sentinel 소유자 종료 시 영구 busy를 재현했다. 짧은 사용자별 상태 변경 구간은 동일 호스트의 kernel-owned exclusive mutex(Windows named pipe / Linux abstract Unix socket)로 직렬화하도록 변경한다. canonical 사용자 runtime 경로 해시로 식별하고 프로세스 종료 시 커널이 잠금을 해제한다. TCP 포트 설정이나 외부 네트워크는 사용하지 않는다. 다중 호스트/컨테이너 분산 잠금으로 사용하지 않는다. 별도 실제 분석 active.lock과 영속 attempt는 유지한다.

## 추가 요청: 매칭 검토 동선 (2026-10-13)
- IPC 수명 근거: [Node 20 net IPC 공식 문서](https://nodejs.org/download/release/latest-v20.x/docs/api/net.html#ipc-support), Linux abstract socket v20.8+ 및 Windows named pipe 종료 시 해제. 이 저장소 Next16의 Node20.9+ 기준에 맞춘다.
- 원문품목 → 길이 → DB 매칭·확인사항 → 수량·가격 순서. 품목명 말줄임을 제거하고 필요한 줄바꿈 허용. 1920×1080/100% 우선, 작은 화면은 표 가로스크롤.
- DB 미매칭/유사확인은 native 버튼으로 기존 품목선택 창을 연다. DB ProdKey로 확인된 실제 ProdName을 표시하며 원문을 DB품목인 것처럼 표시하지 않는다.
- 후보는 같은 국가 범위, 원문 단어·순서·자모 유사도를 우선한다. 숫자/길이 차이는 경고, 추천은 자동 확정하지 않는다. packingSuggestions opt-in 밖의 공용 정렬은 보존한다.
- 사용자의 선택·저장은 기존 team-scoped packing.erp-matches/CAS/revision/actor 이력을 사용. 다음 업로드 fresh GET 후 같은 country+sourceKey에 적용. 삭제/다른국가/중복DB품목은 자동확정 금지.
- 실제 운영 매칭을 테스트 목적으로 임의 저장하지 않는다. 로컬 shared-store/두계정/reload fixture로 저장 및 재적용을 검증한다. 기존 입고·재고·원가 저장경로/수량은 보존.
