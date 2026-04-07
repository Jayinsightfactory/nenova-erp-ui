---
name: 작업 이력 및 미완료 항목
description: 완료된 버그수정/기능, 미완료 태스크, 다음 작업 목록, 버튼 목록, DB 연결 현황, 최초 기획
type: history
---

# nenova ERP — 전체 작업 이력

---

## 🗺️ 최초 기획 (이카운트 분석 기반)

**방향:** 이카운트와 연동X. 이카운트에서 사용하던 기능들을 nenova 웹에 직접 구현
**추가:** 신한은행 API (api.shinhan.com) 연동으로 실제 입출금 데이터 연결

### 최초 계획한 메뉴 구조

**[채권/매출관리]**
- `/sales/ar`          → 거래처별 채권 (미수금 현황 + 입금등록)
- `/sales/status`      → 판매현황 (거래처/품목/일자별)
- `/sales/tax-invoice` → 세금계산서 진행단계

**[구매/외화관리]**
- `/purchase/status` → 구매현황 (수입 인보이스/외화/결제일 추적)
- `/purchase/input`  → 구매입력 (에콰도르 등 수입 등록)
- `/finance/exchange` → 외화/환율 관리

**[금융관리]** ← 신한은행 API 연동
- `/finance/bank` → 입/출금 계좌 조회 (실시간 신한은행 API)

### Phase별 우선순위
- **Phase 1 (최우선)**: 채권관리(`ar.js`) + 구매현황(`purchase/status.js`)
- **Phase 2 (높음)**: 판매현황(`sales/status.js`) + 세금계산서(`tax-invoice.js`)
- **Phase 3 (별도 계약 후)**: 신한은행 API 입출금 연동

### 신한은행 API 계획
- 요금: 월 5만원 (5천건), 초과 건당 5원
- 신청 절차: IP 제출 → 방화벽 해제(2주) → 개발키 교부 → 신한은행 지점 방문(법인서류) → 운영키 발급
- env: `SHINHAN_API_KEY`, `SHINHAN_API_URL=https://api.shinhan.com`
- 채권관리 연동: 입금 내역에서 거래처 매칭 → ReceivableLedger 자동 업데이트 가능

### 사업자 정보 (견적서 출력용)
- NENOVA 사업자: `134-86-94367`
- 대표: 김원배
- 계좌: 하나은행 `630-008129-149`

---

## 🗄️ DB 연결 현황

### MSSQL 서버 정보
| 항목 | 값 |
|------|-----|
| **Host** | `sql16ssd-014.localnet.kr` |
| **Port** | `1433` |
| **Database** | `nenova1_nenova` |
| **User** | `nenova1_nenova` |
| **암호화** | 비활성 (`encrypt: false`) |
| **연결 타임아웃** | 30초 |
| **요청 타임아웃** | 60초 |
| **풀 최대 연결** | 10개, idle 30초 |

### 환경변수 목록 (`.env.local`)
```
DB_SERVER=sql16ssd-014.localnet.kr
DB_PORT=1433
DB_NAME=nenova1_nenova
DB_USER=nenova1_nenova
DB_PASSWORD=nenova1257
JWT_SECRET=nenova2026secretkey
ECOUNT_ZONE=cc
ECOUNT_COM_CODE=...
ECOUNT_USER_ID=...
ECOUNT_API_KEY=...
PUBLIC_API_KEY=nenova-api-2026
```

### DB 연결 이슈
- ⚠️ **Railway → Cafe24 MSSQL 외부IP 차단 문제**: Railway 서버에서 `sql16ssd-014.localnet.kr:1433`으로 연결 시 차단됨
- 로컬 개발환경에서는 정상 연결됨
- **해결책**: Cafe24 측에 Railway 서버 IP 화이트리스트 등록 요청 필요 (코드 외 문제)

