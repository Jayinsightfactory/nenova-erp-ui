# 작업 완료 보고 — 도착원가 농장 이어받기·단/박스 분류

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-24 13:55 |
| 사용자 요청 | 도착원가 파일 농장 인식/분류, 입고수량 단·박스 분류 |
| 브랜치 | master |
| 커밋 | `ccf46c1` — fix(arrival-cost): carry farm names down and classify bunch vs box qty (#322) |
| 배포 | Cafe24 success https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/32691640217 |

## 원인

- 수국 Color Grade 표는 농장명을 그룹 첫 행만 적는데, 파서가 아래 품목 행으로 이어받지 않았다.
- 농장 매칭이 상품명 정규화(cloud/fresh 제거)를 써서 Cloud 같은 농장명이 지워졌다.
- 입고수량은 전산 OutUnit이거나 무조건 '단'이라 엑셀 단/박스를 구분하지 못했다.

## 결과

- 빈 농장 칸은 위 행 농장명을 이어받고, Green Land / Lorzate 등 별칭으로 Farm 마스터와 맞춘다.
- 입고수량은 엑셀 헤더(단당수량, 도착원가(단), 수량(박스))로 단/박스를 분류한다.
- 주문·출고·입고·재고 원장은 쓰지 않는다.
- 이미 올라간 행은 원가 파일을 다시 올려야 반영된다.
