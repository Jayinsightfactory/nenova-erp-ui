---
name: 작업 이력 및 미완료 항목
description: 완료된 버그수정/기능, 미완료 태스크, 다음 작업 목록, 버튼 목록, DB 연결 현황, 최초 기획
type: history
---

# nenova ERP — 전체 작업 이력

---

## 2026-05-25 우선순위 변경

계속된 웹/`nenova.exe` 충돌을 방지하기 위해 앞으로는 기능 수정 전 **충돌 여부 확인을 최우선 작업**으로 둔다.

- 기준 문서: [PRE_WORK_CONFLICT_CHECK_2026-05-25.md](PRE_WORK_CONFLICT_CHECK_2026-05-25.md)
- 적용 대상: 주문등록, 출고분배, 출고확정, 견적서, 재고, 정산, 챗봇의 DB 쓰기 작업
- 원칙: `nenova.exe` 버튼, 저장 프로시저, 기존 ERP row, 운영 데이터 불일치 여부를 확인한 뒤에만 코드 수정
- 출고분배는 `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear`, `ShipmentMaster/Detail`, `ShipmentDate`, `ShipmentHistory` 충돌 여부를 먼저 확인

### 2026-06-02 재고 수동조정 반영 기준 통일

- 요청: `nenova.exe` 재고관리에서 실제 인보이스 차이 때문에 수량을 `+/-` 조정한 경우, 챗봇 재고 답변과 네노바웹 차수피벗/물량표/분배검사가 같은 기준으로 보이게 해야 함.
- 기준 공식: `전재고(ProductStock) + 실제입고(WarehouseDetail) + 수동재고조정(StockHistory) - 출고/주문 기준 수량`.
- 수동재고조정 범위: `StockHistory.AfterValue - BeforeValue`를 합산하되, 자동 이력인 `확정`, `확정취소`, `입고`, `출고`는 중복 방지를 위해 제외.
- 조치: 챗봇 차수별 재고 조회, Pivot 통계/물량표 다운로드, 출고/재고상황 품목별 요약, 붙여넣기 주문등록 후 분배 ADD/CANCEL 입고초과 검사, 차수확정 사전 음수재고 검사를 같은 기준으로 보정.
- 표시: Pivot 통계/물량표에서는 조정값이 있으면 입고 계열에 `재고조정` 열로 함께 들어가며, 합계/잔량이 보정 후 기준으로 계산됨.

### 2026-06-02 23-01 출고분배 엑셀 업로드 출고일 밀림 보정

- 증상: 엑셀 업로드 신규 분배 행의 출고일이 기존 `nenova.exe` 분배 행보다 6일 뒤로 저장됨.
- 대표 사례: 공주플라워 중매 1523 / `CARNATION Mariposa`가 `0 → 1`로 신규 분배되었으나 `2026-06-09`로 저장됨. 정상 출고일은 같은 업체 기존 행과 같은 `2026-06-03`.
- 원인: 웹 출고일 계산이 차수 시작일 이후의 수요일을 찾아서 `23-01` 기준일이 다음 주로 밀림.
- 조치: 출고일 계산을 “차수 시작일의 직전/당일 수요일 + `Customer.BaseOutDay` 오프셋”으로 통일.
- 운영 보정: `23-01` 동일 패턴 18건의 `ShipmentDetail.ShipmentDtm`과 `ShipmentDate.ShipmentDtm`을 함께 보정.
- 후속 확인: `shipmentDateMismatch=0`, `shipmentDateBaseMismatch=0`, `missingCustKey=0`, `duplicateMasters=0`, `keyNumberingNeedsSync=0`.
- 상세 문서: [SHIPMENT_IMPORT_DATE_BASE_OUTDAY_FIX_2026-06-02.md](SHIPMENT_IMPORT_DATE_BASE_OUTDAY_FIX_2026-06-02.md)

### 2026-06-02 출고분배 엑셀 업로드 기본 차수 +1 적용

- 요청: 출고분배 엑셀 업로드 화면은 기존 현재 차수 계산값보다 1차수 뒤를 기본값으로 사용해야 함. 예: `2026-06-02` 기준 `2026-22-01`이 아니라 `2026-23-01`.
- 적용 범위: `/shipment/distribute-import` 화면 기본값만 변경. URL 쿼리로 차수를 직접 지정한 경우는 지정값을 우선 사용.
- 주의: 일반 차수 입력 공통 계산(`getCurrentWeek`)은 그대로 둔다. 업로드 화면에서만 `현재차수 + 1주`를 기본값으로 넘긴다.

### 2026-06-02 2301장미 FREEDOM 50 분배차이 검증 표시 보완

