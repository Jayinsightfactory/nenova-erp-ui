# 22~28차 주차별 매출이익 보고서 evidence-RAG 자동 재생성

- 전체 상태: **INPUT_REQUIRED**
- 검사: PASS 91 / INPUT_REQUIRED 7 / UNVERIFIED 7 / FAIL 0
- 수식 원본: FORMULA_PARITY 8 / WORKBOOK_ANOMALY 1
- cell registry: 293,010개, mapping 100%
- 수식 fingerprint: 12,865개, coverage 100%
- 실제 자동입력률: 742/1008 (73.61%)
- 직접입력 field type: 7개 / 주차별 슬롯 49개 — customs.invoice.warehouse, customs.invoice.duty, customs.invoice.sunyul, customs.invoice.quarantine, colombia.invoice.disinfection, colombia.invoice.quarantine-deduction, inventory.unit-price-evidence
- 허용 오차: 금액 ±1원 / 비율 ±0.01%p

## 차수별 결과

| 차수 | 상태 | 시트 | persisted cells | 수식 | 매핑 | fingerprint | 자동입력률 |
|---:|---|---:|---:|---:|---:|---:|---:|
| 22 | INPUT_REQUIRED | 11 | 41798 | 1885 | 100.00% | 100.00% | 76.39% |
| 23 | INPUT_REQUIRED | 11 | 41534 | 1808 | 100.00% | 100.00% | 73.61% |
| 24 | INPUT_REQUIRED | 12 | 41652 | 1803 | 100.00% | 100.00% | 79.86% |
| 25 | INPUT_REQUIRED | 11 | 41943 | 1831 | 100.00% | 100.00% | 74.31% |
| 26 | INPUT_REQUIRED | 11 | 41774 | 1835 | 100.00% | 100.00% | 69.44% |
| 27 | INPUT_REQUIRED | 11 | 42011 | 1830 | 100.00% | 100.00% | 68.75% |
| 28 | INPUT_REQUIRED | 11 | 42298 | 1873 | 100.00% | 100.00% | 72.92% |

## 전차수 재고 이월 검사

- 22->23: **FORMULA_PARITY** — 전차수 F 31,634,617.83원 / 다음차수 E 31,634,617.83원 / 차이 0원
- 23->24: **FORMULA_PARITY** — 전차수 F 19,198,741.26원 / 다음차수 E 19,198,741.26원 / 차이 0원
- 24->25: **FORMULA_PARITY** — 전차수 F 30,405,427.084원 / 다음차수 E 30,405,427.084원 / 차이 0원
- 25->26: **FORMULA_PARITY** — 전차수 F 16,792,588.526원 / 다음차수 E 16,792,588.526원 / 차이 0원
- 26->27: **WORKBOOK_ANOMALY** — 전차수 F 8,919,590.217원 / 다음차수 E 12,578,453.106원 / 차이 3,658,862.889원 — 웹 E는 26차 확정 F를 이월하며, 27차 Excel E의 베트남 예외값으로 덮어쓰지 않는다.
- 27->28: **FORMULA_PARITY** — 전차수 F 13,229,405.204원 / 다음차수 E 13,229,405.204원 / 차이 0원

## 판정 해석

- 7개 원본을 변경하지 않고 evidence baseline replay로 각각 재생성했으며, 10개 보조시트·본표 B:U·23행 합계·B25 비고를 cell 단위로 비교했습니다.
- 재생성 parity는 PASS지만 외부 확정값 sidecar와 재고 스냅샷 시점 단가 근거가 없어 운영 자동생성 최종 상태는 INPUT_REQUIRED입니다.
- 남은 운영 DB 검증은 아래 read-only query 7개입니다. 이 실행에서는 승인된 운영 환경이 없어 DB·ERP 등록·배포를 수행하지 않았습니다.

## 운영 read-only 미검증 7건

1. `migration.web-stock-price-evidence-applied` — 운영 DB의 WebStockPriceEvidence 스키마 적용 여부
2. `migration.web-customs-rate-history-applied` — 운영 DB의 WebCustomsRateHistory 스키마 적용 여부
3. `shipment.detail-fix-row-impact` — ShipmentDetail.isFix=1 적용 전후 운영 매출 행수·금액 영향
4. `shipment.cross-year-orderweek-isolation` — 동일 OrderWeek의 교차연도 운영 출고 격리 결과
5. `inventory.confirmed-product-stock-coverage` — 확정 ProductStock의 exact-week 단가 evidence 존재율
6. `inventory.price-evidence-metadata-completeness` — 단가 evidence source/effective/confirmed metadata 완전성
7. `inventory.ef-item-value-operational-reconciliation` — E/F 품목별 평가액과 운영 workbook 대사
8. `historic.current-ledger-reconciliation` — 과거 보고서 확정 뒤 수정된 현재 Shipment/Warehouse 원장은 당시 Excel과 분리해 표시하고 확정 snapshot으로만 재현해야 함
