# 인보이스 웹 전용 저장 V1 — 2026-10-08 승인 범위

사용자 `진행.`은 직전 제안의 웹 전용 테이블 추가 승인이다. 기존 EXE, 공용 SP,
TempWarehouseDetail, ERP 원장의 기존 자료/구조 변경은 포함하지 않는다.
이 단계는 빈 웹 저장 구조 준비이며 실제 입고 등록 API 활성화가 아니다.

## 부작용 / 기준

| 동작 | 신규 WebInvoice 6개 테이블 | 기존 ERP/원가/채번/잠금 |
|---|---|---|
| 마이그레이션 | 생성, 제약/인덱스 구성 | 보존, SP 실행 없음 |
| 재실행 | 정확한 기존 V1이면 no-op, 불일치면 중단 | 보존 |
| 격리 SQL fixture | 임시 fixture DB 내부 테스트만 | 운영 접근 금지 |

SQL Server 2016 호환. 런타임 DDL 금지. 한 트랜잭션, XACT_ABORT, 짧은 LOCK_TIMEOUT.
대상 DB는 운영 nenova1_nenova 또는 명시된 로컬 fixture prefix만 허용. 외부 transaction
안에서는 실행하지 않는다. 기존 동명 일부 객체/다른 구조 발견 시 덮어쓰거나 수리하지 않고 중단.
기존 ERP 테이블을 대상으로 한 FK/트리거/인덱스/ALTER/GRANT/UPDATE/DELETE/EXEC 없음.
웹 내부 FK는 NO ACTION; 자동 cascade 삭제 없음. 빈 테이블만 생성, 자료 backfill 없음.

재실행 검증은 열·인덱스·FK·제약 이름/활성/신뢰 검사를 함께 수행한다.
CHECK 조건은 SQL Server가 저장한 정확한 정의의 SHA2_256을 최초 생성 트랜잭션에서
해당 신규 제약의 `NenovaWebInvoiceV1CheckHash` 확장 속성에 기록한다.
재실행은 이 기준을 생성하거나 덮어쓰지 않고 현재 정의와 비교한다.
기준 속성이 없는 기존 구조나 변경된 조건은 중단한다. 괄호 제거로 AND/OR 의미를
놓치지 않는다. 이는 관리자에 의한 고의 변조를 막는 권한 체계가 아니라 마이그레이션
드리프트 탐지이며, 운영 API의 사용자/수정 권한 검증을 대체하지 않는다.

## 6개 테이블 계약

- WebInvoiceDocument: DocumentId UUID PK, OrderYear char4 + OrderWeek char5(01~53/01~99),
  Revision 양수, 공급 FarmKey/InvoiceNo/InvoiceYear nullable(초안), SourceHash/OriginalFileName 필수,
  BusinessKeyHash binary32 nullable unique filtered(확인한 공급자+trim/NFC 번호+발행연도,
  차수는 중복키에서 제외), ReceiptStatus DRAFT/REVIEW_REQUIRED/PARTIAL/COMMITTED,
  CostStatus PENDING/REVIEW_REQUIRED/APPROVED/STALE, RawMetadataJson/ReviewedMetadataJson,
  CreatedBy/UpdatedBy nonempty, UTC datetime2, RowVersion. 현재 원문과 수정본 분리.
- WebInvoiceLine: DocumentId+Revision+LineId(UUID) composite PK, LineNo 양수/동일revision내unique,
  OriginalName/LengthText, ProdKey nullable, Box/Bunch/Stem 수량 decimal(18,6) nullable/nonnegative,
  PriceUnit/UnitPrice/Currency/LineAmount nullable(미인식 보존), SourceEvidenceJson/ReviewedJson,
  FK DocumentId. 같은 품목 복수 가격/원문행을 합치지 않음. 과거revision행은 보존.
- WebInvoiceOperation: OperationId UUID PK, DocumentId, DocumentRevision, ReceiptPartId UUID,
  RequestHash binary32, Action CREATE_RECEIPT/UPDATE_RECEIPT, Status PENDING/COMMITTED/FAILED/UNKNOWN,
  WarehouseKey nullable positive (ERP FK 아님), ResultJson, ErrorCode, Actor nonempty,
  CreatedAt/CompletedAt; FK DocumentId. 명시 성공상태는 WarehouseKey/CompletedAt 필수.
  같은 operationId 다른 hash는 향후 API409. PENDING을 성공으로 표시하지 않음.
- WebInvoiceHistory: HistoryId bigint identity PK, DocumentId, Revision, OperationId nullable,
  Action, BeforeJson/AfterJson, Reason, Actor nonempty, CreatedAt; 웹 FK. 다른 문서 operation 연결 금지.
- WebInvoiceCostRevision: CostRevisionId UUID PK, DocumentId, DocumentRevision,
  OperationId, WarehouseKey positive, RevisionNo 양수, Basis ACTUAL/EXPECTED_95,
  Status DRAFT/APPROVED/STALE, Currency char3, FormulaId/FormulaVersion/FormulaSourceHash,
  InputSnapshotJson, ApprovedBy/At(nullable, 승인시둘다필수), CreatedBy/At.
  FK (DocumentId,DocumentRevision,OperationId,WarehouseKey), unique(DocumentId,OperationId,Basis,RevisionNo).
  원가 승인 또는 ERP 저장 로직은 이 DDL에서 실행하지 않음.
- WebInvoiceCostLine: CostRevisionId+LineId composite PK, DocumentId/DocumentRevision,
  OperationId, WarehouseKey/WdetailKey positive, ProdKey positive, Unit,
  Quantity decimal(18,6) nonnegative, CostPerUnit decimal(18,6) nullable/nonnegative,
  TotalCost decimal(18,6) nullable/nonnegative, ComponentAmountsJson.
  composite FK로 cost revision의 document/revision/operation/warehouse scope와 일치,
  FK (DocumentId,DocumentRevision,LineId) → snapshot line. 다른 문서 원가 혼합 차단.

공동 운임/배분 그룹은 InputSnapshotJson에 근거를 담되 최종 공유 비용 중복 방지 구조는
별도 writer 설계 시 추가 검증한다. 이 스키마만으로 전체 통합 PRD 완료를 주장하지 않는다.

## 필수 실제 SQL 시험

공식 loopback SQL2022 컨테이너의 새 NenovaInvoiceFixture_* DB만 사용한다.
명시 host/credential/db override 금지, mount 없는 기존 승인 컨테이너인지 확인한다.
운영 .env 로딩 금지. 새 fixture DB 정리 전 이름+생성한DB 일치 확인.
마이그레이션 성공/재실행, 6테이블0행, 이전·현재연도 같은차수 공존,
business key 중복(차수 변경해도) 차단, 잘못된 year/week, 음수/명시0/null,
operation id 중복/다른문서 FK, 비용 cross-document FK, 실패전체rollback,
부분 기존 스키마 거부, ERP sentinel 보존, 트리거/SP 수정 없음.

검증 완료 후 메인만 로그인 SSMS에서 운영 마이그레이션 실행하고 여섯 테이블과
빈 행수·기존 SP hash/임시행 snapshot 보존을 readback한다. 운영 test INSERT 금지.
