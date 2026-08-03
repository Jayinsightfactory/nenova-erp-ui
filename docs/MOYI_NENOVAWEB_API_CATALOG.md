# MOYI ↔ nenovaweb 연동 API 카탈로그

> MOYI 회사 관리 → **회사 전산(API) 연결**에 아래 **베이스 URL + 토큰**을 입력하세요.
> 이 문서는 MOYI AI 도구 설명에 그대로 반영해 조회 정확도를 올리는 용도입니다.

## 산출물
| 항목 | 값 |
|---|---|
| ① 베이스 URL | `https://nenovaweb.com` |
| ② 토큰 | 서버 env `MOYI_API_TOKEN` (아래 "토큰 설정" 참고) |
| 인증 헤더 | `Authorization: Bearer <MOYI_API_TOKEN>` (또는 `x-moyi-token: <...>`) |

---

## 작업 A — 파일 수신 (MOYI → nenovaweb, 쓰기)

### `POST /api/automation/moyi-file`
MOYI 워커가 보내는 **확정 파일**을 nenovaweb DB(`WebMoyiFile`)에 저장. **멱등**.

**요청 본문(JSON)**
| 필드 | 필수 | 설명 |
|---|---|---|
| `file_id` | ✅ | **멱등키**. 같은 값 재전송 시 중복 저장 안 함. ≤120자 |
| `content_base64` | ✅ | 파일 base64. **디코딩 후 50MB 이하** |
| `filename` | | 파일명 |
| `mime` | | 예: `application/pdf` |
| `meta` | | 임의 부가정보 JSON |
| `source` | | 예: `moyi-worker` |

**응답 계약 (MOYI 재시도 규약과 맞물림)**
| 코드 | 의미 | MOYI 동작 |
|---|---|---|
| `200 {idempotent:false, moyiFileKey, sizeBytes, sha256}` | 신규 저장 성공 | 완료 |
| `200 {idempotent:true, moyiFileKey, sha256Match}` | 이미 받은 파일(재시도) | 성공 취급(중복 저장 안 함) |
| `400 {error}` | 영구 오류(본문 누락/크기초과/디코딩 실패) | **재시도 금지** |
| `401 {error}` | 인증 실패 | **재시도 금지** |
| `5xx {error}` | 일시 오류(DB 등) | **5회 지수 백오프 재시도** |

> **멱등 필수 이유**: 네트워크 타임아웃 등으로 MOYI 가 같은 파일을 재전송해도 `file_id` 로 판별해 **정확히-한-번** 저장. 그래서 MOYI 는 안심하고 5회 백오프 재시도 가능.

---

## 작업 B — AI 조회 카탈로그 (nenovaweb → MOYI, 읽기 전용)

### `GET /api/automation/ai/<scope>?week=<차수>`
`scope`: `order` | `shipment` | `stock` | `estimate`
`week`: `28`(대차수 전체) 또는 `28-01`(세부차수). stock 은 week 불필요.

**응답 요약(≤4KB, 매출·수량만 · 원가/이익 제외)**
- `order` : `{customers, orderLines, totalOutQty, topCountryFlower[]}`
- `shipment` : `{customers, shipmentLines, salesTotalVatIncl, fixedLines, topCustomers[]}`
- `estimate` : `{confirmedCustomers, confirmedSalesVatIncl, topCustomers[]}` (DetailFix=1 확정분)
- `stock` : `{negativeStockItems, lowStock[]}` (재고<10 상위)

### ⚠ 네노바 도메인 함정 규칙 (AI 가 반드시 지킬 것)
1. **`OrderWeek`/`OrderYearWeek` = 대차수(major)**. `28`=`28-01`+`28-02` 합. 세부차수는 `28-01`. (raw `OrderYearWeek`='202628'은 연도+대차수)
2. **`ShipmentDetail` 에는 `isDeleted` 컬럼이 없음** → `sd.isDeleted` 쿼리 금지(SQL 500). 삭제필터는 `ShipmentMaster.isDeleted`. 이 API 는 **ViewShipment/ViewOrder 뷰**를 써서 이 함정을 이미 회피함.
3. **확정 여부**는 `DetailFix`(뷰) 또는 `sd.isFix`. 매출 집계 시 확정분만 필요하면 `DetailFix=1`.
4. **금액**은 `Amount`(공급가)+`Vat`. VAT 포함 매출 = `Amount+Vat`.
5. `Manager` 는 `UserInfo.UserID`(로그인ID)이지 이름이 아님.

### 보안 원칙
- **읽기 전용**(SELECT만) · ERP/ECOUNT 에 쓰기 없음
- 모든 조회에 **`TOP`(LIMIT) 필수** — 대량 덤프 불가(상위 12건)
- 인증 실패 시 **401**
- **민감정보 제외**: 원가(Cost)·이익률 미노출, 매출·수량만
- 응답 **≤4KB 요약**