- 증상: `2301장미물량표.xlsx` 검증 시 `ROSE / Freedom 50cm`처럼 주문수량은 같지만 현재 출고분배 수량이 다른 행이 사용자 화면에서 충분히 명확하게 보이지 않음.
- 확인: 운영 preview 기준 `FREEDOM` 계열 12건 중 분배차이 9건이 서버 적용대상에 포함됨. 대표: 에프에스오2025, 월드천사, 경원원예, 수연원예는 주문 10 / 현재분배 9 / 엑셀 10으로 `분배차이 +1`.
- 조치: 출고분배 엑셀 업로드 화면에 `분배차이` KPI, `분배차이만` 필터, 업체별 `분배반영품목`, 피벗 품목별 `분배반영 n건` 표시를 추가.
- 주의: 장미 물량표 뒤쪽 `콜롬비아` 농장/입고 블록은 출고업체 분배 대상이 아니므로 업체 매칭 대상으로 읽지 않는다. 읽으면 미매칭 농장명이 적용을 막을 수 있다.

### 2026-06-02 출고분배 엑셀 업로드 적용 현황 모달

- 증상: 엑셀 업로드 적용 중 작업 현황이 페이지 내부에만 표시되어 새창처럼 즉시 확인되지 않음.
- 조치: `승인 후 주문등록+분배` 실행 직후 중앙 `작업 현황` 모달을 띄우고, 처리 중 안내/서버 로그/업체별 처리 결과/오류 메시지를 같은 창에서 확인하도록 변경.

### 2026-06-02 엑셀 누락 기존 주문/분배 삭제대상 표시

- 증상: `2301수국물량표.xlsx`에서 `여분코드(CL00)`를 물량표에서 삭제했는데, 업로드 분석에는 기존 주문/분배 삭제대상으로 표시되지 않음.
- 원인: 기존 preview가 엑셀에서 읽힌 업체×품목 셀만 기준으로 분석행을 만들고, DB에 이미 있지만 엑셀에서 완전히 빠진 업체/품목 조합은 `엑셀수량 0` 행으로 생성하지 않았음.
- 조치: 이번 엑셀에서 매칭된 품목군에 대해 DB 기존 주문/분배가 있는데 엑셀에 없는 조합은 `삭제대상`으로 추가 표시한다. 적용 시 기존 주문/분배를 0 기준으로 처리할 수 있게 한다.

### 2026-05-25 21-01 국내왁스 출고분배 장애

- 증상: `nenova.exe`에서 21-01 국내왁스 일괄출고분배 버튼이 동작하지 않음
- 원인: `KeyNumbering.Category='ShipmentDetailKey'` 값이 실제 `MAX(ShipmentDetail.SdetailKey)`보다 작아서 `usp_DistributeOne`이 이미 존재하는 `SdetailKey=74807`로 INSERT 시도
- 확인: 트랜잭션 롤백 테스트에서 PK 중복 오류를 재현했고, 채번값 보정 후 같은 테스트가 `oResult=0`으로 통과함
- 조치: 운영 DB `ShipmentDetailKey` 채번값을 실제 최대값 `74808`로 보정
- 후속 확인: 실제 분배 후 `ShipmentDetailKey`는 `74813`까지 증가했고 `KeyNumbering`도 `74813`으로 일치
- 후속 확인: 생성된 5건 모두 `ShipmentDate` 합계 = `OutQuantity`, `OutQuantity` = `EstQuantity`, 출고일/단가/공급가/부가세 정상
- 후속 확인: 21-01 `ShipmentMaster` 중복 거래처 그룹 0건
- 재발 방지: 웹 출고분배/분배조정에서 `OrderMaster/Detail`, `ShipmentMaster/Detail` 생성 후 `KeyNumbering`을 실제 최대 key 이상으로 동기화

### 2026-05-25 NenovaWeb vs Nenova.exe 메뉴/화면 누락 감사

- 요청: 로그인 후 첫 화면부터 전체 메뉴, 버튼, 화면 정보가 `nenova.exe`와 어디가 다른지 재확인
- 확인: 웹 `Layout`, `dashboard`, 모바일 메뉴 복제본과 기존 exe dnSpy/문자열 분석 문서 대조
- 결과 문서: `docs/NENOVA_WEB_EXE_MENU_GAP_AUDIT_2026-05-25.md`
- 최우선 누락/차이: 출고분배 버튼 parity, 견적서/ShipmentFarm, 재고 StockList/Product.Stock/ProductStock, 주문등록 기존 주문/변경내역, 업체별 품목단가관리 단가 흐름
- 추가 발견: 모바일 메뉴 복제본에 `/orders/kakao-audit` 누락, 데스크톱/모바일 그룹명 일부 불일치
- 주의: `국내왁스` 묶음의 실제 대상은 꽃 왁스가 아니라 운임성 품목이었다. 주문은 `현지상차운임(ProdKey=2262)`, 입고는 `운송료(ProdKey=2182)`로 잡힘

### 2026-05-25 전체 검증 1차

- 요청: 시간 충분하니 전체 검증 작업 시작
- 결과 문서: `docs/FULL_VALIDATION_AUDIT_2026-05-25.md`
- 운영 DB 읽기 진단: KeyNumbering 정상, 최근 ShipmentDate/ShipmentDtm mismatch 0건, 최근 단가 0 저장 0건
- 확인된 실제 위험: 21-01이 부분확정 상태라 기존 `/api/shipment/distribute`의 차수 전체 확정 체크가 미확정 품목군 분배까지 막을 수 있었음
- 보완: 직접 출고분배 저장을 품목군 확정 체크로 변경, 출고일 미지정 시 거래처 기본출고요일 기준 fallback, 단가 서버 fallback, 저장 실패 감지 추가
- 보완: 붙여넣기 거래처 매핑 학습을 실제 주문 저장/분배 성공 후로 지연
- 보완: 모바일 메뉴에 카톡 변경 검증 추가, 출고분배 품목군 `네달란드` 오타를 `네덜란드`로 수정

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

