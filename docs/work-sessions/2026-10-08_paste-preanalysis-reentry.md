# 붙여넣기 사전 분석 재진입 복원

| 항목 | 내용 |
|---|---|
| 기간 | 2026-10-08 |
| 화면 | /orders/paste 원문 사전 매칭 |
| 원장 부작용 | 기존 authenticated lookupOnly 사용; API/SQL/ERP 저장 변경 없음 |
| 배포/PR | codex/paste-analysis-restore → master → Cafe24 자동 배포 |
| 다음 채팅 | 이 기록과 paste-inbox-preanalysis 계약, 해당 PR 확인 |

## 이어받을 때 고정된 결정
- 로그인 사용자 + 정확한 원문 + 전체 연도/차수 저장 키 유지. 분석과 적용 완료 근거는 별개다.
- 저장본은 마운트 시 읽기 전용 복원. 자동 분석/화면 노출/저장 상태로 복원을 차단하지 않는다.
- 저장본 없는 원문만 실제 viewport 근처에서 순차 분석한다. 저장본 확인/분석 대기/실제 분석 중 구분.
- 재분석 중과 실패 뒤에도 기존 성공 결과를 연다. 원장 저장은 기존 명시적 검토 흐름 유지.

### 1. 계속 분석 중으로 표시되는 문제
**Q.** 붙여넣기 주문등록이 계속 분석 중임. 한번 분석되면 재진입 시 바로 적용할 수 있어야 함.

**A.** 운영 read-only 진단:169개 카드 중 저장본73건/미저장96건. 신규 모델 호출을 가로채 진단 중 추가 분석/ERP 저장 없음. IntersectionObserver가 전체 길이 목록을 root로 삼아 화면 밖까지 분석 대상으로 표시했다. 저장본 조회를 별도 hydration으로 분리하고 root를 실제 viewport(null)로 변경. 대기열과 실행 중 구분, 재분석 실패 시 이전 결과 유지.

**검증.** cache/store 회귀와 실제 컴포넌트 React hooks의 Chrome smoke(1920×1080 CSS/100%): 화면 밖 저장본 복원, 화면 밖 신규 분석0회, 대기/실행 구분, Enter/Space, Tab/Shift+Tab, 재분석 실패 보존, 재진입 모델 재호출0회, ERP 쓰기0회. 전체 ERP 계약/dnSpy/manifest/write guard/build는 배포 전 필수 게이트.

**결과.** DistributionMessagePreanalysis.js, pasteInboxPreanalysis.js, pasteInboxPreanalysis.test.js, paste-preanalysis-reentry-smoke.cjs, paste-inbox-preanalysis.json.

## 미완 / 다음 후보
- 배포 결과는 연결 PR/Cafe24 Actions 실행 확인.
- 미래 savedAt을 거절하는 기존 시계 정책은 변경하지 않음.
- 임시 운영 probe/dev 산출물은 커밋하지 않음.
