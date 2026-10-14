# 신한은행 오픈API 계좌거래내역 연동 (2-legged)

근거: `17.계좌거래내역조회_신한은행 오픈API 연동 가이드(2-legged) v1.5.1`, `26.계좌거래내역조회(여신) v0.1` (사장님 제공, 2026-10-13).
보안성심의 제출 자료: `docs/bank/보안성심의_제출자료_네노바.docx`

## 구성

| 구분 | 파일 | 역할 |
|---|---|---|
| 라이브러리 | `lib/shinhanApi.js` | 접근키 발급(HMAC client_hash), 거래 API 호출(hsKey), 응답→BankTransaction 매핑, 만료(89) 자동 재발급 |
| API | `pages/api/finance/shinhan-sync.js` | GET 상태 / POST 동기화(관리자 JWT 또는 AUTOMATION_API_TOKEN) |
| 화면 | `pages/finance/bank.js` | 입/출금 계좌 조회 + [신한 동기화] 버튼·상태 표시 |
| 저장 | `BankTransaction` (웹 전용, `pages/api/finance/bank.js` 가 생성) | `IsSample=0`, `BankName='신한은행'` |
| 계약 | `docs/contracts/shinhan-bank-sync.json`, `__tests__/shinhanBankSync.test.js` | CI 관문 |

## 서버 환경변수 (`/var/www/nenova-erp/.env.local`, GitHub Secrets 로 동기화)

```
SHINHAN_ENV=dev                      # dev(테스트) | prod(운영)  — 기본 dev
SHINHAN_CLIENT_ID=                   # 신한 오픈API 홈페이지 서비스 승인 후 확인 (개발/운영 상이)
SHINHAN_CLIENT_SECRET=               # 절대 코드·로그 노출 금지
SHINHAN_SUB_CHANNEL=                 # 은행이 별도 부여 (별첨 "추후 안내")
SHINHAN_CLIENT_IP=172.233.89.171     # 요청 헤더 clientIp (화이트리스트 등록 IP)
SHINHAN_ACCOUNT_NOS=                 # 조회 대상 수신계좌, 콤마 구분(하이픈 무관)
SHINHAN_LOAN_ACCOUNT_NOS=            # (선택) 여신 계좌
```

은행 측 사전 준비: ① 서비스 이용 신청·승인 → client id/secret ② IP 화이트리스트에 `172.233.89.171` 등록(개발은 은행 담당자, 운영은 홈페이지에서 직접) ③ subChannel 수령 ④ 개발 서버 점검 완료 후 운영 오픈 일정 협의.

## 거래 흐름

```
[예약: n8n/cron 매일 06:30]  POST /api/finance/shinhan-sync  (Authorization: Bearer AUTOMATION_API_TOKEN)
[수동: /finance/bank 신한 동기화 버튼]  POST /api/finance/shinhan-sync  (관리자 JWT nenovaSS3)
   └ lib/shinhanApi
       1) POST {BASE}/v1/oauth/partner/token  client_id·scope=oob·grant_type=client_credentials·timestamp·client_hash
          → access_token (유효 10분, 9분 캐시)
       2) POST {BASE}/v2/firm/search/transactions  헤더 apiKey·Authorization Bearer·hsKey·reqKey·clientIp
          body {dataHeader:{subChannel}, dataBody:{계좌번호, 조회시작일, 조회종료일}}
       3) successCode=1 & resultCode=89 → 토큰 재발급 후 1회 재시도
   └ BankTransaction INSERT … WHERE NOT EXISTS(계좌·일시·구분·금액·잔액·메모)  → 중복 없음
```

여신(`/v2/firm/search/loan-transactions`)은 `includeLoan:true` 로 호출하며 `다음여부=1` 이면 `다음거래순번` 으로 페이지를 이어 받는다.

## 호출 예

```bash
curl -s -X POST https://nenovaweb.com/api/finance/shinhan-sync -H "Authorization: Bearer $AUTOMATION_API_TOKEN" -H "Content-Type: application/json" -d '{"from":"2026-10-06","to":"2026-10-13"}'
```

응답 `report[]` 에는 계좌가 `110******789` 형태로만 나온다.

## 에러 대응 (가이드 4.4)

| resultCode | 의미 | 조치 |
|---|---|---|
| 89 | 접근키 만료 | 자동 재발급·재시도 |
| 400 Not allowed IP / 401 | IP 미등록 | 은행 홈페이지 화이트리스트에 서버 IP 등록 |
| 403 client_hash/client_id | 키·시각 불일치 | secret 확인, 서버 시간(NTP) 확인 |
| 500 API plan limit exceeded | 월 한도 초과 | 조회 범위 축소(기본 7일) |
| 503 | 은행 측 장애 | 다음 예약 주기에 재시도 |

## 다음 단계
- 입금 대사: BankTransaction(입금) ↔ 견적/채권(`/sales/ar`) 거래처 매칭 → 사람이 확인 후 입금 처리.
- 운영 전환: `SHINHAN_ENV=prod` + 운영 client id/secret + 운영 IP 등록.