---

## 2026-06-02 챗봇 감사 로그 점검 및 라우팅 보정

- 최근 챗봇 감사 로그 기준 오류 유형 확인:
  - `23-1차 콜롬비아 장미 농장`이 거래처명 `콜롬비아...`로 오해되는 문제
  - `22-2차 영남소재 분배수량`이 출고분배 조회가 아니라 재고/모호조회로 빠지는 문제
  - `22-2차 재고`처럼 품목을 지정하지 않은 차수 재고 질문이 전체 재고 계산으로 진행되지 않는 문제
  - 사용자 지정 차수가 있는데도 조사형 응답에서 비정상 차수 후보(`60-01` 등)를 같이 보여주는 문제
- 수정 내용:
  - `농장` 질문은 거래처/업체 문맥이 없으면 재고의 입고농장 조회로 우선 라우팅.
  - `분배`, `분배수량`, `분배물량`, `출고분배`는 출고분배 품목수량 조회로 라우팅.
  - 품목/국가/꽃종류를 지정하지 않은 `N-N차 재고` 질문도 전체 품목 재고현황을 계산하도록 허용.
  - 수동재고조정만 존재하는 품목도 챗봇 재고현황 목록에서 빠지지 않게 조건 보정.
  - 조사형 확인 응답은 사용자가 이미 차수를 적은 경우 별도 차수 후보를 제시하지 않고 해당 차수만 표시.
  - 업체명 정규화에서 `(주)`, `㈜`, `주식회사`, `꽃소재` 표현 차이를 흡수하도록 보정.
- 검증:
  - `next build` 통과.

---

## 2026-06-02 네노바웹 자동 비고 문구 축약

- 요청: 네노바웹에서 작업 시 DB 비고/이력 비고에 남는 자동 문구가 너무 길고 불필요한 내용이 포함됨.
- 기준 변경:
  - 날짜/시간/사용자는 `ChangeDtm`, `ChangeID`, 생성/수정 컬럼에 이미 있으므로 자동 비고 문구에서 제거.
  - 비고에는 작업종류와 변경값만 남김.
  - 예: `엑셀업로드 분배 0>1`, `엑셀업로드 주문 0>1`, `출고분배 0>3`, `단가 11000>12000`, `수량 3단>4단`, `차수피벗 수정`.
- 적용 경로:
  - 출고분배 엑셀 업로드 주문/분배/출고일 지정
  - 출고분배 저장
  - 출고일 보정 진단
  - 견적서관리 단가/수량 수정
  - 차수피벗 주문 추가/수정/삭제
  - 붙여넣기 주문등록 후 분배 및 자동 주문삭제
- 주의:
  - 기존 긴 비고 데이터는 이번 코드 변경만으로 일괄 삭제하지 않음. 기존 데이터 정리는 별도 범위/차수 확인 후 안전하게 진행해야 함.
  - 단가수정 진단 API는 새 짧은 문구(`단가 旧>新`)도 찾도록 패턴 보정.

---

## 2026-06-02 챗봇 주문 조회 선택 안내 개선

- 요청: `꽃길 20-01 주문`처럼 거래처와 차수는 확정됐지만 표시 방식이 없는 경우 `어떻게 보여드릴까요?`만 나오지 않고, 가능한 표시 방식을 같이 안내해야 함.
- 수정 내용:
  - 주문 조회 선택 응답에 `품목별 상세`, `합계만` 설명과 바로 물어볼 수 있는 예시 문장을 함께 표시.
  - 사용자가 이미 `품목별`, `상세`, `합계`, `총수량` 등을 말한 경우 버튼 선택을 다시 요구하지 않고 해당 모드로 바로 조회.
  - `주문 합계`가 일반 SQL 대화로 우회하지 않도록, 거래처가 매칭되는 주문 조회는 주문조회 핸들러에서 직접 처리.
- 검증:
  - `next build` 통과.

---

## 2026-06-02 붙여넣기 주문등록 주문 즐겨찾기 큰 창 추가

- 요청: 붙여넣기 주문등록의 `주문 즐겨찾기`를 새 창에서 크게 보고, 원본 주문과 등록대상 차수를 분리해서 선택할 수 있어야 함.
- 수정 내용:
  - `/orders/paste-template` 전용 큰 창 페이지 추가.
  - 붙여넣기 주문등록 화면 상단에 큰 `주문즐겨찾기` 단일 버튼 추가.
  - 본문 중간의 작은 주문 즐겨찾기 패널은 제거하고, 새 창에서 전체 작업을 처리하도록 정리.
  - 큰 창에서 `원본 차수` 주문 불러오기, 저장 즐겨찾기 불러오기, `등록대상 차수` 직접 선택을 분리.
  - `즐겨찾기로 저장하기` 버튼을 별도 제공하고, 기존 즐겨찾기 수정/삭제와 등록대상 차수 주문등록 버튼을 분리.
