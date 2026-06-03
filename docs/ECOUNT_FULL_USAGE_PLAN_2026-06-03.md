# ECOUNT 100% 활용/매칭 기획

작성일: 2026-06-03

## 목적

`nenovaweb`의 ECOUNT 페이지를 경영지원부가 실제 ECOUNT ERP에서 쓰는 화면과 1:1로 맞춰 사용할 수 있게 만든다.

이번 기준 문서:

- `경영지원부 이카운트 ERP 활용현황_26.03.04.docx`
- 현재 `nenovaweb` ECOUNT 구현
- 기존 `NENOVA_ECOUNT_ERP_MATCH_AUDIT.md`
- 운영 안전 원칙: ECOUNT 전송/저장/삭제/일괄반영은 사용자 승인 전 실행 금지

## 현재 결론

현재 `nenovaweb`의 `/ecount/dashboard`는 ECOUNT 전체 업무 대체 화면이 아니다.

현재 구현은 다음에 가깝다.

- ECOUNT API 세션 상태 확인
- 판매입력 push
- 구매입력 push
- 자동분개 push
- 거래처 동기화/pull 일부
- 동기화 로그

경영지원부 문서 기준 실제 활용 범위는 입출금, 카드, 거래처/품목/사원/계정/외화 마스터, 판매/구매, 채권, 세금계산서, 회계원장까지 포함한다.

따라서 100% 활용 목표는 다음 4단계로 설계해야 한다.

1. ECOUNT 원본 화면/컬럼 목록 수집
2. ECOUNT API pull 가능 여부 확인
3. `nenovaweb` 메뉴/API/DB와 필드 매핑
4. 원본 대비 검증상태를 표시한 뒤에만 전송/반영 허용

## ECOUNT 화면별 구현 목표

