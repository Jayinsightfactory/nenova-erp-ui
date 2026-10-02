# 주광 확정 표시·수량 가독성 후속 수정

## 메타데이터

- 날짜: 2026-10-02, Asia/Seoul
- 작업: 주광 요일표의 전체 미확인 오표시와 숫자·선택 칸 내역 크기 보완
- 작업 ID: 019f5032-9276-72a2-8709-29b719c67702 (현재 작업 컨텍스트)
- workspace: C:/Users/USER/Documents/Codex/2026-07-11/new-chat/work/jugwang-weekday-test-deploy
- branch: codex/weekday-confirmation-display-fix; 시작 origin/master e857b2af
- 상태: 로컬 브라우저·필수 게이트·최종 검토 완료, PR·배포·운영 확인 진행 중

## 질문 → 답변·조치

1. 수량을 셀 중앙에 놓고 글씨 크기를 조절해 달라.
   - 숫자/입력/최초분배/최초값/잔량/합계를 중앙 18px·700으로 조정했다.
   - 실제 computed style 검사에서 부모/특정 잔량 규칙의 16px 우선순위가 발견되어 보완했다.
2. 선택 칸 내역을 더 크게 보여 달라.
   - 선택 칸·요약 내역 팝오버 폭 최대760px, 본문18px, 제목20px.
   - 작은 화면에서는 viewport에 맞게 축소하고 내부 세로 스크롤을 유지한다.
3. 첨부 화면의 품종별 확정이 전부 미확인으로 나온다.
   - 기존 구현이 저장된 isFix와 별개의 연결 경고를 UnknownCount로 합쳐 상태를 UNKNOWN으로 덮었다.
   - 실제 EXE GetFixStatus는 ViewShipment.DetailFix=1의 건수로 확정을 판단한다.
   - 알려진 CountryFlower는 저장 플래그로 확정/부분확정/미확정을 판정하고 연결경고를 함께 표시한다.
   - 품종 자체를 식별할 수 없는 경우·조회 실패·응답 모순은 미확인 유지.

## 근거와 데이터 계약

- 실제 dnSpy.Console FormShipmentDistribution 실행 로그: output/confirmation-fix-dnspy.log
- 실제 EXE: C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe
- 인증된 운영 API 읽기: output/confirmation-fix-before.log
- 39차 표본: total998/fixed998/기존 진단606인데 UNKNOWN이었다.
- 40차 재조회 표본: total1121/fixed362/진단333. 운영 사용자 변경으로 표본 건수는 변동한다.
- 기존 SELECT/OrderYear+대차수 전체 세부차수·전체 거래처·양수 상세 범위는 변경하지 않는다.
- warningCount: 기존 SQL UnknownCount 연결 진단; unknownCount: 품종 식별 불명 건수.
- 확정·연결경고는 저장 가능/재고 마감/견적 완전성 보증이 아니다. ERP 보정은 수행하지 않는다.
- 저장/인쇄 SQL·payload·확정 SP·수량 환산·최초 기준·이월 기록은 변경하지 않는다.

## 역할·검증

- main: dnSpy/API 사전 읽기, 데이터 계약/순수 helper/API, 통합 브라우저, 외부 쓰기·배포 담당.
- Noether: gpt-6-sol/high IMPLEMENTER (중간 비용 모델 대체), component/SSR만 편집.
- Franklin: gpt-5.6-sol/xhigh READ-ONLY 최종 ERP 검토.
- Arendt: gpt-6-luna/high QA, 필수 게이트와 빌드만 담당.
- 하위 작업 모두 P0_LOCAL, 운영 쓰기·권한·병합·배포 금지.
- 순수 helper/API 및 SSR 인접 테스트 통과.
- fixture50품목 실브라우저 1920×1080/100%,1280×800, 선택 내역800×800 통과.
- 숫자18px·중앙·700, 모든 숫자 part가 td 내부, 상하 가로 스크롤 동기화,
  헤더 품종 배지 줄바꿈, fixed+warning 분리, 팝오버760/18px, 겹침·가로 이탈 없음.
- 이월 fixture 검증도 1920×1080/1280×800 통과. 실제 원장은 쓰지 않는다.
- 결과 로그: output/confirmation-fix-readability.log, output/confirmation-fix-browser.log
- 스크린샷: output/weekday-readability/, output/weekday-carryover/

## 미완료·기존 한계

- test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest,
  guard:erp-writes, 별도 dist production build, diff check 모두 exit0.
- 최종 READ-ONLY 리뷰: P1/P2 0건. PR/병합/배포·운영 읽기 확인은 완료 후 추기한다.
- PR854의 첫 CI는 마지막 CSS 보완 뒤에도16px을 기대하던 weekdayHorizontalMatrix
  화면 테스트에서 실패했다. 로컬 전체 게이트는 보완 전 일부 CSS 기대값으로 통과한 결과였으므로,
  해당 기대값을18px으로 갱신하고 최종 전체 게이트와 CI를 다시 수행한다. 실패를 건너뛰어 병합하지 않는다.
- 기존 연결 경고 원인별 데이터 보정은 이 작업 범위가 아니다.
- 기존 부분확정 인쇄 누락 및 날짜 변경 시 ShipmentDtm 대표 날짜 차이 위험은 별도 검토 대상.
  이 표시 수정으로 완전한 EXE 저장·인쇄 호환성을 검증했다고 주장하지 않는다.

## 새 컨텍스트 계속하기

이 파일과 docs/plans/weekday-confirmation-display-fix-2026-10-02.md를 먼저 읽는다.
저장 isFix 표시와 연결 경고를 분리한 주광 UI 수정이며 운영 원장을 보정하지 않는다.
필수 게이트/PR/배포 결과와 운영 read-only 확인 기록을 확인하고 남은 단계만 수행한다.
확정 배지를 저장/재고/인쇄 eligibility로 재사용하거나 기왕의 원장을 변경하지 않는다.