- 검증:
  - `next build` 통과.

---

## 2026-06-02 대시보드 개인 메뉴 즐겨찾기 추가

- 요청: `/dashboard` 홈 화면의 빈 영역에 모바일웹처럼 깔끔한 개인 메뉴 즐겨찾기를 구성하고, `즐겨찾는 메뉴 추가하기`로 직접 메뉴를 추가할 수 있어야 함.
- 수정 내용:
  - 대시보드 상단에 `내 즐겨찾기 메뉴` 카드 영역 추가.
  - 사이드바 실제 메뉴 목록을 재사용해 메뉴 선택창을 구성.
  - 사용자별 `UserFavorite`에 `dashboard-menu` 페이지명으로 즐겨찾기 저장/삭제.
  - 즐겨찾기 메뉴 클릭 시 작업 페이지가 새 창/팝업으로 열리도록 처리.
  - 기존 고정 `빠른 이동`은 개인 메뉴 즐겨찾기로 대체.
- 검증:
  - `next build` 통과.

---

## 2026-06-02 붙여넣기 주문등록 매칭 우선 흐름 및 주문 변경이력 탭

- 요청: 붙여넣기 주문등록에서 재고/변경사항은 최종 단계에 표시하고, 먼저 거래처/품목 매칭부터 처리되게 해야 함. 옆 탭에는 주문 변경이력을 간단히 보여주고 상세 내역은 새 창으로 확인 가능해야 함.
- 수정 내용:
  - 붙여넣기 주문등록 화면의 `카톡 잔량/히스토리`와 `매칭 변경사항` 패널을 분석 버튼 바로 아래에서 제거.
  - 모든 미매칭 품목 처리 후 `최종 확인` 영역에 재고/변경사항을 표시하도록 흐름 변경.
  - `최종 잔량/변경사항 계산` 버튼으로 명칭 변경.
  - 오른쪽 고정 `주문 변경이력` 탭 추가.
  - 붙여넣기 화면의 현재 차수/거래처 기준 최근 `OrderHistory`를 요약 표시.
  - `OrderHistory` 조회 API에 여러 거래처명 직접 필터(`custNames`)를 추가해, 차수 전체 변경 TOP 500에서 업체 이력이 밀려 누락되는 상황을 줄임.
  - 요약 행 또는 `자세히` 버튼 클릭 시 `/orders/history?popup=1` 새 창에서 상세 조회.
  - `/orders/history` 상세 페이지 추가: 차수/거래처 필터, 거래처별 건수 바로 선택, 변경 전/후 값 테이블 표시.
- 안전성:
  - 이번 변경은 조회/표시 UI 중심이며 주문등록, 출고분배, 견적 금액, 출고일 계산 SQL 쓰기 로직은 변경하지 않음.
  - 기존 `OrderHistory` 조회 API를 사용하므로 신규 DB 쓰기 없음.
- 검증:
  - `next build` 통과.

---

## 2026-06-02 일일 대화 원장 및 작업기록 방식 보완

- 요청: 오늘 대화내용 전체를 MD에 저장하고, 검색해서 작업내역 관리방식을 보완해야 함.
- 저장 문서:
  - [DAILY_CONVERSATION_LOG_2026-06-02.md](DAILY_CONVERSATION_LOG_2026-06-02.md)
- 확인한 기존 기준:
  - [WORK_RECORD_POLICY_2026-05-25.md](WORK_RECORD_POLICY_2026-05-25.md)
  - [WEB_VS_ERP_CONFLICTS.md](WEB_VS_ERP_CONFLICTS.md)
  - [NENOVA_PROJECT_PLAN_STATUS.md](NENOVA_PROJECT_PLAN_STATUS.md)
  - `pages/dev/project-plan.js`, `pages/dev/history.js`, `pages/dev/action-log.js`
- 보완 내용:
  - 긴 세션은 `docs/DAILY_CONVERSATION_LOG_YYYY-MM-DD.md` 일일 대화 원장으로 별도 저장.
  - 사용자 요청, 언급 파일, 결정, 검증, 커밋, 남은 위험을 한 문서에 묶어 검색 가능하게 함.
  - 기능별/사고별 상세 문서와 `work_history.md`는 원장 링크 중심으로 연결.
  - DB 쓰기/`nenova.exe` 호환 작업 전 `rg` 검색 체크를 기록 정책에 추가.
- 검증:
  - 문서 변경이므로 빌드 불필요. `git diff --check`로 공백 오류 확인 대상.

---

## 2026-06-02 대시보드 바로가기 버튼 크기 균일화

- 요청: 홈에 만들어준 바로가기 버튼들의 크기가 일관적이지 않음.
- 수정 내용:
  - `/dashboard`의 `내 즐겨찾기 메뉴` 그리드를 고정 폭 카드 기준으로 변경.
  - 바로가기 버튼과 빈 상태 추가 버튼을 동일한 폭 `176px`, 높이 `92px`로 통일.
  - 긴 메뉴명 때문에 버튼 높이가 달라지지 않도록 카드 내부 레이아웃을 고정.
