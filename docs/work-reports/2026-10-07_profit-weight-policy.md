# 주차별 보고서 GW/CW 원천 정정

## 기준·부작용 ledger (구현 전)

- 요청: 한 행의 DB 보정이 아니라 전체 웹 보고서 계산·미리보기·진단 보완.
- 2026/31-01 조회 근거: 입고 GW 1420 / CW 3342, WebColombiaWeekly 저장 GW/CW 3342/3342. 통관 수정 이력은 2026-08-25 15:57:27 임재용 계정 최초 저장이며 직접 타이핑/자동 채움 여부는 알 수 없다.
- 실제 비용: BakSangRateApplied=460, HandlingFee=33000, ItemCount=4, Truck5t=1, 나머지 차량0. 현재 H1885320 → GW만 입고 기준으로 선택 시 H1001200. 항공료9026.56 USD 총액 보존.
- CLI: `dnSpy.Console.exe --no-color -t FormWarehouseView "C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe"`. GetData는 WarehouseMaster/Detail, 상세는 WarehouseKey와 Product JOIN을 사용. 웹 전용 손익에 해당하는 EXE 저장 메서드는 없다.
- 선택 연도+차수 입고 읽기 범위 유지/강화. NULL 연도를 선택연도로 간주하지 않는다.
- 비역사 Colombia: 유효한 입고 GW/CW 쌍 우선, 입고 쌍 없으면 기존 저장 쌍 fallback. 부분·역전·비유한 원천은 진단 차단, GW>CW를 CW로 바꾸지 않는다.
- 국가 양수 GW: 입고 우선. 기존 국가행의 명시적0(면제/미적용)은 보존한다.
- 2026 22~27차 역사 계산 정책과 확정 보고서 revision은 보존한다.
- H 창고료는 GW, S는 GW=CW 무게비율 / CW>GW CBM비율. 실제 수수료·관세·차량·항공료 override는 보존.
- 도착원가 파일 업로드 유무로 과세환율 누락을 추정하지 않는다. 실제 보고서 R 원천만 판정한다.

| 동작 | Warehouse/Order/Shipment/Stock/Estimate | 웹 저장값 | 결과 |
|---|---|---|---|
| 보고서·통관·포워딩 조회 | SELECT only | 보존 | 공통 유효중량으로 H/S 계산 |
| 편집 미리보기 | 보존 | 보존 | 서버와 동일 중량 사용 |
| 기존 비용 저장 | 보존 | 기존 비용/감사 계약만 | 입고 중량을 수기값으로 복제하지 않음 |
| 배포 후 smoke | 읽기만 | 확정 revision 보존 | draft 재계산 검증 |

운영 원장 보정·보고서 강제확정·확정취소는 이번 작업에서 실행하지 않는다.
