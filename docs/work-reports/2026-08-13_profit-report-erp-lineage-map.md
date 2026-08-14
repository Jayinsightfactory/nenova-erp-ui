# 주차별 매출이익 보고서 ERP lineage map (22~28차 통합본)

- 통합일: 2026-08-13 (Asia/Seoul)
- 기준: `origin/master` / `2cdedcfbfa6102c248316c9af0d2becd71b70bb4`
- 입력: `.verify/inputs/profit-report-weeks-22-28/week-22.xlsx` ~ `week-28.xlsx`
- 방식: 저장소와 지정 Excel의 정적·읽기 전용 분석. 운영 DB 쓰기·브라우저 로그인·외부 전송·배포는 수행하지 않았다.

## 1. 통합 결론

1. 매출 원천은 `OrderYear+OrderWeek`로 격리하고 `ShipmentMaster.isFix=1`과
   `ShipmentDetail.isFix=1`을 모두 요구한다.
2. E/F 수량은 동일 연도의 마지막 확정 `StockMaster.isFix=1`과 그 `ProductStock`만
   사용한다. 미확정·flow 재계산·교차연도 fallback은 없다.
3. E/F 가격은 정확한 `OrderYear+OrderWeek+ProdKey`의 `WebStockPriceEvidence`,
   `EvidenceStatus='VERIFIED'`, source/effective/confirmed metadata가 모두 있는 값만
   사용한다. `Product.Cost`, 최근 입고단가, landed-cost, 전차수 F, 최종 E/F 수기값은
   자동 계산에 참여하지 않는다.
4. R은 증거 H/R/S override 뒤에 당주 BILL, 동일 주차 저장 과세환율, 22~27 historical
   registry, 28차 이후 KCS 고시환율을 사용한다. 전차수 R과 `CurrencyMaster`는 자동
   fallback이 아니다.
5. GET 보고서·통관·포워딩 경로에서 schema 생성/변경을 제거했다. 필요한 DDL은 명시적
   migration으로만 제공한다.
6. 확정본은 최신 master의 `WebProfitReportConfirm` revision 불변 계약을 보존한다.
   병렬 `WebProfitReportSnapshot` 구현은 통합하지 않았다.
7. 22~28 baseline replay는 저장 셀 293,010개와 수식 fingerprint 12,865개를 100%
   검증했고 금액·비율 불일치는 0건이다. 이는 입력 workbook 재생성 검증이며 운영 DB
   live reconstruction 검증은 아니다.

## 2. 업무키·확정시점

| 원천 | 업무키 | 확정·선택 계약 | 쓰기 |
|---|---|---|---|
| 출고 | `OrderYear+OrderWeek+ShipmentKey+ProdKey` | master/detail 모두 `isFix=1`, 삭제 제외 | 없음 |
| 견적 | `OrderYear+OrderWeek+ShipmentKey+CustKey+ProdKey` | 연결 출고 master 확정, L/O 분리 | 없음 |
| 입고 | `OrderYear+OrderWeek+WarehouseKey+ProdKey` | 삭제되지 않은 당주 원천 | 없음 |
| 재고 | `OrderYear+OrderWeek+StockKey+ProdKey` | `StockMaster.isFix=1`, ProductStock 존재, 최신 숫자 subweek/tie-break | 없음 |
| 재고 단가 증거 | `OrderYear+OrderWeek+ProdKey` | VERIFIED + source/effective/confirmed metadata | 명시적 evidence 저장만 |
| 통관 | `OrderYear+MajorWeek+Category` 또는 반차수 `OrderYear+OrderWeek` | invoice evidence와 적용 단가 이력 | 웹 evidence 테이블만 |
| 포워딩 | `OrderYear+MajorWeek+Category` | 당주 운송 행 자동 + 증거 override | 웹 evidence 테이블만 |
| 보고서 override | `OrderYear+MajorWeek+Category+ColKey` | H/R/S/note만 sourceRef/effectiveAt 필수 | `WebProfitReport`만 |
| 확정 revision | `OrderYear+MajorWeek+Revision` | CONFIRMED payload 불변 | `WebProfitReportConfirm*`만 |

## 3. 본표 B:U lineage

