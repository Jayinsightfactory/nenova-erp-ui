# 주광 세부차수 저장 위치 수정 — 2026-10-12

| 항목 | 기록 |
|---|---|
| 화면 | 주광 견적서 `/estimate/weekday` |
| 브랜치 | codex/weekday-subweek-placement-fix |
| 운영 쓰기 | Brut 보정 완료 및 새 연결 원장/견적 parity 검증 PASS |
| 관련 별도 사건 | EXE BUSY는 별도 수동 복구 기록 참조 |

## 고정 결정

- 사용자 의도는 Brut 2026/41-01 일요일4박스, 41-02 10/13(화요일)2박스다.
- 기존 코드에서 달력41-02열의 실제41-01행을 편집하면 실제41-01로 저장하는 경로를 확인했다. 당시 입력 요청 로그를 확보한 것은 아니므로 특정 과거 클릭의 인과관계는 단정하지 않는다.
- 불일치는 일반입력/제출에서 차단하고, 명시적 차수 정정으로 source0/target수량의 두 초안을 만든다. preview와 저장은 양쪽 전체 snapshot을 검증한다.
- 기존 ALLOCATION 원자 저장·확정 lifecycle·가격·재고·UUID 정책을 유지한다. 정정 초안 저장/복원, 두 초안 함께 취소를 지원한다.

## Q&A

### 저장된 원인과 해결을 요청
**Q.** 원한 위치와 실제 저장 위치가 달라진 원인을 찾고 해결해 달라.

**A.** 수평 표의 날짜별 달력차수와 effectiveOrderWeek(실제 업무차수)가 달랐다. 일반 입력을 막고 실제/달력 차수를 안내하며 명시적 정정 경로를 추가했다. 코드·계약과 실제 SQL/브라우저 검증을 수행했다.

### 실제 자료 정정
초기 SELECT는 41-01 확정6(10/11 4,10/13 2),41-02 없음이었다. 단가10500, 박스→단15배, 양쪽 활성 주문5/3은 보존 대상이다. 이후 재조회에서 41-02 10/12 확정3이 새로 생겨 기존 보정 스크립트의 target없음 조건이 더 이상 맞지 않는다. 사용자가 41-02 최종2박스의 출고일을 10/13(화)로 명시했다. 최신 41-02 월요일3을0으로, 화요일을2로 바꾸며 source 화요일2를0으로 하는 단일 원자 보정을 준비했다. 확정 합계9→6, Product.Stock +3, 활성 주문5/3 보존을 검증한다.

## 검증

- test:weekday-distribution, 전체 ERP 계약, dnSpy evidence, manifest, write guard 및 production build 통과. 초안 보존 gap을 최종 리뷰에서 발견하여 strict storage roundtrip을 추가하고 재빌드했다.
- 실제 Docker MSSQL: 같은 날짜37-01→37-02, source25→23/target2, 기존 날짜/단가/gross/주문/타 업체/2025 보존, UUID replay, target 생성/확정 실패 rollback 통과.
- 실제 로컬 Chrome 1920×1080 및800×1080 CSS/100%: 불일치 입력차단, 명시 정정, paired preview, Tab/Space/Escape, 취소 및 원본 보존 통과. 모든 API를 fixture로 가로채 운영 저장 요청0건.
- 메뉴 기준: 공간/키보드/최종값 preview/실패안내 적용, 일반 페이지 shell 변경 해당 없음, 표 가로스크롤은 기존 넓은 표 예외 유지.
- 로컬 probe·복구 script와 스크린샷은 ignored/untracked outputs에 보관; 비밀값/운영 원문은 커밋하지 않는다.

## 배포/다음

PR/master/Cafe24 결과를 후속 기록한다. Brut 운영 보정은 배포 성공 후 최신 원장을 다시 대조하고 수행한다.

추가 검증: 기존 target 월요일3 → 화요일2와 source legacy 화요일2 제거를 함께 적용하는 실제 SQL fixture PASS. 전체 ERP 계약·빌드 최종 PASS. stock gate 소유권 실제 SQL 29개 검사 PASS.

## 최종 배포와 실제 보정

- PR #1028 병합: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1028
- master `7c3193f2811bcd3430c846933257760df767cc1c`, Cafe24 run `38222836288` success. 운영 weekday bundle의 차수 정정/정정 취소 표시 및 Chrome 로그인 hydration PASS (`build-1791793380113`).
- 최초 보정 실행은 사전 snapshot에서 같은 transaction에 병렬 SELECT를 보내 EREQINPROG로 저장 진입 전 실패했다. 해당 유지보수 프로세스만 종료하고 연결을 정리했다. 조회를 순차 처리하도록 고친 뒤 원래6/3 및 날짜가 그대로임을 재조회했다. 제품 저장 API 변경 없음.
- 사용자 확인대로 operation UUID `a3e523a4-dd97-4a35-823a-912bb7c31ed9`, 실제 서비스 actor `codex-maintenance`로 정상 ALLOCATION core를 단일 transaction 실행·commit.
- 최종 2026/41-01/533/359: 10/11(일)4박스, 41-02: 10/13(화)2박스, 양쪽 상세확정 유지. source 화요일2와 target 월요일3 제거.
- 출고 확정 합계9→6, Product.Stock +3, 견적 gross1,417,500→945,000. 기존 활성 주문5/3, 농장, Estimate, WebProfitReport, 전년도·타 업체 보존을 transaction 안에서 검사. 미래 ProductStock 음수 없음.
- 별도 새 연결 ViewOrder 5/3, ViewShipment DetailFix1 및 native ViewOrder+ShipmentDate+PeriodDay join으로 일요일4/화요일2, 견적단위60/30, 단가10500과 gross945000 검증 PASS. 최종 gate IDLE/PendingCalc0, capability ready.
- EXE 화면에서 직접 확정취소를 누른 검증은 수행하지 않았다. native DB 실행·조회 parity를 확인한 결과다.
