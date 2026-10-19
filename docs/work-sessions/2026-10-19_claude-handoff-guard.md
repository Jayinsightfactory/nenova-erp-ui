# Claude 인수: 출고·견적 누락 방지

| 항목 | 상태 |
|---|---|
| 기준 | master 6be124e7, PR #1076 f21a2e96 |
| 작업트리 | codex/claude-handoff-audit (기존 로컬 수정 보존) |
| 원장 부작용 | 운영 SELECT만 수행, 보정·DDL·재계산 없음 |
| 배포 | 필수 검증 통과, PR 갱신 전 미배포 |

## 고정 결정

- 사용자: 주문을 먼저 등록해야 분배도 가능하게 차단한다.
- 기존 ADD의 같은 트랜잭션 내 양수 주문 생성 → 분배 순서는 유지한다. 0 가짜 주문은 금지한다.
- 기존 데이터는 자동 보정하지 않는다. 이카운트에 쓰지 않는다.
- 신규 삭제 API는 제외한다. 기존에 없던 DELETE를 만들면서 별도 SELECT와 UPDATE로 보호하면 확정과의 경합을 막을 수 없다. 삭제 관련 진단은 읽기 전용으로 유지한다.
- PR #1085 기존 입고 원가 연결은 별도 진행 작업이다. 이 작업에 섞지 않는다.

## 질문과 실행

### 1. 인수 문서와 남은 작업
Q. AGENTS.md와 WORK_MEMORY.md 최근 기록을 읽고 Claude의 남은 작업을 이어서 진행.
A. 현재 작업트리는 c4942570으로 오래되어 WORK_MEMORY가 없었다. 원격 최신 기록을 확인하고 새 작업트리를 만들었다. #1079 규칙 복원은 머지 완료, Claude 작성 #1076은 CI 성공이나 미머지였다. 최신 WORK_MEMORY의 원가 연결 미완료는 #1085에서 진행 중이다. 낡은 로컬 체크아웃의 auth/ecount/orbit 미커밋 파일은 보존했다.

### 2. 주문 없는 분배 정책
Q. 주문을 먼저 등록해야 분배도 가능하게 차단.
A. #1076 신규 출고 INSERT 전 같은 연도·차수·업체·품목 ViewOrder 존재 검사와 확정 전 검사를 유지한다. 엑셀 shipmentOnly 전체 모드는 최신 master에서 이미 거부됨을 재확인했다.

### 3. 인수 검토와 보완
- 기본 금액 동기화가 ISNULL(EstQuantity,0)을 다시 SET하여 NULL을 0으로 바꾸는 경로를 fake transaction으로 재현했다.
- 기본 UPDATE에서 EstQuantity를 제외하고 혼합단가 Cost도 제외한다. 수량 정렬은 명시 boolean true일 때만 허용한다.
- 새 DELETE /api/master를 제외하여 기존 API 범위로 되돌렸다.
- 67개 기존 검사 + NULL/혼합단가/false/0/문자열 옵션 회귀 4개, 총71개 통과. ERP 기본 검사 명령에도 연결했다.
- 골든 산식 해시는 Windows CRLF를 LF로 정규화한다. Git blob과 fixture의 SHA256이 동일함을 확인했으며 산식·기준 해시는 변경하지 않았다.

## 기준 및 부작용 표

| 동작 | Order | ShipmentDetail | ShipmentDate/Farm | Customer/Product | Estimate/WebProfitReport |
|---|---|---|---|---|---|
| 주문 존재 가드 | 같은 업무키 조회 | 기존 쓰기 앞에서 검증 | 보존 | 읽기 | 보존 |
| 금액 정렬 | 보존 | Amount/Vat, 균일단가 Cost만 변경; EstQuantity 기본 보존 | 합계 읽기/기존 호출자 동작 유지 | 보존 | 직접 쓰기 없음, 저장 매출 간접 영향 |
| 삭제 진단 | 보존 | 확정 출고 조회 | 보존 | 읽기만 | 보존 |

기준: 실제 dnSpy ClassShipmentDetail.GetData/Insert/Update, 기존 금액정렬 계약과 ViewOrder 업무키. 기본 옵션 누락/false/0/문자열 true는 수량 보존, boolean true만 명시 수량 정렬. 화면을 변경하지 않아 메뉴·레이아웃·키보드 기준은 해당 없음.

## 증거와 검증

- 실제 설치 EXE에 dnSpy.Console.exe --no-color -t ClassShipmentDetail 실행, 수량·금액 필드 저장 확인.
- 운영 SELECT: 2026/41-01 상세1094건, EstQuantity NULL0건. sys.columns에서는 nullable1. 현재 사고가 발생했다는 의미가 아닌 잠재 회귀다.
- exeEstimateGoldenTotals: 운영 SELECT 포함10 pass/0 fail/0 skip. 202615·202616·202636 원 단위 합계와 거래처 수 동일.
- dnSpy evidence, 변경 manifest, 변경 write-scope 통과. 전체 ERP 검사·빌드 통과.
- 운영 저장 및 브라우저 스모크는 미검증. 빌드/검사 성공 뒤 PR 갱신→CI→머지→배포→읽기 전용 스모크 순서로 이어간다.
- handoff-contract.log, handoff-build.log는 로컬 검증 로그이며 커밋 제외.

검색어: Claude 인수 1076 주문먼저 EstQuantity NULL 혼합단가 DELETE CRLF

동일 업무키 SELECT(2026/41-01 확정 상세 1건): ViewOrder1, ViewShipment DetailFix=1 1, ShipmentDate2, ShipmentFarm0. 고객명·식별키는 공유 기록에 출력하지 않았다.
