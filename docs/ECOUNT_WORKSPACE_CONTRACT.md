# ECOUNT SQL 작업 영역 계약

사용자 승인: 별도 SQL 작업 영역 생성·적재. ECOUNT 자체는 조회/다운로드만, 입력/수정/삭제/발행/전송 금지.

고정 루트 `nenova-ecount`, SQL 스키마 `ecount_work`. 기존 ERP 원장 및 WebEcountSnapshot/WebEcountRow 보존.
동작별 부작용: import는 Version/Audit INSERT 및 Head UPDATE/INSERT, activate는 Head UPDATE 및 Audit INSERT.
Version은 불변 JSON 안전 투영 스냅샷이며 원본 개인정보 복사본이 아니다. 개인정보/계좌/메모/인증정보는 저장하거나 출력하지 않는다.
rollback은 과거 버전의 활성 포인터만 변경하며 과거 이력은 삭제하지 않는다. 외부 ECOUNT 변경의 rollback 기능이 아니다.
감사는 이 작업 영역의 가져오기·정정·활성 버전 변경만 기록한다. ECOUNT에서 직원이 수행한 모든 업무를 기록하는 감사 시스템이 아니다.
기존 스냅샷 적재 시 SourceSnapshotKey와 원본 TakenAt를 SourceTakenAt에 함께 보존하며 작업영역 CreatedAt와 구분한다. 동일 내용의 활성 버전 재수신은 새 버전·감사행을 만들지 않으므로 반복 조회/가져오기 시도 전체를 기록하는 이력은 아니다. 해시는 원본 수집시각에 의존하지 않는다.
원본 날짜 표시값은 확인된 날짜·오전/오후 시간·전표순번·월계 형식만 sourceDateLabel로 보존한다. refDate는 일자로 정규화하며 월계는 날짜를 만들어 넣지 않고 null로 유지한다. 기간 입력은 ISO 일자만 받는다.

기준: 사용자 승인 및 기존 ecountIngest 데이터셋 프로그램 매핑. 관리자 authority=1, 활성 계정만 접근.
범위: root+canonical menuId+program+dataset. 같은 프로그램의 즐겨찾기/메뉴 경로는 MyPage 외 첫 메뉴 ID로 정규화하여 같은 자료·이력을 조회한다. periodFrom/periodTo는 ISO 날짜 또는 둘 다 null; 미상 기간은 항상 unknown.
기대 revision 필수, 트랜잭션 applock과 revision 재검사. 같은 데이터 해시 재수신은 중복 버전을 만들지 않는다.
응답 유실 후 구 revision으로 재전송하면 409를 반환한다. 클라이언트는 현재 이력을 다시 읽어 결과를 확인하고 최신 revision으로 재시도한다. 즉시 투명 재시도 영수증을 지원한다는 의미는 아니다.
명시적 migration만 허용하며 런타임 DDL 없음. 원본 snapshot 한 개를 고정하여 읽고 Dataset/행수 일치 검증 후 투영.

EXE 예외: 독립 웹 전용 데이터 보관소이며 OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/ShipmentDate/ShipmentFarm/Estimate/Stock/WebProfitReport 및 View/SP에는 읽기·쓰기 하지 않는다. 따라서 새 EXE 메서드 추출 및 ERP probe 해당 없음. 기존 ECOUNT 웹 테이블 구조는 lib/ecountIngest.js를 기준으로 사용. 실제 SQL 실행/마이그레이션 검증은 별도 기록 전까지 미검증.

지원 데이터셋 cash/ar/ap/sales 및 견적조회 E040202의 quote 업로드를 적재한다. quote의 기본 투영은 원본 날짜표시와 견적금액합계 estimateTotal이며 거래처·품목·비고·최초작성일자 등은 수집하지 않는다. 진행상태는 아래 증거 enum 계약에 따라 선택적으로 보존한다. 기존 WebEcountSnapshot 가져오기는 cash/ar/ap/sales 네 종류에 한정하고 quote의 import-latest는 트랜잭션 전에 거부한다. 기존 ecount_work JSON 버전 구조를 사용하며 신규 DDL은 없다.
숫자는 문자열로 보존; 이름·계좌·거래처코드·상품명·메모는 제외. 이 제약 때문에 원본 전체 데이터와 100% 동등한 복사본이 아니다. 다른 페이지의 데이터 수집은 개별 스키마·개인정보 정책 확정 전 지원하지 않는다.

