# 작업 전 충돌 점검 우선순위

작성일: 2026-05-25

## 최우선 원칙

NenovaWeb에서 주문, 출고, 견적, 재고, 정산 관련 기능을 수정하기 전에는 **기능 구현보다 충돌 여부 확인을 먼저 한다.**

특히 `nenova.exe`와 같은 MSSQL DB를 같이 쓰는 기능은 웹에서 정상처럼 보여도 ERP 버튼, 프로시저, 조회 화면과 충돌할 수 있다. 따라서 앞으로는 아래 점검을 통과한 뒤에만 코드 수정으로 들어간다.

## 작업 우선순위

1. `nenova.exe` 또는 기존 ERP 구조와 충돌 가능성 확인
2. DB 테이블, 뷰, 저장 프로시저, 트리거의 실제 사용 방식 확인
3. 기존 웹 코드가 어떤 기준으로 데이터를 생성/수정하는지 확인
4. 운영 데이터에 이미 생긴 중복, 누락, 불일치 row가 있는지 진단
5. 충돌 가능성이 낮은 `+A` 방식의 보완안 설계
6. 코드 수정
7. build 확인
8. 운영 반영 후 git-log와 실제 기능 확인

## 수정 전 필수 체크리스트

- [ ] 관련 기능이 `nenova.exe` 버튼 또는 화면과 같은 DB row를 공유하는가?
- [ ] `nenova.exe`에서 호출하는 저장 프로시저 이름을 확인했는가?
- [ ] `ShipmentMaster`, `ShipmentDetail`, `OrderMaster`, `OrderDetail`, `ShipmentDate`, `ShipmentHistory`, `ProductStock`, `StockHistory` 중 하나라도 INSERT/UPDATE 하는가?
- [ ] `CustKey`, `ProdKey`, `OrderWeek`, `ShipmentKey`, `OrderMasterKey`, `OrderDetailKey` 같은 ERP 핵심 키를 누락하거나 다른 기준으로 생성하지 않는가?
- [ ] 웹 전용 플래그나 정렬 기준이 ERP 조회 기준과 충돌하지 않는가? 예: `WebCreated`
- [ ] ERP가 이미 만든 master row가 있을 때 새로 만들지 않고 재사용하는가?
- [ ] `KeyNumbering.LastKeyNo`가 실제 테이블 최대 key보다 뒤처져 있지 않은가?
- [ ] 확정 상태, 출고일, 견적수량, 출고수량 검증 로직이 ERP와 같은 방향인가?
- [ ] 자동 매핑, 자동 학습, 히스토리 저장은 실제 저장/분배 성공 이후에만 반영되는가?
- [ ] 과거 fallback 매칭이나 자동 생성 데이터가 새 작업의 판단 근거로 과신되지 않는가?
- [ ] 운영 데이터 진단 API 또는 SQL로 기존 불량 row를 먼저 확인했는가?

## 출고분배 수정 전 추가 체크

출고분배는 현재 최우선 충돌 점검 대상이다.

- [ ] `nenova.exe` 일괄출고분배/개별출고분배 버튼이 사용하는 `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear` 흐름과 충돌하지 않는가?
- [ ] `ShipmentMaster` 선택 기준이 ERP 확정 row를 우선하는가?
- [ ] `ShipmentDetail.CustKey`가 항상 채워지는가?
- [ ] `KeyNumbering.Category='ShipmentDetailKey'` 값이 `MAX(ShipmentDetail.SdetailKey)` 이상인가?
- [ ] `ShipmentDate` 합계와 `ShipmentDetail.OutQuantity`가 맞는가?
- [ ] `ShipmentDtm`이 비어 있는 상태로 분배되지 않는가?
- [ ] 일부 품목만 분배할 때, 다른 품목의 확정 상태 때문에 전체 분배가 막히지 않는가?
- [ ] 단가는 `CustomerProdCost` 또는 ERP가 쓰는 업체별 품목단가 기준으로 채워지는가?
- [ ] 실제 분배 성공 전에는 매칭 히스토리나 학습 데이터가 바뀌지 않는가?

## 판단 기준

충돌 여부가 애매하면 기능 추가를 멈추고 먼저 진단 코드를 만든다.

예:

- 조회 전용 진단 API
- 특정 주차/거래처/품목 기준 불일치 리포트
- `nenova.exe` 문자열 또는 dnSpy 확인 결과 기록
- 운영 DB row 샘플과 웹 생성 row 비교

## 관련 문서

- `docs/WEB_VS_ERP_CONFLICTS.md`
- `docs/DB_STRUCTURE.md`
- `docs/FULL_FLOW_AUDIT_2026-05-15.md`
- `docs/PASTE_NATURAL_MATCH_AUDIT_2026-05-25.md`
- `docs/CHATBOT_LEARNING_AUDIT_2026-05-25.md`