- 검증:
  - `next build` 통과.

---

## 2026-06-02 붙여넣기 주문등록 기존재고/수정내역 저장

- 요청: 붙여넣기 주문등록에서 기존재고를 입력한 뒤 저장하고, 수정내역이 생기면 입력 후 `수정저장`으로 다시 저장할 수 있어야 함. 기존재고가 몇 차수 기준인지도 설정할 수 있어야 함.
- 수정 내용:
  - `/orders/paste` 기존재고 영역에 `기준차수` 입력 추가.
  - 기준차수별로 `텍스트 붙여넣기(주문/변경사항)`, `기존재고`, `잔량재고`를 한 묶음으로 저장.
  - 저장본이 없으면 `저장하기`, 저장본이 있으면 `수정저장`으로 표시.
  - 저장본이 있는 기준차수는 `불러오기` 버튼으로 다시 입력칸에 적용.
  - 최종 잔량/히스토리 패널에 `기존재고 기준차수` 표시.
  - 공용 즐겨찾기 API에 사용자 본인 저장본 수정용 `PUT /api/favorites` 추가.
- 저장 위치:
  - `UserFavorite.PageName = 'paste-stock-note'`
  - `FilterData`에 `baseWeek`, `orderWeek`, `pasteText`, `baseStockText`, `remainStockText` 저장.
- 안전성:
  - 주문/분배/재고 DB 원장에는 쓰지 않고, 사용자별 `UserFavorite`에만 저장.
- 검증:
  - `next build` 통과.

---

## 2026-06-02 주문즐겨찾기 차수 이동 및 등록 결과 검증표

- 요청: 주문즐겨찾기 큰 창에서 `원본 차수`와 `등록대상 차수`를 버튼으로 1차수씩 올리고/내릴 수 있어야 함. 등록대상 차수에 주문등록 후 `nenova.exe`에서도 정상 주문등록으로 보이는지, 기존 주문에 추가된 경우 기존/추가/최종 결과값을 보여줘야 함.
- 수정 내용:
  - `/orders/paste-template`의 `원본 차수`, `등록대상 차수` 입력칸 옆에 1차수 이동 버튼 추가.
  - 주문등록 후 `/api/orders`를 즉시 재조회해 전산 `ViewOrder` 기준 최종 수량과 등록 결과를 비교.
  - 하단 검증표에 업체, 차수, 품목별 `기존`, `이번등록`, `최종`, `전산조회`, `일치/확인필요` 표시.
  - 삭제로 최종 0이 된 품목은 전산 조회에서 행이 사라지는 것을 정상 삭제 확인으로 표시.
  - 음수 변경은 검증표에서 `취소`로 표시.
  - `/api/orders` POST 응답에 `previousQty`, `deltaQty`, `finalQty`, `orderDetailKey`를 추가해 화면에서 기존+추가 결과를 직접 확인 가능하게 함.
- 안전성:
  - 주문 저장 경로는 기존 `OrderMaster/OrderDetail` 정식 주문등록 API를 그대로 사용.
  - 전산 표시 검증은 저장 직후 조회만 수행하며 추가 DB 쓰기 없음.

---

## 2026-06-03 모바일 챗봇 바로 조회 패널

- 요청: 네노바 챗봇에서 `재고조회`, `농장확인`, `출고품목수량확인` 등을 차수/업체/품종 선택 후 바로 답변 가능한 구조로 변경.
- 수정 내용:
  - `/m/chat` 상단에 `바로 조회` 패널 추가.
  - 차수는 `/api/orders/weeks`, 업체는 `/api/customers/search`, 품종은 `/api/products/search` 조회 API로 선택.
  - `재고조회`: 선택 차수 + 선택 품종을 structured payload `{ intent:'stock', mode:'weekStockStatus', week, prodKey }`로 전송.
  - `농장확인`: 선택 차수 + 선택 품종을 structured payload `{ intent:'stock', mode:'incomingFarm', week, prodKey, groupBy:'product' }`로 전송.
  - `출고품목수량확인`: 선택 차수 + 선택 업체를 structured payload `{ intent:'shipment', mode:'items', week, custKey }`로 전송. 품종 선택 시 `prodKey`로 해당 품목만 필터링.
  - 사용자가 `2026-23-01`처럼 입력해도 챗봇 조회에는 전산 OrderWeek 기준 `23-01`로 전달.
  - `lib/chat/handlers/shipment.js`는 `prodKey` payload가 있으면 해당 품목만 출고수량 조회.
- 안전성:
  - 화면 선택 패널은 조회 API만 사용.
  - 챗봇 답변은 기존 `/api/m/chat` 라우터와 기존 재고/출고 핸들러를 사용하며, ERP 원장 쓰기 없음.
- 검증:
  - `next build` 통과.

### 2026-06-03 모바일 챗봇 기준차수 휠 및 빠른버튼 대체