| ECOUNT 화면 | 문서상 컬럼/역할 | nenovaweb 목표 | 구현 방식 | 우선순위 |
|---|---|---|---|---|
| 입/출금계좌 조회 | 일자, 입출금, 계좌, 거래처, 금액, 잔액, 상대은행 | `/finance/bank`를 실제 원본 기준으로 전환 | ECOUNT/은행 API pull 또는 ECOUNT 엑셀 업로드 대조 | 높음 |
| 카드매입조회 | 카드명, 거래업체, 총금액, 부가세, 계정, 상태 | 법인카드 사용내역/전표처리 상태 표시 | ECOUNT API 확인, 미지원 시 엑셀 업로드 | 중간 |
| 거래처관리대장1(채권) | 주차별 견적/판매 반영 후 채권 | `/sales/ar`를 ECOUNT 채권 원장 기준으로 대조 | ECOUNT 거래처별채권 pull/엑셀 비교 | 최상 |
| 견적서조회 | 견적서 업로드, 확정, 판매등록 | `/estimate`와 ECOUNT 견적 진행상태 대조 | 견적서 상태/판매전표 번호 매핑 | 높음 |
| 거래처리스트 | 코드, 대표자, 그룹, 사업자, 담당자, 품목분류, 이체정보 | `/master/customers` 필드 확장/검증 | ECOUNT 거래처 pull + Customer 매핑 | 최상 |
| 카드리스트 | 카드코드, 카드명, 결제계좌, 계정 | 카드 마스터 | 신규 마스터 화면 또는 재무 설정 | 낮음 |
| 계좌리스트 | 계좌코드, 계좌명, 계정코드, 외화통장, 이체정보 | 계좌 마스터 | `/finance/bank` 설정 탭 | 중간 |
| 부서리스트 | 부서코드, 부서명, 사용 | 부서 마스터 | ECOUNT 부서 pull 후 코드 매핑 | 중간 |
| 품목등록리스트 | 품목코드, 그룹1/2/3, 비고, 단가, 단위 | `/master/products` 필드/그룹 확장 | ECOUNT 품목 pull + Product 매핑 | 최상 |
| 사원(담당)리스트 | 담당자코드, 이름, 연락처, 이메일 | 담당자 마스터 | UserInfo/Customer.Manager 매핑 | 높음 |
| 계정리스트 | 계정코드, 대차, 계정종류, 사용 | 계정 마스터 | 회계전표/자동분개 전 검증 | 높음 |
| 외화리스트 | 외화코드, 환율, 사용 | `/finance/exchange` 원본화 | ECOUNT 외화 pull 또는 회사 기준 환율 API | 높음 |
| 매출전표1 | 거래처, 공급가, 부가세, 계정, 입금계좌 | 판매전표 원본 조회/검증 | 판매입력 push 후 pull/전표번호 대조 | 최상 |
| 매입전표1 | 거래처, 공급가, 부가세, 매입계정, 출금계좌 | 구매/송금 전표 대조 | 구매입력 + 회계전표 검증 | 높음 |
| 판매입력 | 일자, 담당자, 거래처, 창고, 품목, 수량, 단가, 공급가, VAT | `/sales/status` + ECOUNT 판매입력 완전 매칭 | 전송 전 검증, 전송 후 원본 대조 | 최상 |
| 판매현황 | 기간, 거래처, 품목, 담당자, 양식 | ECOUNT 판매현황 원본 비교 | ECOUNT 판매현황 pull/엑셀 업로드 | 최상 |
| 거래처별채권 | 기준일자, 거래처, 담당자, 양식 | ECOUNT 채권 원장 기준으로 웹 채권 표시 | pull/엑셀 대조 필수 | 최상 |
| 판매일괄회계반영 | 판매입력 후 월마감/세금계산서 전 단계 | 판매 전표 → 회계반영 상태 추적 | ECOUNT 상태 pull 필요 | 높음 |
| 세금계산서 진행단계 | 공급가, VAT, 합계, 종류, 진행단계, 이력 | `/sales/tax-invoice`를 ECOUNT 상태 기준으로 동기화 | 발행번호/단계 pull/대조 | 최상 |
| 회계거래현황 | 전표NO, 거래처, 계정, 부서, 금액, 적요 | 회계전표 조회 화면 | ECOUNT 원장 pull/엑셀 업로드 | 높음 |
| 전표현황 | 전체 입금/출금 전표 조회 | 회계 전표 목록 | ECOUNT 원장 pull | 높음 |
| 계정별원장 | 부서/계정별 원장 | 계정별 원장 화면 | ECOUNT 원장 pull/엑셀 | 중간 |
| 거래처별계정별원장 | 부서/계정/거래처 | 거래처별 계정 원장 | ECOUNT 원장 pull/엑셀 | 중간 |
| 계정별거래처별원장 | 계정/거래처/담당자 | 계정-거래처 교차 원장 | ECOUNT 원장 pull/엑셀 | 중간 |
| 구매입력 | 공급처, 담당자, 창고, 통화, 품목, 수량, 단가, 인보이스, 박스, WEIGHT | `/purchase/status`와 구매입력 완전 매칭 | 전송 전 코드검증, 전송 후 원본 대조 | 최상 |
| 구매현황 | 구매입력 후 외화자금 지급용 자료 | 구매현황/송금 자료 | ECOUNT 구매현황 pull/엑셀 대조 | 높음 |

## 화면 구조 제안

`/ecount/dashboard` 하나에 모든 기능을 쌓지 말고, 경영지원 전용 허브로 재구성한다.

### 1. `/ecount/dashboard`

역할:

- API 연결상태
- 세션 상태
- 최근 전송/동기화 이력
- 원본 대조 요약
- 불일치/미검증 건수

주요 카드:

- ECOUNT 연결 정상/실패
- 판매 미검증
- 구매 미검증
- 채권 불일치
- 세금계산서 단계 불일치
- 코드 미매칭

### 2. `/ecount/master`

ECOUNT 마스터 매칭 화면.

탭:

- 거래처
- 품목
- 담당자
- 부서
- 계정
- 계좌
- 카드
- 외화

각 탭 공통 컬럼:

- ECOUNT 코드
- ECOUNT 명칭
- 네노바 DB 매칭
- 매칭상태
- 차이 필드
- 마지막 확인일