---

## 작업 C — 주차별 매출이익 보고서 수신 (nenovaweb → MOYI Drive, 쓰기)

### `POST https://api.nowlink.kr/integrations/nenovaweb/inbound`

주차별 매출이익 보고서 화면의 **📤 MOYI 전송** 버튼이 현재 조회한 차수의 원본 XLSX를
MOYI 회사 Drive에 저장한다. Nenovaweb은 전송 전에 화면과 동일한 보고서 생성 경로를
사용하며, 주문·출고·재고·견적 원장은 수정하지 않는다.

**요청 본문(JSON)**

| 필드 | 필수 | 설명 |
|---|---|---|
| `file_id` | ✅ | Nenovaweb `PushId` UUID. 재시도 멱등키 |
| `filename` | ✅ | `주차별 매출이익 보고서-연도-차수차.xlsx` |
| `mime` | | XLSX MIME 타입 |
| `tags` | | `nenovaweb`, `weekly-profit-report`, 연도·차수 태그 |
| `content_base64` | ✅ | XLSX 파일 Base64. 디코딩 후 MOYI 수신 한도 50MB 이하 |

**응답·재시도**

- `200 {ok:true, file_id, idempotent:false}`: MOYI Drive 신규 저장 완료
- `200 {ok:true, file_id, idempotent:true}`: 같은 `file_id`가 이미 저장된 재시도. 중복 파일을 만들지 않음
- `401/403`: 토큰 또는 MOYI 양방향 수신 설정 확인 후 재시도
- `5xx`: Nenovaweb 전송 이력에서 `failed`로 확인하고 **재시도**. 같은 파일 ID를 재사용

MOYI 관리자 설정에서 `nenovaweb_bidirectional=1`을 켜고 `nenovaweb_push_token`에
Nenovaweb 배포 환경의 `MOYI_PUSH_TOKEN` 또는 기존 `MOYI_API_TOKEN`과 같은 값을 넣어야 한다.
Nenovaweb 화면 전송 이력은 `WebMoyiReportPush`에 `pending/sent/failed`, 시도 횟수,
파일 크기, SHA-256, MOYI 원격 파일 ID와 오류를 기록한다.

**Nenovaweb 화면 사용**

1. 주차별 매출이익 보고서에서 연도·차수를 조회한다.
2. 수기값이 있으면 먼저 `저장`한다.
3. `📤 MOYI 전송`을 누른다.
4. MOYI 앱의 회사 Drive에서 전송된 XLSX를 확인한다.

전송 API의 GET 이력 조회는 `GET /api/moyi/report-push?week=30&year=2026`이며,
브라우저 로그인 인증이 필요하다.

---

## 완료 기준 — curl 검증

토큰을 셸 변수로:
```bash
TOK="<MOYI_API_TOKEN>"; BASE="https://nenovaweb.com"
```

**1) 멱등 2회 테스트** (같은 file_id 2번 → 2번째 idempotent:true)
```bash
B64=$(printf 'hello moyi' | base64)
curl -s -X POST "$BASE/api/automation/moyi-file" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"file_id\":\"chk-001\",\"filename\":\"t.txt\",\"mime\":\"text/plain\",\"content_base64\":\"$B64\"}"
# → {"success":true,...,"idempotent":false,...}
curl -s -X POST "$BASE/api/automation/moyi-file" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d "{\"file_id\":\"chk-001\",\"content_base64\":\"$B64\"}"
# → {"success":true,...,"idempotent":true,"sha256Match":true}
```

**2) 401 테스트** (토큰 없이 / 틀린 토큰)
```bash
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/automation/ai/shipment?week=28"           # 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer WRONG" "$BASE/api/automation/ai/shipment?week=28"  # 401
```

**3) 내부 화면 수치 대조** (AI 요약 == 견적서/출고 화면)
```bash
curl -s -H "Authorization: Bearer $TOK" "$BASE/api/automation/ai/shipment?week=28" | jq .
# salesTotalVatIncl / customers 를 nenovaweb 견적서 관리(28차) 합계와 대조
curl -s -H "Authorization: Bearer $TOK" "$BASE/api/automation/ai/estimate?week=28-01" | jq .
curl -s -H "Authorization: Bearer $TOK" "$BASE/api/automation/ai/order?week=28" | jq .
curl -s -H "Authorization: Bearer $TOK" "$BASE/api/automation/ai/stock" | jq .
```

---

## 토큰 설정 (서버)
`MOYI_API_TOKEN` 은 서버 환경변수에만 둔다(코드/로그 노출 금지).
1. GitHub 저장소 Secret 에 `MOYI_API_TOKEN` 추가 → deploy.yml 이 서버 `.env.local` 로 동기화 → 재배포
2. 미설정 시 API 는 `503`(토큰 미설정) 반환
