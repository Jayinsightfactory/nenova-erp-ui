# NenovaWeb ↔ 이카운트 ERP 경영지원 100% 매칭 점검

작성일: 2026-05-15

## 결론

현재 `nenovaweb` 경영지원 화면은 이카운트 ERP 원본 데이터를 조회해서 보여주는 구조가 아니다. 대부분은 Nenova MSSQL의 출고/구매/수기 테이블을 기준으로 웹에서 자체 계산하고, 이카운트는 일부 데이터를 `push` 하는 용도로만 연결되어 있다.

따라서 경영지원에서 실제 이카운트 ERP 화면과 대조하면 숫자가 다를 수 있다. 100% 매칭을 목표로 하면 “웹 계산값”이 아니라 “이카운트 원본 전표/세금계산서/거래처/입출금/환율 값”을 기준으로 비교하거나 가져오는 검증 단계가 필요하다.

## 현재 확인된 이카운트 연동 구조

| 구분 | 웹 파일 | 현재 역할 | 100% 매칭 상태 |
|---|---|---|---|
| 이카운트 공통 클라이언트 | `lib/ecount.js` | OAPI V2 로그인/세션/POST 호출 | 연결만 담당 |
| 거래처 조회/동기화 | `pages/api/ecount/customers-sync.js` | 이카운트 거래처 조회, 웹 Customer push, OrderCode 역매핑 | 일부 가능 |
| 판매 전송 | `pages/api/ecount/sales-push.js` | 확정 출고를 이카운트 판매입력으로 push | 원본 조회 아님 |
| 구매 전송 | `pages/api/ecount/purchase-push.js` | 웹 ImportOrder를 이카운트 구매입력으로 push | 원본 조회 아님 |
| 자동분개 | `pages/api/ecount/accounting.js` | 웹 TaxInvoice를 자동분개로 push | 원본 조회 아님 |
| 동기화 이력 | `pages/api/ecount/sync-log.js` | 웹 자체 로그와 미전송 건수 | 이카운트 원장 아님 |
| 경영지원 대시보드 | `pages/ecount/dashboard.js` | 연결상태/미전송/로그/전송 버튼 | 검증 화면 아님 |

## 경영지원 화면별 데이터 출처와 불일치 위험

| 화면 | API | 현재 데이터 출처 | 주요 계산/표시 방식 | ERP 매칭 위험 |
|---|---|---|---|---|
| 판매현황 | `/api/sales/status` | `ShipmentMaster`, `ShipmentDetail`, `Customer`, `Product`, `CustomerProdCost` | 확정 출고 `sm.isFix=1`, 단가 `CustomerProdCost.Cost` 우선, 공급가 `단가*수량/1.1`, 부가세 `단가*수량/11` | 높음 |
| 거래처별 채권 | `/api/sales/ar` | 출고 매출 + 웹 `ReceivableLedger` 입금 | 매출은 `Product.Cost` 기준, 입금은 웹 수기 원장 | 매우 높음 |
| 세금계산서 진행 | `/api/sales/tax-invoice` | 웹 신규 테이블 `TaxInvoice` | 웹에서 신규 등록/단계 변경/삭제 | 매우 높음 |
| 구매현황 | `/api/purchase` | 웹 신규 테이블 `ImportOrder`, `ImportOrderDetail` | 외화 합계와 환율 곱으로 원화 계산 | 매우 높음 |
| 입출금 | `/api/finance/bank` | 웹 신규 테이블 `BankTransaction` | 주석상 샘플 모드, 수동 입력 | 매우 높음 |
| 환율 | `/api/finance/exchange` | 웹 `CurrencyMaster` | 초기 seed 값 + 수동 upsert | 높음 |

## 확인된 구체적 불일치 포인트

### 1. 판매현황과 이카운트 판매입력 기준이 같지 않을 수 있음

- `sales/status.js`는 `CustomerProdCost.Cost`가 있으면 거래처별 단가를 쓰고 없으면 `Product.Cost`를 쓴다.
- `sales/ar.js` 채권 매출은 `CustomerProdCost`를 쓰지 않고 `Product.Cost`만 쓴다.
- 같은 출고라도 판매현황과 채권현황 금액이 다를 수 있다.
- 이카운트에 실제 저장된 판매전표 금액과도 별도 대조가 없다.

필요 조치:
- 금액 기준을 하나로 통일한다.
- 이카운트 판매전표 조회 API 또는 전송 직후 반환 전표번호 기준으로 웹 계산값과 ERP 저장값을 비교하는 검증 테이블을 만든다.

### 2. 채권현황은 이카운트 미수금/입금 원장이 아님

- 웹 채권은 출고 매출에서 웹 수기 입금(`ReceivableLedger`)을 뺀 값이다.
- 이카운트의 실제 수금, 반제, 미수 잔액, 전표 취소, 부분 입금이 반영되지 않는다.

필요 조치:
- 이카운트 수금/채권 원본 조회 가능 엔드포인트를 확인한다.
- 없으면 경영지원이 이카운트에서 내보낸 채권/입금 엑셀을 업로드해 웹 계산값과 대조해야 한다.