### DB 테이블 구조 핵심 주의사항
| 테이블 | 용도 | 읽기/쓰기 | 주의 |
|--------|------|-----------|------|
| `OrderMaster/Detail` | 실제 주문 | 읽기만 | |
| `_new_OrderMaster/Detail` | 테스트 주문 | 쓰기 | worklog 기록 포함 |
| `ShipmentMaster/Detail` | 실제 출고 | 읽기만 | isDeleted/Cost/Amount/Vat 없음 |
| `_new_ShipmentMaster/Detail` | 테스트 출고 | 쓰기 | Cost/Amount/Vat/isDeleted 있음 |
| `Estimate` | 불량/검역 차감 | 읽기+쓰기 | |
| `Customer` | 거래처 | 읽기+쓰기 | `Descr` = 비고 필드 |
| `ReceivableLedger` | 채권 원장 | 읽기+쓰기 | 신규 생성 |
| `ImportOrder/Detail` | 구매 인보이스 | 읽기+쓰기 | 신규 생성 |
| `BankTransaction` | 입출금 내역 | 읽기+쓰기 | 신규 생성 (샘플모드) |
| `CurrencyMaster` | 환율 | 읽기+쓰기 | 신규 생성 |
| `TaxInvoice` | 세금계산서 | 읽기+쓰기 | 신규 생성 |

**ShipmentDetail 원본에 없는 컬럼** (쿼리하면 500 오류):
- `isDeleted`, `Cost`, `Amount`, `Vat`
- → 금액 계산은 `Product.Cost` 기준으로 직접 계산해야 함

---

## 🌐 배포 현황

| 항목 | 값 |
|------|-----|
| **플랫폼** | Railway |
| **앱 URL** | `https://nenova-erp-production.up.railway.app` |
| **커스텀 도메인** | `https://nenovaweb.com` ✅ (DNS 전파 완료) |
| **GitHub** | `https://github.com/dlaww-wq/nenova-erp-ui` |
| **브랜치** | `feat/erp-improvements` |
| **PR #1** | `https://github.com/dlaww-wq/nenova-erp-ui/pull/1` |
| **빌드** | NIXPACKS, `node web.js` 로 시작 |

### 도메인 연결 작업 (2026-04-07 완료)
- **도메인**: `nenovaweb.com` (Cafe24 구매)
- **네임서버**: Cafe24 (ns1.cafe24.com, ns2.cafe24.com)
- **DNS 레코드 추가 (Cafe24 DNS 관리)**:
  - CNAME: `@` → `6ur0ojp1.up.railway.app` ✅
  - TXT: `_railway-verify` → `railway-verify=d64dbb1d44e2692e57f7836faaeacb09c84b0e18c521d795feef3fef3b23c02e` ✅
- Google DNS 기준 전파 확인 완료 (dns.google/resolve 조회)

