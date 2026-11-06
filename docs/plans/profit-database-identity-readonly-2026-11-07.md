# 로컬·운영 실제 ERP 프로세스 DB 식별 읽기 진단

사용자 지시: 입력 인원이 없는 상황의 source-change 원인을 찾고 웹을 고치되 DB는 절대 변경하지 않는다. 현재는 원인 미확정이므로 앱 수정 전 진단만 승인됐다. quiet 운영42237081473 main80.958/81.529초·output80.762/81.966초/파일2회46570bytes1sheet·돈diff0/5xx0, after42238444484 PID1207146/restarts277 유지/RSS390/source변경·query실패0. 이는 미재현이지 원인 해소 증거가 아니다.

## 읽기 근거

- 실제 fingerprint 조립 함수를 합성63회 실행: unique-key 행 순서·병렬scope·cache clear로 이전JSON이 변하지 않음. 동일키에 다른값인 중복행을 주면 last-wins 반례가 있으나 실제 발생 근거는 없다.
- 승인된 스키마SELECT1배치:20 fingerprint tag의 실제23참조object 중22개 모두table/rowversion·computed없음, WebTaxableExchangeRate는 현재 로컬 연결에서missing. invoice 실제PK/unique가(CostRevisionId,LineId)/DocumentId/OperationId 정렬 tie를 막음. 정의·실제행값 반환0.
- 따라서 로컬진단과 실제 PM2 app의 DB가 같은지 확인할 필요가 있다. raw host/DB명을 비교하지 않고 동일 SQL이 SERVERPROPERTY('ServerName')+DB_NAME() 조합을 서버 안에서 SHA256으로 반환한다. 원문 이름은 클라이언트에 반환하지 않는다.

## 권한·기준표

|동작|기준|보존/반례|
|---|---|---|
|운영target선택|pm2 jlist는RAM에만, exact nenova-erp1개 online/양수PID|중복·stopped·0PID중단, 설정/재시작/pm2 save0|
|운영DB설정|해당 /proc/PID/environ의DB5필드만decode, buffer지움|필수server/name/user/password 없으면CONFIG_UNAVAILABLE, dotenv/다른앱 fallback0. PORT만canonical처럼누락/빈값1433,0false invalid|
|동일app확인|SELECT뒤같은exactonlinePID readback|변경시IDENTITY_TARGET_CHANGED, 재시작전결과를현재app의것으로오인금지|
|DB연결|새owned mssqlpool max1/connect15초/query10초/close finally|앱pool/설정사용·변경0,고정SQL1회만·다른query/batch/execute 차단|
|SQL결과|identity SHA64/Taxable table boolean/invoice table·exactunique scope숫자만|원문명/UUID/행값/SQLparams·정의·credential출력/파일/backup0|
|CLI출력|fixed PASS/FAILED code·검증된hash/metadata|console와직접stdout/stderr도억제, 원문error0|
|수동workflow|등록된deploy.yml diagnose_performance_only=true branch에만packaging|기존SSH/production concurrency재사용, deployjob/조건/push byte변경0, 새workflow·mastermerge·앱배포0|

최초 strict 범위에서는 Next dotenv 값이 초기 /proc에 없으면 CONFIG_UNAVAILABLE로 중단했다. 운영42240673358도 이 결과이며 앱 DB조회0이었다. 아래 Nov7 추가 승인 범위가 증명된 재구성만 허용하며, 추정 fallback은 계속 금지한다. 초기 필드가 있는 결과는 configSource=proc_initial_environ이다.

## 검증·현재 상태

순수privacy/실행fixture:DB5만decode·rawbuffer0/누락fallback금지/중복·0false/정확target·PID변경/연결·조회실패close/고정1SELECT·batch·execute 차단. 실제 node stdin으로기존packaging을실행해main1회/SELECT1/close1·rogue stdout/stderr 차단·CONFIG_UNAVAILABLE QUERY0 확인. Node20은manual job에서동일fixture를먼저실행한다.

로컬 동일SQL 승인1회 PASS: SHA `8f2642582be5007a84c48830afbf549cb6d0453431e9d717771e48c369f382ba`,Taxable table false/invoice tables4/exactunique scopes4,ownedpoolclose. 운영동일SQL은부모featurebranch dispatch대기(미검증), hash를그대로비교한다. 최초tuple관측이므로본표금액 SHA와혼동하지않는다. 추가full44/DMV/probe반복0, financial/ERP원장/수식/timeout/fence/메모리설정변경0, UI·가이드N/A. 이번branch는원인조사전용으로mastermerge/앱deploy를하지않는다.

완료대상6fixture/diffcheck PASS. 로컬기실행은당시CLI의기존환경정본기본경로를사용했으며, 이후기본경로하드코딩을제거했다. 현CLI기본은process.cwd(), 기존baseline 재현은동일환경정본디렉터리를PROFIT_ENV_DIR로명시설정한뒤 `node scripts/profit-database-identity-readonly.cjs local`로가능하다. 경로변경뒤추가SQL재실행은하지않았다. 표준manifest는ERP보존키OrderYear/OrderWeek/CustKey/ProdKey를요구하므로그키는보존계약이며 실제진단식별자는별도diagnosticIdentity로분리한다.

