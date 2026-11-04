# 네노바웹 업무 화면 디자인 기준 (레퍼런스 = 기존 화면 실측)

적용 범위: 주문·출고·분배·견적·재고·매출·재무·마스터·관리자 등 일반 업무 화면 (`pages/**`, `components/**`, `styles/**`).
`/pm` 게임 화면(클레이 파스텔, `docs/pm-design-standard.md`, 미머지 브랜치 feat/pm-clay-design-tokens)과는 **별개**다.

## 규칙 (새 화면·수정 시 반드시)

1. 색은 **전역 토큰(CSS 변수)** 으로만 쓴다. 임의 신규 hex 금지. 표에 없는 용도면 먼저 이 문서를 고친다.
2. 버튼·표·입력·탭·배지·모달·배너는 `styles/globals.css` + `styles/unified-ui.css`의 **기존 클래스**를 쓴다(`.btn`, `.tbl`, `.filter-*`, `.form-control`, `.tab-item`, `.badge-*`, `.modal*`, `.banner-*`). 인라인 `style` 버튼과 페이지 전용 `<style>` 색 정의 금지.
3. 생성형 이미지·시안은 기준이 아니다. 기준은 **실제 화면 + 이 문서**.
4. 엑셀형 고밀도(작은 글씨·좁은 간격)가 정체성이다. 카드형/큰 여백 스타일로 바꾸지 말 것.

근거: origin/master 5191ee2b 기준 pages/components 중 /pm·api·demo·dev·m 제외 363개 파일 실측.

## 1. 토큰 (사실상의 표준 = unified-ui.css 가 덮어쓴 현재값)

출처: `styles/globals.css`(원본), `styles/unified-ui.css`(`@media screen`에서 덮어씀 → **화면에 실제 적용되는 값**).

| 용도 | 변수 | 현재 hex |
|---|---|---|
| 페이지 배경 | --bg | #f4f6fa |
| 카드/표면 | --surface | #ffffff |
| 테두리(옅음/진함) | --border / --border2 | #d7e0eb / #b9c7d8 |
| 글자 주/보조/약 | --text1 / --text2 / --text3 | #243247 / #41536b / #5e7086 |
| 강조(파랑) | --blue (연한배경 --blue-bg, 선택행 --blue-sel) | #245bd7 (#edf3ff, #dfeaff) |
| 성공(초록) | --green / --green-bg | #167047 / #edf8f1 |
| 오류·위험(빨강) | --red / --red-bg | #b42332 / #fff0f2 |
| 경고(호박) | --amber / --amber-bg | #885b0b / #fff7e5 |
| 표 헤더/카드 헤더 | --header-bg | #edf2f8 |
| 표 짝수행 | --row-alt | #f7f9fc |
| 모서리 | --ui-radius | 6px |
| 기본 글꼴 | --ui-font | system-ui, 맑은 고딕 |
| 숫자 | `.num` (우측정렬, tabular-nums) | |

기본 글자 크기 12px(표·버튼·입력), 본문 13px, 작은 보조 11px, 제목 13~14px 굵게.

## 2. 컴포넌트 규격 (예시 코드)

| 요소 | 규격 | 예시 |
|---|---|---|
| 버튼 기본 `.btn` | 높이 24 / 좌우 10 / 12px / 흰 바탕·border2 테두리·모서리 6 | pages/master/customers.js, pages/finance/bank.js |
| 주요 `.btn-primary` | --blue 바탕 흰 글자 | pages/estimate.js |
| 성공 `.btn-success` / 위험 `.btn-danger` | --green / --red 바탕 흰 글자 | pages/shipment/distribute.js |
| 작은 `.btn-sm` | 높이 22 / 11px | 전반 |
| 표 `.tbl` | 12px, 헤더 --header-bg 굵게 sticky, 셀 padding 2×6, hover --blue-bg, 선택행 --blue-sel, 합계행 tfoot | pages/orders/index.js, pages/sales/status.js |
| 표 감싸기 `.table-wrap` | border2 테두리, 가로·세로 스크롤 | pages/stock.js |
| 필터줄 `.filter-bar` + `.filter-label/.filter-input/.filter-select` | 입력 높이 22, 12px, 모서리 5 | pages/shipment/distribute.js |
| 폼 `.form-control` | 높이 24, 12px | 전반 |
| 탭 `.tabs/.tab-item(.active)` | 활성=흰 바탕·파랑 글자·위 2px 파랑줄 | globals.css 57~60행 |
| 칩 `.chip-active/.chip-inactive` | 활성=--blue 바탕 | |
| 배지 `.badge-blue/green/red/amber/gray/purple` | 11px, 모서리 4 | |
| 알림줄 `.banner-info/ok/warn/err` | 상태별 연한 배경 + 같은 색 글자 | |
| 카드 `.card/.card-header/.card-title` | 헤더 --header-bg | |
| 모달 `.modal*` | 모서리 10, 헤더 흰색, 푸터 #f7f9fc, 뒷배경 반투명 | |
| 레이아웃 | 사이드바 200px 흰색(활성 항목 왼쪽 3px 파랑), 상단바 36px 흰색, 본문 padding 10 | components/Layout.js |