- 추가 요청: 바로조회 차수는 `기준차수`로 정하고, 위아래 드래그로 선택 가능해야 함. 기존 `오늘 출고 확정 업체`, `이번 주 재고 부족 품목`, `이번 달 매출`, `승인 대기 주문` 빠른버튼은 바로조회 구조로 대체해야 함.
- 수정 내용:
  - `/m/chat`의 기존 빠른버튼 4개 제거.
  - 인사 문구를 `상단 바로 조회에서 기준차수, 업체, 품종을 선택` 안내로 변경.
  - 바로조회 차수 선택을 텍스트 입력/목록에서 `기준차수` 스크롤 휠로 변경.
  - 차수 휠은 오늘 기준 차수를 기본값으로 사용하고, `01-01`~`52-04` 범위 밖 차수는 후보에서 제외.
  - 휠을 위아래로 밀면 가운데에 가까운 차수가 자동 선택되고, 탭 선택도 가능.
- 검증:
  - `next build` 통과.

### 2026-06-03 모바일 챗봇 기준차수/휠 선택 보정

- 보고: 기준차수가 잘못 나오고, 위아래 드래그해도 원하는 차수가 선택되지 않음.
- 원인:
  - 기본 기준차수가 오늘 날짜 계산값 그대로라 업무 기준 `+1차수`가 아니었음.
  - 차수 휠이 스크롤 중 가운데 항목을 자동 선택해 사용자가 원하는 차수를 누르기 전 값이 튈 수 있었음.
  - DB 전체 차수를 내림차순으로 자르면서 기준차수 주변 후보가 목록에서 밀릴 수 있었음.
- 수정 내용:
  - 기본 기준차수를 `오늘 계산 차수 + 1차수`로 변경.
  - 차수 후보는 기준차수 주변 범위를 먼저 표시하고, 그 뒤에 기존 DB 차수를 붙임.
  - 스크롤 중 자동 선택 로직 제거. 위아래로 밀어 찾은 뒤 원하는 기준차수를 직접 누르면 선택되도록 변경.
- 검증:
  - `next build` 통과.

### 2026-06-03 모바일 챗봇 운영 차수만 표시

- 요청: `nenova.exe`에서 운영 중인 차수 표시처럼, 실제 데이터값이 있는 차수만 바로조회 기준차수에 보여야 함.
- 수정 내용:
  - `/api/orders/weeks`가 `OrderMaster`, `WarehouseMaster`, `ShipmentMaster`, `StockMaster`에 실제 데이터가 있는 차수만 합쳐서 반환하도록 변경.
  - `01-01`~`52-04` 형식 밖의 차수는 제외하고, 차수/회차 숫자 기준 최신순으로 정렬.
  - `/m/chat` 바로조회 기준차수 휠은 API에서 받은 실제 운영 차수만 사용.
  - 오늘 날짜 계산값, `+1차수`, 주변 후보처럼 화면에서 임의 생성하던 차수 후보는 제거.
  - 실제 운영 차수가 없으면 `데이터 없음` 안내를 표시하고 조회 버튼은 비활성 상태를 유지.
- 안전성:
  - 차수 목록 조회와 화면 표시만 변경하며 주문등록, 분배, 재고 원장에는 쓰기 작업 없음.
- 검증:
  - `next build` 통과.

### 2026-06-03 모바일 챗봇 바로조회 버튼 응답 단순화

- 요청: 바로조회 버튼은 누르면 질문이 되고, 화면에는 답변만 나오면 됨.
- 수정 내용:
  - `/m/chat` 바로조회 버튼 클릭 시 `23-1차 품목 재고 알려줘`, `23-1차 품목 농장 수량 알려줘`, `23-1차 업체 출고 품목수량 알려줘` 같은 자연어 질문을 대화창에 표시.
  - 정확한 조회를 위한 내부 payload는 유지하되, 사용자 화면에는 카드/선택지 UI 대신 텍스트 답변 하나만 표시.
  - 버튼 조회 결과에서 `제가 이해한 조건`, `검색 경로`, `조회된 후보/행` 같은 내부 검증 문구는 숨김.
  - 버튼 조회 후 바로조회 패널을 접어 질문/답변 대화가 바로 보이게 변경.
  - 바로조회 하단 설명 문구 제거.
- 안전성:
  - 모바일 챗봇 표시 방식만 변경. 주문, 분배, 재고 원장 쓰기 없음.
- 검증:
  - `next build` 통과.

### 2026-06-03 모바일 챗봇 `바로 조회` 문구 제거

- 보고: 버튼 동작은 바뀌었지만 화면에 여전히 `바로 조회` 문구가 표시됨.
- 수정 내용:
  - `/m/chat` 상단 패널 제목을 `바로 조회`에서 `질문 버튼`으로 변경.
  - 초기 안내 문구에서 `상단 바로 조회` 표현 제거.
  - 모바일 브라우저 localStorage에 저장된 예전 챗봇 히스토리 안의 `바로 조회` 문구도 로드 시 자동 치환.
- 검증:
  - `next build` 통과.

### 2026-06-03 모바일 챗봇 질문 버튼 형식 정리

- 요청: 버튼은 아래 질문 형식으로 동작해야 함.
  - `~차수 ~품종 농장 품목수량확인`
  - `~차수 ~담당자 ~업체 출고 수량 확인`
  - `~차수,~차수 ~업체 출고 수량 확인 합산수량`
  - `~차수 재고`
