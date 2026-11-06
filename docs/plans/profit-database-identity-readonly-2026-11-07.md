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

Next가시작후dotenv에서DB변수를읽었다면초기 /proc environ에없을수있다. 이때엄격probe는CONFIG_UNAVAILABLE로멈추며추정config를쓰지않는다. exactcwd/NODE_ENV/Nextenv우선순위/파일mtime<=appstart 재구성은이번권한밖이며필요시별도검토한다. 초기필드가있는결과도 configSource=proc_initial_environ으로구분한다.

## 검증·현재 상태

순수privacy/실행fixture:DB5만decode·rawbuffer0/누락fallback금지/중복·0false/정확target·PID변경/연결·조회실패close/고정1SELECT·batch·execute 차단. 실제 node stdin으로기존packaging을실행해main1회/SELECT1/close1·rogue stdout/stderr 차단·CONFIG_UNAVAILABLE QUERY0 확인. Node20은manual job에서동일fixture를먼저실행한다.

로컬 동일SQL 승인1회 PASS: SHA `8f2642582be5007a84c48830afbf549cb6d0453431e9d717771e48c369f382ba`,Taxable table false/invoice tables4/exactunique scopes4,ownedpoolclose. 운영동일SQL은부모featurebranch dispatch대기(미검증), hash를그대로비교한다. 최초tuple관측이므로본표금액 SHA와혼동하지않는다. 추가full44/DMV/probe반복0, financial/ERP원장/수식/timeout/fence/메모리설정변경0, UI·가이드N/A. 이번branch는원인조사전용으로mastermerge/앱deploy를하지않는다.

완료대상6fixture/diffcheck PASS. 로컬기실행은당시CLI의기존환경정본기본경로를사용했으며, 이후기본경로하드코딩을제거했다. 현CLI기본은process.cwd(), 기존baseline 재현은동일환경정본디렉터리를PROFIT_ENV_DIR로명시설정한뒤 `node scripts/profit-database-identity-readonly.cjs local`로가능하다. 경로변경뒤추가SQL재실행은하지않았다. 표준manifest는ERP보존키OrderYear/OrderWeek/CustKey/ProdKey를요구하므로그키는보존계약이며 실제진단식별자는별도diagnosticIdentity로분리한다.
