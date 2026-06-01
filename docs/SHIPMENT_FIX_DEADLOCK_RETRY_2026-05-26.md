# 출고확정 Deadlock 대응 기록 (2026-05-26)

## 증상

견적서관리에서 일괄 확정을 실행했을 때 SQL Server 오류가 표시됨.

```text
Transaction (Process ID 97) was deadlocked on lock resources with another process and has been chosen as the deadlock victim. Rerun the transaction.
```

## 판단

이 오류는 데이터 입력값 오류가 아니라 SQL Server `1205 deadlock victim`이다.

웹 확정은 다음 순서로 운영 DB의 같은 테이블을 만진다.

1. `usp_ShipmentFix`
2. 품목별 `usp_StockCalculation`

`nenova.exe` 또는 다른 웹 요청이 같은 차수/품목의 출고, 재고, 히스토리 테이블을 동시에 잡으면 SQL Server가 한쪽 트랜잭션을 희생시킬 수 있다.

## 반영한 조치

- `pages/api/shipment/fix.js`
  - `usp_ShipmentFix`, `usp_ShipmentFixCancel`, `usp_StockCalculation` 호출에 deadlock 재시도 로직 추가
  - SQL Server deadlock 번호 `1205` 또는 deadlock 메시지를 감지하면 짧은 backoff 후 재시도
  - 품목군(`CountryFlower`) 조회 순서와 품목키 조회 순서를 고정해서 서로 다른 세션이 다른 순서로 락을 잡는 가능성을 낮춤
  - 품목별 재고계산도 `ProdKey` 오름차순으로 실행
- `lib/db.js`
  - 일반 주문등록/출고분배/업로드에서 사용하는 `withTransaction` 공통 래퍼에도 deadlock 재시도 로직 추가
  - `1205`, `deadlock victim`, `Rerun the transaction` 메시지 감지 시 트랜잭션 전체를 rollback 후 최대 3회 재실행
  - deadlock victim 트랜잭션은 SQL Server가 rollback하므로, PK 생성/주문상세/출고상세 INSERT는 재실행 시 다시 키를 잡는다.

## 주의

- 재시도는 transient deadlock 완화용이다.
- 같은 차수를 `nenova.exe`와 웹에서 동시에 확정하면 deadlock 가능성은 줄어들지만 완전히 0이 되지는 않는다.
- 재고/출고 SP 자체의 내부 락 순서는 전산 DB 프로시저 정의를 따라가므로, 웹에서는 호출 순서 안정화와 재시도까지만 적용했다.
