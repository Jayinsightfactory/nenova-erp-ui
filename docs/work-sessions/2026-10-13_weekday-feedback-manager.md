# 주광 입력·저장 확인과 담당자 오류 (2026-10-13)

| 항목 | 내용 |
|---|---|
| 화면 | 주광 견적서 / estimate/weekday |
| 원장 | 기존 주문 Manager 보존, 신규 주문은 인증된 활성 UserID 사용. 기존 분배·확정·재고·견적 계약 유지 |
| 검증 | 실제 dnSpy CLI, 운영 SELECT-only, 격리 MSSQL 저장/롤백/동시잠금, 계약 검사 |
| 배포 | 검증 후 PR 및 Cafe24 결과 추가 |

## 고정 결정
- 거래처 Customer.Manager 표시이름을 UserInfo.UserID로 추측하지 않는다.
- 기존 OrderMaster 재사용 시 native ViewOrder와 동일하게 UserID 조인, 신규는 native GetUserInfo(false)의 isDeleted=0 기준.
- BUSY 소유자 잠금 강제 해제 금지. 저장 전 명시적 잠금에만 기존 동일 UUID 제한 재시도 유지.
- 페이지 세로 스크롤과 표 가로바 유지. 차수·요일 헤더를 페이지 스크롤에 따라 고정한다.
- 입력 알림은 작게, 수동 상세만 열기. 저장 결과는 영속 UUID와 실제 날짜별 감사 전후값을 GET으로 대조한다.

### 1. 입력칸 가림·헤더·이력
**Q.** 알림이 입력을 가리며, 차수/요일행을 고정하고 적용 후 로그·출고일 변경을 볼 수 있어야 한다.
**A.** 자동 상세창 열기를 제거하고 420px 수동 상세로 축소. 같은 React 헤더의 측정 복제본을 가로스크롤과 동기화하고 원본은 복제 시 inert 처리. 저장 후 실제 영속 작업과 날짜별 감사를 대조하는 inline 결과를 추가했다. 최신값은 저장시점과 별도 비교한다.

### 2. UserInfo 및 BUSY
**Q.** 신규 주문 담당자 활성 계정 오류와 이전 BUSY가 재발하지 않게 해달라.
**A.** dnSpy FormOrderAdd 로그인ID 기본값과 CommonLogic GetUserInfo(false)를 재추출했다. 운영 조회에서 Customer.Manager는 이름이고 기존 OrderMaster.Manager는 정상 UserID임을 확인했다. 기존 Master 담당자 보존/신규 로그인ID 검증으로 수정했다. 실제 격리 SQL에서 기존/신규 Master 추가, 비활성 신규계정 전체롤백·잠금해제, 다른 계산 점유 중 저장전 BUSY→해제 후 같은 UUID 성공을 검증했다.
**결과.** 전체 lifecycle SQL PASS. 운영 gate는 조회시 idle/pending0/owner없음. native CALC SHA256 `24A415FA16E5FD4FCF2A1B342CC05B3E081142E9BD358AB11F010836907A7EDD` 확인; 이번 작업에서 SP/운영원장 수정 없음.

## 검증·한계
- 전체 test:erp-contract 통과(내부 dnSpy evidence 포함), 최종 receipt21tests와 build 통과, changed-from origin/master manifest 및 write guard 통과.
- 오래된 감사가 최근500건 범위를 벗어나면 조회범위 초과로 안내. 재저장하지 않는다.
- 실제 동시 계산 중 일시 대기는 정상 보호 동작이며 모든 BUSY를 제거하지 않는다.
- 브라우저1920×1080 검증은 배포 후 수행. 현재 연결 Chrome은 로그인 필요; 사용자는 웹앱에서 작업했다고 설명했다.
- output/ 하위 SQL probe·추출 원문·테스트 로그는 로컬 ignored. 계정/비밀 원문 커밋 금지.