quote의 상태 필드는 선택 사항이다. 원본 담당자가 DOM의 진행중·완료 상태셀을 직접 확인했으므로 `quoteStatus=in_progress|completed`를 허용하며 `statusEvidence=row_cell`(원본 행 상태셀 확인) 또는 `query_filter`(해당 상태 조건으로 조회된 행)를 함께 전달한다. 화면에서 보이는 행수는 가상스크롤/페이지의 부분 결과일 수 있어 전체총수로 간주하지 않으며 수집 완전성은 unknown이다. 화면의 여섯 상태 탭을 관찰했다는 이유만으로 별도 결재/확인 단계의 미확인 행 상태코드를 만들지 않는다. 두 필드가 없는 과거 행은 그대로 보존해 해시가 바뀌지 않으며 미상으로 표시한다. 단독 필드·null·미확인 enum·타 데이터셋·소계행 상태는 거부한다. 상태가 추가된 자료는 새 버전이며 이전 버전은 수정하지 않는다.

상태필터는 저장된 행 중 확인된 진행중 또는 완료만 반환한다. 미상 전체 행수와 다른 필터를 통과했지만 상태 미상으로 제외된 행수를 따로 반환한다. `statusCoverage`는 현재 보관된 행의 상태근거 범위이며 수집 완전성이나 ECOUNT 전체 상태를 의미하지 않는다. 빈 수집 결과에는 행별 조건 근거가 없으므로 `unknown`을 유지하고 가짜 행을 만들지 않는다.

구매조회 E040304 purchase는 amountTotal/foreignTotal/exchangeRate와 refDate/sourceDateLabel만 보존한다. 업로드만 지원하며 source snapshot import-latest는 금지한다. JSON 버전/활성화/감사 정책을 재사용하고 신규 DDL/기존 원장 변경은 없다. 원본 전체 수집은 unknown이며 거래처·품목·적요는 제외한다.

E040305 구매현황 buyStatus는 기존 첫 non-MyPage 규칙에 따라 MENUTREE_000513을 canonical로 사용하며 000583 경로도 같은 scope를 사용한다. qty/boxQty/unitPrice/foreignAmount/supplyAmt/exchangeRate/total/weight와 검증된 날짜표시만 업로드한다. 인보이스 등 자유텍스트·개인정보·결제일은 제외한다. 기존 6종 scope/hash는 변경하지 않는다. import-latest 금지, 전체 수집 unknown, 새 DDL/ERP 원장 변경 없음.

poQuery(E040302)는 orderTotal, receipt(E040217)/payment(E040310)는 amount와 검증된 날짜만 업로드한다. 상태·납기·거래처·적요는 수집하지 않는다. canonical은 기존 규칙(509/1680/1682), source-latest 금지, 전체 수집 unknown이다. 원본 미리보기 수금·지급은 visible4열이며 숨은 th는 제외한다. 기존 immutable 버전/활성화 정책과 스키마를 재사용한다.

E040216 discount는 현재 읽기 전용이다. 금일/전월0행과 6열만 관측했고 월/일 값 문법은 미확인이다. salesAmount/accountingAmount/difference 숫자모델만 정의하며 날짜저장·필터는 허용하지 않는다. 모든 버전쓰기/가져오기/활성화는 트랜잭션 전 차단한다. 빈snapshot·가짜행을 생성하지 않으며 향후 실제 행 근거와 별도 계약 변경 후 적재할 수 있다.

buyDisc(E040313 구매할인현황)는 discount와 별도 scope이며 purchaseAmount/accountingAmount/difference만 숫자모델로 정의한다. 518/588은 기존 canonical규칙을 공유한다. 날짜 문법 미확인·금일/전월0행 관찰이므로 모든 버전쓰기를 차단하고 가짜행을 만들지 않는다.

saleQuery(E040206 판매조회)는 amount와 검증된 sourceDateLabel/refDate만 적재하며 다른 판매/판매현황 scope와 분리한다. 원본 안전표본26행은 전체성/기본기간 보증이 아니다. source-latest 금지, 기간 unknown 허용, 기존 불변버전/정정/복원 정책 재사용. SQL/DDL 및 기존 ERP 원장 변경은 없다.

unsold(E040212 미판매현황)와 unbought(E040307 미구매현황)는 금일0행만 관측했고 기준일자(영업주기)의 의미와 실제 행 날짜가 미확인이다. readonly scope와 숫자모델만 정의하고 날짜값·필터 및 모든 버전쓰기를 차단한다. unsold는 qty/unfulfilledQty/supplyAmt/vat, unbought는 qty/unfulfilledQty/vat만 투영하며 가짜행/빈snapshot/납기일 추정을 금지한다.

