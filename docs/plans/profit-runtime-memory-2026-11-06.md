# 운영 손익44 반복 출력 메모리 한도 점검

## 확인된 현상과 현재 권한

31af4f81e 기능/명시조회/guide는 로컬·CI·배포까지검증됐으나 운영44 main200/86.5초 후 output93초/502로최종main+file완료실패. 07:55:04Z PM2자동memoryrestart1032MB>1024MB가확인됐다. 앞선plain500은단독output200/85.888초로미재현이며정확원인은여전히미확정이다.

사용자가Node메모리설정점검·조정진행을승인했지만 현재단계는읽기전용진단확장이다. 다음설정값은미리정하지않는다. cap단순상향/임의512MiB/forcedGC/SQL쓰기/스냅샷·수식변경 금지. 실제설정확인→보수적계획/테스트/안전한rollback준비→부모승인실행순서다. 부모가git/CI/운영dispatch를소유한다.

## 진단 기준표 / 부작용

|입력/동작|출력/정책|부작용|
|---|---|---|
|PM2 node_args string/array 및NODE_OPTIONS|heap관련boolean+유효old-space숫자만; 실제proc와configured구분|원문인수/환경/경로보관0|
|실제proc cmdline/environ/exe|Node실행파일·첫argv관측형태확인. Next process.title덮음은actualArgs unavailable; metadatafallback unverified|proc읽기만, 신호/inspector없음|
|CLI vs NODE_OPTIONS|관측가능할때CLI우선, 명시0보존, 누락/invalid구분|설정변경0|
|실제PID의Node실행파일|같은exe의고정 -p만1회, validatedold-space한개만재현, NODE_OPTIONS비움/preload전달0|5초/4KiB제한 작은새process, 앱시작/SQL없음|
|freshprocess heaplimit|isActualAppHeap=false, 실제앱cgroup동일여부·unverifiedsource표시; 앱heap으로간주금지|실제앱GC/계측없음|
|PM2기존axm metrics|heapUsed/heapTotal/external/arrayBuffers 숫자, 누락null|새앱관측hook없음|
|host/procRSS/cgroup v1/v2|숫자만, 조상finite최소한도/unlimited/미가용구분|프로세스/파일/설정쓰기0|

Order/Shipment/Warehouse/Stock/Estimate/ShipmentDate/WebProfitReport 및확정·저장payload 전부보존한다. API/UI/금융SQL변경이없으므로새ERP DB/dnSpy프로브나가이드재촬영은해당없다. 기존ERP가드근거·원장불변계약을재사용하며무관운영query를추가하지않는다.

## 검증/해석

대상privacy회귀: string/array/omitted/null/false/0/중복last flag/underscore/invalid값/CLI우선순위/스크립트인수제외/preload·비밀값제거/Next title덮음unavailable/unverifiedfallback/cgroup1·2조상limit/unlimited/누락/실제PM2numericmetrics. Node stdin 기존workflowpackaging으로동작하는self-contained파일이다. 진단이환경·원문args·pm2jlist를파일이나로그로남기지않는다.

실제진단결과·runtime조정값·rollback자료는아직미정/미검증. rollback은전체PM2환경dump가아니라필요한이전heap숫자/설정유무와다른기존인수보존방식만안전하게설계한다. 최종완료조건은실UI44 main+실제파일을연속2회이상,금액차이0/5xx0/PM2추가restart0이다.