- 수정 내용:
  - `/m/chat` 질문 버튼 영역에 `담당자선택` 추가.
  - 담당자를 선택하면 업체 목록은 해당 담당자 업체만 필터링.
  - `출고 합산차수` 선택을 추가해 1개 차수 또는 2개 차수 합산 질문을 만들 수 있게 변경.
  - 버튼 문구를 `농장 품목수량확인`, `출고 수량 확인`, `차수 재고`로 정리.
  - `차수 재고`는 품종 선택 없이 차수만으로 조회.
  - 출고 수량 버튼은 payload `weeks`를 전달하고, `lib/chat/handlers/shipment.js`에서 여러 차수를 `ShipmentMaster.OrderWeek IN (...)`으로 합산 처리.
  - 버튼 답변에서 텍스트 목록이 이미 있는 경우 카드 변환 목록을 중복 출력하지 않도록 정리.
- 안전성:
  - 챗봇 조회/표시 기능만 변경. 주문, 분배, 재고 원장 쓰기 없음.
- 검증:
  - `next build` 통과.

### 2026-06-03 ECOUNT 100% 활용/매칭 기획

- 요청: 경영지원부 ECOUNT 활용현황 문서와 로그인된 ECOUNT 화면을 기준으로, `nenovaweb` ECOUNT 페이지를 100% 활용할 수 있게 기획.
- 확인 자료:
  - `경영지원부 이카운트 ERP 활용현황_26.03.04.docx`
  - 현재 `/ecount/dashboard`, `/api/ecount/*`, `lib/ecount.js`
  - 기존 `NENOVA_ECOUNT_ERP_MATCH_AUDIT.md`
- 결론:
  - 현재 네노바웹은 ECOUNT 전체 대체가 아니라 일부 `push`/동기화 로그 중심.
  - 100% 활용을 위해서는 ECOUNT 원본 화면별 컬럼, 필터, 버튼, 원본 조회 가능 여부를 먼저 수집하고, 마스터 코드/판매/채권/세금계산서/구매/입출금/회계원장 순서로 대조 구조를 만들어야 함.
- 산출물:
  - `docs/ECOUNT_FULL_USAGE_PLAN_2026-06-03.md`
  - 화면별 매칭표, 단계별 구현 우선순위, DB/API 설계, Claude in Chrome 읽기전용 조사 프롬프트 포함.
- 안전성:
  - ECOUNT API 키 원문은 기록하지 않음.
  - 운영 ECOUNT 저장/삭제/전송/일괄반영은 조사 단계에서 금지.

### 2026-06-03 ECOUNT 작업 제약 추가

- 추가 요청:
  - 이 작업 중 ECOUNT에 데이터를 넣거나 변경하면 안 됨.
  - 기존 `nenovaweb` 메뉴에 이미 구현된 기능과 중복 없이 작업해야 함.
  - ECOUNT API 횟수 제한을 감안해야 함.
- 반영:
  - `docs/ECOUNT_FULL_USAGE_PLAN_2026-06-03.md`에 `최상위 작업 원칙` 섹션 추가.
  - ECOUNT 원본 쓰기 금지 목록 명시: 판매/구매/자동분개/세금계산서/마스터/입출금/일괄반영/마감/삭제/수정/저장 금지.
  - 기존 메뉴 재사용 기준 명시: 판매, 채권, 세금계산서, 구매, 입출금, 환율, 마스터, ECOUNT 허브는 기존 메뉴/API 우선.
  - API 호출 제한 대응 명시: 수동조회, 서버 캐시, DB 스냅샷, 배치 조회, 엑셀 업로드 대조, `EcountMatchAudit` 재사용.
  - Claude in Chrome 조사 프롬프트에도 같은 제약 추가.

### 2026-06-03 ECOUNT 홈페이지 직접 검증 원칙 추가

- 추가 요청: 워드파일 이미지는 잘 보이지 않으므로, 실제 ECOUNT 홈페이지에서 직접 확인해서 100% 검증해야 함.
- 반영:
  - `docs/ECOUNT_FULL_USAGE_PLAN_2026-06-03.md`에 `ECOUNT 홈페이지 직접 검증 필수` 원칙 추가.
  - 검증 기준 우선순위 명시: 실제 ECOUNT 화면 > 조회용 엑셀 원본 > read-only API 응답 > 워드 텍스트 > 워드 이미지.
  - 실제 홈페이지 확인 전에는 어떤 항목도 `100% 검증완료`로 표시하지 않도록 제한.
  - `EcountEndpointMap` 설계에 `VerifiedFromHomepage`, `MenuPath`, `ScreenshotNote`, `WriteRiskMemo` 필드 추가.
  - Claude in Chrome 조사 프롬프트에도 실제 홈페이지 확인 필수 조건 추가.

### 2026-06-03 출고분배 엑셀 업로드 사전 일괄분배 버튼 추가

