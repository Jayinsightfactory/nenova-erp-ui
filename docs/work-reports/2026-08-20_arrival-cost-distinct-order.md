# 작업 완료 보고 — 도착원가 DISTINCT ORDER BY 오류

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 16:56 |
| 사용자 요청 | ORDER BY items must appear in the select list if SELECT DISTINCT is specified. |
| 브랜치 | fix/arrival-cost-distinct-order |

## 원인

품종 버튼 SQL이 `SELECT DISTINCT ... ORDER BY CASE WHEN CountryFlower='기타' ...` 였다. SQL Server는 DISTINCT일 때 ORDER BY 식을 SELECT 목록에 요구한다.

## 변경

- DISTINCT 제거. 안쪽 UNION이 이미 중복을 제거한다.
