# 임원 모바일 월별 보기

| 항목 | 내용 |
|---|---|
| 세션 | 2026-09-30 executive-monthly-view |
| 화면 | /m/executive?demo=weekly |
| 원장 부작용 | 없음, 예시 fixture 및 기존 순수 집계 함수만 사용 |
| 배포 | codex/executive-monthly-view PR 참조 |

## 고정 결정

- 파일 목록을 유지하고 월별 보기 버튼으로 전환한다.
- 기존 웹 pages/sales/profit-report.js의 월별 관리손익 항목을 따른다.
- lib/profitReportMonthly.js를 수정 없이 재사용한다. 종료일의 월에 한 번 귀속한다.
- 공개 예시는 가상 38/39차만 사용한다. 실제 데이터/비밀번호 연결은 아직 별도 범위다.

### 1. 월별 웹 화면

**Q.** 거기에 월별도 웹에 기능 들어가 있는 식으로 볼 수 있는 페이지가 있어야 한다.

**A.** 연도·월 필터, 월별 매출/원가/이익/이익률, 차수 펼치기와 주차 보고서 열기를 추가했다. 요약 카드는 추가하지 않았다.

**검증.** 기존 웹 집계 함수 기반 합계, 연도 분리, 월경계 차수, 자료 없는 월, fixture 변경 격리 테스트.

브라우저 320×740, 390×844, 1920×1080에서 페이지 가로 넘침 없음. 월→38차 보기→복귀 시 선택 월과 확장 상태 유지, 2025년 자료 없음, 파일 목록 복귀 확인. 모바일 만원/PC 원 단위를 명시했고 계산 원본은 보존한다. test:executive-mobile-ui, test:ui-layout, test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest, guard:erp-writes, build 통과.

## 미완 / 보존

- 실제 비밀번호/보고서 게시 연동은 구현하지 않았다.
- .tmp와 이전 작업의 변경 기록은 커밋 제외.
