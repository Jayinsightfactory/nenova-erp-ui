# 은행 빠른조회 수집기 설계 (1차 농협)

## 구조
사장님 PC 전용 프로필 Playwright(`scripts/bank-quick/_profile`, headless=false, chrome) → 은행 빠른조회 화면(조회만) → 결과 표 파싱 → `bank.Txn`(원본 그대로 + RawJson) → 대조 뷰(후속).
- 코드: `lib/bankQuick/{core,schema,loader,credentials}.js`, `scripts/bank-quick/{probe-nh,collect}.mjs`, `register-account.ps1`
- DDL: `docs/migrations/2026-11-03_bank_schema.sql` (bank 스키마만, SQL Server 2016, 멱등). dbo/ecount 쓰기 없음.
- 테이블: `bank.Account`(마스킹 번호만) · `bank.LoadBatch` · `bank.Txn` UNIQUE(AccountKey, RowHash).

## 은행별 조건
| 은행 | 방식 | 입력 | 비고 |
|---|---|---|---|
| 농협 | 빠른조회 | 계좌번호 + 비밀번호 4자리 + 생년월일(주민번호 앞 6자리) | **사전에 영업점/인터넷뱅킹에서 '빠른계좌조회' 등록한 계좌만**. 비밀번호는 TransKey 보안키패드(마우스입력기). 사업자번호 입력란 없음 |
| 국민 | 빠른조회 | 계좌번호+비밀번호+사업자번호 | 미조사 |
| 우리 | 빠른조회 | 계좌번호+비밀번호+사업자번호 | 미조사 |
| 기업 | 빠른조회 | 계좌번호+비밀번호+사업자번호 | 미조사 |
| 신한 | 인터넷뱅킹 로그인 필요 | - | 정식 API 경로(lib/shinhanApi) 유지 |

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
- probe-nh 완료(구조 확인). `collect.mjs` 의 `setFields`(은행 입력)는 미구현 — 보안키패드 검토 후 결정.
