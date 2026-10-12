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