quoteStat(E040208 견적서현황)는 집계8열/현황7열 금일0행만 관측했으므로 읽기 전용이다. qty/unitPrice/supplyAmt/vat/total 숫자모델만 정의하며 그룹키/코드/실제행날짜는 미수집이다. 날짜필터·모든버전쓰기를 차단하고 가짜행을 생성하지 않는다. 집계8열과 현황7열 미리보기 모두 별도새탭을 직접 관측했다. 실제자료 미수집으로 UI 미리보기 실행은 비활성 유지한다.

orderQuery(E040204), orderStat(E040209), poStat(E040306)는 실제행/날짜 의미 미관측으로 읽기전용 scope만 제공한다. 주문조회 주문합계, 주문현황 수량/단가/공급가액, 발주현황 단가/외화금액/환율/공급가액 및 일별집계 수량/세액/합계 숫자모델만 정의한다. 모든버전쓰기·날짜필터 차단. 주문현황과 발주현황 모두 일별집계5열을 추가 관측했으며 다른 집계조건은 추정하지 않는다.

journal(E010701 회계거래조회)는 기존 ERP 회계원장과 무관한 독립 ECOUNT 안전투영이다. 관측9행의 sourceDateLabel은 기존 날짜/문서번호 문법검증을 통과했다. amount와 검증날짜만 업로드하며 나머지 거래처·적요·유형·계정·상태를 보존하지 않는다. source-latest금지, 전체수집unknown, 기존 immutable 버전정책 재사용.

salesTax(E040218 세금계산서조회)는 날짜와 supplyAmt/vat/total만 독립작업영역에 적재한다. 20행은 부분표본이며 전체수집unknown이다. 사용자가 승인한 target 업로드·버전·복원을 기존정책으로 허용하고 ECOUNT원본 발행/수정/삭제는 수행하지 않는다. source-latest는 미연결로 금지, 공유회계원장 읽기쓰기 없음.

stock(E040701)는 원본 품목코드 열에서 확인한 productCode를 stock에만 typed 예외로 허용한다(/[A-Za-z0-9._\/-]{1,60}/ 전체일치). quantity는 정확소수문자열, 제품명은 미수집. 코드중복/소계/행날짜는 거부하며 단일기준일 periodFrom=periodTo가 필요하다. 2026-10-20 안전1949행은 부분표본으로 전체성unknown. 다른dataset코드허용을 확대하지 않고 공유재고원장을 읽거나 쓰지 않는다.


## 관측된 빈 결과 전용 범위 (2026-10-20)

`ordEmpty`는 E040209의 등록된 현황/라인별 조회 조건 하나만 저장한다. 기존 `orderStat` 읽기전용 정책과 배열형 버전의 해시는 변경하지 않는다. 신규 버전의 `RowsJson`에는 `{formatVersion:1,rows:[],coverage:{...}}`를 저장하며 실제 `RowCount`는 0이다. 데이터 행을 만들어 빈 결과를 표현하지 않는다. 이 envelope는 다른 dataset에 허용되지 않는다.

허용 조건은 2026-10-20 하루, 현황/라인별, 비교 사용안함, 내외자 전체, 그래프 미선택, 창고·거래처·품목 선택 없음, 품목별 납기 미지정이다. `lib/ecountObservedCoverage.cjs`의 고정 프로필과 필드·값·빈 선택 배열이 모두 같아야 한다. 현재 결과 GET도 같은 criteria를 SQL 실행 전에 검증한다. 다른 날짜·조건·알 수 없는 필드는 거부하며 UI는 미수집으로 구분한다.

근거 `order-status-observed-empty-criteria.json`의 확인 직후 기록시각은 2026-10-20T11:17:01.4254316Z이다. `evidenceTimeKind=verification_recorded_at`, `sourceQueryExecutedAt=null`로 원본 서버 실행시각과 구분한다. 근거·조건은 content hash에 포함되고 버전은 불변이다. 활성화 시 저장된 envelope를 재검증하며 기존 optimistic revision 및 감사 트랜잭션을 재사용한다. 신규 DDL과 ECOUNT/공유 원장 쓰기는 없다.


## 견적서현황의 별도 빈 결과 프로필

