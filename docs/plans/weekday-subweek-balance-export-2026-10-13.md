# 주광 물량표 기준·세부차수 잔량 및 엑셀 헤더 (2026-10-13)

## 구현 전 기준
- 최초분배 표시를 물량표 기준으로 변경한다. 저장된 baseline/provisional 원천 및 확정 저장 동작은 보존한다.
- 01 잔량 = 01 물량표 기준 - 목~일 출고. 02 잔량 = 01 잔량 + 02 물량표 기준 - 월~수 출고. 예: 30-25=5, 5+5-10=0.
- 초안과 미확정 원천 상태는 양쪽 세부차수에서 전파하며 미확인 값을 0으로 만들지 않는다. 이전 대차수의 명시 이월은 01과 02 잔량에 한 번씩 반영, 당차 수동 마감 override는 세부차수 값을 덮지 않는다.
- 엑셀 날짜 열 위 41-1/41-2 그룹 헤더: 실제 날짜 열, 윌슨/요일합계 포함. 연도는 내부 업무키로 보존, 헤더는 MM/DD 유지.
- 물량표 기준은 연한 노랑, 합계는 파랑, 잔량은 초록. 0은 빈 셀 유지, 테두리/품목 한글/서식 보존.
- OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, Stock/StockHistory, Estimate, WebProfitReport와 확정/금액/SP 모두 보존. 순수 표시/엑셀 다운로드만 변경한다.
- 같은 세션 실제 dnSpy FormEstimateView/FormOrderAdd/CommonLogic 추출 및 운영 SELECT-only 증거는 weekday-feedback-manager 기록 참조. 새 SQL/저장 경로 없음.
- 회귀: 사용자 5+5-10, 음수, 0, 누락 기준, 초안, 다른 연도/품목/단위, 대차수 이월/수동마감, Excel 병합 범위/색/빈0/인쇄 반복 헤더. 1920×1080 Chrome 검증.
