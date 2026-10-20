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
