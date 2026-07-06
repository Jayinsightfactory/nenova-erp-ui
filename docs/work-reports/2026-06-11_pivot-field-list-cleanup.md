# 작업 완료 보고 — Pivot Field List UI 정리 + DnD 수정

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-06-11 |
| 커밋 | `637c8ff` |
| 배포 | GH Actions (push 후) |

## AI 구성

| 담당 | 역할 |
|------|------|
| **Cursor** | 버그 분석·수정·commit·push (UI 2파일) |

## 변경 요약

1. **DnD 버그 수정** — `dataTransfer`로 필드 id/from 전달 (React state 타이밍 이슈)
2. **상단 중복 버튼 제거** — 지역/단가/구분/그룹순서 → 🗂 필드 목록으로 통합
3. **그룹순서** — Field List 내 `02.주문 그룹순서` (▦ 상세 모드)
4. **구분** — Field List 내 버튼 + 하단바 칩
5. **즐겨찾기** — filterZone, fieldFilters, colGroupOrder, filters, filterConditions 저장/복원
6. **더블클릭** — 사용 가능 필드 → 기본 영역에 추가

## 사용법

- 🗂 필드 목록 (기본 열림)
- 사용 가능 → **행/열/필터/값**으로 드래그 (또는 더블클릭)
- ⭐ 즐겨찾기 → 필터·행열·그룹순서 포함 저장