`quoteEmpty`는 E040208의 2026-10-20 현황/전표별, 비교 없음, 내외자 전체, 견적No·시리얼/로트 빈값, 창고·프로젝트·관리항목·거래처·품목 빈선택, 그래프 없음, 양식 견적서현황에만 대응한다. 근거기록시각은 2026-10-20T11:34:11.177Z이며 서버 실행시각은 null이다. `PROFILES.quoteEmpty`와 기존 `PROFILES.ordEmpty`를 구분하고, 각각 서버 GET·import·activate에서 해당 envelope를 검증한다. 기존 ordEmpty의 프로필 값과 content hash, quoteStat의 읽기전용/집계 정책은 보존한다.

### PO 및 일보 판매의 명시적 빈 범위
poEmpty는 E040306의 2026-10-20 현황/라인별/내외자 전체/빈 선택조건/납기 미지정/결재방·그래프 꺼짐/적용양식 결제일 기준만 허용한다. 이 양식명을 기준일자의 업무 의미로 해석하지 않는다. daySale는 E040708의 동일 날짜·판매 종류 하나·빈 창고/거래처/품목/부서/관리항목·전체·결재방 꺼짐만 허용한다. 모두 기록시각 근거의 0행 coverage envelope이며 실제 서버 조회시각은 null이다. 다른 종류·기간·임의필터·증거 없는 빈 배열은 import/read/activate에서 거부한다. 기존 ordEmpty/quoteEmpty 해시 및 poStat은 보존한다. SQL과 원본 실행은 별도 root 검증 절차이며 이 변경은 원장 쓰기를 추가하지 않는다.

### 일보 전체 종류의 단일 증거 버전
`dayAll`은 E040708의 34개 정확 종류, 2026-10-20 양일, 거래처관계기준, 빈 선택조건과 전체 내외자/결재방 해제 조건으로 한정된다. `observed_report` coverage에 원본 기록시각과 34개 구역을 보존하고,2217행은 단일 JSON envelope와 단일 활성 포인터로 원자 저장한다. 30개 구역은 실제 명시적 빈 결과이며 AR72/AP183/재고1950/누계12행은 서로 다른 보고서의 데이터다. 2217을 거래건수나 전체 업무 완전성으로 해석하지 않는다.
AR/AP는 업체명·업체코드·미회수월을 제외한다. 재고는 허용 품목코드와4수량만, 숨은 중복코드는 제외한다. 누계는 관측4분류×3기간만 허용한다. 숫자는 정확 문자열, 원본 공란은null, 실제합계는 별도total행으로 유지하고 계산으로 대체하지 않는다. sourceTable/sourceRow와20개 재고표의 순서·행수·총계를 검증하여 누락/혼합/중복을 거부한다. 기존daySale 판매단독 증거 및 과거 버전 해시는 보존한다. 신규DDL·원본·공유원장 쓰기는 없다.


## 입력 초안(InputDraft) 계약 (2026-10-21)

사장님 기준(2026-10-21): 입력 화면마다 (1) 입력 칸 목록·필수/선택·형식·기본값·검증 메시지, (2) 저장 시 생기는 테이블/행(키·상태·회계반영 여부), (3) 수정·삭제·취소 경로를 확보한다. **ECOUNT 원본 저장(저장(F8)/저장/전표(F7))은 미승인·미실행**이며, 네노바웹은 별도 SQL 스키마 `ecount_work`의 웹 전용 초안 테이블로 샘플 입력→저장→조회→정정→취소 왕복만 검증한다. ERP 공유 원장(OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail/Stock/Warehouse 등)과 ECOUNT 원본, 기존 `ecount_work.Version/Head/Audit`는 읽기·쓰기 대상이 아니다.

