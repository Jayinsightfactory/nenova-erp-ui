# 이카운트 PC 반복 조회 감소

| 항목 | 내용 |
|---|---|
| 기간 | 2026-11-02 14:20~ 진행 중 |
| 화면 | 거래처관리대장1(채권), owner-PC 수집기 |
| 공유 원장 | 쓰기 없음; 기존 shadow snapshot/계산 보존 |
| PR/배포 | 후속 결과 기록 |
| 다음 힌트 | docs/plans/ecount-read-reduction-2026-11-02.md |

## 고정 결정
- ECOUNT 조회 전용, 전표 생성/저장 없음. 수금/원본잔액/은행 중복차감 가드 불변.
- legacy6종 매시간/부팅즉시 대신 평일08/11/14. 같은 dueSlot helper, 원자 체크포인트, source serial queue.
- sanitized PENDING after를 동일기간·세션/<90초일 때 다음before로 재사용. after항상새조회. 기존5분 bracket 불변.
- accepted LINK_CHECK_REQUIRED만 같은KST날짜 보류, sourceCode/lookupName/query 최종SHA256만 저장. 기술실패/변경/수동/명시복구는재시도.
- 생략을 새상세수집으로 표시하지 않는다. 기존 검증본/실제원본시각 유지.
- 전체변경감지로 상세를 생략하는 E040723 요약 모드는 로그인 화면 근거 미확정이므로 이번 안전 배포에서 제외.

### 1. 14:20 — 반복 이카운트 작업 감소
**Q.** 입금 변경이 없는데 PC에서 이카운트를 계속 반복 조회하니 횟수를 줄여 달라.
**A.** 원인: 거래처별 PENDING은행 전후2회(각2개월) + 별도6종 매시간 + 동일연결실패 반복. 수집기/확인된launcher 2개PID만 일시중단하고 커서/코드를 보존. 최신origin/master 별도worktree에서 readReuse 공통 helper와 실제dispatcher 회귀 작성.
**결과.** 대상60검사PASS. 실제dnSpy ClassCustomer exit0, Customer/기존snapshot SELECT-only probe. 원장SQL/세션값/자격증명 변경·기록 없음.

### 2. 14:46 — 기존 결과 보존과 운영 설치 준비
**Q.** 기존 확인 자료는 유지하며 반복 횟수를 줄여야 한다.
**A.** 운영 최신기록은 canonical117=GREEN76+동일식별연결실패41, 전부오늘조회시도 완료. 수집adapter/승인매핑이 현재runtime과동일함을hash/코드 대조. 연결실패41의 안전한당일보류 seed 준비. 이미완료한전체반복커서는 두거래처 canary로만대체예정. 은행snapshot재사용이 실제적용되는지 원본 before/after시각으로 대조예정.
**결과.** 전체ERP/빌드/CI/배포/운영설치는 아직 진행 중. 미검증 결과를 완료로 기록하지 않음.

## 미완 및 로컬 전용
- 동일관계기준 전체요약 화면의 모드/기간/필터/소계/전체합계 확인 후 ‘변동 거래처만 상세’ 단계 가능. 사용자에게 로그인 요청한 상태. 기존 탭 로그인만료, 새 탭도 로그인화면.
- .change-index-wip.patch/.change-index-wip.cjs/.ledger-change-index-wip.mjs는 미검증 초안, 배포/커밋 금지.
- .install-read-reduction.cjs/.change-probe.cjs/.pause-backup.txt/.runtime-* 및 로그는 로컬 운영 보조, 커밋 제외. 자격증명은 기존환경을메모리에서만읽음.

### 3. 14:52 — 로컬 배포 게이트
**A.** 대상60·전체ERP계약(후처리포함)·dnSpy근거·manifest178·ERP쓰기(변경API0)·webpack build 모두 exit0. CI/배포/runtime/실브라우저는 다음단계.

### 4. 15:02 — 재가동 로그인 감지 보완
**A.** 재가동 CFT 로그인 화면과 기존isSourceLoginUrl의 불일치 확인. 실제logincc/ec56/view/login/erp_login도 auth로인식, 정확한ERP경로만base허용. networkidle시작대기 대신15/30초DOM, 브라우저180초, 고정시작단계로그. URL/자격증명입력값 미기록. 대상62 PASS. 초기카나리는시작대기상태에서중단했으며 성공으로집계하지않음; 신규카나리재개예정.
