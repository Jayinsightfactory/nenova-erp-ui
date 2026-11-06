# 최근 손익 ordinary live 취소 실패 관측 기준

운영42198999887 round1 main200/81.666초·output200/84.290초·실XLSX46570bytes/1sheet·금액diff0·차단시도33/실제쓰기0 PASS. round2 main500/60.032초/ECANCEL 뒤 UI120초대기실패. after42199923355 PID1199984/restarts274 유지/RSS429MiB/memoryrestart0이므로 이번실패는 메모리재시작이 아니다. 실제 느린query/단계/대기원인은 아직미확정,512조정근거없음.

|기준|구현 범위|보존/반례|
|---|---|---|
|ordinary live shared owner만|기존 active ERP context return 뒤 owner callback에서진단 생성|transaction/replay bypass·waiter 추가로그0|
|ECANCEL/ETIMEOUT만·최대3회|query 실패 catch에서고정JSON|성공·다른error·잘못된scope 로그0, 로그실패가 원래error교체금지|
|phase|preFence/current/prior/duty/postFence, query dispatch시고정|나중phase변경으로 과거query를오표기하지않음|
|관측내용|year+major/PID/UTCtimestamp/SHA12/elapsed/timerFired/pool dispatch+failure size·borrowed·available·pending bounded숫자 또는 null|SQL원문·params·오류문자열·PII·응답trace0, getter만읽고 acquirehook0|
|SHA|기존profiler와동일 comment제거/공백/숫자IN 정규화 SHA256앞12|SQLDMV query_hash와동일시금지|
|최근집계|기존4MiB logtail 안 marker+exact key/type/enum whitelist 검증, 최근30분 count/최신3건만|과거·미래·원문·추가키·malformed 버림, 새endpoint/환경flag0|

기존45초 explicit request.cancel, lib/db60초 driver timeout, retry없음과 withErpReadContext taildrain/실패우선순위를그대로둔다. 수동cancel ECANCEL과 driver timeout ETIMEOUT은다르며 HTTP60초는사전단계+45초+drain시간을포함한다. pool dispatch/failure snapshot은상태관측일뿐 blocking/plan원인확정아님.

부작용: Order*/Shipment*/Warehouse*/Stock*/ShipmentDate/Estimate/WebProfitReport/확정·저장payload 전부preserve, SQL/수식/금액/재시도/반환/DB/메모리설정변경0. 추가부작용은실패시제한된기존app로그뿐. UI·작업순서변경없어가이드N/A. 기존실제dnSpy FormWarehouseView.GetData와실제44 SELECT-only동일돈SHA 근거는 profit-coherent-performance/profit-runtime-memory 계획을재사용하며 새fullSQL/DMV실행금지. 부모가전체gate/build/CI/운영검증 소유. 현재구현전계약이며최종대상검증결과를후속기록한다.

## 구현 후 검증 / 남은 판정

대상21PASS: 실제reader 함수 합성 실행으로 preFence/current/prior/duty/postFence 모두45초타이머유지·원본erroridentity·timerflag 확인, loggerthrow무해/성공0로그/공유waiter추가owner0/activeERPctx완전bypass. SHA는기존profiler exact정규화와일치. pool dispatch/failure snapshot과0/null/invalid/PID/crossyear 검사, strict JSON schema의과거·미래·추가키·원문·badtype 거절 및 실제runtime VM을기존4MiB tail로실행해safe최근집계만출력함을확인. 첫fixture는SELECT접두누락으로가드가정상거절하여합성statement만정정했다.

PID는각failure에 numeric으로포함하고최근30분의이전PID도함께보존한다. 현재PID로필터하여재시작전오류를숨기지않으며부모가배포baseline과대조한다. 풀snapshot은시점관측이라queue/blocking/계획원인확정아님. 미완료canary는oldworktree보존, 이번branch에없다. 새로운 fullSQL/DMV/HTTP실행0, runtime설정쓰기0. 최종fullsuite/build/CI/배포및운영2회판정은부모후속이며미검증. UI변경없고사용가이드97144 hash대상page변경0.
