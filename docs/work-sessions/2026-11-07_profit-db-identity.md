# source-change 원인조사·로컬/운영 DB 식별

질문: 입력자가없는데도원천변경오류가나며로컬quiet메타probe는같다. 웹수정전어떤근거가필요한가?

답변: 실제조립함수63합성에서unique행순서/cache자기변형/병렬scope/clone원인은재현안됨. 중복키반례는현재SQL GROUP BY·실제unique스키마에서발생근거없다. 승인metadata1배치로22일반table에computed/rowversion없고invoice key unique확인. 로컬Taxable table missing이라실제PM2app의DB와동일한지hash만비교할필요가있다. quiet운영42237081473 파일2회PASS·PID1207146/restarts277 유지/source·queryfailure0은미재현이며원인해결증거아님.

변경: 앱아닌자가완결manual CLI+순수privacyfixture, 등록deploy.yml performance-only진단packaging에만연결/Node20fixture. exactERP1online PID/proc DB5 RAM-only/버퍼지움/필수값없으면CONFIG_UNAVAILABLE·추정fallback0. ownedmssqlpool1/15sconnect/10squery·고정SELECT1·finallyclose·PID일치검사. SQL에서서버+DB명SHA만반환·metadataboolean/count만, 원문env/jlist/설정/credential/error/stdout·stderr출력0/파일·backup0. 자동deploy/push조건과앱/ERP/수식/fence/메모리설정변경0.

검증: 실제node stdin에서main1회/SELECT1/close1·rogue로그차단/누락시QUERY0,기타target/PID/port/close/mismatch/privacyfixture PASS. 로컬승인1SELECT SHA8f264258…9f382ba/Taxablefalse/invoicetables4/uniquescopes4,금융금액SHA아님. 운영은부모featurebranch diagnose_performance_only=true dispatch대기(미검증). initial/proc에dotenv값없으면failclosed하며재구성은별도승인필요. 다음 docs/plans/profit-database-identity-readonly-2026-11-07.md·계약참조,hash대조뒤원인검토계속. mastermerge/앱배포·추가full44/DMV/DBwrite0.

검색어: DB identity CONFIG_UNAVAILABLE exactPID proc dotenv Node20 stdin metadata-only

Nov7 후속: strict 운영42240673358 CONFIG_UNAVAILABLE/앱 DB조회0. 별도 승인으로 exactcwd·명시production·유효appstart·모든Nextenv파일mtime 및 전후stat/hash/PID 불변을 증명할 때만 실제 설치 @next/env 재구성 허용. proc 우선/RAM-only/own환경복구/고정reason failclosed, NODE_ENV 누락 추론0. DB 성공과 독립적으로 고정 저널4MiB tail을 먼저 pairing/실패창 비교하며 UUID·owner·원문0, partial coverage를 명시한다. runner는 lock 정확 단일패키지 임시설치·버전assert, 일반deploy 변경0. 새 단계 추가SQL/앱·설정쓰기0, 실제 운영 재구성·저널 미검증/원인 미확정.

최종 대상11PASS/directmanifest202PASS/diffcheckPASS, 로컬Node24. Node20/manual 운영 증명과 저널 관측은 부모 dispatch 전 미검증이다. fullsuite/build·추가SQL은 실행하지 않았다.
- 추가 승인 두 필드만 같은 SELECT에 포함: 현재DB snapshotIsolationState 정수0..3/readCommittedSnapshotOn boolean. typed/privacy/누락·범위 회귀 포함 최종12PASS, batch증가0/설정ALTER0/실SQL0. 운영값 미검증.
