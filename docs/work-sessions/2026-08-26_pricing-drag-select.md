# 업체별 단가 드래그 선택

## 요청/사전 기준
업체별 단가 셀을 드래그 선택 → 단가 입력 → 선택 영역 적용 → 기존 저장 버튼으로 일괄 저장.
- 선택 키는 CustKey_ProdKey. 현재 표시되는 정렬된 품목×업체 직사각형만 포함.
- 기본단가(Product.Cost) 열은 제외. 숨긴 품목/업체, 필터 변경 후 과거 영역 제외.
- 일반 클릭/Enter 아래 이동 유지. 드래그 중 텍스트선택 방지, 선택칸 강조, 선택 수 및 해제 제공.
- 단가는 유한한 0 이상 숫자, 빈값/음수/Infinity 거부. 0은 명시 값으로 인정.
- 영역 적용은 localCosts/changed만 변경; 서버 요청 없음. 저장 버튼만 기존 PUT 호출.
- 기존 전체 일괄 적용과 영역 적용 버튼을 명확히 분리하고, 저장중 편집/영역 적용 금지.

## 부작용
|동작|CustomerProdCost|Product.Cost|주문/출고/재고/견적/손익|
|---|---|---|---|
|드래그/영역적용|브라우저 초안만|보존|보존|
|기존 저장|기존 CustKey+ProdKey MERGE 재사용|보존|기존 단가마스터 후속 소비 유지, 과거 원장 재계산 없음|

dnSpy FormCustomerProdCost.GetData/btnModify_Click 및 기존 계약 확인. API/SQL 변경 없음. 최근 배포의 실제 단가표 읽기 결과를 브라우저로 확인 후 구현. 운영 단가 저장 테스트는 하지 않는다.
docs/CODEX_SUBTASK_ORCHESTRATION.md 부재; 사용자 제공 역할분담 지침 적용.

## 구현/검증
- 드래그 모드, 파란 선택 강조, 선택 단가/영역 적용/해제 구현. 일반 편집 및 Enter 아래 이동 유지.
- rectanglePricingCellKeys와 applyPricingCellCost 실행형 fixture: 정/역방향 직사각형, 단일칸, 숨긴행/업체/기본단가 제외,0/소수,잘못된 값,미선택초안보존,원값복원 dirty해제 PASS.
- 전체 test:erp-contract, dnSpy, manifest, write guard PASS. 하위세션 최종 npm run build PASS, 메인 동시 빌드 시도는 lock으로 종료(빌드실패 아님).
- 운영 단가 저장은 하지 않음. Chrome runtime tabs=[]이고 new tab이 normal-window 오류로 실패하여 수동 드래그 실브라우저 검증은 미완료.