- 근거: `data/ecount-workbench/evidence/2026-10-21-source-survey-p008-p019.json` (읽기 전용 설문, 각 화면 `note: "input screen; nothing saved"`). 입력 칸은 설문 `fields`(라벨/유형/필수 플래그)와 본문(body) 토글 컨트롤에서 그대로 생성한다. 설문의 필수 플래그는 전부 0(=미관측)이므로 모든 칸의 원본 필수여부는 **미관측(required:null)** 으로 보존하고, 웹 초안의 최소 요건(일자·품목 행 1개 이상·품목 참조코드·수량)만 `draftRequired`로 구분한다.
- 라인(품목 행) 그리드 열은 설문에서 관측되지 않았다. 웹 초안 잠정 열만 허용하고 원본 열과의 동등성은 미검증으로 둔다.
- 개인정보: 거래처·담당자·부서·창고는 이름을 저장하지 않고 불투명 참조코드(`/^[A-Za-z0-9._/-]{1,60}$/`)만 받는다. 참조·비고·적요·결제조건·검색창내용은 길이 제한(100~200자) 후 이메일·전화·사업자번호·주민번호형·7자리 이상 숫자열을 토큰으로 마스킹한다. 작업자는 sha256 해시만 남긴다.
- 라이브러리: `lib/ecountInputDrafts.cjs` (순수 함수, DB·ERP·ECOUNT 호출 없음). 마이그레이션: `docs/migrations/2026-10-21_ecount_work_input_drafts.sql` (idempotent, 사장님 SSMS 명시 실행, 런타임 DDL 없음). 계약: `docs/contracts/ecount-input-drafts.json`. 테스트: `__tests__/ecountInputDrafts.test.cjs`. API: `pages/api/ecount/input-drafts.js`, 입력 폼: `components/ecount/InputDraftForm.js`(아래 API 표).

### InputDraft API (`/api/ecount/input-drafts`, withAuth, 쓰기 대상은 InputDraftHead/Line/Audit 만)

| 메서드 | 입력 | 동작 | 오류 |
|---|---|---|---|
| GET | `?view=schema&program=` | 입력 칸 스키마 (DB 접근 없음) | 400 UNKNOWN_PROGRAM |
| GET | `?program=&draftId=` | readDraft 단건 | 404 DRAFT_NOT_FOUND |
| GET | `?program=` | 최근 50건 목록(본인·전체, `mine` 표시) | 400 |
| POST | `{program,header,lines}` | validateDraft, INSERT Head/Line/Audit (201) | 400 VALIDATION_FAILED(한글 details) |
| PATCH | `{draftId,expectedRevision,header,lines,reason}` | applyCorrection, Head UPDATE(revision 조건)+Line/Audit INSERT | 409 REVISION_CONFLICT |
| POST | `{action:'review',draftId,expectedRevision}` | 검토 처리 | 409 |
| POST | `{action:'cancel',draftId,expectedRevision,reason}` | 소프트 취소(사유 필수) | 400 CANCEL_REASON_REQUIRED |

테이블 미설치 시 모든 요청(스키마 제외) 503 `{code:'MIGRATION_PENDING',migration:'docs/migrations/2026-10-21_ecount_work_input_drafts.sql'}`. 런타임 DDL 없음. 작업자는 `actorHash` 해시만 저장. ECOUNT 원본 저장 버튼은 비활성(`원본 저장 미승인`).

### 입력 칸 (7화면, 헤더 55칸 = 설문 fields 46 + 본문 토글 9)

검증 메시지(한글): 필수 누락 `…은(는) 필수 입력입니다(웹 초안 최소 요건)`, 날짜 `…은(는) YYYY-MM-DD 형식의 실제 날짜여야 합니다`, 숫자 `… 형식이 올바르지 않습니다(정수 18자리·소수 8자리 이내, 지수·쉼표 불가)`, 참조코드 `… 참조코드 형식이 올바르지 않습니다(영문·숫자·._/- 60자 이내). 이름·상호는 저장하지 않습니다`, 길이 `…은(는) N자를 넘을 수 없습니다`, 미허용 칸 `허용되지 않은 입력 칸입니다: …`, 라인 없음 `품목 행이 최소 1개 필요합니다(웹 초안 최소 요건)`. 빈칸(`''`/`null`/`undefined`)과 `'0'`은 구분하며 숫자는 문자열로 정밀도를 보존한다.

#### E040203 주문서입력 — 헤더 12칸 (설문 fields 10 + 본문 토글 2)

