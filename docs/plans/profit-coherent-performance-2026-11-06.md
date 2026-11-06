# 최근 손익 지연 진단 및 동일 요청 원천 중복 제거

운영42 XLSX는2.5초 성공했으나 후속독립검산이120초 timeout, 44는최초본표가120초내완료되지않았다. 이는 아직 HTTP오류/전송중단/서버계산지연 중 어느것인지 확정하지 못했다. PM2 restart266/uptime05:36:34Z와배포시각의관계도현재설정만으로원인을단정하지않는다.

승인된진단만수행:

- 기존 profit-download-smoke workflow의 `readonly_api=true`: context→선택연도/차수 main GET 각1회, 전체180초deadline, Chrome/XLSX/output/audit/retry 없음. HTTPstatus/body.code/elapsed/financialbasis/outcome만로그. 토큰·원자료·비고·예외본문/stack 금지.
- 기존 deploy workflow diagnose_performance_only의 runtime script에 PM2 max_memory_restart/watch유무·개수/cron_restart/auto-restart/delay만익명허용필드로추가. 전체환경·watch경로·비밀값 출력금지. PM2설정변경/서비스restart/재배포없음.
- 앱금융source/API/DB/수식/조회정책 변경0. 원인확정후성능보완은 별도승인/검증대상이다. 사용자화면/업무순서 변경없으므로새가이드해당없음.

우선 `profit-download-smoke.yml --ref codex/profit-coherent-performance readonly_api=true year=2026 week=44` 한개만실행한다. main이실패하면출력요청을추가하지않는다. 기존독립검산timeout과본표조회진단을분리한다. script/workflow 및privacy/deadline/교차연도양성·반례 대상검사를수행한다. 운영실행결과는부모가추가한다.

## 2026-11-06 실제 진단 및 승인된 최소 보완

- GET-only42170549749: context200/786ms, main44 HTTP502/118767ms/non-JSON. 전후 PM2 restart266→267/pid변경, 502직전2초에 재시작. max_memory_restart1GiB/watchfalse/cronnull. 요청중 재시작은 확인됐으나 정확한 restart reason은 미확정이며 메모리 임계는 강한 후보일 뿐 확정하지 않는다.
- 읽기전용 크기 집계: 2026 snapshot44건/JSON총10,127,776B/최대445,698B, active confirmed0, invoice cost revisions3건/JSON총262,964B. invoice4N을 원인으로 단정하지 않고 bulk adapter 계획은 중지했다. 실제 dnSpy.Console.exe FormWarehouseView를 다시 확인했고 원장/EXE수정은 없다.
- 소스 편집 없는 loader profiler의 canonical44 최초1회:46.685초/2699SELECT/peakRSS388.53MB. raw44약17.9초, raw43약14.7초, dutycontext1.2초, average9.7초. invoice revision SELECT는4회뿐이다. WebArrivalCostLine FX동일연도 GROUP BY259회와 arrival 원천파이프라인 약260회가 반복됐다.
- exact-args 및 반환 변이검사를 추가한 baseline:46.229초/2699SELECT. arrival261호출/105고유/156중복/최대5회, FX원래입력259호출/19고유(내부에서는 동일 검증된 연도 집합). 반환값 소비후 hash변이0. 계측기가 반환reference를 보관하여 peakRSS486.17MB/heap287.53MB로 첫계측보다 높다.
- 승인된 수정은 요청 내부 promise memo 두 곳뿐이다: arrival의 모든 typed 인수+queryRunner 함수identity, FX의 기존 검증/중복제거 연도set(sorted key). 읽기SQL/필터/계산식/과거 취득원가 reference/원천 fence/기존 invoice 정책은 그대로다. 요청 밖 기존동작 그대로, 실패promise제거, 소비자별 structuredClone으로 변이격리. 전역TTL/cache/snapshot 생성/DB쓰기0.
- pairedafter44:34.294초/1403SELECT(시간−25.8%, 쿼리−48.0%), moneySHA256 `bc10325225a9df284f399d6a76905986678a4f646a91c0a96ddbef4a1ee19607` 전후 동일(rows.calc 전체+totals). 반환변이0/SQL실패0/기존 전후 fencePASS. FX GROUP BY259→1, arrival실제read261→105.
- 같은 계측조건 after peakRSS497.26MB/heap288.26MB이므로 메모리 개선은 입증되지 않았다. 남은120회 reader군/평균fallback단계는 유지하며 운영502 해결을 로컬시간만으로 완료판정하지 않는다. 배포 후 GET-only44 단1회와 PM2 restart delta를 재확인해야 한다. 출력은 main성공 이후만 검증한다.

