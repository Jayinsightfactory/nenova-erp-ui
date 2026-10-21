# 바로빌(barobill) API 연동 — 세팅·사용·검증 기록

> 목적: 이카운트 해지 전제의 원천 데이터(세금계산서 발급·홈택스 매입매출 수집·계좌거래·카드사용) 를 네노바웹이 바로빌 API 로 직접 받는다. 설계 상위 문서: `docs/ACCOUNTING_LEDGER_DESIGN.md`. 계약: `docs/contracts/barobill-api.json`.

## 1. 계정·키 (2026-10-21 세팅 완료)
| 항목 | 값/위치 |
|---|---|
| 개발자센터 | https://dev.barobill.co.kr (로그인 계정 nenovabusiness1@gmail.com), 파트너 **네노바**(콘솔 `/console/partners/8614`) |
| 회원사 사업자번호 | **134-86-94367** → `BAROBILL_CORPNUM=1348694367` (견적서의 416-81-38772 는 케이넷 번호, 쓰지 말 것) |
| 테스트서버 인증키 | 콘솔 "인증키 및 제휴 정보" → GitHub Secret `BAROBILL_CERTKEY`(현재 테스트 키), owner PC 사용자 env, 서버 `.env.local`(deploy.yml 동기화) |
| 운영서버 인증키 | GitHub Secret `BAROBILL_CERTKEY_PROD` (운영 전환 시 `BAROBILL_CERTKEY` 로 옮기고 `BAROBILL_ENV=prod`) |
| 환경 | `BAROBILL_ENV=test`(testws.baroservice.com) / `prod`(ws.baroservice.com) |
| 쓰기 허용 | `BAROBILL_ALLOW_WRITE=1` 일 때만 발급·등록 API 호출. 기본 차단 |
| 바로빌 회원 ID | `BAROBILL_USERID` — 계좌/카드 거래내역 조회의 `ID` 파라미터(미설정 시 빈값; 바로빌 측에 회원사 담당자 ID 확인 필요) |

인증키·전체 계좌/카드번호는 코드·로그·응답에 싣지 않는다(응답은 `maskNumber`).

## 2. 코드
- `lib/barobillApi.js` — 의존성 없는 SOAP 1.1 클라이언트(fetch + 최소 XML 파서). `createBarobillClient()` 메서드: `ping, checkCert, checkCorpIsMember, balance, corpState(s), bankAccounts, bankLog, cards, cardLog, taxSalesList, taxPurchaseMonthly, taxState, taxLog, registAndIssueTaxInvoice(쓰기)`.
- `pages/api/finance/barobill.js` — GET 전용, 관리자 JWT 또는 자동화 토큰. `?action=status|accounts|cards|bank-log|card-log|tax-sales|tax-purchase|corp-state`. DB 미접촉.
- `scripts/barobill-smoke.mjs` — 서버 연결 스모크(읽기 전용).
- `__tests__/barobillApi.test.js` — `npm run test:barobill` (test:erp-contract 에 포함).

규격 출처: `testws.baroservice.com/{TI,BANKACCOUNT,CARD,CORPSTATE}.asmx?wsdl` (2026-10-21). 주요 호출:

| 용도 | 서비스.오퍼레이션 | 비고 |
|---|---|---|
| 연결 | TI.Ping | 인증키 불필요 |
| 인증키 유효 | TI.CheckCERTIsValid | 1=유효. **-31100 = 등록된 공동인증서 없음**(발급 전 테스트 사이트에 인증서 등록 필요) |
| 회원사 여부 | TI.CheckCorpIsMember | 1=회원사 |
| 선불 잔액 | TI.GetBalanceCostAmountEx | 포인트 |
| 사업자 상태 | CORPSTATE.GetCorpState | State 1=영업중 |
| 계좌 목록/거래 | BANKACCOUNT.GetBankAccountEx2 / GetPeriodBankAccountLogEx2 | 계좌는 바로빌 사이트(또는 RegistBankAccountEx)에서 등록 후 수집 |
| 카드 목록/사용 | CARD.GetCardEx2 / GetPeriodCardLogEx3 | |
| 매출 세금계산서 | TI.GetPeriodTaxInvoiceSalesListEx | 발행분 목록 |
| 홈택스 매입 | TI.GetMonthlyTaxInvoicePurchaseListEx | 월 단위 |
| 발급 | TI.RegistAndIssueTaxInvoice | 쓰기, 기본 차단 |

## 3. 테스트 서버 스모크 결과 (2026-10-21, `node scripts/barobill-smoke.mjs`)
```
OK   Ping
FAIL CheckCERTIsValid → -31100 등록된 공동인증서가 없습니다.
OK   CheckCorpIsMember → 1
OK   GetBalanceCostAmountEx → 10000 (테스트 포인트)
OK   GetCorpState → State 1 (영업중), TaxType 3
OK   GetBankAccountEx2 → [] (등록 계좌 없음)
OK   GetCardEx2 → [] (등록 카드 없음)
OK   GetPeriodTaxInvoiceSalesListEx 2026-10-01~21 → 0건
```

## 4. 남은 세팅(사람)
1. 테스트 사이트 https://test.barobill.co.kr 에 회원사(네노바)로 로그인 → **공동인증서 등록**(세금계산서 발급 테스트용) → `CheckCERTIsValid`=1 확인.
2. 테스트 사이트에서 **계좌 4개·카드 2장 등록**(은행/카드사 웹 ID·비밀번호는 바로빌 사이트에서 사장님이 직접 입력; 네노바웹은 저장하지 않음) → `?action=accounts|cards` 로 보이는지 확인.
3. `BAROBILL_USERID` 확정(바로빌 회원 ID) 후 Secret 추가.
4. 운영 전환: `BAROBILL_ENV=prod`, `BAROBILL_CERTKEY`=운영키, 운영 사이트에도 1·2 반복, 선불 포인트 충전.

## 5. 다음 구현
`docs/ACCOUNTING_LEDGER_DESIGN.md` 6-2 순서대로: 1단계 계좌 입금 → 외상매출금 자동 매칭 전표(웹 전용 테이블, PR #983 선행).
