# 주광 물량표 기준과 세부차수 잔량 (2026-10-13)

## 사용자 요청과 처리
- Q: 최초분배를 물량표 기준으로 바꾸고 날짜 위에 41-1/41-2 묶음, 기준 열 색상 추가.
- A: 웹 기준 열 이름/연노랑 표시, Excel 날짜·윌슨·요일합계 위 세부차수 병합 헤더와 2행 고정/인쇄 반복. 합계 파랑·잔량 초록, 한글명/빈 0값/원본 테두리 보존.
- Q: 41-1 잔량5 + 41-2 물량5 - 출고10이면 잔량0이어야 한다.
- A: 공통 matrix 02 잔량을 두 구간 누적으로 계산. 미확인/초안/미확정 전파, 이전 대차수 이월은 한 번, 당차 수동 마감은 대차수만 별도로 유지. ERP 원장/확정/견적 저장 변경 없음.

## 근거·검증
- 기준: docs/plans/weekday-subweek-balance-export-2026-10-13.md, 같은 세션 actual dnSpy/운영 read-only 증거는 weekday-feedback-manager 참조.
- 전체 ERP 계약·dnSpy evidence·manifest·write guard·build PASS. 독립 검토 blocking 결함 없음.
- 실제 사용자 원본 양식을 production exporter에 넣은 문라이트 fixture: 30-25=5, 5+5-10=0. XLSX 렌더로 병합·색상·한글·0빈칸 확인(output/weekday-export-format/preview.png).
- 배포 및 실제 Chrome 결과는 후속 기록.
