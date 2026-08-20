# 작업 완료 보고 — 호텔+미우 게시판 너비·품목매칭 유지

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 |
| 사용자 요청 | 페이지를 더 넓게, 왼쪽 붙여넣기/텍스트는 좁게. 품목매칭 한 번 하면 다음에 남아 있게. |
| 브랜치 | feat/hotel-miu-layout-match |
| 커밋 | (검증 후) |
| 배포 | (검증 후) |

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor 직접** | 원인 확인, 레이아웃·overlay 재적용, 테스트, PR/배포 | — |

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 페이지 `maxWidth: 1180` + `1fr 1fr` 그리드. 텍스트 파싱에도 이미지용 `matchName`이 붙어 저장 매칭이 버려지거나 다른 후보로 밀림.
2. **구현** — 왼쪽 좁은 칸, 텍스트는 matchName 없음, `applyBoardOverlay`로 게시판 매칭 재적용, 합산 저장 시 overlay upsert.
3. **검증** — `node __tests__/hotelMiuIntake.test.js`, UI layout, ERP write guard, build.

## 변경 요약

| 파일 | 내용 |
|------|------|
| `pages/sales/shilla-miu-board.js` | 1680px, 왼쪽 280px, 로컬 overlay 재적용 |
| `lib/hotelMiuIntake.js` | `applyBoardOverlay`, 텍스트는 matchName 생략 |
| `pages/api/sales/hotel-miu-parse.js` | 이미지에만 matchName, overlay 재적용 |
| `pages/api/sales/hotel-miu-intake.js` | 합산 저장 시 매칭 upsert |

## 사용자 확인 포인트

- 새로고침 후 매칭 열이 더 넓고, 왼쪽 붙여넣기 칸이 좁은지
- `카네이션(화이트)`를 한 번 고른 뒤 같은 엑셀을 다시 붙이면 초록 칩이 바로 나오는지