### 3. `/ecount/sales`

판매입력/판매현황/매출전표 대조 화면.

필수 기능:

- 출고 확정 데이터 미전송 목록
- 전송 전 검증: 거래처코드, 품목코드, 수량, 단가, 공급가액, 부가세
- 전송 후 검증: ECOUNT 전표번호, ECOUNT 저장 금액, 웹 금액, 차액
- ECOUNT 원본 판매현황 업로드/조회 비교

### 4. `/ecount/ar`

거래처별채권 화면.

필수 기능:

- 웹 계산 채권 vs ECOUNT 거래처별채권
- 거래처별 잔액 차이
- 입금/반제 누락 여부
- 담당자별 필터
- 불일치 사유 메모

### 5. `/ecount/tax`

세금계산서/판매일괄회계반영 진행상태.

필수 기능:

- 웹 `TaxInvoice` 단계
- ECOUNT 진행단계
- 발행번호/전자발송번호
- 공급가/VAT/합계 차이
- ECOUNT 내역보기/거래명세서 링크 또는 참조번호

### 6. `/ecount/purchase`

구매입력/구매현황.

필수 기능:

- 구매 전송 전 코드 검증
- 공급처코드/품목코드/창고/통화/부서 검증
- 인보이스/차수/품목/박스/WEIGHT/부대비용 비교
- 외화자금 지급용 엑셀 다운로드
- ECOUNT 구매현황 원본 대조

### 7. `/ecount/bank`

입출금/카드/전표현황.

필수 기능:

- ECOUNT 입출금 원본 또는 은행 API 원본
- 카드매입 내역
- 회계전표 처리상태
- 거래처/계정 매칭
- 웹 채권 입금 반영 여부

### 8. `/ecount/ledger`

회계거래현황/계정별원장.

필수 기능:

- 전표NO별 조회
- 계정별/거래처별/부서별 필터
- ECOUNT 원장 엑셀 업로드 대조
- 네노바 업무 전표와 역추적

## API 설계

공통 원칙:

- API 키/세션은 서버에서만 사용
- 프론트에는 API 키 노출 금지
- 쓰기 API는 항상 미리보기/검증/승인/전송 4단계
- 원본 pull API와 push API 분리

### 공통 클라이언트 보강

현재:

- `lib/ecount.js`
- `ecountPost(endpoint, data)`

추가:

- `ecountGetLike(endpoint, payload)` 또는 모든 조회를 POST wrapper로 통일
- endpoint별 응답 정규화 함수
- 실패 응답 원문 저장
- rate limit/재시도/세션갱신 이력

### 신규 API 후보

| API | 역할 |
|---|---|
| `GET /api/ecount/menu-map` | ECOUNT 화면별 지원상태/컬럼 매핑 |
| `POST /api/ecount/raw-query` | 개발자 승인용 ECOUNT endpoint 테스트 |
| `GET /api/ecount/master/customers` | ECOUNT 거래처 원본 조회 |
| `GET /api/ecount/master/products` | ECOUNT 품목 원본 조회 |
| `GET /api/ecount/master/accounts` | 계정 원본 조회 |
| `GET /api/ecount/master/departments` | 부서 원본 조회 |
| `GET /api/ecount/master/currencies` | 외화/환율 원본 조회 |
| `POST /api/ecount/sales/preview` | 판매전송 전 검증 |
| `POST /api/ecount/sales/push` | 판매전송 실행 |
| `POST /api/ecount/sales/verify` | ECOUNT 판매현황과 대조 |
| `POST /api/ecount/purchase/preview` | 구매전송 전 검증 |
| `POST /api/ecount/purchase/push` | 구매전송 실행 |
| `POST /api/ecount/purchase/verify` | 구매현황 원본 대조 |
| `POST /api/ecount/ar/verify` | 채권 원본 대조 |
| `POST /api/ecount/tax/verify` | 세금계산서 진행단계 대조 |
| `POST /api/ecount/import-excel` | API 미지원 화면의 ECOUNT 엑셀 업로드 |
| `GET /api/ecount/match-audit` | 전체 검증 이력 조회 |

