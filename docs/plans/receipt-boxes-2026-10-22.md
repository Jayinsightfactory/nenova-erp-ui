# 입고 입력 정합 및 박스 현황

사용자: 운영 DB 쓰기 금지. 42-1 실제 파일의 UI 종단 검증은 격리 SQL에서만 수행.

## 근거와 기준
- 2026-10-22 설치 EXE dnSpy CLI ExcelLoadingPackingList 재확인: G3 InputDate, G2 OrderWeek, F BoxQuantity/I BunchQuantity/J SteamQuantity 별도 저장. 인쇄 날짜 확인 사유는 native 필수 입력이 아니다.
- 실제 입고일/선택 연도 검증은 유지. 인쇄 날짜는 참고 자료로 보존하며 미확인 날짜를 실제 입고일로 자동 복사하지 않는다.
- 박스는 WarehouseDetail.BoxQuantity 저장값. 현행 Product 포장규격으로 역산하지 않는다. NULL은 미기재이며 0과 구별한다.
- 조회 키: 명시 OrderYear 및 선택 OrderWeek. 원본 상세를 한 번만 집계하며 Farm/Order 조인으로 중복하지 않는다. 삭제 Master 제외, 삭제 Product 이력은 보존.
- 국가 CounName, 품종 FlowerName은 Product 원천. 미연결/빈 분류는 미분류로 표시하고 합계에서 누락하지 않는다.

## 부작용 표
| 동작 | Warehouse | Product/Stock | Order/Shipment/Estimate/WebProfitReport | 웹 문서 |
|---|---|---|---|---|
| 인쇄 날짜 참고/입력 검토 | 보존 | 보존 | 보존 | 명시 초안 저장만 기존 계약 |
| 박스 현황 GET/필터 | SELECT | Product SELECT만 | 보존 | 보존 |
| 격리 입고/원가 시험 | 테스트DB만 기존 writer | 테스트DB만 native 계산 | 보존 검증 | 테스트DB만 |

## 검증 계획
교차연도 같은 차수, 명시 0/NULL/소수 박스, 복수 상세, 미분류, 필터 합계 및 빈 결과를 실행형 테스트. 날짜만 미확인인 정상 건 통과와 통화/수량/총액 오류 차단을 구분. 실제 UI 입고→원가 다운로드, 운영 쓰기0. 완료 전까지 미검증.
