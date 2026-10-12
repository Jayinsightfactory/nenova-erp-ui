# 재사용형 ERP 제품 기반 — 데이터·업무흐름·사용자 UI 청사진

- 작성일: 2026-09-29
- 상태: 설계 초안 / 구현·운영 스키마 아님
- 목적: 업체별 서버와 DB를 별도로 운영하되 공통 제품 코드로 ERP를 공급하기 위한 데이터 계약, 차수·확정 모델, 기본 기능 범위, 사용자 화면 조립 기능을 정리한다.
- 관련 문서: [화이트라벨 ERP 청사진](../BLUEPRINT_WHITE_LABEL_ERP.md), [Nenova DB 구조](../DB_STRUCTURE.md), [미래 확장 엔지니어링 원칙](../FUTURE_READY_ENGINEERING.md)
- 신규 업체 기준정보·SQL 수집 질문지: [ERP 신규 업체 온보딩 질문지](ERP_NEW_COMPANY_ONBOARDING_QUESTIONNAIRE.md)

> 이 문서는 새 설계를 위한 개념 모델이다. Nenova 운영 DB에 테이블을 추가하거나 기존 원장을 대체하라는 마이그레이션 지시가 아니다. 실제 DDL은 파일럿 업체의 업무 정의, 원본 자료, EXE/API 계약을 확인하고 별도 리뷰·테스트한 후 작성한다.

## 1. 설계 원칙

1. **업체별 독립 배포와 DB 격리**: 고객마다 별도 서버·DB·비밀정보·백업을 사용하고 코드와 버전이력만 공유한다.
2. **원본 거래와 사용자 화면 설정을 구분**: 주문·입고·출고·재고·회계 데이터는 명시적 관계형 테이블에 보존한다. 사용자별 대시보드 배치나 피벗 즐겨찾기처럼 개인 선호인 값만 검증된 JSON 설정으로 저장할 수 있다.
3. **원본은 추가 중심, 현재값은 계산/조회**: 업무 기록을 조용히 덮어쓰지 않는다. 변경·취소·확정 취소를 추적 가능한 기록으로 남긴다.
4. **차수는 범용 운영기간의 한 형태**: 차수 없는 업체도 쓰게 `OperatingPeriod`를 선택적으로 연결한다. 숫자 차수는 연도·업체·업무구분과 독립된 단독 키가 아니다.
5. **확정은 상태와 동결 버전**: 확정 행을 직접 수정하지 않는다. 수정은 재검토 버전/조정 문서로 만들며, 확정 당시 원천과 결과를 식별할 수 있어야 한다.
6. **업무 규칙은 UI와 SQL에 중복 구현하지 않는다**: 동일한 응용 서비스/API가 웹과 데스크톱 UI를 지원하고 서버가 권한·전이·수량·중복 규칙을 마지막으로 검증한다.
7. **업체별 DB에서도 기준 스키마 버전은 공통 관리**: 고객별 임의 DDL 분기를 줄이고, 버전 migration·검증·롤백 문서를 유지한다.

## 2. ECOUNT 수준의 최소 기능 범위

ECOUNT 공식 기능 소개에서 확인되는 폭은 판매·구매·재고·생산·회계·급여·그룹웨어 등이며, 사용자별 메뉴/마이페이지, 입력 화면·필수 필드 설정, 보고서 사용자화, 연동 API도 강조된다. 따라서 “기능 수준”은 단일 화면 모양이 아니라 최소한 아래 업무 영역의 연결성과 사용자 설정 가능성을 기준으로 정의한다. 이 목록은 공식 전체 모듈을 그대로 복제한다는 뜻이 아니라 제품 범위의 기준선이다.

| 영역 | 기본 업무와 데이터 연결 |
|---|---|
| 기준정보 | 회사·사업장·부서·사용자·역할, 거래처/공급처, 품목·분류·단위·창고·세금/통화 |
| 판매 | 견적 → 주문 → 출하/납품 → 매출전표 → 수금/미수 → 판매/이익 보고 |
| 구매 | 구매요청/발주 → 입고검수 → 매입전표 → 지급/미지급 |
| 재고 | 품목·창고별 원장, 이동·조정·실사, LOT/시리얼/유통기한은 업종 기능으로 선택 |
| 생산/작업 | 작업지시·투입·완료·불량·원가. 제조/작업 업종에서 기능 활성화 |
| 회계/정산 | 계정과목, 전표, 세금/부가세, 비용·수익, 미수·미지급, 기간 마감 |
| 분석·출력 | 거래처/품목/기간별 표준 보고서, Excel/인쇄, 필터·정렬·열 저장 |
| 관리·협업 | 역할/권한, 승인함, 업무 알림, 감사 이력, 파일 첨부, 공지/메모 |
| 사용자 경험 | 즐겨찾기, 최근 작업, 개인 대시보드/피벗 레이아웃, 입력 폼 설정 권한 |
| 연동 | 가져오기/내보내기 API, 외부 회계/쇼핑몰/레거시 ERP 어댑터, 재시도·오류 대기열 |

