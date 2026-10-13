# 주광 신규 주문 담당자 EXE 근거 (2026-10-13)

메인 작업이 설치 Nenova.exe를 dnSpy CLI로 재추출한 `output/weekday-order-manager-native-20261013.txt`를 사용한다. FormOrderAdd의 신규 주문 담당자 기본값은 로그인 ID이며 선택값은 UserInfo.UserID다. 기존 주문을 편집하면 ClassOrderMaster.Manager를 로드한다.

운영 SELECT-only probe의 실제 ViewOrder 정의는 `OrderMaster.Manager = UserInfo.UserID`를 조인하며 UserInfo.isDeleted로 기존 주문을 제외하지 않는다. 따라서 기존 Master 재사용은 원래 Manager의 UserID 연결을 보존하고, 신규 Master는 인증된 활성 로그인 UserID로 등록한다. Customer.Manager의 표시이름을 ID로 추측하거나 임의 계정으로 대체하지 않는다.

범위와 사전 criteria: `docs/plans/weekday-order-manager-2026-10-13.md`. 운영 원문 probe와 계정 식별값은 로컬 ignored output에만 보관한다.

추가 actual CLI `output/weekday-common-native-20261013.txt`: CommonLogic.GetUserInfo(false)는 UserInfo의 정확한 `isDeleted=0` 조건을 사용한다. 신규 계정은 NULL을 활성으로 확장하지 않는다.
