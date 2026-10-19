# 독립 재고·수익률 검산 — 구현 전 기준

## 요청과 완료 기준

사용자: 독립 검산 엔진으로 기초/기말재고 문제를 차수별로 설명하고 배포한다.
기존 보고서 계산 함수를 정답으로 재사용하지 않는다. 조회만 하며 보정하지 않는다.

| 기준 | 구현/검증 |
|---|---|
| 1차~선택 차수 수량 대사 | 명시적 연도, 실제 모든 세부차수, 품목/출고단위별 독립 산술 |
| 기초/기말 원인 분리 | 직전 저장 잔량을 사용한 당차수 차이와 앞 차수 차이의 이월을 별도 표시 |
| 최초 원인 | 조회 범위의 최초 관측 차이만 표시. 초기 앵커/누락 구간은 확정 원인으로 단정하지 않음 |
| 금액/수익률 | 별도 순수 함수로 공식 재계산. 단가 증빙 완전성, 수량 대사, 산술 일치를 분리 |
| 자료 부족 | NULL, 누락 snapshot, 중복, 비정상 업무키, 출처 미확인, 확정시점 차이를 정상으로 만들지 않음 |
| 설명 | 실제 수량 식, 차이 방향, 이익 영향 방향, 다음 확인처, 판정 한계를 한국어로 표시 |
| 안정성 | 원천 전체 관련 필드의 정렬된 SHA256 전후 대조. 변경 감지 시 STALE; 원자적 snapshot이라고 주장하지 않음 |
| 검증 | 합성 교차연도/반례/읽기 전용 테스트, ERP guard/build, 실제 SELECT/브라우저, CI/배포 |

## 실제 근거 (2026-10-19)

- 설치된 dnSpy.Console.exe로 실제 Nenova.exe FormStockView.GetData 확인: 이전 차수, ViewWarehouse, ViewShipment, StockHistory/CodeInfo StockType 및 ProductStock 읽기.
- 운영 DB SELECT로 dbo.usp_StockCalculation 정의 확인. SHA256 `990d54a853ef8a9794cc76ffcb13a7e720ae2cff13e723ca5c97e235cca1890c`.
- 계산은 이전 StockMaster의 ProductStock + ROUND(입고합,2) - ROUND(DetailFix=1 출고합,2) + ROUND(StockType 조정합,2), 최종 ROUND(...,2). 보고서 매출의 master/detail 확정 조건과 재고 출고의 DetailFix 조건을 혼동하지 않는다.
- 2026/32-01,32-02 ProductStock 존재 SELECT 확인. 금융 금액·품목별 운영 데이터는 공개 저장소에 기록하지 않는다.
- DB SNAPSHOT isolation/RCSI 모두 비활성. 설정 변경 없이 전후 원천 hash를 비교하고 조회 사이 변경 가능성 한계를 표시한다.
- 수량은 OutUnit 기준, 평가액은 EstUnit 기준. 현재 Product 환산계수만 존재하므로 과거 계수의 정당성까지 확정하지 않는다.
- 기존 report E/F는 최신 ProductStock 세부차수, 01차 기초는 전년도52차. StockMaster.isFix로 제한하지 않는다.

## 부작용/보존 표

| 동작 | 읽기 | 쓰기 |
|---|---|---|
| 독립 수량 검산 GET | StockMaster/ProductStock, Product, ViewWarehouse/ViewShipment, StockHistory/CodeInfo, WebStockPriceEvidence, SP 정의 | 없음 |
| 보고서 산술/평가 비교 | 기존 report GET의 입력값/확정본; 직접 단가 증거와 품목 환산 | 없음 |
| 차수 이동/범위 검산/취소 | 명시 연도·차수 GET만 | 없음 |

OrderMaster/Detail, ShipmentMaster/Detail/Farm/Date, Estimate, StockHistory/ProductStock, WebProfitReport 및 확정/스냅샷 원장 전부 보존. 외부 AI/API 과금 없음. dnSpy/실사/인보이스 확인이 필요한 부분은 미확인 상태로 남긴다.

## 구현 후 보완

- `auditLive=1` GET은 기존 loadWeeklyReportPayload의 preferLive 읽기 옵션만 사용하며 원본/확정 snapshot을 저장하거나 갱신하지 않는다.
- 비표준 세부차수는 실제 native 이전 StockMaster 선택에 영향을 주므로, 단순 제외하고 앞 차이를 계속 전파하지 않는다. 그 구간의 추적은 끊고 해당 대차수를 입력 확인 필요로 표시한다.
- 금액 산술은 보고서 입력값에 독립 공식을 적용하는 검사다. 매출전표/통관비 원천의 실제 발생 사실 및 FIFO 레이어 가격 증빙 전체를 독립 감사했다고 주장하지 않는다.