## 3. 실측 요약

- 사용된 클래스 빈도: `.btn` 535, `.num` 321, `.btn-sm` 229, `.btn-primary` 109, `.tbl` 91, `.filter-input` 88, `.form-control` 87, `.card` 80, `.btn-secondary` 65(정의 없음), `.btn-xs` 31(정의 없음), `.badge` 40, `.modal` 31.
- 글자 크기(인라인): 12px 917회, 11px 788, 13px 432, 10px 357. 모서리: 6px 288, 8px 275, 4px 210, 5px 113.
- hex 상위(전체 363파일): #fff 1168, #64748b 322, #cbd5e1 240, #e2e8f0 183, #b91c1c 166, #94a3b8 146, #f8fafc 140, #2e7d32 125, #475569 123, #1d4ed8 113, #1565c0 111, #166534 107.
- 토큰 변수는 82개 파일이 사용(--text3 428회, --border 158, --blue 153). 나머지는 hex 직접 사용.
- 버튼 유형: 기본/primary/success/danger/sm = 5종이 정식. 실제로는 인라인 스타일 버튼 485개, 클래스 버튼 532개 공존.

## 4. 불일치 목록 (통일 필요, 우선순위순)

| 순위 | 문제 | 실측 | 통일 방향 |
|---|---|---|---|
| P1 | **같은 의미 색이 여러 계열**. 빨강: #b91c1c(168) #c62828(99) #dc2626(70) #b42318(43) #cc0000(6) vs 토큰 #b42332(0회) | 빨강 5종, 초록 #166534/#2e7d32/#16a34a/#15803d/#006600, 파랑 #1d4ed8/#1565c0/#2563eb/#1976d2/#2457c5/#155bd7 | 오류=--red, 성공=--green, 강조=--blue 변수로 치환 |
| P1 | **인라인 스타일 버튼이 클래스 버튼과 공존**(485 vs 532). 바탕색 #fff·#f5f5f5·#2563eb·#16a34a·#0f766e·#2457c5·#1565c0 제각각 | 같은 "저장/조회"가 화면마다 다른 파랑 | `.btn`/`.btn-primary`로 교체 |
| P1 | **정의 없는 클래스** `.btn-secondary`(22개 파일 65회), `.btn-xs`(31회) | styles에 규칙 없음 | `.btn`(보조), `.btn-sm`으로 정리 또는 클래스 정식 정의 |
| P2 | **표를 직접 만든 화면 125개 파일**(`<table>`인데 `.tbl` 미사용) vs `.tbl` 사용 44개 | 헤더색·줄무늬·hover 제각각 | `.tbl` 적용 |
| P2 | **페이지 전용 팔레트**: pages/stats/china-order-download.js(--ink/--line #14243a 등), pages/work/drive.js(--sf/--ln/--ac #3b6cf6, 모서리 10) | 화면 안에서만 다른 파랑·회색 | 전역 토큰으로 이관 |
| P2 | **모서리 반경 혼재**: 4/5/6/8/10/12/20/999 | 6 중심이어야 하나 8도 275회 | 버튼·입력 5~6, 카드 6, 모달 10, 칩 999만 허용 |
| P3 | **회색 계열 2벌**: 슬레이트(#64748b #94a3b8 #475569 #334155, 약 700회) vs 토큰 --text3(#5e7086) / 옛 회색(#888 #999 #666 #555 #ccc) | 약한 글자색 6종 | 약한 글자=--text3, 테두리=--border/--border2 |
| P3 | **옛 윈도우 클래식 값 잔존**: globals.css 원본(#D4D0C8 헤더, #E0E0E0 버튼, 모서리 2px)이 unified-ui.css 덮어쓰기에 의존. `@media print`에서는 옛 값으로 보임 | | 의도(인쇄)면 유지, 아니면 globals 원본값을 현재값으로 갱신 |
| P3 | **글자 크기 잔가지**: 8·9·10·14·15·16·17·18·20 혼재(10px 357회, 9px 99회) | 9px 이하는 가독성 위험 | 10px 미만 금지, 표본문 12px 고정 |
| P3 | **Layout.js 인라인 색**(즐겨찾기 버튼 #d6a124/#fff4cc/#b8c5d4, 팝업 바 그라데이션 #000080→#1084d0) | 사이드바 정식 파랑과 다름 | 토큰화 |

## 5. 운영

- 새 화면/수정 PR은 위 규칙 1~2를 확인한다(신규 hex·인라인 버튼이 diff에 있으면 반려 사유).
- 토큰 값을 바꿀 때는 `styles/unified-ui.css` 한 곳에서만 바꾼다.
- 통일 작업(4번 표)은 화면 단위로 나눠 별도 PR로 진행한다. 이 문서는 분석·기준 고정만 다룬다.
