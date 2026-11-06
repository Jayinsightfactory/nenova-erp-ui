# 운영44 반복 출력과 Node/PM2 메모리 진단

질문: 기능/CI/guide는통과했는데큰main다음output에서1GiB cap재시작을어떻게점검할까?

답변: 사용자승인에따라runtime점검을확대하되현재는진단만. 07:55:04Z1032>1024MB PM2memoryrestart확정, V8old-space/PM2RSS불일치가능성은설정을읽기전단정하지않는다. 원래500단독미재현도원인미확정으로보존한다.

변경: self-contained 기존runtime-readonlyscript와privacyfixture. 실제proc/exe·첫argv확인, Next process.title덮음은unavailable, configuredfallback은unverified. old-space숫자와heap관련boolean만출력, 원문args/env/jlist/path보관없음. 고정Node통계새process는preload/NODE_OPTIONS를전달하지않고validatedoldspace만, 실제앱heap아님/cgroup동일여부표시. host/procRSS/cgroupv1·v2조상최소한도와기존PM2metrics숫자만사용한다. 앱/SQL/ERP원장/설정변경없음.

검증: 관련5회귀/syntax/diffcheckPASS. 운영읽기진단은부모commit/push/dispatch대기. 임의512/cap상향/forceGC/inspector/SQL쓰기금지. 실제결과후기존인수보존과비밀값없는rollback자료를포함한보수적조정계획을정한다. 최종조건인실UI44 main+file연속2회/금액차이0/5xx0/추가restart0은아직미검증·미달성이다.

검색어: runtime memory diagnostic heap PM2 1032 1024 argv process-title unavailable cgroup readonly

## 후속: 설정변경 대신 겹치는 fullcalc부터 제거
운영42188478063 Node20.20.2/설정heapflag없음/actualargv Next title관측불가/freshheap1995실앱값아님/cap1GiB/host3893.84MB. Node24 로컬512후보3회 돈동일/RSS낮음은 운영동등성 증거아니며 latency원인미분리. 미완료canary scaffolding은unstaged보존·PR제외/설정적용0.
main완료뒤 live week-check/notes/output의 겹치는 read만 exactyear+major/Symbol registry로 공동as-of 공유. 기존fence/정책/수식/SQL보존, ERPctx bypass/clone/settle삭제TTL0·완료cache아님. 별도 Nextbuilt 두APIbundle/source1회/ownerHTTPabort뒤waiter200·동일money/ctx/error PASS·원본hash불변/DB0. 대상18PASS+frozen6PASS. actual44 SELECT1회26.412초1403SELECT/돈SHA bc1032…19607 동일/cache0/변이0/peakRSS503.91MB(운영안전증거아님).
기존workflow 명시repeat_recent_download exact2026/44 UI+실파일2회 추가, 이mode만 독립감사분리·기본감사유지. 부모sourcefreeze후 최종gate/build/CI/배포 및 운영2회·돈diff0/5xx0/PM2restartdelta0 예정(현재미검증). 이전output500 원인미확정/운영OOM미해소, runtime튜닝완료주장금지. 상세계약 profit-latest-inflight/계획 profit-runtime-memory-2026-11-06. 후속은canary제외 명시파일만stage.
검색어: overlap-only singleflight 공동asof TTL0 repeat_recent_download no-runtime-apply