## Nov7 추가 승인: 증명된 Next env 재구성·독립 저널

42246363460 CANONICAL_NEXT_START_UNPROVEN/SQL0 뒤 entry proof의 과도한 literal 제한을 보완했다. exact ROOT/node_modules/.bin/next 또는 dist/bin/next 두 경로만 허용하고 realpath가 canonical dist entry와 같아야 한다. 다른 경로·잘못된 symlink target은 거부한다. 실패는 고정 CANONICAL_NEXT_ENTRY_UNPROVEN/ARGS_UNPROVEN/TITLE_UNPROVEN으로만 구분하고 raw값은 숨긴다. 나머지 strict 조건·SQL1회 제한은 동일하다. 정상symlink/오류target 회귀 포함 대상14PASS, 추가 실SQL0.

후속42245474108은 NODE_ENV_UNPROVEN이었다. 저널 full39459bytes/earliestOct19/latestNov6 11:21Z/partial187/두창 overlap0은 관측 범위이며 원인 완전 배제는 아니다. 이후 추가 승인은 NODE_ENV가 실제 미설정일 때만 canonicalNextStart 증명을 허용한다: exact PM2 pm_exec_path의 realpath가 ROOT/node_modules/next/dist/bin/next와 일치, args는 start 단독 또는 -p/--port+정규문자열1..65535만, proc cmdline은 알려진 next-server 버전 제목만 허용한다. 기존cwd/start/files 증명과 조회 후 metadata/title 재검증도 유지한다. configSource=verified_canonical_next_start_env/configProof=CANONICAL_NEXT_START_DEFAULT_PRODUCTION으로 구분한다. explicit empty/false/development/test/unknown은 계속 거부하고 raw args/title은 출력하지 않는다. 아래 초기 strict 설명의 NODE_ENV 미설정 거부는 이 증명이 없는 경우를 뜻한다. [Next 공식 환경변수 문서](https://nextjs.org/docs/app/guides/environment-variables)는 NODE_ENV 미할당시 dev 외 명령의 production 기본값을 명시한다. 자체 진단 RAM seed만 수행하며 앱 설정은 바꾸지 않는다. 최종 대상13PASS, 추가 실SQL0.

동일 identity SELECT 안에서 현재 DB sys.databases의 snapshot_isolation_state(정수0..3)와 is_read_committed_snapshot_on(boolean)만 추가 반환한다. 누락·문자열·범위 밖 값은 failclosed다. 설정 ALTER/별도batch/실SQL 추가실행/앱 readpolicy 변경0. 최종 대상12PASS/directmanifest202PASS/diffcheckPASS이며 실제 운영 설정값은 아직 미검증이다.

초기 proc DB5를 우선한다. 부족할 때만 exact canonical cwd, 초기 NODE_ENV=production 명시, 유효 PM2 시작시각, 실제 production Next env 파일 전부의 mtime<=appstart를 요구한다. 해당 설치 @next/env의 production 우선순위·변수확장을 자체 진단 프로세스 RAM에서 실행하고 원래 환경을 복구한다. 파일 existence/stat/hash/cwd/PID/start를 조회 전후 검증한다. 파일 내용/hash/설정값은 출력·저장하지 않는다. configSource=verified_next_production_env로 구분하며 증명 실패는 고정 reason의 CONFIG_UNAVAILABLE이다. NODE_ENV 누락을 next start로 임의 추론하는 분기는 없다.

DB 진단보다 먼저 고정 stock-recovery attempts.jsonl의 마지막4MiB만 읽는다. attempt ID는 RAM pairing에만 사용하고 두 Nov6 실패 UTC 창과 겹친 연도/차수/검증된 UTC/고정 status·code만 최대20 출력한다. partial pair/tail coverage 부족을 별도 표시하며 이 결과만으로 작업 부재를 확정하지 않는다. 저널이 없어도 고정 JOURNAL_UNAVAILABLE만 출력하고 identity 진행은 독립적이다. background history SQL·추가 full44·앱/PM2/DB 쓰기는 없다.

실제 설치 Next 코드를 VM에서 fake fs/env로 실행하여 우선순위·확장·복구·파일 drift·증명 실패를 검증한다. Node20 진단 runner는 lockfile 정확 @next/env 버전 한 패키지만 RUNNER_TEMP 격리 설치(--ignore-scripts/--no-save/--package-lock=false), 설치 버전 일치 assert 후 fixture 경로만 전달한다. repo lock/일반 deploy job/운영 환경은 변경하지 않는다. 새 단계의 실제 SQL 실행0, 운영 재구성·저널 결과는 부모 featurebranch dispatch 전 미검증이며 source-change 원인은 여전히 미확정이다.
