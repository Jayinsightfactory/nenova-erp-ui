# 주광 수량·요일 변경 확정 전환 검증

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-10-09 |
| 화면 | 주광 견적서 /estimate/weekday |
| 원장 | 대상 상세 확정·수량·날짜, Product/StockHistory, native 재계산, ShipmentHistory, touched master |
| 배포 | 최종 결과 아래 기록 |
| 다음 채팅 | 이 문서와 docs/plans/weekday-confirmation-lifecycle-2026-10-09.md 읽기 |

## 고정 결정
- 확정 수량변경은 확정취소→수량저장→재확정; 요일만 이동은 확정유지.
- 미확정 수량만 변경은 미확정유지; 요일 이동은 확정 후 이동, 복합변경은 수량먼저.
- 같은 업체·품목의 세부차수 이동을 요청 전체에서 판단한다. preview/server 공통 분류기 사용.
- 재고소비증감은 최종확정×신규량−기존확정×기존량. 기존음수재고를 개선하는 감소·소비0 이동은 새부족으로 오판하지 않는다.
- 다른 업체·품목·전년도 상세를 확정하지 않는다. 선택요일 출력은 해당업체/날짜의 실제확정 전체품목을 검사하고 초안을 제외한다.
- 선출고 내부저장 호출은 trusted opt-in을 주지 않아 기존정책보존. 외부본문만으로 lifecycle을 켜지 못한다.

### 1. 확정 처리 요청
**Q.** 네 가지 확정 규칙을 적용하고 dnSpy, 로그, 페이지, 견적연결, 요일별 인쇄까지 확인.
**A.** 설치 EXE dnSpy 재추출 및 운영 SELECT-only schema/SP/downstream preflight 후 설계·계약을 먼저 작성했다. native 전체품종 확정SP는 범위가 넓어 직접호출하지 않고 exactdetail 전환과 nativeStockCalculation을 같은 transaction에서 실행한다. 확정 시 native날짜이력 대조까지 포함한다. 성공감사에 확정전후·처리단계·소비량·재고반환/차감 저장, 실패에는 단계와 rollback상태를 구조화로그로 남긴다.

### 2. 검증과 제한
**A.** 격리 MSSQL 실제코어에서 네가지규칙·복합·0삭제·세부차수이동·가격불일치·현재/후속연도부족·각단계rollback·UUID재시도·다른업체/전년도sentinel·mixedmaster·실제EXE견적SQL/HTML을 검증한다. 운영 ERP 테스트쓰기는 하지 않는다.
**브라우저.** Codex Chrome 연결에 성공해 열린 구버전 화면에서 다른업체미확정 때문에 주광요일버튼까지막힌 것을 확인했다. 1920×1080 기준으로 최신화면 새로고침 시 세션만료 로그인으로 이동해 사용자에게 로그인을 요청했다. 로그인전 배포후개별조작 완료로 주장하지 않는다.
**제한.** 복수날짜단가가 섞인 복합이동에서 확정전량배분이 모호하면 전체를 차단한다. 전체견적 대차수검사는 유지하고 선택요일만 실제선택범위로 판정한다.

## 완료 검증·배포 결과
최종 검사와 배포 결과는 작업 종료 전에 갱신한다. ignored output/early-shipment-integration raw EXE/DB추출물과 output/weekday-confirmation-*.log는 커밋하지 않는다. 비밀값·운영원본자료는 문서에 포함하지 않는다.

최종 로컬 검증: test:erp-contract(전체 UI/주광/선출고 회귀 포함), test:nenova-dnspy-evidence, test:erp-manifest --changed-from origin/master, guard:erp-writes --changed-from origin/master, npm run build 모두 exit0. 기존 weekday-distribution/adversarial 실제SQL suite와 새 lifecycle SQL의 25개 시나리오 통과. 새 이력대조 반영 후 lifecycle 25개와 전체계약/빌드를 다시 통과했다.
운영 SELECT-only 추가 스키마 확인: ShipmentHistory PK는 ShipHistoryKey(int IDENTITY), 날짜이력대조는 환경별 PK명을 추정하지 않고 exacttimestamp/native ChangeDtm 기준을 사용한다.
Chrome 로그인은 기존 검증계정 정상로그인으로 해결했다. 배포후 최신 UI 조작은 아래에 추가 기록한다.