## DB 설계

### `EcountEndpointMap`

ECOUNT 화면과 API endpoint, 지원상태 기록.

- `MapKey`
- `MenuName`
- `ScreenName`
- `Endpoint`
- `Direction` (`PULL`, `PUSH`, `EXCEL`)
- `SupportStatus` (`CONFIRMED`, `TESTING`, `UNSUPPORTED`, `EXCEL_ONLY`)
- `RequestSampleJson`
- `ResponseSampleJson`
- `LastCheckedDtm`

### `EcountFieldMap`

ECOUNT 컬럼과 네노바 필드 매핑.

- `FieldMapKey`
- `MenuName`
- `EcountField`
- `NenovaTable`
- `NenovaField`
- `TransformRule`
- `RequiredYn`
- `Memo`

### `EcountMatchAudit`

대조 결과.

- `AuditKey`
- `Domain`
- `LocalRefType`
- `LocalRefKey`
- `EcountRef`
- `MatchStatus`
- `LocalAmount`
- `EcountAmount`
- `DiffAmount`
- `LocalHash`
- `EcountHash`
- `DiffJson`
- `CheckedDtm`
- `CheckedBy`

### `EcountUploadBatch`

ECOUNT 엑셀 원본 업로드 이력.

- `BatchKey`
- `MenuName`
- `FileName`
- `RowCount`
- `UploadedBy`
- `UploadedDtm`
- `Status`

## 구현 우선순위

### Phase 0. ECOUNT 원본 조사

목표:

- ECOUNT 화면별 실제 컬럼/필터/출력 엑셀을 확정한다.

작업:

1. Claude in Chrome으로 ECOUNT 로그인 세션에서 문서에 적힌 화면을 하나씩 연다.
2. 각 화면에서 저장/삭제/반영/전송 버튼은 누르지 않는다.
3. 화면명, 필터, 표 컬럼, 버튼, 엑셀 다운로드 가능 여부를 캡처한다.
4. API 개발자 페이지가 있으면 해당 메뉴의 OAPI endpoint 명칭을 확인한다.
5. 결과를 `EcountEndpointMap`, `EcountFieldMap` 초안으로 정리한다.

### Phase 1. 마스터 매칭

목표:

- 거래처/품목/담당자/부서/계정/외화 코드 미매칭을 먼저 제거한다.

이유:

- 판매/구매/채권/세금계산서의 100% 매칭은 코드가 맞아야 가능하다.

작업:

- 거래처: `Customer.OrderCode`와 ECOUNT `CUST_CD`
- 품목: `Product.ProdCode`와 ECOUNT `PROD_CD`
- 담당자: `Customer.Manager`, `UserInfo.UserName`, ECOUNT 담당자코드
- 부서/계정/외화/창고 코드 매핑

### Phase 2. 판매 100% 매칭

목표:

- 출고 확정 → 판매입력 → 판매현황 → 매출전표까지 전표번호와 금액이 일치하게 한다.

작업:

- 판매전송 전 미리보기
- 공급가/VAT 계산 방식 확정
- ECOUNT 전표번호 저장
- 전송 후 원본 대조
- 불일치 행 표시

### Phase 3. 채권/입금

목표:

- `/sales/ar`가 웹 계산만 보여주는 화면이 아니라 ECOUNT 거래처별채권과 대조되는 화면이 되게 한다.

작업:

- 거래처별채권 원본 pull 또는 엑셀 업로드
- 웹 채권과 차이 계산
- 입금/반제 누락 표시
- 계좌 입출금과 연결

### Phase 4. 세금계산서/회계반영

목표:

- 판매일괄회계반영, 세금계산서 진행단계, 회계전표 상태를 웹에서 확인한다.

작업:

- `TaxInvoice` 웹 단계와 ECOUNT 진행단계 매핑
- 전자발송번호/발행번호 저장
- 자동분개 push 후 전표번호 대조
- 월마감 전 미반영 목록

### Phase 5. 구매/외화/송금

