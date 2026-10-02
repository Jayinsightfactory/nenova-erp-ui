# 주광 요일 저장·견적 EXE 호환

| 항목 | 값 |
|---|---|
| 날짜 | 2026-10-02 |
| 화면 | /estimate/weekday |
| 작업공간 | work/jugwang-weekday-test-deploy |
| 브랜치 | codex/weekday-exe-compatibility |
| 원장 부작용 | 명시 저장만 출고수량/일자/대표일/금액/재고 및 이력 원자 변경. 주문·입고·Estimate·최초기준 보존 |
| 배포 | 검증 후 PR/배포 결과를 아래 추가 기록 |

## 고정된 결정

- 사용자 요청은 요일 셀 변경을 실제 ERP 저장·출고일 변경·견적까지 호환되게 하는 것.
- 초안 입력만으로 운영 DB가 바뀌지 않는다. 변경 확인과 사유 입력 후 명시 저장.
- 기존 상세 확정 후 저장. 임의 전체 확정 해제·확정·재확정 없음.
- 최초 기준 확정은 page-only이며 ERP 상세 확정과 다르다.
- EXE 실제 순서(day1 일요일부터 day7 토요일)로 대표 ShipmentDtm도 동기화한다.
- 인쇄의 메인차수 전체 확정 요구는 사용자 안전 정책. EXE 자체 전역 검사라고 주장하지 않는다.
- 전역 isFix 현황과 선택 업체 견적 연결/수량/금액 검사를 분리한다.

### 1. 수량 변경하면 어떻게 처리하나

Q. 요일별 수량 변경의 처리 방식과 EXE 호환 여부.
A. 기존 초안→명시 저장 흐름을 확인했고 미확정 저장 및 대표 출고일 비동기 위험을 설명했다.

### 2. 호환성이 문제없게 로직 만들어줘

Q. 실제 호환 보완 구현.
A. 실제 CLI 3개 클래스/폼 재검증, 운영 조회 표본 확인, 공유 확정 predicate,
대표 출고일 digest·저장·readback, SERIALIZABLE 인쇄 검증/원본 결과 재대조를 구현했다.
운영 40-01 주광 블루20은 최신 조회 시 미확정이었다. 자동 복구/확정하지 않는다.
격리 DB에서 실제 저장·인쇄·전후연도·동시 변경·실패 롤백을 검사했다.

## 산출물과 검증

- docs/plans/weekday-exe-compatibility-2026-10-02.md
- lib/weekdayErpCompatibility.js, weekdayDistributionPolicy/Apply/Client.js, weekdayEstimatePrint.js
- 운영 코드 비교 API, 인쇄 API, workspace 안내 및 SQL/단위/브라우저 fixture
- output/compat-*.log는 로컬 증거이며 커밋하지 않는다. .next-*·기존 output 사용자 파일 보존.

### 출시 전 검증

- 실제 dnSpy 재확인: FormShipmentDistribution / FormEstimateView / ClassShipmentDetail.
- 단위·ERP 회귀, manifest 77개, 변경 API write-scope, dnSpy 근거 guard 통과.
- 격리 SQL Server 실제 트랜잭션 저장·인쇄 및 실패 롤백 검사 통과. 운영 SQL 쓰기 없음.
- 브라우저 fixture: 1920×1080 CSS px / 100%, 수량 수정·미확정 차단·실패 초안 보존·재시도·요일 인쇄 검증 통과.
- 최종 검토 P0/P1 없음. C# decimal midpoint-to-even과 기존 웹 half-up의 완전한 저장 금액 tuple만 허용한다.
- 명시 0단가는 보존하지만 견적 단가 NULL/빈값/비정상 값은 0으로 치환하지 않고 409로 차단한다.
- 배포 및 운영 읽기 전용 smoke 결과는 출시 후 기록한다.

### 출시 결과 / 다음 작업 전 필독

> **후속 진단으로 정정됨:** 아래 출시 당시의 “NULL 거래처 키 연결 오류/보정 필요” 판단은 철회한다.
> native NULL 79건은 정상 EXE 저장·조회와 호환됐고 신규 웹 검사에서 오차단했다.
> [우선 적용할 근거·규칙](../SHIPMENT_DETAIL_CUSTOMER_NULL_NATIVE_COMPAT_2026-10-02.md)을 읽는다.

- PR #857: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/857 — 병합 완료.
- master: `2fc28dc45765cd5fd1f53e9b2b7aab6f1d8eabfc`.
- ERP Contract Guard 및 Cafe24 배포 run 36957036240 성공. 서버 build `build-1790909173387`.
- 최신 master 반영 후 로컬 프로덕션 빌드도 통과.
- 운영 읽기 전용 API와 1920×1080 / 100% 브라우저: 새 확정 안내/비교 필드, 가로 잘림 없음, JS 오류 없음 확인.
- **운영 정상 견적 출력 성공은 아직 확인하지 못했다.** 안전 차단이 발견됐으므로 성공으로 기록하지 않는다.
  - 39차: 998/998 확정이나 선택 주광 견적 연결 오류 79건으로 409.
  - 40차: 1122건 중 363건 확정, 759건 미확정 + 선택 업체 연결 오류 39건으로 409.
  - 기존 GET `/api/shipment/distribute-diagnose?year=2026&week=39-01`에서 주광
    `ShipmentKey=6508 / MasterCustKey=533`에 `DetailCustKey=NULL` 자료를 실제 확인했다.
    예: 블루 `SdetailKey=92020 / ProdKey=866 / OutQuantity=13`, 라벤더 `92023/871/10`.
    진단 API TOP200 제한이 있어 이 표본으로 전체 79건의 원인을 전부 동일하다고 단정하지 않는다.
