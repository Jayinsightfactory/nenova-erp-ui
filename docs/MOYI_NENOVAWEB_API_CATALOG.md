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
