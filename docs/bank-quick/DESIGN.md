# 은행 거래내역 수집기 설계 (1차 하나은행 기업뱅킹 HANA)

## 구조
사장님 PC 전용 프로필 Playwright(`scripts/bank-quick/_profile`, headless=false, chrome) → 은행 빠른조회 화면(조회만) → 결과 표 파싱 → `bank.Txn`(원본 그대로 + RawJson) → 대조 뷰(후속).
- 코드: `lib/bankQuick/{core,schema,loader,credentials}.js`, `scripts/bank-quick/{probe-nh,collect}.mjs`, `register-account.ps1`
- DDL: `docs/migrations/2026-11-03_bank_schema.sql` (bank 스키마만, SQL Server 2016, 멱등). dbo/ecount 쓰기 없음.
- 테이블: `bank.Account`(마스킹 번호만) · `bank.LoadBatch` · `bank.Txn` UNIQUE(AccountKey, RowHash).

## 은행별 조건
| 은행 | 방식 | 입력 | 비고 |
|---|---|---|---|
| 하나(1차) | 기업뱅킹 로그인 세션 재사용 | 사람이 ID+인증서/OTP 로 로그인, 자동 로그인 금지 | 아래 HANA 절 참고 |
| 농협 | 빠른조회 | 계좌번호 + 비밀번호 4자리 + 생년월일(주민번호 앞 6자리) | **사전에 영업점/인터넷뱅킹에서 '빠른계좌조회' 등록한 계좌만**. 비밀번호는 TransKey 보안키패드(마우스입력기). 사업자번호 입력란 없음 |
| 국민 | 빠른조회 | 계좌번호+비밀번호+사업자번호 | 미조사 |
| 우리 | 빠른조회 | 계좌번호+비밀번호+사업자번호 | 미조사 |
| 기업 | 빠른조회 | 계좌번호+비밀번호+사업자번호 | 미조사 |
| 신한 | 인터넷뱅킹 로그인 필요 | - | 정식 API 경로(lib/shinhanApi) 유지 |

## 하나은행 기업뱅킹(HANA, 1차 대상)
- 로그인은 사람이 하는 인증(ID+인증서/OTP). 수집기는 자동 로그인하지 않고 전용 프로필 세션을 재사용하며, 세션이 없거나 만료되면 사람 로그인 + '거래내역 조회' 화면 열림까지 대기한다(--wait-min).
- 조회: 프레임 hanaMainframe 안 POST /inquiry/rebuild/account/wcdep700r16i_11.do. 폼 필드 acctNo·sInqStrDt·sInqEndDt(YYYYMMDD)·sRcvWdrwDvCd(전체/입금/출금)·sRqstNcnt(15/30/50/100)·trscPtclSrchDvCd·srchStrnCtt. 계좌는 사람이 화면에서 고른 값을 쓰며 코드는 계좌번호를 다루지 않는다.
- 결과 IBSheet 컬럼(거래일시·적요·메모·의뢰인/수취인·입금·출금·거래후잔액·구분·거래점·거래일련번호·상세일련번호·거래일자·거래시각·거래금액·잔액변동구분코드·금액유형코드·압축기장여부·원화코드)은 핵심 열을 bank.Txn 컬럼에 매핑하고 전체를 RawJson 에 보존한다.
- 로그인 후 조회 버튼·IBSheet 읽기 부분은 실화면 미검증(첫 실행은 --dry-run). 농협 probe 는 중단(참고용).
- register-account.ps1/DPAPI 는 하나은행엔 불필요하며 빠른조회 은행(농협·국민 등)용 선택 사항이다.

### 하나은행 실측 확정(2026-11-03, 로그인 세션)
- 폼 form[name=wcdep700r16iForm], 날짜 input sInqStrDt/sInqEndDt 는 YYYY-MM-DD, 건수 라디오 sRqstNcnt=100, 조회 버튼은 폼 컨테이너 범위의 button.btn.action-level1(GNB '조회' 와 혼동 금지). 완료 판정=화면의 '조회기간 : A ~ B 조회일시' 텍스트 변경.
- 과거 기간 제한 없음(2024-01 직접입력 조회 성공) → 월 단위 루프(monthChunks).
- 수집 1순위=전체엑셀다운로드(헤더 그대로 RawJson 보존), 2순위=그리드 DOM 페이지네이션(12열, 100건/페이지, 다음=a.grid_btn.layer).
- 계좌는 --account 전체번호로 드롭다운 항목 클릭(번호 미저장·로그는 마스킹). 세션은 5분마다 '연장' 클릭로 유지, 로그인 페이지로 튕기면 사람 로그인 대기. 기본 channel=chrome.