2026-10-09 배포: PR #1009, master b436065305d04367dd4fb7def4ff5ebaeea4fc33. CI 37910430999 / Cafe24 37910647884 성공. Chrome 최신 SHA 확인, 40차 10/04 일요일 실제 확정 견적 1문서·74행 미리보기 확인. 운영 ERP 변경 없이 검증했다. 41차 10/11 미확정 포함 요청은 409 차단 확인.
추가 UI 검토에서 적용확인·인쇄창 키보드 초점경계/복귀를 보완했다. 저장 중 Escape는 닫지 않고, 인쇄 iframe 내부 Escape/Tab도 모달로 연결한다. 행동 테스트와 ERP 계약에 포함한다. 최초 전체 검사 중 기존 carryover cross-process 경합 테스트가 1회 실패했으며 단독 재실행은 10/10 통과; 부하 없는 전체 재검사 결과를 확인 후 배포한다.
전체 ERP 계약 재검사 exit0. dnSpy evidence/manifest/write guard/build 모두 exit0. 기존 경합 테스트 단독 및 전체 재검사 통과를 확인했다.

## 최종 완료 (2026-10-09)
- 본 기능 PR #1009 / master b4360653, 키보드 보완 PR #1010 / master 368faf990988bb1649c61fbb0988c3a3684709fc.
- PR1010 CI 37912095139 재실행 성공. 최초 실패는 unrelated importChecklistEditing Chromium WS endpoint 30초 시작 timeout; 검사 수정/생략 없이 동일 실패 job 재실행 성공.
- Cafe24 37912537543 전체 성공: ERP+교차연도 guard, SSH deploy, 실제브라우저 hydration smoke.
- Codex Chrome 1920×1080/100%, 최신 SHA 368faf99 확인. 고정40차 Brut 10/04 3→4 초안 preview에 확정→확정/확정취소→수량저장→확정 표시; 사유입력 초기초점, Shift+Tab/Tab 경계순환, Escape 닫기 및 ERP버튼복귀 확인. ERP 적용 최종버튼은 누르지 않음.
- 입력 직후 이월확인 보조패널과 선택칸내역이 배경에 열린 상태에서도 적용모달의 초점 경계를 유지하고 Escape 복귀 확인. 이 배경 보조패널은 기존 UI 동작이다.
- 40차 10/04 일요일 실제확정견적 1문서/74행. 인쇄창 닫기 초기초점→Tab iframe→Escape 닫기→해당요일출력버튼복귀 통과. 견적서 출력 버튼의 window.print 호출 후 CDP input 응답이 대기되어 페이지 reload로 복귀했으며, OS 인쇄대화상자 내용/물리출력 완료는 주장하지 않는다.
- SELECT-only HTTP smoke: 40차 10/04 200/74행; 41차10/11 실제미확정 포함은409 차단. 다른업체미확정은 선택업체요일인쇄를 막지않음.
- 세로통합 확인: viewport1920×1080, documentHeight7237, table clientHeight=scrollHeight6701; 가로 client1874/scroll2643, 위·아래 가로바유지. 모달이 기준화면 안에 위치, 호출버튼/사유/인쇄버튼 확인. Chrome error logs [].
- 검증용 미적용 입력 삭제후0건 확인. 운영ERP 테스트쓰기는 없음. MSSQL fixture named container nenova-estimate-sql-test-20260826 종료.
- 잔여 제한: 모호한 복수단가 날짜이동은 저장 전 차단; 실제선택일 미확정은 인쇄차단. 운영사용자의 실제수량변경 트랜잭션은 격리실제SQL로 검증했고 운영데이터를 임의변경하지 않음.