| 저장 키 | 라벨 | 유형 | 필수 | 기본값 | 비고 |
|---|---|---|---|---|---|
| `docDate` | 일자 [관측 라벨 26] | 날짜(YYYY-MM-DD) | 미관측 / 웹초안 필수 | 연도 토큰 26 만 관측(월·일 미판독) |  |
| `customerRef` | 거래처 | 참조코드(불투명) | 미관측 | 미관측 | 거래처명 저장 금지, 참조코드만 |
| `unlabeledText1` | (라벨 미관측) | 자유텍스트(≤100자, 마스킹) | 미관측 | 미관측 | 라벨 미관측 텍스트 칸 |
| `managerRef` | 담당자 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지, 참조코드만 |
| `shipWarehouseRef` | 출하창고 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지 |
| `reference` | 참조 | 자유텍스트(≤100자, 마스킹) | 미관측 | 미관측 |  |
| `paymentTerms` | 결제조건 | 자유텍스트(≤100자, 마스킹) | 미관측 | 미관측 |  |
| `validUntil` | 유효기간 | 날짜(YYYY-MM-DD) | 미관측 | 미관측 |  |
| `searchText` | 검색창내용 | 자유텍스트(≤100자, 마스킹) | 미관측 | 미관측 | 화면 검색창 입력, 저장 시 마스킹 |
| `unlabeledCheckbox1` | (라벨 미관측) | 예/아니오 | 미관측 | 미관측 | 라벨 미관측 체크박스 |
| `applyVatRate` | 부가세율 적용 [본문 토글] | 예/아니오 | 미관측 | 미관측 |  |
| `domestic` | 내자 [본문 토글] | 예/아니오 | 미관측 | 미관측 | 내자/외자 구분 토글로 관측, 기본값 미관측 |

라인(품목 행, 미관측·웹 잠정): `itemRef`(품목(참조코드), 웹초안 필수), `quantity`(수량, 웹초안 필수), `unitPrice`(단가), `supplyAmt`(공급가액), `vat`(부가세), `remark`(적요) · 최대 200행

#### E040205 판매입력 — 헤더 8칸 (설문 fields 6 + 본문 토글 2)

| 저장 키 | 라벨 | 유형 | 필수 | 기본값 | 비고 |
|---|---|---|---|---|---|
| `docDate` | 일자 [관측 라벨 26] | 날짜(YYYY-MM-DD) | 미관측 / 웹초안 필수 | 연도 토큰 26 만 관측(월·일 미판독) |  |
| `customerRef` | 거래처 | 참조코드(불투명) | 미관측 | 미관측 | 거래처명 저장 금지, 참조코드만 |
| `managerRef` | 담당자 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지, 참조코드만 |
| `shipWarehouseRef` | 출하창고 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지 |
| `departmentRef` | 부서 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지 |
| `unlabeledCheckbox1` | (라벨 미관측) | 예/아니오 | 미관측 | 미관측 | 라벨 미관측 체크박스 |
| `applyVatRate` | 부가세율 적용 [본문 토글] | 예/아니오 | 미관측 | 미관측 |  |
| `domestic` | 내자 [본문 토글] | 예/아니오 | 미관측 | 미관측 | 내자/외자 구분 토글로 관측, 기본값 미관측 |

라인(품목 행, 미관측·웹 잠정): `itemRef`(품목(참조코드), 웹초안 필수), `quantity`(수량, 웹초안 필수), `unitPrice`(단가), `supplyAmt`(공급가액), `vat`(부가세), `remark`(적요) · 최대 200행

#### E040253 판매입력 II — 헤더 7칸 (설문 fields 5 + 본문 토글 2)

| 저장 키 | 라벨 | 유형 | 필수 | 기본값 | 비고 |
|---|---|---|---|---|---|
| `docDate` | 일자 [관측 라벨 26] | 날짜(YYYY-MM-DD) | 미관측 / 웹초안 필수 | 연도 토큰 26 만 관측(월·일 미판독) |  |
| `customerRef` | 거래처 | 참조코드(불투명) | 미관측 | 미관측 | 거래처명 저장 금지, 참조코드만 |
| `managerRef` | 담당자 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지, 참조코드만 |
| `shipWarehouseRef` | 출하창고 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지 |
| `unlabeledCheckbox1` | (라벨 미관측) | 예/아니오 | 미관측 | 미관측 | 라벨 미관측 체크박스 |
| `applyVatRate` | 부가세율 적용 [본문 토글] | 예/아니오 | 미관측 | 미관측 |  |
| `domestic` | 내자 [본문 토글] | 예/아니오 | 미관측 | 미관측 | 내자/외자 구분 토글로 관측, 기본값 미관측 |

라인(품목 행, 미관측·웹 잠정): `itemRef`(품목(참조코드), 웹초안 필수), `quantity`(수량, 웹초안 필수), `unitPrice`(단가), `supplyAmt`(공급가액), `vat`(부가세), `remark`(적요) · 최대 200행

#### E040301 발주서입력 — 헤더 10칸 (설문 fields 8 + 본문 토글 2)

