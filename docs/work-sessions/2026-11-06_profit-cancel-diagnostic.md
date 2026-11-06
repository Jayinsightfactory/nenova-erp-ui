# 반복 손익 취소 실패 관측

질문: 첫main+실파일PASS 뒤 두번째main500/60초/ECANCEL인데timeout상향이나메모리변경없이원인을어떻게분리할까?

답변: after42199923355 PID1199984/restarts274/RSS429MiB/memoryrestart0으로이번실패는메모리재시작아니다.45초수동cancel은ECANCEL/driver60초timeout은ETIMEOUT이며HTTP시간은사전읽기와taildrain을포함해동일시금지.과거종료query는현재DMV로확정하기어려워추가실SQL/DMV중지한다.

변경: ordinary live shared owner의기존scoped query 실패만최대3회, PID/year+major/UTC/dispatch시phase/SHA12/elapsed/timerflag/dispatch+failure pool4숫자관측. SQL원문·params·오류·응답trace0. 기존runtime4MiB tail 최근30분 exactschema집계count/최신3건만, 이전PID보존. sourcefence/수식/SQL/타이머값/retry/원래erroridentity/activeERPctx보존·DB/설정쓰기0, UI변화0/가이드N/A.

검증: 대상21PASS, actualreader 함수합성5phase/45000ms/erroridentity/loggerthrow·owner1·성공0로그/ERPctxbypass, profilerhash동일/0false/null/crossyear/PID/privacy와runtime VM bounded4MiB PASS. 첫fixture SELECT접두누락은가드가정상거절하여합성SQL만정정. fullsuite/build/CI/운영실행은부모후속(미검증). 신규canary파일없음/oldworktree보존.

계속할때: docs/plans/profit-cancel-diagnostic-2026-11-06.md 및계약profit-read-failure-diagnostic 참조, sourcefreeze후부모가PR/CI/배포/readonlyrepeat 및runtime최신PID와최근failurePID대조. exacthash를기존로컬profiler그룹과비교하되SQLDMVquery_hash와혼동금지. 풀상태snapshot만으로blocking/계획원인확정하지않는다. 운영UI+파일2회/돈diff0/5xx0/추가restart0 미달성.

검색어: ECANCEL queryHash phase preFence postFence poolAtFailure explicitTimerFired PID readonly diagnostic