목표:

- 수입 구매입력과 구매현황을 ECOUNT 기준으로 맞춘다.

작업:

- 구매입력 전 코드검증
- 인보이스/차수/품목/박스/WEIGHT/부대비용 컬럼 확장
- 구매현황 원본 대조
- 외화자금 지급용 엑셀

### Phase 6. 입출금/카드/회계원장

목표:

- 입출금계좌, 카드매입, 회계전표, 계정별원장까지 경영지원부 조회 화면으로 제공한다.

작업:

- ECOUNT 원본 조회 또는 엑셀 업로드
- 거래처/계정 자동매칭
- 채권/채무 반영상태 표시
- 전표번호 기준 역추적

## Claude in Chrome 조사 프롬프트

아래 프롬프트를 Claude in Chrome에 그대로 전달한다.

```text
Nenova ECOUNT 화면 매칭 조사 요청.

중요:
- 운영 ECOUNT에서 저장, 삭제, 전송, 일괄반영, 전표생성, 세금계산서 발행 버튼은 절대 누르지 말 것.
- 조회, 필터 확인, 컬럼 확인, 엑셀 다운로드 가능 여부 확인만 한다.
- API 키/세션/쿠키/개인정보는 답변에 노출하지 말 것.

조사 목적:
nenovaweb의 ECOUNT 페이지가 경영지원부가 쓰는 ECOUNT ERP 화면을 100% 대체/대조할 수 있도록 화면별 필드, 버튼, 필터, 원본 데이터 기준을 정리한다.

조사 대상:
1. 입/출금계좌 조회
2. 카드매입조회
3. 거래처관리대장1(채권)
4. 견적서조회
5. 거래처리스트
6. 카드리스트
7. 계좌리스트
8. 부서리스트
9. 품목등록리스트
10. 사원(담당)리스트
11. 계정리스트
12. 외화리스트
13. 매출전표1
14. 매입전표1
15. 판매입력
16. 판매현황
17. 거래처별채권
18. 판매일괄회계반영
19. (세금)계산서진행단계
20. 회계거래현황
21. 회계거래현황(전표현황)
22. 계정별원장
23. 거래처별계정별원장
24. 계정별거래처별원장
25. 구매입력
26. 구매현황

각 화면마다 아래 형식으로 정리:

화면명:
메뉴 경로:
조회 필터:
표 컬럼:
주요 버튼:
엑셀 다운로드 가능 여부:
상세/팝업 화면 여부:
저장/전송/반영 버튼 존재 여부:
nenovaweb에서 대응될 메뉴:
API pull 가능해 보이는지:
100% 매칭에 필요한 필드:
주의사항:
스크린샷/캡처 설명:

마지막에 전체 우선순위를 다음 기준으로 정리:
- 최상: 판매, 채권, 세금계산서, 구매처럼 금액/전표 영향
- 높음: 마스터 코드 불일치가 후속 전표에 영향
- 중간: 조회/참고성
- 낮음: 현재 미사용 또는 보조
```

## 운영 안전 원칙

- ECOUNT push 버튼은 사용자 승인 전 실행하지 않는다.
- 먼저 `preview`, `verify`, `audit`를 만든 뒤 전송한다.
- 코드 미매칭, 단가 미매칭, VAT 차이가 있으면 전송 버튼을 비활성화한다.
- 모든 ECOUNT 응답은 원문 일부를 `EcountMatchAudit` 또는 전용 로그에 저장한다.
- API 키는 환경변수에만 저장하고, 화면/로그/MD에 원문 노출하지 않는다.

## 바로 다음 작업

1. ECOUNT 원본 조사 결과를 받을 `EcountEndpointMap`, `EcountFieldMap` 테이블/API 생성
2. `/ecount/dashboard`를 허브형으로 개편
3. `/ecount/master` 거래처/품목 코드 매칭부터 구현
4. 판매입력 전송 전 미리보기와 전송 후 원본 대조 추가
5. ECOUNT API 미지원 화면은 엑셀 업로드 기반 대조부터 구현
