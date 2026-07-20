# Nenova ERP 작업 가드

이 저장소의 주문·출고·입고·재고·견적 기능은 `nenova.exe`와 같은 MSSQL 데이터를 사용한다. 관련 기능을 만들거나 수정할 때 아래 절차는 선택사항이 아니다.

## 작업 전 필수 확인

1. `docs/ERP_CHANGE_GUARD.md`
2. `docs/ERP_COMPAT_INVARIANTS_2026-06-04.md`
3. `docs/WEB_VS_ERP_CONFLICTS.md`의 작업 대상 View/SP/dnSpy 섹션
4. 대상 API의 읽기·쓰기 테이블과 사용자 동작별 부작용 표

DB 쓰기 기능은 `OrderYear + OrderWeek + CustKey + ProdKey`를 업무 키로 취급한다. `OrderWeek`는 매년 반복되므로 `OrderWeek`만으로 Master를 조회·수정·삭제하거나 집계하지 않는다. PK로 한 행을 지정한 뒤 표시용으로 `OrderWeek`를 읽는 경우만 예외다.

## 차수피벗 주문/분배 계약

| 동작 | 같은 연도·차수·업체·품목의 활성 주문 | OrderDetail | ShipmentDetail |
|---|---:|---|---|
| ADD | 없음 | 양수 주문 신규 등록 | 증가 |
| ADD | 있음 | 변경 금지 | 증가 |
| CANCEL | 있음/없음 | 변경 금지 | 감소 |

- 주문 유무 판정에 전년도 동일 차수를 포함하지 않는다.
- EXE 노출을 위한 수량 0 가짜 주문행을 만들지 않는다.
- 공용 API를 재사용할 때는 `mode`와 순수 정책 함수로 부작용을 명시한다.

## 변경 후 필수 검증

```powershell
npm run test:erp-contract
npm run guard:erp-writes -- --changed-from HEAD^
npm run build
```

운영 DB 보정은 수정 코드가 배포된 뒤에 수행하고, 보정 전후에 같은 연도·차수·업체·품목의 `ViewOrder`와 `ViewShipment`를 대조한다. 계약검사나 빌드가 실패하면 배포하지 않는다.