출처: [ECOUNT 전체 기능](https://www.ecount.com/us/ecount/product/erp_features), [프로그램 환경 사용자화](https://www.ecount.com/us/ecount/product/erp_customizing), [Open API](https://www.ecount.com/us/ecount/product/erp_open-api). ECOUNT의 최신 기능 세부사항·한국판 차이는 실제 상세 범위 확정 전에 다시 공식 제품 문서로 비교한다.

## 3. 데이터 분류 및 관계형 모델 초안

### 3.1 데이터가 속하는 범주

| 범주 | 예 | 저장 원칙 |
|---|---|---|
| 마스터 | Company, Site, User, Role, Customer, Supplier, Item, Unit, Warehouse, Currency, TaxCode | 안정된 내부 키, 코드 유일성, 비활성/대체 이력. 이름을 업무 FK로 사용하지 않음 |
| 기간·차수 | FiscalPeriod, OperatingPeriod, PeriodAlias | 날짜 구간/업무 종류와 외부 표시 라벨을 분리. 연도·차수 쌍의 유일성 규칙 |
| 업무 문서 | SalesQuote/Order, PurchaseOrder, Receipt, Shipment, Invoice, Payment, StockCount | Header + Line. 상태·작성자·업무일·전표번호·거래처·기간 키 |
| 원장 | InventoryMovement, Receivable/PayableEntry, AccountingEntry | 발생한 증감/분개 단위로 기록, 원본 문서 행에 FK. 삭제 대신 반대/취소 전표 |
| 확정/승인 | WorkflowInstance, ApprovalAction, DocumentRevision, ConfirmationSnapshot | 누가/언제/무슨 revision을 승인했는지, 승인 대상 해시와 기준 원천을 보존 |
| 감사/통합 | AuditEvent, ImportBatch, IntegrationOutbox, IntegrationAttempt | 사용자 작업·파일 수입·외부 전송 시도/응답을 상관 ID로 연결 |
| 사용자 UI | UserPageLayout, UserReportPreset, UserFavorite | 개인 설정이며 금액·수량·원장 데이터가 아님. 사용자/페이지/스키마 버전별 저장 |

### 3.2 최소 개념 테이블

아래는 물리 컬럼 확정 전의 논리 모델이다. SQL Server에서 PK는 `bigint identity` 또는 분산 가능한 `uniqueidentifier` 중 키 생성·연동 요구에 맞춰 선택하고, 모든 업무 날짜/수량/통화는 명시적 자료형을 사용한다.

```text
Company(CompanyId, CompanyCode, LegalName, BaseCurrency, TimeZone, Status)
Site(SiteId, SiteCode, Name, Address, Status)
User(UserId, LoginId, DisplayName, Status)
Role(RoleId, RoleCode, Name) / UserRole(UserId, RoleId)
Permission(RoleId, Resource, Action, ScopePolicy)

Party(PartyId, PartyCode, Name, PartyType, ...)  -- customer/supplier roles
Item(ItemId, ItemCode, Name, CategoryId, BaseUnitId, TrackingPolicy, Status)
Unit(UnitId, UnitCode, Precision)
ItemUnit(ItemId, UnitId, Numerator, Denominator, IsDefaultSales, IsDefaultPurchase)
Warehouse(WarehouseId, WarehouseCode, Name, SiteId, Status)

FiscalPeriod(FiscalPeriodId, FiscalYear, PeriodNo, StartDate, EndDate, Status)
OperatingPeriod(OperatingPeriodId, PeriodType, PeriodYear, SequenceNo,
                Label, StartDate, EndDate, Status, IsConfirmable)
ExternalPeriodMap(SystemCode, ExternalYear, ExternalCode, OperatingPeriodId)

Document(DocumentId, DocumentType, DocumentNo, PartyId, DocumentDate,
         FiscalPeriodId NULL, OperatingPeriodId NULL, Status, CurrentRevisionNo,
         CreatedBy, CreatedAt, UpdatedBy, UpdatedAt, RowVersion)
DocumentLine(DocumentLineId, DocumentId, LineNo, ItemId, Description,
             Quantity, UnitId, BaseQuantity, UnitPrice, NetAmount, TaxAmount,
             WarehouseId NULL, SourceLineId NULL)
DocumentRevision(RevisionId, DocumentId, RevisionNo, BasedOnRevisionId,
                Reason, PayloadHash, CreatedBy, CreatedAt)
WorkflowInstance(WorkflowId, DocumentId, RevisionId, State, StateVersion)
ApprovalAction(ActionId, WorkflowId, Action, ActorId, At, Comment, EvidenceJson)
ConfirmationSnapshot(SnapshotId, DocumentId, RevisionId, ConfirmedBy, ConfirmedAt,
                     SourceWatermark, PayloadHash, SnapshotLocation)

InventoryMovement(MovementId, ItemId, WarehouseId, QuantityDelta, UnitId,
                  BaseQuantityDelta, MovementType, EffectiveAt, DocumentLineId,
                  ReversalOfMovementId NULL, PostedAt, PostedBy)
AccountingEntry(EntryId, JournalNo, FiscalPeriodId, AccountId, PartyId NULL,
                Debit, Credit, CurrencyCode, ExchangeRate, SourceDocumentId,
                ReversalOfEntryId NULL, PostedAt, PostedBy)
AuditEvent(AuditId, ActorId, Action, EntityType, EntityId, OccurredAt,
           CorrelationId, BeforeHash, AfterHash, Reason)

UserPageLayout(UserId, PageId, LayoutVersion, LayoutJson, UpdatedAt, RowVersion)
UserReportPreset(UserId, ReportId, PresetId, Name, PresetVersion, ConfigJson, SortOrder)
```

`Document`는 공통 계약을 설명하기 위한 개념이다. 실제 제품에서는 주문/입고/출고/전표 도메인별 typed header와 line 테이블을 사용하거나, 검증된 공통 헤더 + typed detail 조합을 채택한다. 모든 업무 필드를 `DocumentLine.Json`이나 EAV 속성 테이블에 몰아넣지 않는다. 업체 고유 필드는 소유 도메인별 확장 테이블 또는 검증된 `ExtensionJson`에 제한하고, 조인·권한·집계 대상 핵심 필드는 일반 SQL 컬럼/관계로 둔다.

### 3.3 SQL 입력/저장 계약

- 화면은 임의 SQL을 만들지 않는다. 입력 명령은 `CommandId`, `IdempotencyKey`, `ExpectedRowVersion`, 문서/행 변경분, 사유를 API로 보낸다.
- 서버는 사용자·권한·기간 상태·현재 revision·품목 단위 환산·중복/수량 제약을 다시 검사한다.
- 한 업무의 헤더/행/상태전이/원장 기록/outbox는 가능한 범위에서 단일 DB 트랜잭션으로 커밋한다. 원격 API 호출은 트랜잭션 안에서 직접 하지 않고 outbox로 분리한다.
- 저장은 파라미터 SQL을 사용하고, 업무키에는 FK/unique/check 제약과 인덱스를 설계한다. 동시 수정은 `rowversion` 또는 명시적 상태 버전으로 충돌을 감지한다.
- 임시 초안은 저장돼도 재고·회계 원장에 반영하지 않는다. `Posted`/ `Confirmed` 전이는 별도 명령이며, 확정 선행조건을 모두 충족해야 한다.
- 재고 증감은 문서 상태와 매핑된 `InventoryMovement`에서 발생한다. 재고 잔량을 직접 UPDATE하는 임의 API를 기본 경로로 두지 않는다. 재고 스냅샷/집계 테이블을 두더라도 원장으로 재생·대조할 수 있어야 한다.
- 취소/반품/정정은 기존 원장을 삭제하지 않고 reversal/adjustment 기록으로 남긴다. 감사 로그는 누가·무엇을·언제·왜, 전후 hash와 상관 ID를 연결한다.
- 차수/기간은 모든 조회·확정·마감·내보내기의 명시적 범위에 포함한다. 차수 라벨만 같은 다른 연도 데이터를 섞지 않는다.
- DB migration은 버전 테이블과 순차 migration으로 관리한다. 운영 서버에서 API 호출 때 자동 `CREATE TABLE`하는 패턴을 제품 공통 구조로 확장하지 않는다.

### 3.4 차수와 기간 확정

`OperatingPeriod`는 회계연도와 별도일 수 있는 운영 차수, 배송 묶음, 시즌, 작업 주기를 나타낸다. 예: Nenova `2026 / 37-01`, 타 업체의 `2026-Q3`, 또는 기간 관리 미사용. 화면 라벨은 별칭일 뿐 PK가 아니다. 외부 EXE의 `OrderYear + OrderWeek` 같은 키는 `ExternalPeriodMap`/레거시 adapter가 보존한다.

확정 상태는 최소 `Draft → Submitted → Reviewed → Confirmed → Closed`로 설계하되, 업체가 불필요한 단계를 끌 수 있고 승인권한과 상태전이 정책은 서버에 둔다. 확정 시점에 revision과 원천 watermark/hash를 고정한다. 확정 자료의 수정은 새 revision + 재승인 또는 취소/대체전표로만 허용한다. 단순 boolean `isConfirmed` 하나로 사용자·시간·대상 버전·마감 상태를 대체하지 않는다.

## 4. UI 개인화 및 Pivot 페이지 설계

요구사항은 열 너비 조정뿐 아니라 **페이지 구간/패널의 가로·세로 크기와 위치를 마우스로 편집하고 저장하는 작업공간**이다. Pivot은 첫 파일럿 화면으로 적합하지만, 공통 레이아웃 엔진은 대시보드/목록 페이지에서도 재사용할 수 있게 분리한다.

### 4.1 레이아웃 편집 UX

- 기본 보기와 `레이아웃 편집` 모드를 분리한다. 편집 모드에서만 카드/구간의 drag, resize, 숨김, 복원, 배치를 허용한다.
- 페이지 구성 요소는 stable `WidgetId`를 갖는다. 예: 검색·기간필터, 피벗 필드 목록, 피벗 표, 요약/KPI, 최근 이력, 작업결과.
- 자유 좌표가 아니라 반응형 grid 단위 `(x, y, w, h)`로 저장한다. `minW/minH`, 최대 크기, 허용 breakpoint, 잠금, 기본 순서 정의를 서버가 제공한다.
- 그리드의 드롭 미리보기, 겹침 방지, 행/열 스냅, 빈 공간 정돈, 기본 배치 복원, 실행취소/다시실행을 제공한다.
- 1920×1080 CSS px / 100% 확대에서 기본 템플릿을 설계·검증한다. 작은 화면에서는 의미 있는 순서의 단일열/접힘 보기로 바꾸며 가로 화면 밖에 주요 기능을 숨기지 않는다.
- Pivot에서는 필드 배치(행/열/필터/값), 표시 순서, 숫자 자리수, 열 너비, 접힘 상태, 필터를 별도 분석 preset으로 저장한다. 분석 preset과 페이지 구간 위치/크기 레이아웃은 분리해 서로 독립적으로 불러온다.
- 사용자 개인 레이아웃과 조직 기본 템플릿을 구분한다. 관리자가 정한 필수 검색/저장/확정/오류 구간은 사용자가 숨길 수 없고, 크기/위치만 제한 범위에서 조정 가능하게 한다.
- 작업 버튼의 위험도/순서는 메타데이터로 정의한다. 조회·내보내기는 배치 편집 가능하지만, 확정·삭제·전표 등록 같은 주요 액션은 확인·권한·상태 안내를 유지하고 업무 진행에 필요한 컨텍스트와 떨어뜨리지 않는다.

### 4.2 서버 저장 및 복구

- `UserPageLayout`에는 사용자·페이지·레이아웃 버전·정규화된 JSON·수정 시각·rowversion을 저장한다. 브라우저 localStorage는 초기 로드 캐시/오프라인 복구에만 쓰며 장기 기준 저장소는 서버 DB로 둔다.
- `UserReportPreset`에는 Pivot 필드구성·필터·정렬·표시 옵션을 저장한다. 기존 페이지 중 일부는 DB 즐겨찾기 API, Pivot은 localStorage `pivotFavs`/`pivotFieldLayout`를 쓰므로 개념/저장 경로를 통합해야 한다.
- API는 현재 사용자의 설정만 수정하도록 강제하고, layout JSON을 서버 allowlist로 검증한다. 임의 component id, 비정상 좌표, 과도한 payload, 금지된 업무 구간 숨김은 거부한다.
- `If-Match`/rowversion 기반 낙관적 동시성, 이전 버전 복원, 기본 레이아웃 복원을 제공한다. 같은 계정의 다른 PC/브라우저에서 설정을 가져올 수 있게 한다.
- 회사 관리자는 기본 프리셋 배포와 reset을 할 수 있지만 사용자의 개인 설정을 무단으로 덮지 않는다. 사용자별 설정의 공유/복제는 명시적 동작으로 한다.

### 4.3 화면 수용 기준

- 편집 모드에서 위젯 이동·가로/세로 크기 조절·숨김/복원·기본값 복원 후 저장/새로고침해도 구성이 유지됨.
- 저장된 분석 프리셋을 열면 Pivot 쿼리/그리드 결과까지 해당 설정을 반영하고, 필드 영역만 바뀌고 데이터가 고정되는 현상이 없어야 함.
- 서로 다른 사용자 설정이 섞이지 않음. 여러 탭에서 충돌 편집하면 덮어쓰지 말고 충돌 안내 및 다시 불러오기 제공.
- 업무 필수 액션을 숨기거나 범위 밖으로 밀어내지 못함. 확정/삭제는 버튼 위치와 무관하게 서버 권한/선행조건 검사를 통과해야 함.
- 1920×1080에서 가로 잘림, 패널 겹침, sticky 가림, 모달 이탈, 버튼 실패 알림, Pivot 표의 가로/세로 스크롤을 검사.

## 5. 버튼·업무·오류 정의서

모든 작업 버튼은 아래 메타데이터를 갖는 단일 액션 계약으로 정의한다.

```text
ActionId / LabelKey / Permission / AllowedStates / Preconditions
InputSchema / ValidationRules / PreviewRequired / ConfirmationText
CommandEndpoint / TransactionBoundary / ExpectedWrites
IdempotencyPolicy / AuditFields / SuccessState / ErrorCodes / RecoveryAction
```

오류는 사용자용 코드·문구·복구 동작과 운영 로그를 분리한다. 예: `PERIOD_CLOSED`는 “이 차수는 마감되어 수정할 수 없습니다. 새 조정 문서를 만들거나 관리자에게 마감 해제를 요청하세요.”로 안내하며, 로그에는 correlation ID·SQL 상태·요청 주체를 기록하되 비밀번호/토큰/불필요한 개인정보는 제외한다. 재시도 가능한 일시 장애, 사용자 입력 오류, 권한 거부, 데이터 충돌, 외부 연동 실패를 구분한다.

## 6. 구현 단계 및 게이트

### 0단계 — 업무·데이터 계약 확정 (코드/DB 쓰기 없음)

- 차수·확정·마감·재고·거래전표 용어사전 및 상태도 작성
- ECOUNT 기능 매트릭스 확정: 1차 출시 포함/후속/제외와 대체 수단
- Nenova 기존 SQL 테이블/SP/API 대조표: 유지, adapter, 공통 대체 후보를 구분
- 파일럿 두 번째 업체의 양식/샘플 데이터와 사용자 동선을 받아 모델 검증

### 1단계 — 공통 기준 스키마와 SQL 계약

- ERD, 테이블 명세, 키/인덱스/삭제·정정·보존 규칙
- 문서 저장 command, 상태전이, 재고·회계 원장 side-effect matrix
- migration/seed/backup/restore/test fixture 작성. 운영 DB 적용 금지 상태에서 검증

### 2단계 — 권한·워크플로/API 코어

- 역할/범위 권한, idempotency, rowversion, 감사/outbox/error catalog
- 먼저 read-only 조회와 import preview/dry-run. 불변식 테스트 전까지 운영 쓰기 연결 안 함

### 3단계 — 사용자 화면 및 개인 레이아웃

- Pivot 분석 preset 저장 통합 후 grid layout 편집기를 별도 개발
- 사용자별 저장·불러오기·버전 복구 및 API 테스트
- 1920×1080 브라우저 검증, 화면 fixture 및 접근성/키보드 대체수단

### 4단계 — 파일럿 업체·회귀

- 별도 DB에 빈 스키마 설치 → seed → import → 주문/입고/출고/재고/확정 E2E
- 업무 원장 대조, cross-period/cross-year 동일번호 fixture, 권한 분리, migration 재실행/복구 테스트
- ECOUNT 요구 목록 및 업체 수용 테스트 통과 후에만 운영 배포 검토

## 7. 현재 저장소에서 확인된 차이와 우선 작업

- `docs/BLUEPRINT_WHITE_LABEL_ERP.md`에 화이트라벨 방향은 있으나 테넌트 설정을 화면/API에 완전히 적용하는 단계는 미완료다.
- `docs/DB_STRUCTURE.md`는 Nenova MSSQL의 실제 예외와 EXE 호환 규칙을 보존한다. 이것을 곧바로 타 업체의 공통 스키마로 복사하면 안 된다. 범용 도메인 모델과 Nenova adapter/매핑을 분리해야 한다.
- 현재 즐겨찾기는 `pages/api/favorites.js`에서 `UserFavorite` DB 테이블을 쓰는 화면과 Pivot 페이지의 `pivotFavs`/`pivotFieldLayout` localStorage가 공존한다. 다른 컴퓨터 동기화·버전 관리·레이아웃 preset 통합이 안 된 구조이므로 UI 개인설정 저장 계약이 선행돼야 한다.
- 현재 Pivot은 필드 드래그, 일부 열 폭 조절이 있으나 페이지 전체의 패널 이동/리사이즈 설정 모델과 사용자별 서버 동기화는 별도 기능이다.
- 저장소에는 광범위한 미커밋 변경이 있어 이번 작업은 기존 파일을 수정하지 않고 이 설계 문서만 추가했다. 기존 변경물의 소유권/내용은 건드리지 않았다.

## 8. 아직 필요한 실증 자료

새 업체의 SQL 컬럼이나 저장방식을 지금 가정해 확정하면 안 된다. 아래를 받아 논리 모델을 물리 스키마로 변환한다.

1. 두 번째 업체가 실제로 쓰는 거래 문서와 업무 절차(차수 없음/있음, 확정·수정·취소 사례 포함)
2. 기존 DB의 테이블·키·뷰·프로시저 목록 또는 샘플 백업/마스킹된 스키마
3. 주요 입력 Excel/인쇄물과 정상·오류 사례 각 2~3건
4. 필요한 ECOUNT 기능의 실제 메뉴·업무 목록과 출시 우선순위
5. 사용자 역할별 화면·버튼 권한과 확정 책임자

현 단계 완료는 설계 기준 초안 작성이다. 구현·마이그레이션·실제 업체 이식은 아직 수행되지 않았다.

## 13. 업체에 전달할 자료 요청서 초안

아래 내용을 업체 담당자에게 보내 킥오프 전에 수집한다. 전체 자료가 한 번에 없더라도 1차 워크숍은 가능하나, 없는 항목은 설계 가정으로 숨기지 않고 “확인 필요”로 기록한다.

### A. 회사 및 출시 범위 — 필수

- 회사/사업장 수, 사용자 수, 부서·직무, ERP를 쓰려는 목적과 현재 가장 큰 업무 문제
- 첫 출시에서 꼭 필요한 메뉴와 업무 5~10개, 후속으로 미뤄도 되는 기능
- 현재 쓰는 프로그램/ERP, 기존 이력 데이터의 시작 연도, 신규 구축인지 이관인지
- 각 업무의 담당자와 최종 승인/확정 권한자, 읽기만 가능한 역할
- 한국 외 법인/통화/언어/세금·회계 기준이 있는지

**요청 산출물:** 조직도 또는 역할표(이름은 가명 가능), 메뉴 우선순위 표, 기존 시스템 목록.

### B. 실제 업무흐름 — 필수

각 핵심 흐름을 “시작 자료 → 입력/검토 → 저장 → 확정/전기 → 후속 처리 → 취소/정정” 순서로 받고, 아래 사례를 각각 최소 하나씩 요청한다.

- 정상 거래 한 건
- 저장 후 수정한 거래 한 건
- 확정 후 취소/반품/정정한 거래 한 건
- 동시 작업 또는 중복 업로드 등 오류/예외 한 건
- 입고/출고/재고와 기간·차수·회계 반영시점이 서로 다른 사례 한 건(해당 시)

각 단계마다 누가 처리하는지, 어떤 값이 잠기는지, 어떤 화면/출력물이 기준인지, 재고·미수·미지급·회계가 언제 바뀌는지 답을 받는다. “확정”이 버튼명인지 회계/재고 반영 시점인지도 분리해 확인한다.

**요청 산출물:** 화면 녹화/캡처 또는 손그림 흐름도, 상태별 문서 예시, 예외처리 메모. 직원 실명·고객 개인정보는 가명/마스킹 가능.

### C. SQL/DB 저장방식 — 설계 핵심, 필수

- DB 제품/버전과 기존 DB가 있으면 DB 이름·스키마명(접속 자격증명은 보내지 않음)
- 주요 테이블 목록과 컬럼 정의: 자료형, NULL 허용, PK/FK, unique/index, 기본값
- 뷰·저장 프로시저 목록 및 주문/구매/입고/출고/재고/확정 처리에 관련된 정의
- 문서번호 생성 방식, 삭제 플래그/취소 방식, 수정 이력 테이블, 연도/기간/차수 키
- 실제 화면 한 건이 어떤 테이블 행을 만들거나 수정하는지 아는 범위의 매핑
- 마스터 품목 단위 변환, 소수점/반올림, 통화/세율, 기초재고/재고원장 규칙
- 기존 ERP/EXE가 직접 SQL을 쓰는지, 외부 프로그램이 참조하는 뷰·SP·컬럼이 무엇인지

**요청 산출물:** ERD 또는 스키마 전용 DDL, 관련 SP/view 정의, 마스킹한 표본 덤프(핵심 테이블별 정상 5~20행 및 연결되는 키). 데이터 덤프를 줄 수 없다면 동일한 모양의 가상 샘플로 대체.

**보안 전달:** 운영 계정·비밀번호·토큰·인증서·실제 개인정보/계좌정보는 받지 않는다. 원격 조회가 꼭 필요할 경우 업체가 만든 별도 읽기 전용 계정, 스테이징 DB, 허용된 대상·기간을 별도 승인한다. 운영 데이터 INSERT/UPDATE/DELETE 권한은 설계 단계에서 요구하지 않는다.

### D. 양식·보고서·가져오기 파일 — 필수

- 자주 입력하는 화면과 출력/인쇄 양식 각 2~3개
- 사용하는 Excel/CSV 업로드·다운로드 원본 파일(개인/가격 민감정보 마스킹 가능)
- 동일 품목이 여러 이름/코드/단위로 들어오는 사례, 헤더행/병합셀/공식/숨은 시트 유무
- 현재 보고서에서 쓰는 필터·정렬·그룹·합계 및 부서/사용자별 다른 열 구성
- 파일 업로드 이후 사람이 수정하는 지점과 최종본 확정 시점

### E. 차수·기간·확정 정책 — 해당 시 필수

- 차수/시즌/주차/프로젝트 기간 사용 여부와 라벨 예시 3개(연도 경계 포함)
- 기간에 귀속되는 대상: 주문일, 수요일, 실제 입고일, 출고일, 회계일 중 각각 무엇인지
- 한 물량이 실제 입고 차수와 다른 판매/작업 차수에 연결될 수 있는지
- 차수별 자료 마감·재오픈·확정 권한과 확정 뒤 정정 승인 방식
- 차수 없는 업무/긴급 입출고/이월/부분입고가 가능한지

### F. ECOUNT 기준 기능 및 개인화 — 필수

- “ECOUNT급” 중 실제로 원하는 기능을 A(첫 출시 필수)/B(후속)/C(불필요)로 나눈 표
- 판매·구매·재고·회계·미수미지급·생산·급여·그룹웨어 중 사용하는 모듈과 연결 요건
- 사용자별 메뉴 숨김/즐겨찾기/대시보드 위젯/입력 폼·보고서 수정 필요 여부
- Pivot·목록에서 사용자가 옮기거나 크기 조절하려는 구간, 보존되어야 하는 필수 버튼
- 모바일/태블릿 이용, 프린터/라벨/바코드/전자서명 요구

### G. 배포·운영 기준 — 범위 확정용

- 고객 전용 서버/DB의 소유·운영 담당, OS/SQL Server 버전과 네트워크 접근 조건
- 사내/외부 접속, VPN/IP 제한, 도메인/인증, MFA·SSO 필요 여부
- 백업 주기·보존기간·복구 목표, 장애 알림 수신 담당, 운영시간
- 유지보수·업데이트 승인자, 점검창구, 로그 보존·개인정보 보관/파기 정책
- EXE/프린터/스캐너/회계 프로그램 등 계속 유지할 외부 연결과 해당 업체 담당자

## 14. 워크숍에서 반드시 질문할 결정 항목

| 질문 | 업체 담당자가 정해야 하는 답 |
|---|---|
| 업무 데이터의 원본은 무엇인가? | 새 ERP, 기존 ERP, 회계 프로그램 중 원장별 기준 시스템 |
| 언제 재고가 변하는가? | 주문, 입고, 검수, 출고, 확정 중 전기 기준 이벤트 |
| 확정은 정확히 무엇을 잠그는가? | 문서 revision, 재고원장, 매입/매출, 기간 또는 조합 |
| 확정 뒤 정정은 어떻게 하는가? | 재오픈 승인, 조정 전표, 취소 후 재작성 중 허용 방식 |
| 차수는 어떤 뜻인가? | 수요/판매 계획, 실물 입고, 출고, 회계기간을 각각 구분 |
| 품목 코드/단위의 소유자는 누구인가? | 신규 생성·중복 통합·단위 환산 승인 담당 |
| 버튼별 권한은 누구에게 있는가? | 작성·검토·확정·취소·설정 권한 역할표 |
| 사용자가 바꾸는 UI 범위는 어디까지인가? | 패널 위치/폭/높이, 숨김, 보고서 필드와 잠금 위젯 |
| “ECOUNT 정도” 중 첫날 필요한 것은? | A/B/C 우선순위와 실제 월말/현장 시나리오 |
| 성공을 어떻게 대조하는가? | 기존 시스템·엑셀·인쇄물과 일치시킬 표본/합계 |

### 업체 자료 수령 체크박스

- [ ] 회사·사업장·사용자 역할과 첫 출시 메뉴 목록
- [ ] 판매/구매/재고 대표 업무흐름, 수정·취소·예외 사례
- [ ] 마스킹된 화면/출력물/가져오기 Excel 예시
- [ ] 스키마 DDL/ERD, 관련 테이블 PK/FK, View/SP 정의
- [ ] 연도·차수·확정·마감·재고 반영 기준 문답
- [ ] ECOUNT 기준 A/B/C 기능 우선순위 및 사용자별 UI 요구
- [ ] 서버/SQL 버전, 백업·복구·보안 담당 정보
- [ ] 표본 거래로 기존 결과와 대조할 수용 기준

자료 수령 후 설계 산출물은 (1) 용어사전·ERD (2) 문서 상태도 (3) 버튼별 SQL side-effect matrix (4) 화면 와이어프레임과 위젯 제약표 (5) 오류 코드/복구 안내표 (6) MVP 범위·회귀 테스트 fixture 순으로 승인받는다.

## 9. 상세 SQL 명세 방향

이 절은 실제 DDL 작성자가 그대로 검토할 수 있게 키·제약·쓰기 경계를 좁힌 논리 명세다. 타입/인덱스 길이·삭제 정책·보존기간은 파일럿 원천과 부하 추정 후 확정한다.

### 9.1 키·번호 정책

- 각 테이블의 내부 PK는 의미가 변하지 않는 surrogate key로 둔다. 사용자에게 보이는 문서번호, 거래처 코드, 품목 코드, 차수 라벨은 PK로 쓰지 않는다.
- 업무번호는 `DocumentNumberSeries(SeriesId, DocumentType, FiscalYear, SiteId, Prefix, NextNumber, RowVersion)`에서 트랜잭션으로 발급한다. 삭제한 번호를 재사용하지 않고, 실패한 트랜잭션에서 번호를 소비할지 여부를 업무별로 명시한다.
- 외부 ERP 키는 `(AdapterId, EntityType, ExternalCompanyKey, ExternalKey)` 복합 유일키로 매핑하고, 원본 키 문자열과 마지막 동기화 watermark를 보존한다.
- 운영기간 유일성은 최소 `(PeriodType, PeriodYear, SequenceNo)`로 정의하되, 실제 업무에서 기간종류/사업장별 독립 차수가 필요하면 `SiteId`를 포함한다. 같은 숫자 차수를 다른 연도에서 허용한다.
- 문서 유일성은 `(DocumentType, SiteId, DocumentNo)`로 보장한다. 문서 라인은 `(DocumentId, LineNo)`가 유일하고, 항목 참조는 ItemId FK를 사용한다.

### 9.2 수량·금액·환산 정책

- 입력 수량은 사용자가 입력한 값과 단위(`EnteredQuantity`, `EnteredUnitId`)로 저장하고, 동일 행에 기준단위 환산값(`BaseQuantity`)과 적용된 환산율/단위 버전(`ConversionNumerator`, `ConversionDenominator` 또는 참조 버전)을 보존한다. 마스터 환산율이 나중에 바뀌어도 과거 문서가 재계산되어 변하지 않도록 한다.
- 수량은 적절한 `decimal(p,s)`로 저장하고 float를 사용하지 않는다. 금액·세율·환율의 scale과 반올림 시점은 통화/세법 정책으로 선언하며, 문서 저장 시 계산 입력과 계산 결과를 재검산한다.
- 문서 행에는 순액/세액/총액 및 가격 적용 근거(가격표/수동/계약)를 저장한다. 보고서에서 현재 품목 마스터 가격을 과거 문서 금액으로 대체하지 않는다.
- 단위별 별도 수량 컬럼을 사용하는 레거시(Nenova의 Box/Bunch/Steam)는 adapter 경계에서 canonical base quantity로 변환하되 원본 컬럼 값도 보존·대조한다. 변환 공식은 업체별 계약에 둔다.

### 9.3 문서 및 재고 전기 계약

| Command | 허용 상태 | 원장 영향 | 반복 호출/취소 |
|---|---|---|---|
| SaveDraft | Draft | 업무 문서 revision만 | 같은 idempotency key는 같은 결과 반환 |
| Submit | Draft | 승인 작업 생성만 | 이미 제출된 버전은 중복 제출 거부/기존 결과 반환 |
| Confirm | 검토완료 + 모든 선행조건 충족 | 확인 snapshot 생성, 아직 재고 영향 없음(문서 종류 정책이 정함) | 현재 revision이 예상값과 다르면 충돌 |
| Post | Confirmed | 문서 유형별 재고/미수/미지급/회계 원장 생성 | 문서당 posting 1회 unique 보장 |
| Reverse | Posted | 반대 방향 원장 행 및 취소 연결 생성 | 원본 삭제 금지, reversal 원본당 정책상 허용횟수 제한 |
| Reopen | 정책상 권한 + 마감 전 | 원장 삭제 금지. 재검토 revision/보상전표 필요 | 닫힌 기간은 기본 거부, 예외는 별도 권한·사유·감사 필요 |

`Confirm`과 `Post`를 모든 업체에서 같은 버튼/단계로 강제하지 않는다. 어떤 문서는 확인 즉시 전기될 수 있지만, 해당 규칙은 문서유형의 `PostingPolicy`로 명시하고 사용자가 화면에서 추측하지 않게 표시한다. 상태 전이와 원장 영향은 서버에서 한 계약으로 검증한다.

재고 전기는 `InventoryMovement`에서 품목·창고·lot(선택)·기준단위·효력시각·출처 문서행을 연결한다. 예상재고는 원장 합계, 실시간 재고는 게시된 움직임 합계 또는 검증 가능한 잔량 스냅샷으로 계산한다. 스냅샷은 원장 기준 시점과 재생 검증값을 가진다. 동일한 문서행을 두 번 전기하지 않도록 unique 제약(예: `(SourceDocumentLineId, MovementRole, PostingRevision)`)을 둔다.

### 9.4 차수 매핑 예

| 원천 표시 | 저장 관계 | 주의 |
|---|---|---|
| Nenova `2026 / 37-01` | OperatingPeriod row + 외부 매핑 `OrderYear=2026`, `OrderWeek=37-01` | 다른 연도의 `37-01`과 절대 혼합 금지 |
| 일반 도매 `2026-Q3` | 회계기간과 별개 OperatingPeriod 또는 같은 기간 참조 | 화면명은 자유지만 기간 날짜/마감은 명시 |
| 차수 안 씀 | 문서의 `OperatingPeriodId=NULL` 허용 | NULL 범위 집계의 의미를 보고서 계약에 정의 |
| 여러 입고분을 앞선 판매차수에 배정 | 주문/수요 기간과 실제 입고 기간을 각각 참조 | 한 `Week` 컬럼으로 두 의미를 덮어쓰지 않음 |

차수에서 이동된 물량은 `BusinessDemandPeriodId`와 `PhysicalReceiptPeriodId`처럼 업무상 의미가 다른 관계를 분리한다. 실제 배송/입고가 발생한 시점과 배정/판매 대상 차수를 한 칼럼으로 표현하지 않는다.

## 10. UI 레이아웃 저장 JSON 및 API 계약

### 10.1 레이아웃 문서 예시

사용자 배치는 임의 CSS 좌표가 아닌 breakpoint 별 12열 논리 grid로 저장한다. 화면의 실제 픽셀 크기는 렌더러가 계산한다.

```json
{
  "schemaVersion": 1,
  "pageId": "stats.pivot",
  "revision": 12,
  "breakpoints": {
    "desktop": { "columns": 12, "rowHeight": 28, "widgets": [
      { "widgetId": "query-toolbar", "x": 0, "y": 0, "w": 12, "h": 2 },
      { "widgetId": "field-list", "x": 0, "y": 2, "w": 3, "h": 5 },
      { "widgetId": "pivot-grid", "x": 3, "y": 2, "w": 9, "h": 14 }
    ] },
    "tablet": { "columns": 8, "widgets": [] },
    "mobile": { "columns": 4, "widgets": [] }
  },
  "hiddenWidgetIds": [],
  "updatedAt": "2026-09-29T10:00:00Z"
}
```

서버의 `PageWidgetDefinition`이 `widgetId`, 적용 가능한 페이지/역할, 기본 위치, `minW/minH/maxW/maxH`, `resizable`, `draggable`, `hideable`, 필수 여부, 업무 위험등급을 관리한다. 클라이언트가 이 정의를 덮어쓸 수 없으며 API는 허용된 ID·경계·겹침 정책을 검증한다. JSON은 사용자 설정을 위한 문서이며, 업무 데이터의 정형 관계를 대체하지 않는다.

### 10.2 API 초안

| Method/Path | 목적 | 주요 규칙 |
|---|---|---|
| `GET /api/ui/pages/{pageId}/layout` | 유효한 최종 사용자 배치 조회 | 개인 배치가 없으면 회사 기본값 → 제품 기본값 순으로 합성 |
| `PUT /api/ui/pages/{pageId}/layout` | 레이아웃 저장 | `If-Match` revision 필수, allowlist 검증, 업무 데이터 접근 불가 |
| `POST /api/ui/pages/{pageId}/layout/reset` | 현재 사용자 배치 초기화 | 조직 기본값으로 복원, 변경 이벤트 기록 |
| `GET /api/ui/pages/{pageId}/widgets` | 위젯 정의/제약 조회 | 서버의 현재 권한과 기능 플래그 적용 |
| `GET/POST/PUT/DELETE /api/user-presets/{presetId?}` | Pivot·목록 분석 구성 CRUD | 소유권 검사, preset schema/version 검증 |

저장 실패 시 화면에는 “다른 탭/기기에서 레이아웃이 바뀌었습니다. 최신 설정을 다시 불러와 변경사항을 비교하세요.”와 같은 충돌 메시지를 제공한다. 자동 마지막 저장은 짧은 debounce와 저장중/저장됨/실패 상태를 표시하되, 미저장 상태에서 페이지 이탈 시 경고한다.

### 10.3 버튼과 위젯 위험등급

| 등급 | 동작 예 | 위치 변경 | 숨김 | 서버 필수 검증 |
|---|---|---:|---:|---|
| Read | 검색, 새로고침, 상세 열기 | 허용 | 허용 | 조회 범위 권한 |
| Configure | 필터·열·피벗 배치·즐겨찾기 | 허용 | 허용 | 개인 설정 소유권 및 schema |
| Write | 주문/입고/출고 저장 | 제한 내 허용 | 역할별 | 상태·단위·중복·행 버전·부작용 범위 |
| Confirm | 확정·마감·전기 | 기본 위치 유지 또는 고정 액션바 | 금지 | 권한·선행상태·합계 검증·동시성·감사 |
| Destructive | 삭제·취소·원장 반전 | 고정 영역/명확한 위험존 | 금지 | 재인증/사유/확인/반대전표/감사 |

레이아웃 개인화는 표시 공간을 조절하는 기능이지 업무 절차·권한을 사용자 마음대로 바꾸는 기능이 아니다. 위험 등급 Write 이상은 시각적 경계, 버튼 라벨, 확인 다이얼로그와 성공/실패 알림을 유지한다.

## 11. ECOUNT 기준 MVP 수용 매트릭스

최소 출시(Phase A)는 아래 공통업무 흐름이 한 데이터 계약으로 끝까지 연결되는 범위를 말한다. 급여/생산은 출시 파일럿 업종 요구가 있을 때 확장 모듈로 두며, “기능 목록에 존재”와 “모든 고객에 동일하게 켜짐”은 구분한다.

| 우선순위 | 범위 | MVP 완료 기준 |
|---|---|---|
| A0 필수 | 계정/사용자/역할/감사 | 조회·입력·확정·취소 권한 분리, 누가 한 작업인지 이력 조회 |
| A0 필수 | 회사/거래처/품목/단위/창고 | 코드 유일성, 사용중지 이력, 다단위 환산, import 검증 |
| A0 필수 | 판매 및 구매 문서 | 초안·검토·확정/전기·취소, 행별 품목/단위/수량/가격, 중복 제출 안전 |
| A0 필수 | 입고·출고·재고 원장 | 전기 전 미리보기, 품목·창고별 원장/잔량/기초·기말 대조, 조정 사유 |
| A0 필수 | 미수·미지급 기본 | 판매/구매 전표에서 생성 및 수금/지급 반영·잔액 대조 |
| A0 필수 | 표준 조회/Excel | 날짜·기간·거래처·품목 검색, 사용자별 열/정렬 저장, 출력 합계 일치 |
| A0 필수 | 사용자 작업공간 | 즐겨찾기, 홈 위젯, Pivot/list layout 개인 저장 및 기기 간 동기화 |
| A1 권장 | 회계/세무 | 계정과목/분개/기간마감/세금 신고 자료는 현지 회계 요건 명세 후 출시 |
| A1 업종형 | 생산/작업 | BOM/작업지시/투입/완료/폐기/원가; 제조 파일럿에서 수용 테스트 |
| A2 선택 | 급여/그룹웨어 | 개인정보·노무·법적 의무 때문에 별도 요구·보안 검토 후 범위 확정 |
| A2 선택 | 외부 플랫폼 연결 | API scope, idempotency, retry/outbox, reconciliation, credential rotation 검증 |

“ECOUNT급”은 메뉴 수가 아니라 위의 연결된 업무 범위·권한·사용자 입력 환경·조회/보고서 구성 기능의 충족 여부로 판단한다. 실제 출시 판단은 후보 고객의 사례로 검증한다.

## 12. 설계 완료 게이트 및 테스트 fixture

코드 구현 전에 다음 시나리오를 문서화하고, 나중에 자동 테스트 데이터로 옮긴다.

1. **기간 식별**: 서로 다른 연도의 같은 차수 번호가 조회·확정·재고 집계에서 섞이지 않는다.
2. **차수 비사용**: `OperatingPeriodId=NULL` 문서도 번호/집계/마감 정책에서 모호하지 않다.
3. **재배정**: 36차 입고 물건이 35차 판매 배정에 연결되어도 실제 입고 기간과 판매 대상 기간이 보존된다.
4. **확정 동시성**: 사용자 A/B가 같은 revision을 수정하면 후발 저장은 충돌하고, 확정 스냅샷은 실제 확정한 revision을 가리킨다.
5. **중복 제출**: 네트워크 재시도로 같은 전표가 이중 저장·이중 전기되지 않는다.
6. **취소**: 확정/전기된 거래를 취소하면 원본은 남고 정확히 한 reversal이 생성된다.
7. **단위 변경**: 품목 마스터 환산율을 나중에 바꿔도 기존 문서의 입력 단위·저장 기준수량이 바뀌지 않는다.
8. **권한**: 읽기 권한만 있는 계정은 API를 직접 호출해도 저장/확정 못 한다.
9. **레이아웃 소유권**: 두 사용자가 서로의 설정을 못 읽고 수정하지 못하며, user setting의 좌표값으로 서버 위젯 제약을 우회하지 못한다.
10. **레이아웃 업그레이드**: WidgetId 제거/추가와 schemaVersion 상승 시 안전한 기본값 migration 또는 복원 경로가 있다.
11. **화면 배치**: 1920×1080 / 100%에서 표·패널·작업 버튼 접근 가능, 이동/리사이즈 후 겹침·가림 없음.
12. **복구성**: 백업에서 별도 스테이징 DB로 복원 후 문서 수, 재고원장 합계, 미수·미지급 합계와 확정 hash 검증이 통과한다.

각 업무 쓰기에는 side-effect matrix를 먼저 둔다. 예를 들어 판매 주문 초안은 주문 테이블만 쓰고, 출고 전기만 재고 원장을 감소시키며, 매출 전기는 매출/미수 원장을 생성한다는 식으로 문서 유형별 실제 정책을 정한다. 이 규칙은 ECOUNT를 추정해 정하지 않고 파일럿 회사의 합의된 업무 기준과 법적 회계 요건으로 확정한다.
