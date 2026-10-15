# 미완료 재고 재계산 자동 복구

## 근거와 범위
실제 2026/40-02 FIX 후 WAIT_CALC가 남았다. 10/12 atomic CALC 패치는 그대로였다. 실제 설치 EXE는 FIX/CANCEL 성공 후 CALC0을 별도 호출하므로 후속 호출 중단은 WAIT_CALC를 남길 수 있다. 이번 원래 중단 사유는 입증되지 않았다.

운영 조회/EXE 추출: `outputs/busy-2026-10-15-*`. 원문은 커밋하지 않는다. gate helper와 CALC 정의를 읽고 스코프/부작용을 먼저 고정했다. 전산 원장 수량을 다시 확정·취소하거나 gate를 직접 초기화하지 않는다.

| 동작 | 주문·출고·날짜·농장·견적·매출·Product·StockHistory | StockMaster/ProductStock | 게이트 |
|---|---|---|---|
| 검사/대기 | 보존 | 보존 | 잠근 상태 읽기 |
| 완료되지 않은 동일 차수 CALC0 | 보존 | 기존 native 재계산 | native 인수/해제 |
| 실패/연결 종료 | 보존 | 해당 계산 트랜잭션 rollback | 진입 전 pending 복원 |
| RUN/불완전/연도범위오류 | 보존 | 보존 | 회수 금지 |

## 구현 기준
공통 core는 잠긴 WAIT_CALC만 처리한다. 연도2026이후, 정확한 세부차수, V2소유권/토큰/시간, capability/정확modulehash/6인자 검증. SQLGETDATE 기준60초 유예는 정상 호출의 기회이며 소유권 만료가 아니다. nativeCALC0 이전/이후 같은 연결·원래transaction표식과 반환값0두개·완전IDLE 확인 뒤 callercommit.

운영은 next start를 사용하므로 별도 PM2 서비스 nenova-stock-recovery가 명시 opt-in으로 독립 Node child를 15초마다 실행한다. Next 환경 파일을 로드하며 웹 프로세스에서는 중복 시작하지 않는다. child는 전용pool/transaction, 요청90초/프로세스120초 한도. 부모는 실제close 전 재실행하지 않는다. 프로세스 중단 시 물리 연결이 종료되어 rollback된다. nativeCALL/commit불확실은unknown이며 다음에 현재gate를 재조회한다.

기록은 `/var/lib/nenova/stock-recovery`에 남긴다. 같은gate token 실패는30/60/120/240/300초 간격,5회 이후 자동쓰기를 멈추고 경고한다. 새로운token은 별도예산이다. 시작기록 실패면 계산금지. 여러프로세스의 기존성공이 새pending예산을 지우지 않도록 fingerprint별 파일을 쓴다. status.json은 최근보고일 뿐 현재DB의 증거가 아니다.

## 검증
실제 격리 SQL: 동일범위 성공,IDLE/RUN보존,2025거부,다른현재차수정확처리,오류전체rollback,2worker경합1회계산,실제child강제종료후gate/sentinel복원과후속복구. fixture에서는 native업무본문을sentinel로바꾸고metadatahash만adapter에서맞춘다. 따라서 실제재고공식테스트라는주장은하지않는다.

실제운영40-02 native계산은 별도사용자승인하에완료했다. return/output0,46,851snapshot,보호12테이블건수/체크섬일치,신규/악화음수없음,새연결IDLE/PendingCalc0 확인. 체크섬은 완전한행동일성증명은아니다.

화면·메뉴 기준선: 해당 없음(백그라운드 복구만). 적용: 기존 입력·원장 보존, 성공/실패 구분, 감사 기록. 새UI/EXE설치/SP DDL/권한 변경 없음.
