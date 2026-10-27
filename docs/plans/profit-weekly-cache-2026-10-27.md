# 주차별·월별 보고서 수요일 계산본 저장

## 사용자 요청과 범위

차수별/월별 조회가 느리므로 매주 수요일 현재 기준차수의 직전 한 차수를 계산·저장하고 조회 때 재계산하지 않는다. ERP 공유 원장을 보정하는 작업이 아니다. 기존 계산식·환율·수량·평가 정책은 보존한다. 테스트→PR→CI→Cafe24→운영 스모크까지 수행한다.

## 선행 증거 및 충돌

- 현재 일반 GET은 preferLive=true이며 저장본이 있어도 원천 연도 전체 지문을 조회한다. 월별은 같은 동작을 주차마다 반복한다.
- 기존 저장본에는 row.calc/합계가 없어 소비자가 현재 수식을 다시 적용한다. PayloadJson에 계산값과 저장정책 버전을 추가해야 한다(DDL 불필요).
- 기존37~39 저장본10/20 및40~41 저장본10/23은 최신 수정 전이며42~44는 없다. 기존 snapshot 무조건반환 금지. 신규 정책 계산본만 빠르게 읽는다.
- SQL PeriodDay:202643=10/21~27,202644=10/28~11/03. 단순 getCurrentWeek는10/28을43으로 잘못 산정한다. 전산 달력 정확매칭이 권위다.
- PeriodDay에는202553/202653이 존재한다. 예약 타깃을 전년52로 하드코딩하지 않는다. 기존 수량/원가 계산식의 연말 이월 정책은 이번 성능 작업에서 임의 개정하지 않는다.
- Snapshot은 INSERT-only WebProfitReportSnapshot이고 기존 테이블/불변 트리거를 사용한다. 활성 보고서 확정 revision은 항상 최우선, 자동 확정/취소 없음.

## 기준 ledger

| 기준 | 정책 | 소비자 |
|---|---|---|
| 시간대 | Asia/Seoul, 수요일06:00 | 스케줄/표시 |
| 현재차수 | KST 날짜와 PeriodDay를 정확매칭, 중복/공백은 임의추정 없이 오류 | 주별/월별/예약 |
| 예약 타깃 | 마지막 도래한 수요일06시 슬롯 당시 current의 직전 업무차수; 지연실행일 기준으로 이동 금지 | 예약 |
| 저장 범위 | 연도+대차수, 모든 품종/필터 전 전체 payload, 행 calc+합계+원천경고+저장정책버전 | 저장/읽기/출력 |
| 과거 기본조회 | 활성확정→신규정책 snapshot; fingerprint/원천재계산/이전snapshot조회 없음 | 주별/월별/엑셀 |
| 구형/누락 | SNAPSHOT_NOT_READY; 명시 생성·갱신 안내. GET자동계산/저장 금지 | 주별/월별 |
| 현재/미래 | 기존 최신계산 정책 보존; 미래를 과거로 오판하지 않음 | 일반조회 |
| 명시검산 | liveAudit/별도검산 요청만 원천조회; 활성확정은 보존 | 검산 |
| 수동재계산 | 기존 권한/연도 확인 후 새 계산본 INSERT, 실패시성공표시 금지 | POST |
| 예약 멱등성 | DB 동일세션 applock, 슬롯+연도+차수 중복 확인, 확정 재검사, 실패재시도 | 서버 작업 |
| 최초준비 | 배포 후2026년1차~현재직전차수 최신1회 준비. 유효 신규정책본/확정은 건너뜀. 명시 --apply 스크립트만 | 운영 배포단계 |
| 경고/누락 | NULL/확인필요를 그대로 저장, 캐시저장≠회계확정/검증완료 | UI/월별/엑셀 |
| 추가점검 | 접힌 과거 원장 참고/주차점검은 명시 실행 전 요청하지 않음 | UI |

### 월별 범위 사용자 최종 선택(동일 세션)

실제 SQL에서2026년 hasData는48차수(01~47,50)이며 현재/미래43·44·45·46·47·50의6개 live계산만으로37.9초/4688SELECT였다. 사용자에게 선택지를 제시했고 **"저장된 차수 우선, 최신 차수는 별도 조회"**를 선택했다.

