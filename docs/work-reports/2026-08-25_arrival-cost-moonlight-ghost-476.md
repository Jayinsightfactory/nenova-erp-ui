# 작업 완료 보고 — 도착원가 33-2 문라이트 476원 유령 행

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-25 12:50 |
| 사용자 요청 | 재업로드해도 33-2 문라이트가 476원 |
| 브랜치 | fix/arrival-cost-blank-country-ghost |
| 커밋 | (배포 후 기록) |
| 배포 | Cafe24 |

## 원인

재업로드(import 10)는 33-2 시트를 8,986원으로 저장했다. 그 전에 import 9가 시트 `16-1B`를 파일명 차수 33-2·국가 공란·송이원가 476원으로 남겼고, SUPERSEDE가 `33-2|콜롬비아`만 내려 `33-2|` 빈 국가 현재본이 남았다. 16-1B 머리글이 `B`라 COLOMBIA를 읽지 못했다.

## 변경

| 파일 | 내용 |
|------|------|
| `lib/arrivalCostExcel.js` | 같은 차수·같은 파일의 국가를 빈 시트에 이어받음 |
| `lib/arrivalCost.js` | 같은 차수의 빈 국가 현재본도 SUPERSEDE |
| 운영 `WebArrivalCostLine` | 33-2/33-1 빈 국가 16-1B 유령 행 `IsCurrent=0` |

주문·출고·견적·재고는 그대로다.

## 사용자 확인

- 33-2 문라이트는 Don Eusebio/Serrezuela/Teucali/Gaitana **8,986원**만 보여야 한다.
- Ayura/Fillco 476원 줄은 보이면 안 된다.
