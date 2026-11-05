# /pm 디자인 기준 — SOFT CLAY DESIGN SYSTEM (유일 기준 문서)

> **이 문서가 /pm 계열 디자인의 유일 기준이다. 생성 이미지를 새로 받지 말 것.**
> 기준 이미지(아래 2장)와 이 문서의 실측 토큰 값만 따른다. 2026-11-04 사장님 컨셉 확정.

**현재 기준 테마 = I(해변).** 테마 선택기는 I만 노출(`PM_THEMES_VISIBLE`), 신규 작업·검증 스크린샷은 I 기준. (2026-11-04 사장님 확정 — 나머지 테마는 숨김·보존)

## 적용 범위 (중요)

- **/pm 계열 전용**: `pages/pm.js`, `pages/pm/*`(radar 등), /pm 위젯·매뉴얼의 pm 컴포넌트.
- **네노바웹의 다른 업무 화면(주문·출고·견적·재고·수입 등)에는 절대 새지 않는다.**
  - 전역 CSS(`styles/globals.css` 등) 수정 금지. 전역 `.badge`/`.btn` 재정의 금지.
  - 색·모양은 전부 `.pm[data-theme]` 스코프의 토큰(`var(--pm-*)`, `--pmk-*`)과
    각 페이지 styled-jsx 스코프(예: `.radar :global(.badge)`) 안에서만 바꾼다.
  - 검증: `git diff` 에 `styles/globals.css` 없음 + 바뀐 선택자가 전부 `.pm `/페이지 스코프 접두 +
    `node __tests__/pmNoHexColor.test.js`(hex 0) · `__tests__/pmUiKit.test.js` 통과.

## 기준 이미지

| 파일 | 내용 | 원본 |
|---|---|---|
| [`/pm/design/design-system.jpg`](../public/pm/design/design-system.jpg) | SOFT CLAY 디자인 시스템(버튼 4종×상태 3종·칩/배지·탭·링크·카드 그림자) | 사장님 PC `C:\Users\USER\nenova-pm\github-radar\design\design-system.png` (2752×1536) |
| [`/pm/design/radar-ui-A.jpg`](../public/pm/design/radar-ui-A.jpg) | /pm/radar 기술 레이더 화면 시안(헤더·추천 큰 카드·그리드·사이드바) | 같은 폴더 `radar-ui-A.png` (2752×1536) |

Higgsfield 소품시트(별도 이미지 파일 없음 — 톤 설명): /pm 사무실·캐릭터 소품은 Higgsfield 류의
**말랑한 3D 클레이 아이콘 톤** — 무광 파스텔, 둥글린 모서리, 낮은 채도 + 부드러운 단일광 그림자,
외곽선 없음. 에셋은 가져오지 않고 Blender 프리미티브로 직접 렌더(원칙: `nenova-pm/character-v2/REFERENCES.md`).

## 실측 팔레트 (design-system.png)

| 역할 | hex | 쓰임 |
|---|---|---|
| 민트 | `#A0E0C5` | 주 버튼, 선택된 칩/탭, 보조 버튼 테두리, 해시태그 칩 |
| 민트 호버 | `#8FD7B7` | 주 버튼 호버 |
| 민트 눌림 | `#6FAE90` | 주 버튼 눌림 |
| 크림(면) | `#FFFDF5` | 보조 버튼·카드·헤더 표면 |
| 크림(바탕) | `#FFF8E7` | 페이지 배경 |
| 코랄 | `#FF9E8B` | 위험 버튼, 강조(99+ 배지, 링크 호버) |
| 코랄 호버/눌림 | `#F58A76` / `#C56F5E` | 위험 버튼 상태 |
| 노랑 | `#FFE085` | 별수 칩(★55k), 중간 점수 |
| 라벤더 | `#D5C2F1` | 점수 배지(7/10), 탭 변형 |
| 비활성 | `#E0E0E5` / 글자 `#9A9AA2` | 비활성 버튼(그림자 없음) |
| 잉크 | `#3B352C` | 본문 글자 |
| 뮤트 | `#8A8071` | 보조 글자 |
| 링크 | `#3F8E74` | 링크 텍스트(민트 밑줄), 호버 시 코랄 |

모서리: 버튼/칩/배지 완전 둥근(999px 계열), 카드 `18px`(+큰 카드 22px).
그림자(소프트 드롭): `0 6px 16px rgba(190,168,122,.25)` — 눌림 시 제거, 비활성 없음.

## 토큰이 곧 구현 (하드코딩 금지)

- hex 는 **`lib/pmThemes.js` 테마 B 한 곳에만** 둔다(`pmNoHexColor` CI가 검사). 위 표 값이 그대로 들어가 있다.
- 상태 토큰: `accentHover/accentDown`, `errHover/errDown`, `disBg/disInk` — 다른 테마(A·C~J)는 `color-mix` 자동 파생이라 각 테마 색감 유지.
- 버튼·칩·탭·배지는 **UI 키트(`components/pm/ui.js`)만** 사용(생 `button`/`span` 배지 금지, `pmUiKit`/`pmTechRadar` CI).
  - 버튼 상태 3종: 기본(그림자) → 호버(1px 들림·밝은 색) → 눌림(1px 내려앉음·어두운 색·그림자 제거). 비활성=회색 클레이.
  - 링크: 파란 밑줄 금지 — 민트 글자 + 반투명 민트 밑줄(`text-underline-offset: 3px`), 호버 시 코랄.
- 항목 칩 구성(radar): 분류 이모지 아이콘 · 저장소명 · ★별수 · 점수 배지(N/10)를 **각각 별 요소**로(한 덩어리 금지).

## 작업 절차

1. 이 문서와 기준 이미지 2장을 먼저 본다. 새 생성 이미지 요청 금지.
2. 색이 필요하면 테마 B 토큰에서 고르고, 없으면 테마 B에 토큰을 추가한다(다른 테마 파생 고려).
3. `node __tests__/pmNoHexColor.test.js`·`pmUiKit`·`pmTechRadar` 로컬 통과 후 PR, CI(next build 포함)로만 빌드 검증.
