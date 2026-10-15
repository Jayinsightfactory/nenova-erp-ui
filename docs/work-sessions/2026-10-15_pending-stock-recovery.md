# 2026-10-15 40-2차 BUSY 복구 및 미완료 계산 재시도

## 사용자 요청 → 처리
- 질문: 다시 BUSY가 떠서 확정취소가 안 된다. 40-2차를 재계산해 풀고 중단 후에도 복구되게 해 달라.
- 원인: 2026/40-02 FIX 이후 committed WAIT_CALC가 남았다. 10/12 수정한 atomic CALC 정의는 유지됐다. 실제 EXE는 FIX/CANCEL과 후속 CALC0을 별도로 실행한다. 후속 호출 미실행·통신 오류·rollback 중 어느 것이 최초 원인인지는 현재 상태만으로 입증할 수 없다.
- 즉시 복구: 승인된 2026/40-02 기존 native CALC0 실행. return/output=0, 원래 외부 트랜잭션 정상, commit 후 새 연결에서 IDLE/PendingCalc=0 확인. 별도로 확정취소하거나 게이트를 직접 비우지 않았다.
- 보존 확인: 보호 대상 12개 테이블 건수/체크섬 일치, 46,851개 현재·후속 ProductStock snapshot 비교, 신규/악화 음수 없음. 체크섬은 행 전체 동일성의 완전한 증명은 아니다.
- 재발 보완: 서버가 committed WAIT_CALC만 60초 유예 후 정상 동일 연도·차수 CALC0으로 복구한다. 계산 중 RUN은 건드리지 않는다. 독립 프로세스/트랜잭션 표식/정확한 native hash와 서명/완료값을 확인한다. 연결 중단은 rollback되며 재시도 때 현재 상태를 다시 읽는다. 동일 pending은 최대 5회, 간격을 늘려 재시도하고 소진하면 기록·경고한다.

## 검증
- 단위/주입 테스트 81개 통과.
- 실제 격리 SQL: 정상 복구, RUN/IDLE 보존, 교차연도 거부, 정확한 차수, 실패 rollback, 동시 worker, 프로세스 강제 종료 후 재복구 통과.
- SQL fixture의 업무 계산 본문은 sentinel이며 실제 재고 공식 검증으로 표현하지 않는다. 운영 native 계산은 위 즉시 복구로 별도 확인했다.
- ERP 전체 계약, manifest 109개, 쓰기 가드, dnSpy 근거 검사 및 production build 통과. worker heartbeat는 별도 SQL 쓰기 없이 배포 후 실행 여부를 확인한다.

## 기준선 및 범위
화면 기준선은 해당 없음(백그라운드 작업). 원장 보존·성공 실패 구분·진단 이력은 적용. UI, EXE 설치파일, native SP, 권한 변경 없음. 업무 수량 수정이나 재확정은 수행하지 않음.
계약: docs/contracts/pending-stock-recovery.json. 설계: docs/plans/pending-stock-recovery-2026-10-15.md.
운영 세부 진단과 보호 체크섬은 커밋하지 않는 outputs/recover-pending-40-02-result.json 및 outputs/busy-2026-10-15-*에 보관.

## 배포 진행
PR #1064 검증 통과 후 master merge 9e8c9ef48450d080279135ea6c8f2bbb20b65851 완료. Cafe24 run 38663120974 대기 중. 최신 master 병합 후 주광 회귀와 production build 재검증 통과. 전용 child를 운영 DB에 읽기 전용(candidate 항상 거부)으로 연결해 PENDING_STOCK_IDLE 및 정상 종료 확인. 최종 reviewer는 차단 결함 없음으로 판정했다.

남은 단계: Cafe24 배포 완료, worker heartbeat 및 현재 gate 읽기 확인.

## 배포 실행 경로 보완
첫 배포는 웹 smoke 15건 통과 후 heartbeat 검사에서 실패했다. 읽기 전용 PM2 probe로 운영이 web.js가 아닌 node_modules/.bin/next로 실행됨을 확인했다. heartbeat/status 파일 모두 없었으며 env opt-in은 설정돼 있었다. 별도 PM2 서비스로 분리하고 Next 환경 로드·프로세스 유지·종료를 검증한다. 기존 web.js 시작 hook은 제거해 중복 실행을 피한다.
