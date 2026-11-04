# 수입부 수정 요청 → 영업지원 매칭·확정

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-11-04 KST |
| 작업트리 | C:/Users/USER/nw-incoming-approval-flow-1104 |
| 브랜치 / 기준 | codex/incoming-approval-flow-1104 / dc5a5d58 |
| 화면 | 입고관리 수입부 수정 요청, 업무도구 입고 정정 3탭 |
| 원장 영향 | 요청·매칭 ERP쓰기0, 최종 확정만 단일 트랜잭션 |
| 운영 DB | 읽기 전용 probe만. 실제 정정 저장하지 않음 |
| PR / 배포 | 진행 중 |

## 고정 결정

- 수입부 초안/제출 → 영업지원 선택 분배 매칭 → 영향 검토/명시 확인 → 원자 반영.
- 농장만 변경하면서 품목별 수량/경제값 동일하면 분배·재고·금액·확정 보존.
- 분배 감소만 가능. 이동 또는 독립 추가는 최종 수량/단가/단위 명시. 기존 주문은 보존, 없는 대체품은 양수 신규 주문 연결을 명시 확인.
- 41차 수정은 44차 및 이후 연도 재고까지 native CALC cascade. 확정 상태 자체로 막거나 일괄 해제하지 않음.
- 동일 연도·차수·업체·품목, 물리 입고/상세/출고일 키와 revision/hash 검사. native NULL CustKey 보존.
- 원가 문서/확정 손익/기존 농장배정 수량의 연결 정정이 필요한 건은 현재 원자 writer 지원 범위 밖이며 구체적 차단 사유를 표시. 그 부분을 완성했다고 주장하지 않는다.

### 1. 구현 요청

**Q.** 수입부 수정요청부터 영업지원 매칭·확정까지 실제 구현, 입고·분배·재고·견적·매출 함께 반영, 테스트·배포.

**A.** 3탭과 요청 원장 및 최종 writer 구현. 기존 web_mgmt.ApprovalRequest/ApprovalAudit를 전용 TargetKind로 재사용(운영 SELECT로 존재·읽기 확인), 일반 결재 생성/전환에서 해당 종류 차단. DDL 없음. 요청 완료 상태와 ERP/audit를 같은 트랜잭션에 저장하며 감사 실패까지 롤백.

## 검증 기록

- 실제 dnSpy FormShipmentDistribution 재추출, 저장 순서/ShipmentDate/ShipmentFarm/단위·금액 확인.
- 운영 read-only 7970: 2026/44-01, 입고4행/분배20행/날짜20행, 농장배정0, 원가 연결0, 활성 확정 보고서0. 새 reader SQL 실행 성공. 전년도 동일 차수 분리 확인.
- 순수 정책11 PASS: 역할 누락/0수량/감소만/전체감소/동일단위 이동/다른단위 이동/독립추가/기존 대상합치기/농장-only/교차연도/중복·누락.
- 실제 격리 SQL writer PASS: 요청·매칭 ERP0, 권한/CAS, A→B+양수 신규 주문, 매출·날짜금액일치, 2025보존/2027재계산, 동시확정/재실행, 농장-only 불변, 감소만, native실패/감사실패/후속음수 전체롤백, 반려 보존, 요청후 원장변경 차단.
- Docker 시작 오류 복구: 손상된 임시 소켓이 있던 runtime 폴더만 이름 변경 백업, 컨테이너/볼륨 초기화 없음. 기존 loopback 격리 컨테이너 재시작 후 SQL 검증. 백업은 AppData/Local의 *.bak-1104-approval*.
- 모의 실Chrome 1920/390: 제출/매칭/임시저장/미리보기/명시확정/동일UUID재시도/이력/Tab·ShiftTab·Enter·Space·방향키 PASS. 모든 API 모의, 운영쓰기0.
- 전체 ERP 계약 첫 실행 exit0. webpack 첫 빌드 exit0. 이후 보완 최종 빌드·UI 재검증 및 CI/배포 진행 중.
- manifest192/dnSpy PASS. 신규 API 포함 staged 쓰기 가드 및 최종 배포 검증은 후속 기록.

## 현재 지원 제한

일반 확정 분배를 소급 수정할 수 있으나 승인 인보이스/운송원가 상세의 물리키 연결, 확정 손익 보고서 revision, 수량 변경을 동반한 기존 ShipmentFarm 재배정은 지원 완료가 아니다. 연결이 있으면 전체 확정을 차단한다. 독립 Estimate 차감·외부 발송 서류/ECOUNT는 변경하지 않는다. 원장 견적·매출 반영과 별개로 이미 발송한 견적서 재발행 필요 안내.

`.verify/`는 로컬 합성시험/읽기전용 probe·로그·스크린샷이며 커밋하지 않는다. 운영 자격증명은 메모리에서만 사용하고 저장하지 않는다.

검색어: incomingApproval WAREHOUSE_CORRECTION_V1 입고정정 수정요청 매칭확정 원자반영 web_mgmt 재고cascade

2026-11-04 배포 전: 후속 농장후보 공통scope·원가연결farm-only·0주문/숨은주문 차단·보존행 날짜/혼합단가·미확정예약수량·재고미리보기 보완. 최종 정책+SQL12 PASS, 전체ERP exit0, webpack build-release exit0, 승인UI 재시험PASS. 신규API1 쓰기guard/manifest192/dnSpy PASS. PR/배포는 이어서 진행.

