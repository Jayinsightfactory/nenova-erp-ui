# 손익 source fence 불일치 관측·재고비고409 전달

운영42203821147 첫실파일PASS뒤 두번째main200/output409 PROFIT_SOURCES_CHANGED+stock-notes500,42205610701 main200뒤output409+stock-notes500 재현.85초quiet metadata source변경0/인보이스변경false 및실패시간창MAX시각후보0은이전409원인부재증거가아니다. GET callgraph에서금융DB쓰기경로는못찾았고정확변경component는미확정이다. ERP지문은2025/2026전체+global, invoice는합산digest; 미래차수도허용된reference 의존가능하므로범위축소하지않는다.

|기준|구현|보존/반례|
|---|---|---|
|whole signature 불일치일때만|기존before/after JSON문자열을메모리에서비교해owner1회로그|shape/SQL/SELECT횟수/fence판정/409throw/미래donor변경0|
|진단값|UTC/PID/scope/changedCount/최대20changes(component/year/major/added·removed·modified)/truncated/invoiceChanged/coveredYears|C/H/M값·금액·digest·SQL·params·오류원문0; invoice정확변경year는합산digest로알수없음|
|timestampOnly|C/H동일이고유효M만변경일때true;금융fingerprint부분도변하면false;shape불명null|timestamp무시·fence완화금지|
|소유자와실패|ordinary live owner최대1·loggerthrow무해·activeERPctxbypass|waiter추가로그0,기존45/60초/retry/erroridentity보존|
|runtime 집계|기존4MiB tail/최근30분/newmarker strictschema/최신3event|이전PID보존·raw로그0·추가SQL/endpoint/flag0|
|stock-notes|statusCode409+code PROFIT_SOURCES_CHANGED exact조건만409/code전달|generic문구유지·unknown/ECANCEL500·정상200그대로·원문응답0|

부작용: Order/Shipment/Warehouse/Stock/Estimate/ShipmentDate/WebProfitReport/확정·저장payload 전부보존, DB/메모리설정/수식/timeout/SQL변경0. 실패로그만추가. UI/작업흐름변경0/가이드N/A. 기존실제dnSpy/SELECT-only44금액동일근거는 profit-coherent-performance/profit-runtime-memory 계획재사용. 새probe/fullSQL/DMV0, 부모가fullgate/build/PR/CI/운영소유. 추가진단은상태관측이며원인확정·운영해소주장아님.

## 구현·대상 검증

대상27PASS: 실제reader 함수합성으로 before/after JSON내용·동일SQLsequence·current/prior args·force:true year범위·2회fence 유지, ERP/invoice-only 불일치동일409/owner1/waiter동일error/loggerthrow무해/activeERPctx로그0/성공로그0. component privacy·2025/2026/45미래키보존·timestampOnly true/false/null·최대20/truncated·PID/최근strictschema 검사, 실제runtime VM4MiB tail 새marker집계PASS. 실제stock-notes handler와실제scope파서로2025/2026정상200·known409·unknown/ECANCEL500·기존400/405 및generic문구/응답원문0 확인. 기존2개sourceassert는wholefence 비교의after변수표현만정정했다.

최종fullsuite/build/CI/배포·운영2회는부모후속(아직미검증). sourcefence 실패원인은지속미확정, quiet85초동일/현재MAX시간후보0은당시409반증이아님. 자동GET callgraph에서금융DB쓰기경로미발견(KCS/RAM캐시/readonly schemaassert, activity파일저널은fence외). explicit POST의같은값UpdatedAt/SavedAt touch는가능하나자동GET에연결되지않았다. 기존runtime512후보적용0·현재liveheap564.59MiB 관측도있어이진단을메모리설정완료로표현하지않는다.
