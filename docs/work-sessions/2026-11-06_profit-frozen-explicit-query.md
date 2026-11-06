# 주차별 손익: 과거 고정·전체 최신 원천·명시 조회

| 항목 | 내용 |
|---|---|
| 날짜 |2026-11-06|
| 화면 |/sales/profit-report, monthly/weeks/XLSX/print|
| 작업 |codex/profit-explicit-query-frozen-history, 기준 eb07b46c2|
| 부작용 |운영 SELECT only, DML/DDL/SP/계산본생성·갱신·백필0|
| 배포 |부모 PR/CI/배포 담당, 현재 미완료|

## 고정 결정

- 실제 PeriodDay 현재+직전만 최근창. 오늘45/44, 역사<=43. 예시 현재44라면43/44최근·<=42역사.
- 활성확정 whole CALC 우선, 모든 과거 물질화 저장 calc/totals 고정. 현재 원가 overlay금지. 표시 K만 기존승인 J/C, 0/null분모 공란.
- 최근 본표는 raw current/prior 전체SQL. 과거 취득원가 reference는 acquisition donor 전용. 조회중 ERP/인보이스 비용 source변경은 전체실패.
- 진입/URL/입력/전후/보기만으로 금융GET0, 조회만 실행. abort/seq/scope로 늦은응답폐기·stale출력잠금. 기존22열선택·수기비고 보존.
- 운영 DB 보정/계산본 생성하지 않는다. 누락·legacy는409 준비필요.

### 1. 과거 원가로 매번 바뀌는 손익

Q. 현재 원가를 과거 매출·이익에 섞지 말고 최근창은 전체 최신 자료로 보여 달라.

A. canonical loadWeeklyReportPayload 공유 정책을 추가하고 확정/역사 monetary overlay를 차단했다. 최근44 실제SQL 중국N44,964,933/VN N6,942,000 확인. 중국원가reference H/F는 유지하되 저장N45,989,638/VN0을 현재본표에 이식하지 않는다. 원본39/42/43/44JSON SHA256 전후동일. 실제dnSpyStock/Sales 재실행 및 int history index SELECT/CTE key4행 회귀 근거는 [기준표](../plans/profit-frozen-explicit-query-2026-11-06.md).

### 2. 자동 조회를 없애 달라

Q. 탭 진입이나 조건변경으로 보고서를 자동 조회하지 말고 연도·차수 선택 뒤 조회만 하라.

A. 카테고리/범위/월별/분석/원천시트 모두 명시 의도에 연결했다. 실제Chrome1920×1080 paced fixture PASS, 최초·선택 금융0, 늦은43응답이44를덮지않음, scope변경출력잠금. 가이드48.9초 ready. 하단현재재고notes는 명시보고서조회후별도참고GET을유지한다.

## 검증 및 미완료

대상5신규회귀, weeklycache, KCS/국가평균/53 carry/원가/기존출력대상검사 PASS. 새invoicefence 실제SELECT PASS. 첫 전체gate는 origin/master 갱신 통합을 위해 pretest 진행 중 소유 프로세스만 중단했다(완주 PASS 아님). 부모가 현재 변경을 커밋하고 master를 통합한 뒤 최종 gate를 다시 실행한다. 필수 전체gate·정식build/built UI/player·PR/CI/Cafe24·운영smoke는 진행중이며 완료아님. .verify/와실패중간영상은출력근거임의커밋금지. public/guides/profit-explicit-query의최종MP4/VTT/proof만배포.

검색어: frozen explicit query PeriodDay53 coherentLatest invoice fence 원본금액 고정 조회버튼
