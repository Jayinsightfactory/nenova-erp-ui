# 입고관리 업로드일자 기본 조회기간

## 범위와 사전 근거

- 요청: 입고관리 최초 조회를 오늘 기준 달력 3개월 전부터 오늘까지로 변경한다. 기존 URL `from`/`to`는 각각 독립적으로 우선한다.
- 전용 브랜치 `codex/incoming-date-default`, 기준 `65635f23`. DB 쓰기, API/SQL/SP, 업로드·삭제·원가·환율 계산 변경은 없다.
- 실제 설치 EXE의 dnSpy `FormWarehouseView.FormWarehouseView_Load`는 시작 `DateTime.Now.AddMonths(-3)`, 종료 `DateTime.Now`를 사용한다. `GetData`는 `CONVERT(DATE, wm.UploadDtm) BETWEEN`으로 조회하며 `InputDate` 표시와 구분한다.
- 읽기 전용 SQL 사전 probe: 활성 WarehouseMaster의 2026-07-27~2026-10-27 업로드 1,112건. 같은 연도·세부차수의 태국 EXCEL WarehouseKey 7474(2026/39-01, 9/28 업로드), 7581(2026/40-01, 10/5 업로드)가 포함된다. 운영 쓰기 없음. 원천 조사 결과의 비용/중량 판단은 이 UI 변경 범위와 별개다.
- Next 번들 `02-pages/03-building-your-application/03-data-fetching/05-client-side.md` 확인. 기존 mount 초기화, 날짜 상태 기반 useEffect 조회, 요청 순서 보호를 유지한다.

## 기준 결정표

| 입력/상황 | 결과 |
|---|---|
| URL 날짜 미지정 또는 빈 문자열 | 한국 오늘 및 달력 3개월 전 기본값 |
| 명시 `from`/`to` | 해당 값을 그대로 우선, 다른 쪽만 기본값 |
| 오래된 날짜/다른 연도 URL | 최신 기간으로 덮어쓰지 않음 |
| URL `0` 또는 잘못된 비어 있지 않은 값 | 기존과 같이 보존; 새 정규화/검증 정책을 추가하지 않음 |
| 월말 | 대상 월의 마지막 날로 clamp; 90일 차감/JS setMonth overflow 금지 |
| 한국 자정/브라우저 다른 시간대 | Asia/Seoul 달력 날짜로 일정하게 계산 |
| 1월에서 3개월 전 | 전년도 10월 조회를 허용; 현재연도 강제 필터 없음 |
| 업로드 inputDate | 기존 UTC `toISOString().slice(0, 10)` 기본값 보존; 이번 요청은 조회 초기값만 변경 |

## 사용자 동작별 부작용

| 동작 | 브라우저 | WarehouseMaster/Detail/Product | Order/Shipment/Stock/Estimate/WebProfitReport |
|---|---|---|---|
| 기본기간/URL 복원 | 조회 날짜 상태 설정 | 보존 | 보존 |
| 자동조회/기간 수정/재조회 | 기존 GET 실행 및 URL 보존 | 기존 SELECT만 | 보존 |
| 상세 선택 | 기존 GET 및 선택 상태 | 기존 SELECT만 | 보존 |
| 목록 엑셀 | 기존 필터 목록 다운로드 | 보존 | 보존 |
| 업로드/삭제 | 기존 구현 그대로, 이번 검증에서 실행하지 않음 | 기존 계약 유지 | 기존 계약 유지 |

`apiGetExe`와 서버 `useExeParityFlag(undefined)=true` 기본 경로를 유지한다. legacy API의 InputDate 필터로 우회하지 않는다. 재조회 기간 확대에 따른 목록 수/응답시간만 달라질 수 있다.

## 구현과 검증 계획

1. 순수 helper가 주입된 시각에서 한국 오늘을 추출하고 달력 3개월 전 날짜를 월말 clamp한다.
2. incoming 초기화의 start/end만 helper 결과로 교체한다. uploadMeta, URL 저장, 조회/업로드/삭제 payload는 보존한다.
3. 기존 `incomingWarehouseDisplay.test.js` 실행 경로에서 새 날짜 테스트를 import한다. 별도 package 명령은 추가하지 않는다.
4. 실행 fixture: 2026-10-27, 평년/윤년 5월31일, 1월31일 연도 경계, 한국 자정 전후, UTC/서울/미국 실행 환경, URL 양쪽/한쪽/빈값/과거/비정상값 보존.
5. 기존 SQL UploadDtm BETWEEN 및 화면 GET/초기화/자동조회 경로 회귀를 검사한다. 필수 ERP 계약·dnSpy·manifest·write guard·build와 브라우저 smoke는 메인에서 수행한다.

## 완료 판정

테스트 또는 빌드 실패, URL 지정기간 덮어쓰기, 업로드 기본값 변경, API/SQL 변경, 초기 조회에서 쓰기 발생 시 배포하지 않는다. 최초 3개월 조회와 기존 URL 복원은 실제 브라우저에서 확인한다. 이 문서 작성 시 최종 테스트·브라우저·배포는 아직 미완료다.

## 구현 담당 검증 결과

- `npm run test:warehouse-upload` 통과: 기존 파서/정책, 표시, 입고 자동입력 10개 테스트와 새 날짜 회귀 포함.
- 새 회귀는 순수 helper뿐 아니라 `pages/incoming.js`의 실제 mount effect 본문을 실행한다. 한국 오늘 2026-10-27과 기존 업로드 UTC inputDate 2026-10-26을 분리해서 보존하는지 확인했다.
- UTC, Asia/Seoul, America/Los_Angeles 별도 Node 프로세스에서 조회기간이 동일함을 검증했다.
- `npm run test:erp-manifest -- --changed-from HEAD^` 통과: 162개 manifest 검사.
- `git diff --check` 통과. API/SQL/package/공통 WORK_MEMORY 변경 및 DB 쓰기 없음.
- 전체 `verify:erp-change`, 운영 브라우저 smoke, PR/배포는 메인 에이전트가 후속 진행한다. 이 절의 통과는 운영 배포 완료를 뜻하지 않는다.

## 메인 통합 검증

- `npm run verify:erp-change` 전체 종료0: ERP 계약, manifest, 쓰기 가드, webpack production build 통과. DB_SERVER 비움/운영 환경 파일 없이 실행.
- dnSpy evidence, 기준65635f23 manifest/쓰기 가드, `test:ui-layout` 57건 통과. 변경 API 0개.
- 메뉴 기준: 조회 맥락/URL 보존·회귀검증 적용. 기존 shell/스크롤/키보드 컨트롤 유지(레이아웃 변경 없음). 신규 매칭/대량적용/초안 기능은 해당 없음. 1920×1080 운영 화면 검증 및 릴리스 결과는 세션 기록에 후속 기입.