계측 출력은 `.verify/profit-profile-{local,baseline,after}.jsonl`의 무시되는 로컬 산출물이다. SQL문/params/원자료/credential은 출력하지 않는다. 본표금액은 digest만 비교하며 operational DB의 INSERT/UPDATE/DELETE/MERGE/DDL/SP/재계산은 실행하지 않았다. UI/업무순서 변경이 없어 기존 명시조회 guide는 그대로 유효하다.

## 배포 후 UI 실패 분리 진단

PR1595 deploy42174149111 SUCCESS. 단독API42174802773 main44 HTTP200/92256ms/live, afterruntime42175112330 PID1187763/restarts268유지. 그러나 UI+XLSX42175253514 초기버튼활성120초timeout(파일없음), afterUI42175795442 PID1188275/restarts269/uptime06:36:04.120으로 해당조회중 추가재시작1회 확인. UI실패가409 source변동/502전송중단/200화면미적용 중 어느것인지는 아직 미확정이다.

diagnostics-only branch에서 기존 download harness의 실제요청만 관찰한다. scope/count/status/허용된bodycode/JSON성공여부/basis/실패·abort·pending 및 화면출력활성/기준표시boolean을 기록하며 추가fetch/retry/별도본표조회는 없다. API에러문자열/본문/행/URL/인증header/토큰은 출력하지 않는다. main200 JSON은 기존비교로 재사용한다. 초기timeout은 고정code만 출력한다.

정확한 PM2 memory 이유를 위해 기존 runtime read-only 진단에서 daemon pm2.log의 마지막4MiB 안 최근30분/선택erp PM2id의 `restarted because it exceeds --max-memory-restart value`만 집계한다. count/latestISO/current/maxMB 및 available/scoped/tailTruncated만 기록한다. 일치원문/개인경로/환경값은 출력하지 않는다. 기존 node-stdin packaging과 호환되도록 self-contained이다. 대상8회귀PASS, 운영원인확인은 부모실행대기이며 추가UIheavy조회는 보류한다. 앱source/fence/cacheclear/DB/설정변경은 없다.

## 원인확인 후 승인된 요청 캐시 수명 보강

PM2 daemon42176449563: count1/latest06:36:04/current1081MB/max1024MB. 따라서 UI조회중 memory-cap 자동재시작 원인은 확정됐다. 다만 ALS장수resource의 특정cache유지라는 누수인과는 미확정이다. 기존 `withErpReadContext` finally tail drain 직후 `context.caches.clear()` 한줄만 추가한다. 반환객체/내부cache객체가 아니라 namespace참조만 해제하고 externalEvidence/missing/errors 및 후속검증순서는 그대로다. disable/global clear/cap변경/금융source수정은 없다.

lifecycle·기존memo·독립검산16PASS, incomingApprovalProfit/dbDeadlockRetry/WeeklyCache16PASS, profiler2PASS. 성공/작업실패/삼킨SQL실패/근거실패/오류우선순위/동시·중첩/성공·실패 drain전cache유지/종료cache0/반환identity·0보존 검증. 첫 mssql dependency누락은 새worktree node_modules junction으로 해결. 실제SQL쓰기fixture 실행0. ctx 관련 source/VM/globalrg로 추가하네스수정 불필요 확인.

실제44 동일process sequential3회, forcedGC0/source반환reference보관OFF/각회응답해제, SELECT-only+기존sourcefence 유지:

|회|초|SELECT|peak RSS MB|종료 RSS MB|종료heap MB|종료namespace|
|---|---:|---:|---:|---:|---:|---:|
|1|29.812|1403|493.96|467.68|160.85|0|
|2|26.967|1402|526.15|471.00|228.00|0|
|3|24.672|1402|534.47|471.13|236.66|0|

모든회 moneySHA256는 이전 baseline `bc10325225a9df284f399d6a76905986678a4f646a91c0a96ddbef4a1ee19607`와 완전히 동일. 원자료/파라미터/자격증명 로그0, DB쓰기0. 종료RSS는 거의평탄하나 자연GC 영향을 포함하며 peak/heap은 상승했으므로 peak저감·누수제거·운영cap안전을 확정하지 않는다. 배포후 최소2회 운영조회+PM2 restartdelta0 필수(미검증). `.verify/profit-cache-lifetime-three-reads.jsonl`은 commits제외. 정식gate/build/cleanCI 진행대기.
