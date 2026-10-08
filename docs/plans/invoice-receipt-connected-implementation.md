# 인보이스 연결 구현 계약 · 2026-10-08

기존 PRD를 실제 화면/API/원장에 연결한다. 배포 완료는 연결 코드와 격리 SQL·화면 검증 및 운영 배포 readback으로 판단한다.

## 기준 ledger와 쓰기 경계

| 기준 | 근거 | 소비자/실패 처리 |
|---|---|---|
| 연도/세부차수 | 명시 문서 범위, native StockMaster | 초안/preview/commit/readback 동일, 추정 금지 |
| 활성 품목/단위 | Product raw isDeleted=0, OutUnit/EstUnit | 서버 재조회, 누락 환산 차단 |
| 저장 가능 | invoiceReceiptEligibility + V2 gate 잠금 | 트랜잭션 내부 재검사, 자동 확정해제 금지 |
| 입고 효과 | native CreateWarehouse/StockCalculation/GetNextKey | 공용 staging 보존, 상세/StockHistory/Product.Stock/native cascade 원자적 |
| 최초/재시도 | Document revision + operationId + requestHash | 동일 ID 동일 요청 재사용, 다른 요청409, timeout 상태조회 |
| 원가 | 실제량 기본, 승인 공식/입력 snapshot | 미검증/누락은 확인 필요, 95%는 비교 전용 |

초안은 WebInvoiceDocument/Line/History만 변경한다. 등록만 WarehouseMaster/Detail, Product.Stock/StockHistory 및 native StockCalculation 결과를 변경한다. Order/Shipment/Estimate는 직접 변경하지 않는다. 기존 EXE/SP/공용 임시입고와 타 작업의 gate 상태를 변경하지 않는다. runtime DDL 없음.

## 초안 계약

POST /api/import/receipts/drafts, GET /api/import/receipts/drafts?orderYear=&orderWeek=,
GET/PATCH /api/import/receipts/[id]. 서버 인증 actor만 사용한다.

입력: documentId(UUID, 신규 시 선택), expectedRevision(수정 필수), orderYear, orderWeek,
sourceHash(원본 SHA256 hex), originalFileName, farmKey(nullable), invoiceNo(nullable),
invoiceYear(nullable), rawMetadata(object), reviewedMetadata(object), reason,
lines[{lineId(UUID),lineNo,originalName,lengthText,prodKey,boxQuantity,bunchQuantity,
stemQuantity,priceUnit,unitPrice,currency,lineAmount,sourceEvidence,reviewed}].

reviewedMetadata는 inputDate, country, transportMode, farmName, awb, gw, cw,
freightCurrency, freightRate, docFee, invoiceDate, receiptNotes와 원가 검토 입력을 담는다.
NULL과 명시0을 구분한다. 새 revision의 행만 INSERT하고 과거 행은 보존한다.
ERP 등록 후 초안 변경은 기존 입고를 바꾸지 않는다. 기존 원가는 STALE 표시하고
별도 등록 수정 작업 전까지 실제 원장과 편집 초안을 구분한다.
응답 document는 입력 camelCase에 revision,receiptStatus,costStatus,updatedBy/At,
rowVersion(hex), history, operations를 추가한다. 목록은 요약만 반환한다.
businessKeyHash는 FarmKey+NFC trim InvoiceNo+InvoiceYear, 세부차수 제외.

## 연결 API

POST /api/import/receipts/[id]/preview {revision}: 저장 초안을 서버에서 읽어 품목/확정/대조/원가 검증.
POST /api/import/receipts/[id]/commit {revision,operationId,receiptPartId,baselineDigest,reason,allowPendingCost}.
GET /api/import/receipts/operations/[id]: timeout 후 결과조회. 새 operation 자동 생성 금지.
UI는 분석 완료와 입고 완료를 구분하고 등록 후 실제 WarehouseKey와 상세키를 표시한다.

## 필수 검증