- 월별 기본은 기존 hasData 중 현재 업무차수 미만만 포함한다(10/27기준1~42). 그 범위의 미저장/구형을 조용히 제외하지 않고 불완전 합계로 표시한다.
- 진행/미래 차수는 "최신 차수 포함" 명시 요청만 계산·합산한다. 해당6차수 제외 및 현재 포함범위를 화면/API에 명시한다.
- 단일 주간 현재차수 조회는 기존live. MOYI 등 기존 전체연도 소비자는 필요한 경우 includeLive를 명시해 동작을 유지한다.
- 본문 중 "현재·미래 기존live"는 개별주간 및 명시최신포함에 적용한다. 월별 기본조회에서는 원천 계산0이어야 한다.

### 실제 읽기 선행 검증

- 신규 v1 materialize를 실제41차 loadReportData에 적용:17행의 모든calc필드·합계 exact일치. live26.385초,전 과정1174SELECT/쓰기0.
-41차 구형계산본 display:96ms/5SELECT, SNAPSHOT_NOT_READY. 원천계산 없이 안전중단.
- 보호20테이블 관측 전후17개일치,OrderMaster/OrderDetail/ShipmentMaster는동시운영중변화. 본 probe는 Request DML/DDL/SP와 Transaction을 강제 차단했으므로 이 작업의 원장쓰기0. 전체DB가안변했다고과장하지않는다. 캐시행수도동일.
- 기존운영실브라우저41차조회성공,월별대기후HTML응답JSON파싱오류확인. 정확HTTP코드는이번관측에서확인하지않았다.

## 동작별 부작용

| 동작 | Order/Shipment/Date/Farm | Warehouse/Stock/Product/Estimate | WebProfitReport 수기 | Confirm/Detail | WebProfitReportSnapshot |
|---|---|---|---|---|---|
| 저장본 GET/월별/출력 | 보존 | 보존 | 보존 | SELECT | SELECT |
| 현재/명시 검산 GET | SELECT | SELECT | SELECT | SELECT | SELECT |
| 수동·예약·최초준비 계산 | SELECT | SELECT | SELECT | SELECT·활성보존 | 새 버전INSERT만 |
| 오류·캐시누락·중복예약 | 보존 | 보존 | 보존 | 보존 | 보존 |

DB schema/ERP SP/기존기록 UPDATE·DELETE 없음. EXE에 대응 자동저장 Form은 없으며 웹 결과 캐시다. EXE ViewStock/PeriodDay/매출 원천의 의미와 실제 dnSpy·SELECT 선행증거는 guardian 기록을 연결한다.

## 담당과 검증

- API/UI 구현: snapshot materialization, 빠른읽기, 공통저장서비스, 확정우선, 월별 batch, 화면/출력/명시검산 모드, 계약/회귀.
- 스케줄 guardian: PeriodDay/KST/53차 순수정책, 부팅훅·스케줄 runner·명시backfill, 실행형 경계/멱등성 테스트와 독립리뷰.
- Main: 기준/문서, 교차리뷰, 전체게이트, 운영 baseline·불변검증, PR/merge/deploy/스모크.
- cache hit에서 compute/fingerprint spy가0; 과거miss/legacy 자동계산0; 금액0/null 유지; calc함수가나중에달라도저장값불변; 현재live; 명시refresh1회; confirmed불변; 수요일06경계/연말53/UTC차이/gap·overlap; 다중worker중복/실패rollback; 월별missing숨김금지; 엑셀단일/범위숫자일치.
- npm run verify:erp-change, 표적테스트, manifest/writeguard(base origin/master), webpack build, 실제브라우저스모크. 운영 ERP/수기/확정 전후지문보존, 캐시만새버전증가를검증한다.

## 메뉴 기본선

적용: 저장시각/확정과캐시구분/키보드수동갱신/오류안내/기존필터보존/실브라우저. 해당없음: 신규메뉴·파일매칭·ERP반영. 기존표가로스크롤만유지하며관련없는레이아웃을재설계하지않는다.