| 저장 키 | 라벨 | 유형 | 필수 | 기본값 | 비고 |
|---|---|---|---|---|---|
| `docDate` | 일자 [관측 라벨 26] | 날짜(YYYY-MM-DD) | 미관측 / 웹초안 필수 | 연도 토큰 26 만 관측(월·일 미판독) |  |
| `customerRef` | 거래처 | 참조코드(불투명) | 미관측 | 미관측 | 거래처명 저장 금지, 참조코드만 |
| `unlabeledText1` | (라벨 미관측) | 자유텍스트(≤100자, 마스킹) | 미관측 | 미관측 | 라벨 미관측 텍스트 칸 |
| `managerRef` | 담당자 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지, 참조코드만 |
| `inWarehouseRef` | 입고창고 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지 |
| `reference` | 참조 | 자유텍스트(≤100자, 마스킹) | 미관측 | 미관측 |  |
| `remark` | 비고 | 자유텍스트(≤200자, 마스킹) | 미관측 | 미관측 |  |
| `unlabeledCheckbox1` | (라벨 미관측) | 예/아니오 | 미관측 | 미관측 | 라벨 미관측 체크박스 |
| `applyVatRate` | 부가세율 적용 [본문 토글] | 예/아니오 | 미관측 | 미관측 |  |
| `domestic` | 내자 [본문 토글] | 예/아니오 | 미관측 | 미관측 | 내자/외자 구분 토글로 관측, 기본값 미관측 |

라인(품목 행, 미관측·웹 잠정): `itemRef`(품목(참조코드), 웹초안 필수), `quantity`(수량, 웹초안 필수), `unitPrice`(단가), `supplyAmt`(공급가액), `vat`(부가세), `remark`(적요) · 최대 200행

#### E040501 창고이동입력 — 헤더 6칸 (설문 fields 6 + 본문 토글 0)

| 저장 키 | 라벨 | 유형 | 필수 | 기본값 | 비고 |
|---|---|---|---|---|---|
| `docDate` | 일자 [관측 라벨 26] | 날짜(YYYY-MM-DD) | 미관측 / 웹초안 필수 | 연도 토큰 26 만 관측(월·일 미판독) |  |
| `managerRef` | 담당자 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지, 참조코드만 |
| `unlabeledText1` | (라벨 미관측) | 자유텍스트(≤100자, 마스킹) | 미관측 | 미관측 | 라벨 미관측 텍스트 칸 |
| `fromWarehouseRef` | 보내는창고 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지 |
| `toWarehouseRef` | 받는창고 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지 |
| `unlabeledCheckbox1` | (라벨 미관측) | 예/아니오 | 미관측 | 미관측 | 라벨 미관측 체크박스 |

라인(품목 행, 미관측·웹 잠정): `itemRef`(품목(참조코드), 웹초안 필수), `quantity`(수량, 웹초안 필수), `remark`(적요) · 최대 200행

#### E040503 자가사용입력 — 헤더 6칸 (설문 fields 6 + 본문 토글 0)

| 저장 키 | 라벨 | 유형 | 필수 | 기본값 | 비고 |
|---|---|---|---|---|---|
| `docDate` | 일자 [관측 라벨 26] | 날짜(YYYY-MM-DD) | 미관측 / 웹초안 필수 | 연도 토큰 26 만 관측(월·일 미판독) |  |
| `customerRef` | 거래처 | 참조코드(불투명) | 미관측 | 미관측 | 거래처명 저장 금지, 참조코드만 |
| `unlabeledText1` | (라벨 미관측) | 자유텍스트(≤100자, 마스킹) | 미관측 | 미관측 | 라벨 미관측 텍스트 칸 |
| `warehouseRef` | 창고 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지 |
| `managerRef` | 담당자 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지, 참조코드만 |
| `unlabeledCheckbox1` | (라벨 미관측) | 예/아니오 | 미관측 | 미관측 | 라벨 미관측 체크박스 |

라인(품목 행, 미관측·웹 잠정): `itemRef`(품목(참조코드), 웹초안 필수), `quantity`(수량, 웹초안 필수), `remark`(적요) · 최대 200행

#### E040507 불량처리입력 — 헤더 6칸 (설문 fields 5 + 본문 토글 1)

