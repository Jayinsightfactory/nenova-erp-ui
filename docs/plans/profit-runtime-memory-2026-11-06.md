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
