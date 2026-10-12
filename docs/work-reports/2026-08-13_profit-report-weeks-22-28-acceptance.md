# 22~28차 주차별 매출이익 보고서 evidence-RAG 자동 재생성

- 전체 상태: **INPUT_REQUIRED**
- 검사: PASS 91 / INPUT_REQUIRED 7 / UNVERIFIED 8 / FAIL 0
- cell registry: 293,010개, mapping 100%
- 수식 fingerprint: 12,865개, coverage 100%
- 실제 자동입력률: 742/1008 (73.61%)
- 직접입력 field type: 10개 — currency.taxable-rate, customs.invoice.warehouse, customs.invoice.duty, customs.invoice.sunyul, customs.invoice.quarantine, colombia.invoice.disinfection, colombia.invoice.quarantine-deduction, forwarding.invoice.freight, inventory.unit-price-evidence, inventory.stock-adjustment-evidence
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

## 판정 해석

- 7개 원본을 변경하지 않고 evidence baseline replay로 각각 재생성했으며, 10개 보조시트·본표 B:U·23행 합계·B25 비고를 cell 단위로 비교했습니다.
- 재생성 parity는 PASS지만 외부 확정값 sidecar와 재고 스냅샷 시점 단가 근거가 없어 운영 자동생성 최종 상태는 INPUT_REQUIRED입니다.
- 남은 운영 DB 검증은 read-only query 7개입니다. 이 실행에서는 운영 DB·ERP 등록·배포를 수행하지 않았습니다.
