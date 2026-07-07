# 롤백·분배삭제 안전 체크리스트 (30초 필독)

> 주문/분배/재고를 **되돌리거나 삭제**하는 스크립트를 짜거나 돌리기 전에 이 표부터 본다.
> 상세 원장: [STOCK_INTEGRITY_DESIGN.md](STOCK_INTEGRITY_DESIGN.md) · [NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md](NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md)

## 절대 규칙 (위반 시 사고)

| # | 규칙 | 안 지키면 |
|---|------|-----------|
| R-1 | **빈 ShipmentMaster를 `isDeleted=1`로 남기지 말 것.** 해당 거래처가 그 차수에 **활성 주문이 있으면** 마스터를 활성(빈)으로 두고, 주문도 없으면 **물리삭제**. | exe가 재분배 시 삭제된 마스터를 CustKey+OrderWeek로 **재활용→사용자 입력이 숨겨짐**. 사용자는 "안 보인다"며 재입력→**중복 누적**. (2026-07-06 28-01 루스커스 사고) |
| R-2 | 수량은 **delta(Before→After)** 로만 되돌린다. 타 계정(exe/다른직원) 수정분은 차감 보존. | 남의 정상 작업까지 삭제 |
| R-3 | **관련 없는 거래처/품목/차수/수량은 절대 안 건드린다.** 대상을 명시 키(SdetailKey/OrderDetailKey)로 한정. | 스코프 크리프, 2차 사고 |
| R-4 | 삭제 전 **이력 기록**(ShipmentHistory/OrderHistory) + 대상 **백업 JSON**. | 되돌리기 불가 |
| R-5 | **dry-run 표 먼저** 확인 → `--apply`. 트랜잭션으로. | 검증 없는 대량변경 |
| R-6 | 사용자가 **이미 수정한 수량은 보존**. 내 작업이 그 위에 덮어쓰지 않는지 확인. | 사용자 작업 무효화 |

## 증상 → 원인 빠른 진단

| 증상 | 먼저 볼 것 |
|------|-----------|
| "exe에서 수량 입력했는데 웹/집계에 안 뜸" | 해당 거래처+차수 **ShipmentMaster.isDeleted** — 1인데 밑에 상세 있으면 = 재활용 충돌(R-1). 상세보유 마스터만 `isDeleted=0` 복원 |
| "확정이 안 됨(음수)" | [STOCK_INTEGRITY_DESIGN.md](STOCK_INTEGRITY_DESIGN.md) §2 — 재고조정 주입 금지, 근원 정정 |
| "주문취소가 안 됨" | 빈/고스트 ShipmentMaster (취소게이트가 isDeleted 무시하고 COUNT). 물리삭제 필요 |
| "수량이 2~3배" | 숨겨진 마스터에 재입력 중복 — 유지행=주문수량 가드 걸고 초과분만 제거 |

## 복구 표준 절차 (재활용 충돌)

```
1. 대상 거래처+차수 ShipmentMaster 상태 확인 (isDeleted, detCnt)
2. 상세 보유 & isDeleted=1 마스터만 → isDeleted=0 (수량 무변경)
3. 중복 상세: 마스터별 최저 SdetailKey 1행 유지, 나머지 제거
   — 가드: 유지행 OutQuantity == 주문(OrderDetail) 수량 일치할 때만 삭제
   — ShipmentDate 동반 삭제 + ShipmentHistory 기록 + 백업
4. 최종: 거래처별 출고 == 주문 검증
```