참조: [Node old-space](https://nodejs.org/docs/latest-v20.x/api/cli.html#--max-old-space-sizesize-in-mib), [PM2 node_args](https://pm2.keymetrics.io/docs/usage/application-declaration/), [V8 heap statistics](https://nodejs.org/docs/latest-v22.x/api/v8.html#v8getheapstatistics).

## 실제 진단 후 범위 정정: 먼저 겹치는 최신 조회만 공유

운영42188478063: 실제 Node20.20.2/V811.3, configured node_args/NODE_OPTIONS heapflag 없음. 실제 argv는 Next process.title 덮음으로 관측불가. 같은 executable의 fresh heap1995MB는 실제 앱 heap 한도가 아니며 같은 cgroup도 아니다. PM2 cap1GiB, host3893.84MB, cgroupv2 unlimited, 기존 metrics heapUsed170.34/heapTotal176.39MB. 최신9f860 배포42189534571 성공으로 당시 PID는 과거값이다.

512MiB는 canary 후보일 뿐 적용0. 로컬 Node24.16.0 동일process3회/forcedGC0/SELECT-only는38.718/37.715/39.023초, peakRSS387.79/403.96/413.27MB, peakheap235.56/240.64/230.64MB, 모두 이전돈SHA동일/cache0. 이전 true peakheap은276.58MB(종료heap237과구분). 로컬 RSS가 낮아도 Node20 운영 동등성·GC 원인·cap 안전은 입증하지 않으며 latency 증가는 원인 미분리다. 미완료 canary tooling은 unstaged보존/이번PR제외, 설정 적용 보류.

코드상 live main 완료 후 week-check 자동GET(auditLive=1), stock notes 자동GET(detail=1), 사용자의 outputGET이 각각 fullcalc를 요청한다. 첫 main 완료결과 캐시가 아니라 **그 뒤 겹치는 두 번째 wave**만 공동 as-of 읽기로 합친다. 실제 운영 동시 SQL 수/peak 개선은 미측정이며 반드시 세 요청이 모두 합쳐진다고 단정하지 않는다.

|기준|구현/소비자|보존/반례|
|---|---|---|
|exact year+major 일반 최신 조회|loadCoherentLatestReport → shareLatestProfitRead, globalThis Symbol Map|2025/44≠2026/44≠2026/43,0/false invalid bypass|
|공동 as-of|겹치는 호출만 기존 전후 source fence를 통과한 결과 공유|각 caller frozen/confirmed/calendar policy 별도; 수식/SQL/donor 보존|
|수명|성공/실패 settle 즉시삭제TTL0|완료결과/저장fallback 없음, 재요청 재계산|
|독립성|active ERP transaction/replay ctx join/register 완전 bypass, 각caller clone|승인/독립검산 보존, owner HTTP abort가 waiter취소 안함|
|부작용|Order/Shipment/Warehouse/Stock/Estimate/ShipmentDate/WebProfitReport/confirmed/saved 보존|SELECT-only, DB/운영설정쓰기0/UI변경0/guide N/A|
|반복검증|명시 repeat_recent_download exact2026/44만 UI+실XLSX2회|각120초/200/5xx0/금액diff0, 이모드만 무관 독립감사 분리·기본감사 유지|

합성 production Next build: 별도 임시 NEXT_DIST_DIR=.next-synthetic, 실제 helper/ERPctx 복사본을 서로 다른 main/notes API bundle로 컴파일. overlap source1회/clone isolation/실제 ownerHTTPabort 뒤 waiter200·동일money/year분리/ctxbypass/실패evict PASS. 원본hash 사전/사후동일, 원본계측주입/복원없음/DB0. 이는 productionAPI 전체 SQL부하 테스트가 아니며 실제 entrypoint 연결/정책/fence는 source contract로 함께 확인한다. 기존 actual dnSpy FormWarehouseView.GetData 근거는 [성능 계획](profit-coherent-performance-2026-11-06.md)을 재사용(업무키/SQL/쓰기변경0).

변경 후 실제44 SELECT-only **1회**:26.412초/1403SELECT/live, rows key/category/calc+totals moneySHA `bc10325225a9df284f399d6a76905986678a4f646a91c0a96ddbef4a1ee19607`가 이전baseline과완전동일. 종료namespace0/원천반환변이0/peakRSS503.91/peakheap284.60MB. 단일read라 동시peak감소증거 아님. 원자료/SQLparams/자격증명로그0/DB쓰기0.

대상18PASS+frozen6PASS/합성builtPASS. 최종gate/build/cleanCI는 부모sourcefreeze후1회 예정(현재미검증). 현재메모리설정 그대로 운영UI+실파일2회/돈diff0/5xx0 및 SHA/PID/restartdelta0 검증 우선, 실패시에만512재검토. 이전 output500 미재현/원인미확정 유지. runtime튜닝완료·운영OOM해소를 주장하지 않는다.