### Railway 설정
```toml
# railway.toml
[build]
builder = "NIXPACKS"
[deploy]
startCommand = "node web.js"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

```json
// next.config.js
serverExternalPackages: ['mssql']  // Turbopack mssql 번들링 오류 방지
```

```json
// package.json scripts
"build": "next build --no-turbopack"  // Railway mssql 번들링 오류 방지
```

---

## ✅ 완료된 작업 (커밋 순서)

---

### [커밋 b4c5da1] 초기 전체 기능 구현
- nenova ERP 전체 페이지 초기 구현

---

### [커밋 b70cda6] pivot: 지역 버튼 + useMemo 최적화
- pivot.js에 `지역(showArea)` 토글 버튼 추가
- useMemo/useCallback으로 성능 최적화

---

### [커밋 3888914] weekInput 4순환 + pivot 빈 데이터 표시
- WeekInput 차수 순환 방식 개선
- pivot 데이터 없을 때 빈 상태 표시 개선

---

### [커밋 7160801] 주문등록/출고분배 저장확인모달 + worklog + 견적서출력 개선
- 주문등록/출고분배 저장 후 확인 모달 추가
- worklog API에 `_new_OrderMaster` 테스트 테이블 이력 추가
- 견적서 출력 HTML 레이아웃 개선 (NENOVA 헤더, 한글금액, 꽃 분류별 분할출력)

---

### [커밋 c40ca84] 버그수정 4종

**1. 견적서 거래처 검색 후 데이터 없음 (CRITICAL)**
- **파일**: `pages/api/estimate/index.js`
- **원인**: `ShipmentDetail.isDeleted`, `Cost`, `Amount`, `Vat` 쿼리 → 원본 테이블에 없는 컬럼 → SQL 500 오류
- **수정**: `AND sd.isDeleted = 0` 제거, `sd.Cost/Amount/Vat` → `ISNULL(p.Cost,0)` 및 `ROUND(p.Cost*qty/1.1,0)`, `ROUND(p.Cost*qty/11,0)` 직접 계산

**2. 견적서 출고요일 기본값**
- **파일**: `pages/estimate.js`
- **수정**: `useState(new Set())` → `useState(new Set(['월','화','수','목','금','토','일']))`
- "초기화" 버튼 → "전체선택" 버튼으로 변경, `size<7` 일 때만 노출

**3. 출고분배 업체검색 후 데이터 사라짐**
- **파일**: `pages/shipment/distribute.js`
- **원인**: `handleSearch` 마지막에 `setCustFilter('')` 호출 → 입력값 초기화됨
- **수정**: 해당 줄 제거, 검색 후 첫 번째 매칭 업체 자동 선택 로직 추가

**4. pivot 필터 드롭다운 없어짐**
- **파일**: `pages/stats/pivot.js`
- **원인**: `position:absolute` 드롭다운이 `overflow:auto` 컨테이너에 clip됨
- **수정**: `createPortal`로 `document.body`에 렌더링, `useRef+getBoundingClientRect`로 위치 계산, `position:fixed`

---

### [커밋 515bdf6] 피벗 드래그 컬럼그룹 + Filter Editor + 하단 필터바

**API 수정 (`pages/api/stats/pivot-data.js`)**
- `Customer.Descr AS custDescr` 추가

**pivot.js 대규모 기능 추가**
1. **드래그 가능한 컬럼 그룹 순서** (`colGroupOrder: ['지역', '비고', '거래처명']`)
2. **그룹 헤더 행 자동 생성** (`custGroupHeaders`) — 같은 값 colSpan 병합
3. **Filter Editor 모달** — 구분/국가/꽃/비고/지역/품목명 다중 조건, 연산자 11종
4. **하단 필터 상태바** — 구분 칩, And 조건 칩, × 개별 삭제

---

### [커밋 2e88bf3] 신규 기능 6종 추가

- `pages/sales/ar.js`: 거래처별 채권 (미수금 조회, 입금등록, 원장 상세)
- `pages/sales/status.js`: 판매현황 (전체/거래처별/품목별 탭, 엑셀 다운)
- `pages/sales/tax-invoice.js`: 세금계산서 진행단계 (5단계)
- `pages/purchase/status.js`: 구매현황 (외화/인보이스, 신규입력 모달)
- `pages/finance/bank.js`: 입/출금 조회 (샘플모드, 신한은행 API 연동 예정)
- `pages/finance/exchange.js`: 외화/환율 관리 (USD/EUR/COP/JPY)
- 신규 DB 테이블 자동생성: ReceivableLedger, ImportOrder/Detail, BankTransaction, CurrencyMaster, TaxInvoice
- API 버그 수정: `sm.ShipmentDtm` → `sd.ShipmentDtm`, `sm.Manager` → `c.Manager`

---

### [커밋 626e962] Railway 빌드 수정 + 견적서 tfoot 개선

- `package.json` build: `"next build"` → `"next build --no-turbopack"`
- `pages/estimate.js` tfoot: colspan 수정, 공급가액/부가세 정렬, 합계금액 파란색 강조
- PR #1 pushed

---

### [2026-04-07] 도메인 연결 (커밋 없음, 인프라 작업)

- Railway 설정에서 `nenovaweb.com`, 포트 8080으로 커스텀 도메인 등록
- Railway가 제공한 DNS 레코드를 Cafe24 DNS 관리에서 추가
  - Cafe24 iframe 기반 모달(`cnamePop_iframe`, `txtPop_iframe`) JavaScript로 직접 입력
  - CNAME: `@` → `6ur0ojp1.up.railway.app`
  - TXT: `_railway-verify` → `railway-verify=d64dbb1d44e2692e57f7836faaeacb09c84b0e18c521d795feef3fef3b23c02e`
- Google DNS 기준 전파 확인: CNAME + TXT 모두 ✅

---

## 📄 페이지별 버튼 목록

---

### `/dashboard` — 대시보드

| 버튼/링크 | 동작 |
|-----------|------|
| 주문 등록 | `/orders/new` 이동 |
| 출고 분배 | `/shipment/distribute` 이동 |
| 재고 관리 | `/stock` 이동 |
| 견적서 관리 | `/estimate` 이동 |
| 월별 판매 | `/stats/monthly` 이동 |
| 거래처 관리 | `/master/customers` 이동 |

**기능**: 실시간 KPI 4종 (이번주 매출, 주문건수, 재고부족 품목, 미확정 출고), 지역별 매출 카드, Top5 거래처

---

### `/estimate` — 견적서 관리

| 버튼 | 동작 |
|------|------|
| ✕ | 거래처 선택 초기화 + 검색 초기화 |
| 🔄 조회 / Buscar | 견적 데이터 로드 |
| 🖨️ 견적서 출력 | PDF 출력 다이얼로그 열기 |
| 📊 엑셀 다운 | 엑셀 내보내기 |
| 전체선택 | 요일 필터 전체선택 (size<7 일 때만 노출) |
| 요일 칩 (월화수목금토일) | 개별 요일 토글 |
| Print Dialog: 출력 | PDF 생성 실행 |
| Print Dialog: 취소 | 출력 다이얼로그 닫기 |
| Defect Modal: 닫기 | 불량/검역 모달 닫기 |
| Defect Modal: 저장 | 불량 차감 등록 저장 |

**기능**: 거래처 검색, 요일 필터, PDF 출력(종합/분할), 불량검역 모달, 한글금액 변환, 꽃 분류별 분할출력

---

### `/orders/new` — 주문 등록

| 버튼 | 동작 |
|------|------|
| 🔄 조회 [Ctrl+R] | 주문 데이터 검색/로드 |
| 신규 [Ctrl+N] | 신규 주문 팝업 열기 |
| 💾 저장 [Ctrl+S] | 주문 저장 |
| 삭제 / Eliminar | 주문 삭제 |
| 닫기 [ESC] | 창 닫기 / 목록으로 |
| 지난 주문 불러오기 | 직전 주문 데이터 로드 |
| 주문 변경 내역 조회 | 변경 이력 모달 열기 |
| History Modal: 닫기 | 이력 모달 닫기 |

**기능**: 거래처 검색 드롭다운(키보드 nav), 품목 그룹 계층 탐색, Box/Bunch/Steam 수량 입력, 단축키, 저장 확인 모달, 변경 이력 조회

---

### `/shipment/distribute` — 출고 분배

| 버튼 | 동작 |
|------|------|
| 🔍 조회 | 출고 데이터 검색 |
| 💾 저장 / Guardar | 분배 저장 |
| 📋 내역 조회 / Historial | 분배 이력 보기 |
| ✖️ 닫기 / Cerrar | 닫기 |
| 품목 기준 | viewMode = 'prod' |
| 업체 기준 | viewMode = 'cust' |
| 📋 일괄 출고분배 | 전체 거래처 자동 분배 |
| 📦 개별 출고분배 | 거래처별 수동 분배 |
| 🔄 개별 초기화 | 분배값 0으로 리셋 |
| History Modal: 닫기 | 이력 모달 닫기 |

**기능**: 2가지 뷰모드 (품목/업체 기준), 비율 분배, 주차 확정/해제(handleFix), 거래처 필터, 품목 그룹 필터

---

### `/stats/pivot` — Pivot 통계

| 버튼 | 동작 |
|------|------|
| 엑셀 | 엑셀 내보내기 |
| 저장 | 현재 피벗 설정 즐겨찾기 저장 |
| ✕ (즐겨찾기 옆) | 즐겨찾기 삭제 |
| ▼ (컬럼 헤더) | 필터 드롭다운 열기 (portal, fixed 위치) |
| ✏️ Edit Filter | Filter Editor 모달 열기 |
| Filter OK | 필터 적용 + 모달 닫기 |
| Filter Apply | 필터 적용 (모달 유지) |
| Filter Cancel | 모달 닫기 |
| ▼ 펼침 | 모든 행 그룹 펼치기 |
| 행 토글 버튼 | showOutDate/showInPrice 등 개별 토글 |
| ⠿ 지역/비고/거래처명 | 드래그로 컬럼 그룹 순서 변경 |
| 구분 섹션 칩 | prev/order/incoming/none/cur 즉시 토글 |
| 조건 칩 × | 개별 Filter 조건 삭제 |

**기능**: 다차원 피벗, 드래그 컬럼 그룹, 정렬(▲▼), 다중 필터(11종 연산자), 즐겨찾기, 그룹 헤더 자동 생성(colSpan 병합)

**핵심 state**:
```javascript
colGroupOrder: ['지역', '비고', '거래처명']
showSections: {prev, order, incoming, none, cur}
filterConditions: [{field, op, value/values}]
collapsed: Set  // 접힌 행 그룹
```

---

### `/incoming` — 입고 원장

| 버튼 | 동작 |
|------|------|
| 새로고침 | 데이터 리로드 |
| 📤 업로드 / Subir | 파일 선택 다이얼로그 (CSV/XLSX) |
| 🗑️ 원장삭제 / Eliminar Reg. | 선택된 원장 삭제 (확인 후) |
| 📊 엑셀 / Excel | CSV 내보내기 |
| ✖️ 닫기 / Cerrar | 닫기 |
| ＋ 신규 / Nuevo | 상세 행 추가 |
| ✏️ 수정 / Editar | 상세 행 수정 |
| 🗑️ 삭제 (상세) | 상세 행 삭제 |
| Upload Modal: 취소 | 업로드 모달 닫기 |
| Upload Modal: 📤 업로드 | 업로드 데이터 저장 확인 |

**기능**: 날짜 범위 필터, 원장(마스터) 목록/상세 분할패널, XLSX Packing 포맷 파싱(Row1:Grower/Weekend/Invoice, Row2:AWB/Date, Row4:헤더, Row5+:데이터), 업로드 미리보기(상위 5행)

---

### `/sales/ar` — 채권 관리

| 버튼 | 동작 |
|------|------|
| 조회 | 기간별 채권 데이터 로드 |
| 엑셀 | 채권 데이터 엑셀 다운 |
| 원장 | 선택 거래처 원장 상세 패널 열기 |
| 입금등록 | 입금 등록 모달 열기 |
| 닫기 | 원장 상세 패널 닫기 |
| 입금등록 Modal: 저장 | 입금 저장 → 원장/목록 자동 갱신 |
| 입금등록 Modal: 취소 | 모달 닫기 |

**기능**: KPI 3종(총매출/총입금/채권잔액), 매니저 필터, 잔액만 필터, 거래처별 미수금 목록, 원장(날짜/유형/금액/잔액/메모), 입금 등록 폼(금액/날짜/계좌/메모)

---

### `/sales/status` — 판매현황

| 버튼 | 동작 |
|------|------|
| 조회 | 판매 데이터 쿼리 |
| 엑셀 | 현재 탭 기준 CSV 내보내기 |
| 📤 이카운트 판매입력 | 이카운트 판매 데이터 Push |
| 탭 (전체/거래처별/품목별) | 뷰 전환 |
| 거래처 검색 clear | 거래처 검색 초기화 |

**기능**: 날짜범위/주차/거래처/매니저 필터, KPI 5종(건수/거래처수/공급가액/부가세/합계), 이카운트 연동 Push

---

### `/sales/tax-invoice` — 세금계산서

| 버튼 | 동작 |
|------|------|
| 조회 | 세금계산서 로드 |
| ＋ 신규등록 | 신규 세금계산서 모달 |
| 단계 필터 칩 | 전체/출고완료/판매반영/발행완료/전자발송/완료 필터 |
| 단계변경 | 단계 변경 모달 열기 |
| 자동분개 | 이카운트 자동분개 전송 |
| 삭제 | 세금계산서 삭제 |
| Modal: 저장 | 저장 |
| Modal: 취소 | 닫기 |

**기능**: 월별+거래처+단계 필터, 단계별 카드(건수/금액), 5단계 진행(출고완료→판매반영→발행완료→전자발송→완료), 부가세 자동계산, 이카운트 자동분개

---

### `/purchase/status` — 구매현황

| 버튼 | 동작 |
|------|------|
| 조회 | 구매 데이터 로드 |
| ＋ 신규 구매입력 | 신규 구매 입력 모달 |
| 📊 엑셀 다운 | 구매 목록 내보내기 |
| 📤 이카운트 구매입력 | 체크된 항목 이카운트 Push |
| 체크박스 (전체/개별) | 이카운트 전송 대상 선택 |
| 🗑️ 삭제 | 구매 건 삭제 |
| 상세 Modal: 닫기 | 닫기 |

**기능**: 날짜범위/주차/인보이스/공급업체 필터, KPI 5종(건수/박스/외화금액/원화금액/연체건수), 결제상태(예정/⚠️결제필요/⚠️오늘결제), 외화→원화 환산 미리보기, 라인아이템 동적 추가/삭제

---

### `/finance/bank` — 입출금 관리

| 버튼 | 동작 |
|------|------|
| 조회 | 거래 내역 로드 |
| ＋ 수동입력 | 수동 거래 입력 모달 |
| 삭제 | 샘플 데이터 삭제 |
| Modal: 저장 | 거래 저장 |
| Modal: 취소 | 닫기 |

**기능**: 날짜범위/거래유형(입금/출금)/계좌/거래처 필터, KPI 3종(총입금/총출금/순액), 샘플모드 배너 (신한은행 API 연동 후 실시간 전환 예정), 수동 입력 폼(날짜/유형/계좌/금액/잔액/상대방/은행/지점/메모)

---

### `/finance/exchange` — 환율 관리

| 버튼 | 동작 |
|------|------|
| 환율 업데이트 | 환율 목록 새로고침 |
| ＋ 신규추가 | 신규 통화 등록 모달 |
| 수정 | 인라인 편집 시작 |
| 저장 | 편집 저장 |
| 취소 | 편집 취소 |
| 사용 토글 | isActive 편집 중 토글 |
| Modal: 저장 | 신규 통화 저장 |
| Modal: 취소 | 닫기 |

**기능**: 통화 목록(코드/명칭/환율/업데이트 시각/활성상태), 인라인 편집(4자리 소수), 신규 통화 모달, 코드 자동 대문자 변환, `purchase/status.js`에서 FX 환산에 사용

---

### `/master/customers` — 거래처 관리

| 버튼 | 동작 |
|------|------|
| 새로고침 | 거래처 목록 리로드 |
| ＋ 신규 / Nuevo | 빈 폼 모달 열기 |
| ✏️ 수정 / Editar | 선택 거래처 수정 모달 |
| 📊 엑셀 / Excel | 엑셀 내보내기 |
| ✖️ 닫기 / Cerrar | 닫기 |
| Modal: 저장 / Guardar | 저장 |
| Modal: 취소 / Cancelar | 닫기 |

**기능**: 거래처명/코드/매니저 검색, 이중클릭 수정, 지역 뱃지(경부선/양재동/지방/호남선), 출고요일 설정, 주문코드, 담당자 선택

---

### `/stock` — 재고 관리

| 버튼 | 동작 |
|------|------|
| 🔄 조회 / Buscar | 재고 로드 |
| 📝 조정등록 | 재고 조정 모달 열기 |
| 📊 엑셀 / Excel | CSV 내보내기 |
| ✖️ 닫기 / Cerrar | 닫기 |
| Modal: 저장 | 조정 저장 |
| Modal: 행 추가 | 조정 라인 추가 |

**기능**: 주차+품목 필터, 분할패널(재고목록/이력), 이전재고/입고/출고/조정/현재고, 색상코딩(빨강≤0/황색<10/초록>10), 조정유형(불량차감/검역차감/검수차감/기타차감/재고조정)

---

### `/warehouse` — 창고 Pivot

| 버튼 | 동작 |
|------|------|
| 새로고침 | 주차 피벗 로드 |
| 엑셀 | CSV 내보내기 |
| ▼ 펼침 | 모든 그룹 펼치기 |
| ▶ 닫기 | 모든 그룹 접기 |
| 컬럼 토글 | 주문차수/단위/변경수량 표시/숨김 |

**기능**: 3단계 그룹(국가→꽃→품목), 날짜별 수량 컬럼, 소계/합계, 접기/펼치기, 색상 헤더

---

## 📋 API 라우트 목록

| 경로 | 파일 | 메서드 | 설명 |
|------|------|--------|------|
| `/api/auth/login` | auth/login.js | POST | 로그인 (JWT 발급) |
| `/api/auth/logout` | auth/logout.js | POST | 로그아웃 |
| `/api/estimate` | estimate/index.js | GET/POST/PATCH/DELETE | 견적서 CRUD |
| `/api/orders` | orders/index.js | GET/POST | 주문 조회/등록 |
| `/api/orders/history` | orders/history.js | GET | 주문 변경이력 |
| `/api/shipment` | shipment/index.js | GET | 출고 조회 |
| `/api/shipment/[id]` | shipment/[id].js | GET/PATCH | 출고 상세/수정 |
| `/api/shipment/distribute` | shipment/distribute.js | GET/POST | 출고분배 |
| `/api/shipment/history` | shipment/history.js | GET | 출고 이력 |
| `/api/shipment/fix` | shipment/fix.js | POST | 주차 확정 |
| `/api/stats/pivot-data` | stats/pivot-data.js | GET | Pivot 데이터 |
| `/api/stats/dashboard` | stats/dashboard.js | GET | 대시보드 KPI |
| `/api/stats/sales` | stats/sales.js | GET | 월별 판매 통계 |
| `/api/master` | master/index.js | GET/POST/PATCH/DELETE | 거래처/품목 마스터 |
| `/api/master/pricing-matrix` | master/pricing-matrix.js | GET/POST | 가격 매트릭스 |
| `/api/master/activity` | master/activity.js | GET | 활동 이력 |
| `/api/customers/search` | customers/search.js | GET | 거래처 검색 |
| `/api/products/search` | products/search.js | GET | 품목 검색 |
| `/api/sales/ar` | sales/ar.js | GET/POST | 채권 조회/입금등록 |
| `/api/sales/status` | sales/status.js | GET | 판매현황 |
| `/api/sales/tax-invoice` | sales/tax-invoice.js | GET/POST/PATCH/DELETE | 세금계산서 |
| `/api/purchase` | purchase/index.js | GET/POST/DELETE | 구매 현황 |
| `/api/finance/bank` | finance/bank.js | GET/POST/DELETE | 입출금 |
| `/api/finance/exchange` | finance/exchange.js | GET/POST/PATCH | 환율 |
| `/api/stock` | stock/index.js | GET/POST | 재고 조회/조정 |
| `/api/warehouse` | warehouse/index.js | GET | 창고 피벗 |
| `/api/warehouse/[id]` | warehouse/[id].js | GET/PATCH/DELETE | 창고 상세 |
| `/api/warehouse/pivot` | warehouse/pivot.js | GET | 창고 피벗 집계 |
| `/api/admin/worklog` | admin/worklog.js | GET | 작업내역 조회 |
| `/api/admin/activity` | admin/activity.js | GET | 관리자 활동 |
| `/api/ecount/session` | ecount/session.js | POST | 이카운트 세션 |
| `/api/ecount/status` | ecount/status.js | GET | 이카운트 상태 |
| `/api/ecount/sales-push` | ecount/sales-push.js | POST | 판매 Push |
| `/api/ecount/purchase-push` | ecount/purchase-push.js | POST | 구매 Push |
| `/api/ecount/accounting` | ecount/accounting.js | POST | 자동분개 |
| `/api/ecount/customers-sync` | ecount/customers-sync.js | POST | 거래처 동기화 |
| `/api/ecount/sync-log` | ecount/sync-log.js | GET | 동기화 로그 |
| `/api/public/orders` | public/orders.js | GET | 공개 주문 API |
| `/api/public/shipments` | public/shipments.js | GET | 공개 출고 API |
| `/api/ping` | ping.js | GET | 서버 상태 확인 |

---

## 🔴 미완료 태스크 (다음 작업)

### 원래 플랜에서 미완료
1. **주문등록 레이아웃 변경** (`pages/orders/new.js`)
   - `gridTemplateColumns: '220px 1fr 220px'` → `'200px 1fr 340px'`
   - 주문내역서(오른쪽) 220→340px 확대

2. **품목정보 주문 빈도순 정렬** (`pages/api/products/search.js`)
   - OrderDetail COUNT JOIN으로 주문 많은 품목이 위에
   ```sql
   LEFT JOIN (SELECT ProdKey, COUNT(*) AS orderCount FROM OrderDetail WHERE isDeleted=0 GROUP BY ProdKey) oc
   ON p.ProdKey = oc.ProdKey
   ORDER BY ISNULL(oc.orderCount,0) DESC, p.ProdName
   ```

3. **입고관리 XLSX 업로드 고도화** (`pages/incoming.js`)
   - Packing AYURA.xlsx 구조 파싱 완성
   - Row 1: Grower/Weekend/Invoice, Row 2: AWB/Date, Row 4: 헤더, Row 5+: 데이터

### 인프라 미완료
4. **Cafe24 MSSQL IP 화이트리스트**: Railway 서버 IP → Cafe24에 외부 접속 허용 요청 필요
5. **신한은행 API 연동**: 별도 계약 후 착수 (Phase 3)

---

## 📌 중요 기술 메모

### estimate.js 견적서 출력 구조
- `numToKorean(n)`: 한글 금액 변환
- `getFlowerGroup(flowerName)`: 수국/알스트로, 카네이션, 장미, 에콰도르, 기타
- `buildEstimateHtml(...)`: PDF 매칭 HTML
- 출력 모드: `combined`(종합) / `split`(꽃 분류별 분할)

### 공통 컴포넌트
- `WeekInput` (`lib/useWeekInput.js`): 차수 입력 + 4순환, 9개 이상 페이지 사용
- `useApi` (`lib/useApi.js`): fetch 래퍼, 401 시 로그인 리다이렉트
- `withAuth` (`lib/auth.js`): JWT 검증 + 에러 catch
- `ColHeader` (`stats/pivot.js` 내 로컬): createPortal 필터 드롭다운
- `Layout` (`components/Layout.js`): 사이드바 + 탑바

### 주요 버그 패턴 (재발 방지)
- `ShipmentDetail` 원본에 `isDeleted/Cost/Amount/Vat` 없음 → `p.Cost` 사용
- `overflow:auto` 컨테이너 내 `position:absolute` 드롭다운 → `createPortal`
- custFilter 검색 후 `setCustFilter('')` 호출 주의