- 요청: 출고분배 엑셀 업로드에서 `검증하기` 전에, 업로드한 파일의 품종/품목 범위에 대해 먼저 일괄 출고분배를 실행하고 그 뒤 검증할 수 있게 변경.
- 반영:
  - `/shipment/distribute-import` 상단에 `업로드 품종 일괄분배` 버튼 추가.
  - 새 API `/api/shipment/distribute-import-prealign` 추가.
  - 엑셀 파일을 읽어 업체/품목을 매칭한 뒤, 매칭된 업로드 품목 범위의 기존 주문등록 수량을 기준으로 `ShipmentDetail`, `ShipmentDate`를 먼저 정렬.
  - 주문등록 수량은 변경하지 않음. 최종 엑셀 변경 적용은 기존 `승인 후 주문등록+분배` 버튼에서만 실행.
  - 작업 결과는 업체명, 품목명, 주문기준 수량, 출고분배 변화, 처리내용, 출고일로 표시.
- 안전성:
  - 확정된 차수는 실행 차단.
  - `KeyNumbering` 동기화, `ShipmentMaster` 기존 row 재사용, `ShipmentDate` 재작성, 출고일 계산 기준은 기존 엑셀 업로드 적용 로직과 동일 방향.
  - `OrderMaster`, `OrderDetail`은 사전 일괄분배 단계에서 수정하지 않음.
- 검증:
  - 번들 Node로 `next build` 통과.

### 2026-06-03 붙여넣기 주문등록 기존재고 저장본 추가/삭제 버튼

- 요청: `/orders/paste` 기존재고 영역에 수정만 있고 삭제가 없으며, 기존재고 추가도 따로 필요.
- 반영:
  - 기존재고 버튼을 `추가저장`, `수정저장`, `삭제`로 분리.
  - `추가저장`은 같은 기준차수라도 새 저장본을 생성.
  - `수정저장`은 현재 기준차수의 불러온 저장본만 덮어씀.
  - `삭제`는 현재 저장본만 삭제하고, 입력창 내용은 유지.
  - 삭제 후 같은 기준차수에 이전 저장본이 있으면 다시 감지해 상태 문구로 표시.
- 안전성:
  - 기존재고 저장본은 `UserFavorite`만 사용. 주문/분배/재고 원장 DB에는 쓰지 않음.
- 검증:
  - 번들 Node로 `next build` 통과.

### 2026-06-03 출고분배 엑셀 업로드 사전 일괄분배 MD 재점검 및 비활성화

- 요청: `업로드 품종 일괄분배`가 `nenova.exe` 적용 과정과 동일한지, 문제 생김 요소를 MD 기준으로 확인.
- 확인한 MD:
  - `docs/PAGE_DATA_INPUT_DB_PARITY_AUDIT_2026-05-26.md`
  - `docs/ESTIMATE_EDIT_EXE_PARITY_AUDIT_2026-05-26.md`
  - `docs/NENOVA_EXE_REPORTED_ISSUES_RECHECK_2026-05-26.md`
  - `docs/PRE_WORK_CONFLICT_CHECK_2026-05-25.md`
  - `CLAUDE.md`
- 결론:
  - `nenova.exe`의 일괄/개별 출고분배는 `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear` 전산 SP 경로.
  - 웹 직접 출고분배 저장은 `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentHistory`, `KeyNumbering`을 직접 갱신하는 경로로, 전산 SP와 완전 동일 경로가 아님.
  - 따라서 `업로드 품종 일괄분배`를 바로 운영 쓰기 버튼으로 열어두면 중복 `ShipmentDetail`, `KeyNumbering`, 출고일/단가/히스토리, `nenova.exe` 표시 차이 위험이 있음.
- 조치:
  - `/shipment/distribute-import`의 `업로드 품종 일괄분배` 버튼을 비활성화.
  - `/api/shipment/distribute-import-prealign`도 기본적으로 409 응답으로 차단.
  - 향후 실제 사용하려면 `usp_DistributeTotal/One/Clear` 파라미터와 결과를 읽기 전용으로 확인하고, 테스트 차수에서 1:1 대조 후 전산 SP 경로로 재구성해야 함.

### 2026-06-03 출고분배 웹 저장 경로 기준 보정

- 사용자 기준:
  - "웹 직접 저장은 전산 SP와 완전 동일 경로가 아니다"의 의미는 웹 작업 자체를 금지한다는 뜻이 아니라, 웹 작업 때문에 `nenova.exe`와 충돌이 생기면 안 된다는 뜻.
  - 웹에서 `nenova.exe`와 같은 전산 SP 경로를 쓸 수 있으면 그 경로를 우선 사용한다.
- 반영:
  - `/api/shipment/distribute-diagnose` 응답에 `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear`의 실제 운영 DB 파라미터 목록을 추가.
  - 이 변경은 읽기 전용 진단이며 주문/분배/재고 데이터는 수정하지 않는다.
- 후속 원칙:
  - 출고분배 엑셀업로드의 사전 일괄분배는 웹 직접 INSERT/UPDATE로 다시 열지 않는다.
  - 운영 DB에서 SP 파라미터와 호출 단위가 확인되면, 업로드 품종별 `usp_DistributeOne` 또는 동일한 전산 SP 호출 경로로 재구성한다.
  - SP 호출 전에는 확정 차수, `KeyNumbering` 역전, 기존 출고일 누락/불일치 진단을 먼저 보여주고 이상이 있으면 실행을 막는다.
