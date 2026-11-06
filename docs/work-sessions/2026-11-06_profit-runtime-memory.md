# 운영44 반복 출력과 Node/PM2 메모리 진단

질문: 기능/CI/guide는통과했는데큰main다음output에서1GiB cap재시작을어떻게점검할까?

답변: 사용자승인에따라runtime점검을확대하되현재는진단만. 07:55:04Z1032>1024MB PM2memoryrestart확정, V8old-space/PM2RSS불일치가능성은설정을읽기전단정하지않는다. 원래500단독미재현도원인미확정으로보존한다.

변경: self-contained 기존runtime-readonlyscript와privacyfixture. 실제proc/exe·첫argv확인, Next process.title덮음은unavailable, configuredfallback은unverified. old-space숫자와heap관련boolean만출력, 원문args/env/jlist/path보관없음. 고정Node통계새process는preload/NODE_OPTIONS를전달하지않고validatedoldspace만, 실제앱heap아님/cgroup동일여부표시. host/procRSS/cgroupv1·v2조상최소한도와기존PM2metrics숫자만사용한다. 앱/SQL/ERP원장/설정변경없음.

검증: 관련5회귀/syntax/diffcheckPASS. 운영읽기진단은부모commit/push/dispatch대기. 임의512/cap상향/forceGC/inspector/SQL쓰기금지. 실제결과후기존인수보존과비밀값없는rollback자료를포함한보수적조정계획을정한다. 최종조건인실UI44 main+file연속2회/금액차이0/5xx0/추가restart0은아직미검증·미달성이다.

검색어: runtime memory diagnostic heap PM2 1032 1024 argv process-title unavailable cgroup readonly
