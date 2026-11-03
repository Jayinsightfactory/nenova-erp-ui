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
