# 주간 캐시 선행 guardian 근거 — 2026-10-27

기준 작업트리 `nw-profit-weekly-cache`, master `7ff11536`. 설계·부작용 기준은
`profit-weekly-cache-2026-10-27.md`이다. 이 선행 검토는 운영 저장·DDL·스케줄 등록을 하지 않았다.

## 실제 EXE 및 읽기 전용 SQL

실행한 CLI:

```powershell
& 'C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe' --no-color -t FormSalesView 'C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe'
```

실제 `FormSalesView.GetData`는 ViewShipment/ViewOrder의 OrderYearWeek·CustKey·ProdKey를 연결하고,
ShipmentDate.ShipmentDtm과 PeriodDay.BaseYmd를 연결하여 YearMonth/DetailFix로 매출을 읽는다.
웹 계산본 자동 캐시에 대응하는 EXE 저장 Form은 없다. 기존 ERP 매출/재고 계산을 수정하지 않는다.

SQL은 Request.query를 SELECT만 허용하도록 감싸고 execute/batch/Transaction.begin을 차단했다.
총 **6 SELECT 성공, 쓰기0**. 자격증명·개인명·원본 payload는 문서에 보관하지 않는다.

| 실제 PeriodDay 업무키 | 시작 | 종료 |
|---|---|---|
| 202642 | 2026-10-14 | 2026-10-20 |
| 202643 | 2026-10-21 | 2026-10-27 |
| 202644 | 2026-10-28 | 2026-11-03 |
| 202552 | 2025-12-24 | 2025-12-30 |
| 202553 | 2025-12-31 | 2025-12-31 |
| 202601 | 2026-01-01 | 2026-01-06 |
| 202652 | 2026-12-23 | 2026-12-29 |
| 202653 | 2026-12-30 | 2026-12-31 |
| 202701 | 2027-01-01 | 2027-01-05 |

`getCurrentWeek()`의 연중7일 분할은 10/28을43으로 산출하지만 실제 달력은44다.
따라서10/28수요일06시 저장 대상은43이며42가 아니다. 실제53차가 있으므로01의 직전을52로
하드코딩하지 않는다. 매수요일 직전1개라는 요청 때문에 짧은53차는 자동 슬롯에 걸리지 않을 수
있으며, 여러 차수를 몰래 저장하지 않고 명시 backfill/수동 갱신으로 보완한다.

## 기존 저장본의 회귀 위험

- Snapshot37~39 최신 저장일10/20,40~41은10/23;42~44는없음.
-39최신 v13은 CalcVersion `2026-10-06.1+3c202db0acb1`, 태국H0/E240000/F240000이다.
  이는10/27사진근거 수정 전 값이다. legacy를 무조건 빠르게 반환하면 최근 수정이 회귀한다.
- 신규 cachePolicy·계산 완료 필드가 있는 저장본만 빠른 경로에 사용한다. 구형/누락은 명시 준비 필요.
- 조사한2025/2026·37/38/42/43/44/52 범위의 활성/비활성 확정 행은0이다. 전체 확정 테이블이
  비었다고 일반화하지 않으며, 회귀 fixture에서는 활성 확정본을 반드시 보존한다.
- 기존 `TR_WebProfitReportSnapshot_Immutable`가 활성이다. 신규 스키마나 UPDATE/DELETE를 쓰지 않는다.

## 스케줄·잠금 및 검증 조건

기존 instrumentation의 판매 히스토리/입고파일 자동처리는 보존한다. 별도 production-only
runner가 마지막 도래한 수요일06시의 날짜를 고정하고 직전 한 차수만 전달한다. 빌드에서는
모듈 import만으로 SQL·타이머를 시작하지 않는다. process global은 같은 프로세스의 중복 tick만
막으므로 공통 저장 서비스의 동일 DB 세션 applock·슬롯 이력 확인·확정 재검사가 필수다.

첫 배포 후 기존 과거 차수 준비는 명시 `--apply` 실행으로만 한다. 실패/unknown/busy는 성공으로
표시하지 않으며 기존 계산본을 보존한다. 수량/금액/환율/수기/확정 변경은 이번 범위가 아니다.

필수 fixture: 수요일05:59/06:00, UTC/KST 자정, 목금 지연, 연말53, 날짜공백/중복/잘못된연도키,
다중 tick·worker, 실패 후 재시도, 유효본/활성확정 건너뜀, 현재/미래 backfill 거부, dry-run 무쓰기,
build/dev/edge 타이머0·SQL0. 전체 ERP 검증 및 운영 배포 검증은 메인이 기록한다.

## 구현 후 로컬 검증

- `node __tests__/profitReportWeeklySchedule.test.js` PASS: 실제 달력 차수/연말53/경계시간,
  내부·끝점 누락과 중복·잘못된 연도키 차단, strict backfill 범위, 순차·부분실패,
  SQL guard의 ERP DML/DDL/SP/SELECT INTO 차단.
- `node __tests__/profitReportWeeklyScheduler.test.js` PASS: build/dev/edge timer0,
  고정 슬롯 목금 catchup, 단일 tick/다음 슬롯/실패 재시도, 공통 원자 저장 서비스 멱등성 mock.
  실제 다중 운영 프로세스 DB 잠금 실행 검증은 이 테스트가 대신하지 않는다.
- `node scripts/backfill-profit-report-cache.mjs --year 2026 --from 1 --to 42`:
  dry-run, DB 연결·쓰기0. `--apply`는 실행하지 않았다.
- manifest base `7ff11536` 및 dnSpy evidence guard PASS. 공통 전체게이트와 실서버 import,
  운영 명시 초기준비/스모크는 메인 담당이며 여기서 완료로 주장하지 않는다.

운영 backfill은 `--apply --report <새 JSON 경로>`도 필요하다. 기존 보고서 파일을 덮어쓰지
않으며 각 차수 결과와 SQL INSERT 시도 횟수/차단 횟수를 기록한다. INSERT 시도 횟수를 실제
커밋 건수로 표현하지 않고, 저장 결과 `saved`를 따로 집계한다. 첫 실패에서 중단하고 부분
성공을 명시한다. SQL 오류 원문·자격증명·고객 정보는 기록하지 않는다.