실제 isolated MSSQL에서 채번/동일품목 복수가격/재고 연쇄/rollback/동시중복/gate busy/timeout,
기존 staging sentinel 보존. 초안 revision 충돌/actor/body 위조/미등록 품목/가격·통화 누락 차단.
1920×1080, 100% 검증 후 전체 ERP 계약·write guard·build와 배포 readback.

## 실제 native 재확인과 의도적 결함 미복제

SSMS hex SELECT로 CreateWarehouse(3038자, SHA256 UTF16LE C52523F2A5735B9420E845AE601B3E3F730205E99DFD9309FEF29C8325C23BD8),
GetNextKey(1004자, 2CAA094745C908F29E31702EE1C563EF7C34C2AFA28B48E0A1A604D08A2A7418), ViewOrder 원문을 보존했다.
fixture 파일은 LF이므로 실제 지문 대조 시 CRLF 복원만 적용한다. 공유 SP에는 쓰지 않는다.

FormWarehouseAdd.btnSave_Click은 상세 수정 시에도 Product.Stock에 새 전체 OutQuantity를 더한다.
이 동작을 웹에 그대로 복제하면 반복 수정 때 중복 증가하므로 웹은 잠근 실제 상세의
기존 수량을 뺀 차액만 Product.Stock/StockHistory에 기록한다. StockCalculation의 원장 기반
스냅샷과 대조한다. native 수기 상세 화면의 TPrice=SteamQuantity×UPrice와 달리 본 기능은
인보이스 원문 단가기준을 보존하는 packing upload 계약(UPrice/TPrice 복사)을 사용한다.
이 차이를 EXE 수기 수정 로직과 완전히 동일하다고 설명하지 않는다.

## 연결 단계 검토 보완

- 한 문서는 하나의 입고 원장에 연결한다. 수정은 최초 receiptPartId를 재사용하며 다른 part를 보내 기존 원장을 분할 입고로 오인해 덮어쓰는 요청은 거절한다. 여러 인보이스는 각각 별도 문서다. 한 인보이스의 별도 분할입고는 이번 연결 범위에서 지원하지 않는다.
- 수량 차액이 없는 가격/헤더 수정은 StockHistory, Product.Stock, StockCalculation을 실행하지 않는다. 원가는 재검토(STALE)로 전환한다.
- 수량 변경 후 Product.Stock 차액과 현재/후속 ProductStock을 native SQL ROUND 공식으로 재조회한다. 입고 헤더·상세 수량·가격도 readback 불일치 시 전체 rollback한다.
- 주문 원본이 ViewOrder의 활성 거래처/품목/담당자 연결에서 누락되는 경우 0으로 오인하지 않고 등록 검증을 차단한다.
- 원가 승인/조회는 실제 WarehouseMaster/Detail과 당시 스냅샷을 대조한다. EXE에서 헤더/수량/가격이 바뀌면 기존 승인 원가를 현재값으로 표시하지 않는다.
- 원가 승인 대상은 검증된 중국 해상 실제량 및 네덜란드 금액배분 공식이다. 나머지 공식·혼합통화·공동운임 범위를 임의 추정하지 않는다. 95%는 비교용 별도 revision이다.
- 입고관리 읽기 SQL에는 기존 키/범위/집계를 보존하면서 GW/CW/USD 운임, 입고 상세에 저장된 환산비율/단가/금액 별칭만 추가한다.
- 날짜는 세션 언어에 의존하지 않는 YYYYMMDD/style112 변환으로 저장한다.
- native SQL의 비유니코드 한글 단위 상수를 보존하기 위해 격리 fixture DB는 Korean_Wansung_CI_AS로 만들고 SQL2016 호환130에서 실행한다. 이는 운영 collation 변경이 아니다.

2026-10-08 중간 검증: native CreateWarehouse/GetNextKey 원문 해시 대조, 같은 품목 복수가격 유지, 입고 생성/수량 변경/가격만 변경, 동일 작업 재요청, 다른 part 거절, 연도 경계 재고 연쇄, stock 계산 실패 전체 rollback, busy gate/공용 staging 4행/주문·분배 원본 보존 통과. 원가 통합·동시성·브라우저·최종 배포 검증은 최종 세션 기록을 따른다.