- 운영 DB 보정/자동 확정/수량 시험 쓰기 없음. 출시 직후 NULL 보정을 검토했지만 후속 EXE 검증으로
  필요성 판단을 철회했다. 이 NULL 현상을 이유로 SQL 보정을 진행하지 않는다.
- 운영 증거: 로컬 `output/compat-live.log`, `compat-diagnostic.log`, `compat-live-1920x1080.png`.
- 이 출시 결과는 병합 후 로컬 인계 기록이며 PR 병합 당시 본문에는 포함되지 않았다.

## 한계와 이어받기

### 2026-10-02 추가 정정 — NULL 거래처 키는 오류로 단정하지 말 것

Q. 보정부터 하되 EXE/SQL 데이터를 수정하는 것은 아닌지. 이어서 “누락된 이유가 있을 것”이라고 지적.

A. 모든 보정을 중단하고 원본 EXE 저장 경로와 운영 SELECT를 다시 대조했다.
이전의 “누락 거래처 키를 채워야 한다”는 판단은 성급했다. 현재 프로그램/SQL 수정은 하지 않았다.

- EXE SHA256: `4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63`.
- 새 dnSpy 추출 `output/weekday-null-customer-native.log`: ClassShipmentDetail에는 CustKey 속성이 없고,
  Insert(307행)/Update(313행) SQL 모두 CustKey를 기록하지 않는다. ShipmentKey로 상위 출고에 연결한다.
- FormShipmentDistribution btnSave_Click은 실제로 이 클래스의 Insert/Update를 사용한다
  (기존 추출 1103~1119행, 요일 변경 1183~1185행). 따라서 NULL은 정상 EXE 경로에서도 가능하다.
- 운영 GET item-trace(year=2026, q=주광): 39-01 양수46건 중43건NULL,
  39-02 양수52건 중36건NULL. 79건 모두 ERP 표시 가능, 각 차수 양수46/52건 모두 실제 날짜 수량합 일치.
  마스터6508/6509의 WebCreated=0은 참고 표식이며 개별 생성 주체를 증명하지 않는다.
- 기존 공통 EXE 견적 SQL GET은 200, `real_db_exe_print`, 94행 반환.
  블루 Prod866 정상출고600송이, 공급가1363637/VAT136363 포함.
- 그러므로 주광39차의79건을 “SQL 자료 오류”로 단정한 설명을 정정한다.
  신규 `assessWeekdayPrintEligibility`의 `DetailCustKey===MasterCustKey` 필수 조건이 정상 native NULL을
  거부하는 READ false positive다. compare/baseline에도 sd.CustKey 동일 조건이 있는지 다음 구현에서 함께 점검해야 한다.
- 다음 작업: SQL NULL 채우기/EXE 수정이 아니라 ShipmentKey→Master.CustKey와 실제 ViewOrder/ViewShipment
  유일 연결을 권위로 하는 웹 조회·검증 계약을 설계한다. 실제 다른 양수 CustKey/복수 마스터/교차연도/
  주문탈락/날짜·금액 오류는 NULL과 구분한다. 기존 쓰기 보호를 무조건 해제하지 않는다.
- 이 추가 턴은 원인 확인만 했으며 소스 수정·새 배포·운영 UPDATE는 수행하지 않았다.
- 증거: `output/weekday-null-customer-trace.log`, `weekday-null-customer-native.log` (로컬 비커밋).

### 관련 내용을 MD에 저장해 같은 잘못을 반복하지 말 것

Q. “관련 내용 md 에 저장해놔서 또 잘못 얘기하는상황없게해줘.”

A. [전용 원인·정정 문서](../SHIPMENT_DETAIL_CUSTOMER_NULL_NATIVE_COMPAT_2026-10-02.md)에
EXE SHA/저장 메서드, 실제 View 연결, 운영 읽기 전용 표본, 잘못된 웹 검사와 미완 작업을 저장했다.
AGENTS.md, ERP_CHANGE_GUARD, 호환 불변식 3번, DB_STRUCTURE, 통합 작업 가이드와 인덱스도 정정했다.
다음 작업은 native NULL과 실제 잘못된 거래처 키를 구분하고, SQL 보정부터 시작하지 않는다.
이번 요청은 문서 저장만 수행했다. EXE·운영 SQL·애플리케이션 실행 코드·배포는 변경하지 않았다.

운영 실제 수량 시험 쓰기 및 EXE GUI 조작 시험은 하지 않았다. 실제 저장은 사용자 업무 시
서버의 최종 잠금 검사로 판정한다. 성공한 fixture만으로 모든 운영 원장에 이상이 없다고
주장하지 않는다. 기존 이월값은 웹 별도 기록이지 ERP 재고 변경이 아니다.

다음 작업은 이 문서/계약/최신 PR 상태를 읽고 시작한다. 운영 보정·확정 일괄 작업은
별도 사용자 승인 없이 수행하지 않는다.
