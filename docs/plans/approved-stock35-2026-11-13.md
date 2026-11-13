# 사용자 승인 35차 카네이션 3품목 +1 보정

사용자 최신 명시 요청: ‘35차 0으로 바꾸고 영향받는 36부터46까지 전부1개씩 조절’. 이전 현재고보존안은 대체한다. 2026/35-02 ProdKey1062/2322/2601 각각−1→0박스, 이후 각 snapshot은 기존+1, 현재고0/4/0→1/5/1. 매주+1이력을 반복하지 않는다.

실SQL/EXE근거: FormStockAdd.btnSave_Click은 StockHistory 기록, Product.Stock 갱신, usp_StockCalculation 순서. 실제 SP는 ProductStock만 갱신하며 Product.Stock은 변경하지 않는다. 현재SP는 OwnerV2 게이트와 정렬cursor, 미래연도 포함 native 연쇄 계산이다. 읽기확인으로35-02 StockKey271/세품목−1 및 후속/현재고를 확인했고, 과거 두조정의 의도는 미확정이다. 오류이력을 삭제하거나 기존조정목적을 재해석하지 않고 새 승인증분 이력을 남긴다.

|동작|StockHistory|Product.Stock|ProductStock|주문/출고/입고/Estimate/매출/보고서확정본/SP/EXE|
|---|---|---|---|---|
|preview|SELECT|SELECT|SELECT|보존|
|rehearse|정확3행추가 후 전체rollback|각+1후rollback|native3품목cascade후rollback|보존지문대조|
|apply|정확3행추가,기존이력보존|각+1CAS|선택이전불변/선택이후기존+1|전부보존|

조건: exact연도/세부차수/세품목/박스/30단환산,표적재고−1,원천식이기존snapshot과일치해보정후정확+1,원천2회지문동일,같은해시rehearsal별도rollbackreadback,원본SP해시/메타보존,게이트완전IDLE/V2잠금,유효operator,고정중복marker. 불일치면전체중단/rollback,자동재시도/게이트해제/PK가짜행/직접ProductStock쓰기/스키마변경금지.

숫자차수검증은35~46전체. 원천일관성을위해native가참조하는기존46이후/2027준비스냅샷도preview와검증대상에포함하며새master생성금지. 수량조정은보고서원본/확정revision을덮어쓰지않는다. 승인된새계산본갱신은별도기존웹동작으로처리하고확정본은보존한다.

새메뉴/화면변경없음: 가이드/키보드/UI항목해당없음. 계약/단위·교차연도/실LocalDB/롤백/필수ERP게이트·build·배포전검증후운영실행. 미검증/미적용상태를보정완료로표시하지않음.
