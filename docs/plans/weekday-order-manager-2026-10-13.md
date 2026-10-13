# 주광 신규 주문 담당자 기준 — 2026-10-13

## Criteria ledger (코드 수정 전)
- 업무키: OrderYear + OrderWeek + CustKey + ProdKey. 현재 차수의 활성 주문만 재사용한다.
- 현재 활성 양수 주문 있음: 기존 OrderMaster/Detail/Manager 보존. 기존 경로를 유지한다.
- 현재 활성 Master만 있음: 그 Master.Manager의 UserInfo.UserID 존재를 확인한다. 실제 ViewOrder는 이 INNER JOIN만 하고 UserInfo.isDeleted를 걸지 않으므로 삭제 flag 자체로 기존 원장 연결을 차단하지 않는다. Customer.Manager와 로그인 계정으로 덮어쓰지 않는다.
- 현재 활성 Master 없음: authenticated req.user.userId를 신규 Manager로 사용한다. UserInfo의 유일한 활성 계정(isDeleted=0)을 확인한다. 표시이름 매칭·임의 관리자 대체는 하지 않는다.
- Customer.Manager는 읽기 근거일 뿐 신규 주문의 계정 식별값으로 사용하지 않고 변경하지 않는다.
- prepare에서 검증한 manager를 allocationOrder.manager로 고정하여 materialize가 사용한다. 모든 검증은 기존 outer transaction/gate 내부에서 수행한다.
- Stock gate, retry, lease, 주문 보존/신규 양수 주문, 확인 lifecycle, 날짜·견적·재고 계산과 UUID 계약은 보존한다.

## 근거
실제 EXE 재추출 `output/weekday-order-manager-native-20261013.txt`: FormOrderAdd의 lueManager는 GetUserInfo(false), ValueMember UserID, 신규 기본 Program.Option.LoginID, 편집 classOrderMaster.Manager이다.
읽기 전용 `output/weekday-feedback-probe.jsonl`: 주광 Customer.Manager는 이름으로 저장되어 UserInfo.UserID와 일치하지 않는다. 현재 차수의 기존 OrderMaster.Manager는 실제 UserID다. ViewOrder는 OrderMaster.Manager=UserInfo.UserID로 연결하며 UserInfo.isDeleted 조건이 없다. 이전연도는 별도 조사했다. 원문 행·계정·비밀값은 커밋하지 않는다.

## 부작용
기존 Master는 Manager와 주문수량 보존, 신규 Master의 Manager만 검증된 로그인 UserID로 생성한다. UserInfo/Customer는 SELECT-only. 기존 분배·확정·재고·견적 쓰기 순서는 동일하며 실패 시 outer rollback이다. 정상 BUSY는 원장 저장 전 반환하고 재시도할 뿐 owner를 해제하지 않는다.

추가 actual CLI `output/weekday-common-native-20261013.txt`: CommonLogic.GetUserInfo(false)는 UserInfo의 정확한 `isDeleted=0` 조건을 사용한다. 신규 계정은 NULL을 활성으로 확장하지 않는다.
