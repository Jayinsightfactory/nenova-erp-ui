# 작업 완료 보고 — 도착원가 화이트 검색에 수국 표시

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 16:20 |
| 사용자 요청 | 화이트 검색 시 수국 품종 버튼이 안 보임 |
| 브랜치 | feat/arrival-cost-white-hydrangea |

## AI 구성

| 담당 | 역할 |
|------|------|
| **Cursor 직접** | 화이트↔White 동의어, Hydrangea→수국 정규화, 테스트·배포 |

## 원인

수국 화이트는 엑셀/전산명이 `Hydrangea White`인 경우가 많고, 매칭데이터에도 `수국 화이트` 별칭이 거의 없다. 한글 `화이트`만 LIKE 해서 수국 행이 빠지고, 품종 버튼은 영어 `Hydrangea`로 나오거나 아예 없었다.

## 변경

- `화이트` 검색은 `White`도 함께 찾음
- 품종 버튼은 `Hydrangea` → `수국`으로 표시
- 수국 버튼을 누르면 hydrangea 행도 걸림

검색은 SELECT만. Order/Shipment/Estimate/Stock 보존.