| 저장 키 | 라벨 | 유형 | 필수 | 기본값 | 비고 |
|---|---|---|---|---|---|
| `docDate` | 일자 [관측 라벨 26] | 날짜(YYYY-MM-DD) | 미관측 / 웹초안 필수 | 연도 토큰 26 만 관측(월·일 미판독) |  |
| `managerRef` | 담당자 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지, 참조코드만 |
| `unlabeledText1` | (라벨 미관측) | 자유텍스트(≤100자, 마스킹) | 미관측 | 미관측 | 라벨 미관측 텍스트 칸 |
| `foundWarehouseRef` | 발견창고 | 참조코드(불투명) | 미관측 | 미관측 | 이름 저장 금지 |
| `unlabeledCheckbox1` | (라벨 미관측) | 예/아니오 | 미관측 | 미관측 | 라벨 미관측 체크박스 |
| `disposal` | 폐기 [본문 토글] | 예/아니오 | 미관측 | 미관측 |  |

라인(품목 행, 미관측·웹 잠정): `itemRef`(품목(참조코드), 웹초안 필수), `quantity`(수량, 웹초안 필수), `remark`(적요) · 최대 200행

### 저장 결과 (buildSavePlan — SQL 실행 없음, 세 테이블만)

| 동작 | 테이블·행 | 키 | 상태 | 회계반영 | 부작용 |
|---|---|---|---|---|---|
| 생성 `CREATE_INPUT_DRAFT` | `ecount_work.InputDraftHead` 1행 INSERT(Program, Status, Revision=1, FieldsJson=헤더 안전투영, LineCount, CreatedBy 해시) + `InputDraftLine` N행 INSERT(Revision=1, LineNo 1..N, FieldsJson) + `InputDraftAudit` 1행 INSERT(Action=create, DiffJson) | Head `DraftId`(uniqueidentifier) · Line `(DraftId,Revision,LineNo)` · Audit `(DraftId,Revision)` 유일 | `draft` | 없음(`accountingPosted:false`) | `none (web-only draft)` — ECOUNT 원본·ERP 원장 쓰기 없음 |
| 검토 `REVIEW_INPUT_DRAFT` | Head UPDATE(Status=reviewed, Revision+1) `WHERE DraftId AND Revision=expected` + Audit INSERT(review) | 동일 | `reviewed` | 없음 | 없음 |
| 정정 `CORRECT_INPUT_DRAFT` | Head UPDATE(FieldsJson/LineCount/Revision+1, Status=draft) `WHERE DraftId AND Revision=expected` + Line 새 Revision 집합 INSERT(기존 라인 삭제 없음) + Audit INSERT(correct, DiffJson=칸별 from/to·행별 added/removed/changed) | 동일 | `draft`(재검토 필요) | 없음 | 없음 |
| 취소 `CANCEL_INPUT_DRAFT` | Head UPDATE(Status=cancelled, CancelledReason 필수·마스킹, Revision+1) + Audit INSERT(cancel) | 동일 | `cancelled`(종단) | 없음 | 없음 |

- 모든 전이는 `expectedRevision`이 현재 Revision과 같아야 한다(불일치 → 409 `REVISION_CONFLICT`, 서버는 Head UPDATE의 Revision 조건으로 재검사).
- DB 수준 규칙(마이그레이션): Head 하드 DELETE 차단(51011), Program/CreatedBy/CreatedAt 변경 차단(51012), 취소 상태 되돌림 차단(51013), Revision 은 정확히 +1(51014), Line·Audit 는 UPDATE/DELETE 불가(51015/51016). `Status IN ('draft','reviewed','cancelled')`, `Program IN (7코드)`, `ISJSON(FieldsJson)=1`, 라인 1..200.

### 수정·삭제·취소 경로

| 경로 | 허용 상태 | 방법 | 결과 |
|---|---|---|---|
| 조회 | 전부 | `readDraft` — 저장된 안전투영 그대로(참조코드·마스킹 텍스트), `deletable:false`, `sourceSaved:false` | 읽기만 |
| 수정(정정) | `draft`, `reviewed` | `applyCorrection(draft, {head 부분병합(null=칸 비우기), lines 전체교체}, expectedRevision)` | 새 Revision + Audit diff, 상태 `draft` |
| 검토 | `draft` | `review(draft, expectedRevision)` | 상태 `reviewed` |
| 삭제 | — | **없음.** 하드 삭제 경로를 제공하지 않으며 DB 트리거가 DELETE 를 차단 | — |
| 취소(소프트 삭제) | `draft`, `reviewed` | `cancel(draft, reason(필수, ≤200자, 마스킹), expectedRevision)` | 상태 `cancelled`(종단: 정정·검토·재취소 불가, 행 보존) |
| ECOUNT 원본 저장 | — | **미승인·미실행.** 어떤 코드도 저장(F8)/저장/전표(F7)를 호출하지 않는다. 승인 시 별도 계약 변경 필요 | — |