| 열 | 원천·공식 | 통합 판정 |
|---|---|---|
| B | versioned 국가/화종 resolver. 22~27 마지막 `공제`, 28 `국내` | 자동 |
| C | `N+L+O` | 자동 |
| D | 행 C / 전체 C | 자동 |
| E | 전차수 확정 ProductStock × exact-week VERIFIED 단가 증거 | 증거 없으면 INPUT_REQUIRED |
| F | 현재차수 확정 ProductStock × exact-week VERIFIED 단가 증거 | 증거 없으면 INPUT_REQUIRED |
| G | `P+T` | 자동 |
| H | 중량·차량·이력 자동값 + invoice evidence override | 일부 직접 증거 필요 |
| I | 일반 `E+G+H-F`; noEnding `E+G+H` | 자동 파생 |
| J | 일반 `C-I`; noEnding `C-I+F` | 자동 파생 |
| K | 일반 `J/C`; noEnding/합계 `J/(C+F)` | 자동 파생 |
| L | 확정 출고에 연결된 불량차감 `Estimate.Amount` | 자동 |
| M | `-L/C` | 자동 |
| N | 확정 `ShipmentDetail.Amount` | 자동 |
| O | 불량차감 외 확정 `Estimate.Amount` | 자동 |
| P | `Q×R` | 자동 파생 |
| Q | 당주 구매 외화금액, 운송/중량 행 제외 | 자동 |
| R | exact-week 과세환율 resolver 또는 증거 override | 증거 없으면 INPUT_REQUIRED |
| S | 당주 운송행/콜롬비아 항공료 자동 + evidence override | 자동 또는 증거 |
| T | `S×R` | 자동 파생 |
| U | 행 P / 전체 P, workbook 역사 범위 보존 | 자동 |

## 4. 직접 증거 manifest

필수 직접입력은 외부 청구서나 확정 증거가 없으면 자동 계산할 수 없는 7종이다. 각 항목은
7개 주차 슬롯을 가져 총 49슬롯이다.

| manualId | 근거 |
|---|---|
| `customs.invoice.warehouse` | 창고 청구서 |
| `customs.invoice.duty` | 관세 청구서 |
| `customs.invoice.sunyul` | 선율 청구서 |
| `customs.invoice.quarantine` | 한국방역 청구서 |
| `colombia.invoice.disinfection` | 콜롬비아 소독 청구서 |
| `colombia.invoice.quarantine-deduction` | 콜롬비아 검역 차감 증거 |
| `inventory.unit-price-evidence` | 확정 재고 평가 단가 증거 |

`currency.taxable-rate`, `forwarding.invoice.freight`,
`inventory.stock-adjustment-evidence`는 정확 주차 DB/구조화 원천으로 연결 가능해 필수
수기 manifest에서 제거했다. H/R/S의 선택적 증거 override는 UI에서 유지하지만 baseline
필수 종류에 중복 계상하지 않는다. E/F 최종값 직접입력은 금지한다.

## 5. side-effect 계약

| 동작 | 읽기 | 허용 쓰기 | 금지 |
|---|---|---|---|
| REPORT_READ/Excel | ERP 및 Web evidence SELECT | 없음 | runtime DDL, ERP write |
| H/R/S/note 저장 | 현재 confirm/evidence 조회 | `WebProfitReport` 증거행 | E/F final 저장, 원장 write |
| 재고 단가 증거 저장 | ProductStock/현재 evidence 조회 | `WebStockPriceEvidence` exact key | `Product.Cost`/재고원장 변경 |
| 통관/포워딩 저장 | 당주 원천 조회 | 관련 Web evidence/history | Order/Shipment/Warehouse/Stock/Estimate 변경 |
| 확정 | live 보고서 읽기 | 새 `WebProfitReportConfirm` revision | 기존 confirmed revision 변경 |

schema 변경은 `docs/migrations/2026-08-13_profit_report_evidence_rag.sql`과
`docs/migrations/2026-08-13_web_customs_rate_history.sql`을 별도 배포할 때만 발생한다.
이번 통합에서는 migration을 실행하지 않았다.

## 6. 검증 상태

- baseline mapping: 293,010 / 293,010, 100%
- formula fingerprint: 12,865 / 12,865, 100%
- 자동입력: 742 / 1,008, 73.61%
- 금액 parity: 22~28 모든 차수 mismatch 0, 최대 오차 0원
- 비율 parity: 22~28 모든 차수 mismatch 0, 최대 오차 0.00%p
- 원본 해시: 검사 전후 동일

승인된 운영 DB 환경이 없어 다음 7개 read-only probe는 미검증이다.

1. `WebStockPriceEvidence` migration 적용 여부
2. `WebCustomsRateHistory` migration 적용 여부
3. 운영 출고에서 `ShipmentDetail.isFix=1` 조건의 실제 행수 영향
4. 동일 `OrderWeek` 교차연도 출고 격리 결과
5. 확정 ProductStock에 대응하는 exact-week 단가 evidence 존재율
6. 단가 evidence source/effective metadata 완전성
7. E/F 품목별 평가액의 운영 workbook 대사