### 3. 세금계산서 진행단계는 웹 신규 테이블 기준

- `TaxInvoice`는 웹에서 자동 생성하는 신규 테이블이다.
- 이카운트 세금계산서 발행상태, 전자발송번호, 완료상태를 pull 하지 않는다.
- 자동분개 push만 있고, ERP 진행단계와 웹 단계가 일치하는지 확인하지 않는다.

필요 조치:
- 이카운트 세금계산서/계산서 진행단계 원본 필드와 웹 `ProgressStep` 매핑표를 확정한다.
- ERP 발행번호/상태를 가져와 웹 단계가 틀리면 빨간색으로 표시하는 검증 화면이 필요하다.

### 4. 구매현황은 이카운트 구매 원장 원본이 아님

- `ImportOrder/Detail`은 웹 신규 테이블이다.
- 구매 push는 하지만, 이카운트 구매입력 결과를 다시 조회해 웹 구매와 비교하지 않는다.
- 공급처 코드를 `SupplierName`으로 전송하고, 품목코드는 `ProdName`을 쓰는 구조라 ERP 코드 체계와 어긋날 수 있다.

필요 조치:
- 공급처 코드, 품목 코드, 창고 코드, 통화, 수량 단위, 금액 통화 기준을 이카운트 화면과 맞춰야 한다.
- 구매 전송 전 “ERP 코드 미매칭”을 차단해야 한다.

### 5. 입출금/환율은 실제 ERP/은행 원본이 아님

- `BankTransaction`은 주석상 샘플 모드이며 수동 입력 테이블이다.
- `CurrencyMaster`는 seed 값과 수동 수정 값이다.
- 실제 이카운트 또는 은행/고시환율과 다를 수 있다.

필요 조치:
- 경영지원이 보는 실제 원본이 이카운트인지, 은행 API인지, 엑셀인지 결정해야 한다.
- 원본이 정해지기 전에는 “참고용/수동” 배지를 붙이는 것이 안전하다.

## 100% 매칭을 위한 검증 설계

### A. 기준 데이터 확정

| 업무 | 웹 기준 | ERP 기준으로 필요한 값 |
|---|---|---|
| 판매 | 확정 출고 상세 | 판매전표 번호, 거래처코드, 품목코드, 수량, 단가, 공급가, 부가세, 일자 |
| 채권 | 출고 매출 - 웹 입금 | 거래처별 미수잔액, 수금 전표, 반제 상태 |
| 세금계산서 | 웹 TaxInvoice | 발행일, 공급가, 부가세, 전자발송번호, 진행상태 |
| 구매 | 웹 ImportOrder | 구매전표/수입 인보이스, 공급처코드, 품목코드, 통화, 환율, 금액 |
| 입출금 | 웹 BankTransaction | 실제 계좌 입출금 또는 ERP 입출금 원장 |
| 환율 | 웹 CurrencyMaster | ERP 환율 또는 회사 기준 환율 |

### B. 대조 화면/테이블 추가

추천 테이블:

```sql
EcountMatchAudit
```

필드:
- `AuditKey`
- `Domain` (`sales`, `ar`, `taxInvoice`, `purchase`, `bank`, `exchange`)
- `LocalRefKey`
- `EcountRef`
- `LocalAmount`
- `EcountAmount`
- `LocalHash`
- `EcountHash`
- `MatchStatus` (`MATCH`, `DIFF`, `MISSING_LOCAL`, `MISSING_ECOUNT`, `CODE_ERROR`)
- `DiffJson`
- `CheckedDtm`

### C. 화면 표시 원칙

- 이카운트 원본과 대조되지 않은 값은 “검증전”으로 표시한다.
- 이카운트와 금액/코드/상태가 다르면 행 단위로 “불일치” 표시한다.
- 경영지원 화면의 엑셀 다운로드에는 `검증상태`, `ERP전표번호`, `차이금액`, `차이사유` 컬럼을 포함한다.

## 우선순위

1. 판매현황과 채권현황 금액 기준 통일
2. 이카운트 판매전표 전송 후 전표번호/결과 저장 강화
3. 판매/채권/세금계산서 ERP 원본 조회 또는 ERP 엑셀 업로드 비교 기능 추가
4. 구매 코드 매핑 검증: 공급처코드, 품목코드, 창고코드
5. 입출금/환율 화면에 “수동/샘플/ERP검증전” 상태 표시

## 다음 작업 제안

바로 구현 가능한 1차 작업:

- `/api/sales/ar` 금액 계산을 `/api/sales/status`와 동일하게 `CustomerProdCost.Cost` 우선으로 수정
- 경영지원 화면에 “이카운트 원본 검증전” 안내 배지 추가
- `EcountMatchAudit` 테이블과 `/api/ecount/match-audit` 조회 API 생성
- 이카운트 전송 성공 시 `EcountSyncLog`에 전송 금액/라인 수/전표번호를 추가 저장
- 이카운트 또는 경영지원 엑셀 업로드 기반의 대조 기능 설계