## 보안 원칙
- 자격증명은 `%USERPROFILE%\.nenova\bank-credentials.dpapi`(DPAPI CurrentUser)에만. 등록은 `register-account.ps1`(Read-Host -AsSecureString, 값 미출력). 코드·로그·커밋·DB에 계좌번호/비밀번호/사업자번호 원문 금지.
- DB에는 마스킹(앞3·뒤4)과 RowHash(sha256)만. 캡차·보안키패드 우회 금지: 키패드가 자동 입력을 막으면 '불가'로 보고한다.
- 은행 사이트에서는 조회만. 이체·설정변경·약관동의 클릭 금지.

## 한도
- 같은 계좌 5분 1회 권장(`collect.mjs` 가 간격 가드).
- 농협: 조회기간은 시작일로부터 최대 1년(화면 문구 실측). 월별조회·1년 버튼 존재. 그 외 은행은 실측 후 기입.

## 이카운트 입출금 조회 대체 범위·입금 대사
- 대체 대상: 이카운트 '입출금 조회'(ecount 스키마 입출금 Raw)의 은행 원본 쪽. 이카운트에는 쓰지 않는다.
- 대사 계획: bank.Txn(deposit) ↔ ecount 입출금·채권(거래처별) 일자·금액 매칭 뷰(`bank` 스키마 뷰, 후속). 입금자명(Counterparty)↔거래처 간판명(Customer.Descr) 별칭 매칭 후 미매칭만 사람 확인.

## 현재 상태
- 1차 대상 HANA 로 전환. collect.mjs 는 세션 재사용·기간 입력·IBSheet 읽기 구현(실화면 미검증). 농협 probe 결과(키패드 있음·사전등록 계좌만·생년월일 입력)는 위 표 참고용.

## 빠른조회 경로 (HANA, 2026-11-03 실측 — 로그인 경로 폐기)
- 폐기 사유: biz.kebhana.com 기업뱅킹 로그인은 자동화 브라우저에서 보안모듈 '미설치' 판정으로 차단됨(`collect.mjs` 로그인 경로 사용 불가).
- 대체: 로그인·보안모듈 검사가 없는 빠른조회서비스 `https://www.kebhana.com/flex/quick/quickService.do?subMenu=1` (간편조회 팝업 `/cont/adm/redirect/quick_service.jsp`).
- 폼(동일 문서, 프레임 아님): `#acctNo`(14자리, 하이픈 없음) · `#acctPw`(4) · `#bkfgResRegNo`(사업자번호 뒤 5자리) · `#inqStrDt/#inqEndDt`(YYYYMMDD) · `select#rvSeqInqYn` · `select#rcvWdrwDvCd`(전체/입금/출금) · `select#listSize`(15/30/45/60) · `#srchStrnCtt`(적요) · '조회' 버튼.
- 제약: 빠른조회 등록 계좌만, 조회 최대 24개월, 페이지당 최대 60건. TouchEn nxKey·transkey 가상키패드 스크립트가 로드되어 비밀번호 칸 입력이 막힐 수 있음 → 막히면 `KEYPAD_BLOCKED` 로 중단(우회·캡차 처리 금지).
- 자격(.env.local, 값은 로그·커밋 금지): `HANA_QUICK_ACCT_<alias>`(14자리) · `HANA_QUICK_PW_<alias>`(4자리) · `HANA_BIZ_NO5`(5자리).
- 실행: `node scripts/bank-quick/collect-quick.mjs <alias> --from --to [--dry-run] [--probe] [--resume]`. 월 단위 루프, 24개월 밖 달은 경고 후 건너뜀, LoadBatch.Source='quick'. 순수 함수=`lib/bankQuick/quick.js`.
