# 단가 입력 Enter 아래 칸 이동

Q. 업체별 품목 단가를 입력하고 Enter를 치면 바로 아래 품목 단가로 이동하고 싶다.

## 기준/부작용

- 대상: 매트릭스 업체별 단가 입력칸. 같은 CustKey 열의 현재 표시된 sortedProducts 다음 ProdKey.
- Enter: 기본동작 차단, 다음 칸 focus/select, 가까운 위치로 스크롤. 값 복사/자동저장 없음.
- 마지막 행/없는 품목은 이동하지 않음. 숨김/해제된 품목은 건너뜀. IME 조합중 Enter는 무시.
- 기본단가(전체 업체 적용) 칸은 기존 동작 유지.
- 브라우저 포커스만 변경. SQL/API/권한/단위환산/금액계산 변경 없음. CustomerProdCost 및 Order/Shipment/Stock/Estimate/WebProfitReport 모두 preserve.
- dnSpy 근거는 기존 FormCustomerProdCost 기록. 동일 CustKey+ProdKey 저장 함수는 변경하지 않음. 이번 기능은 웹 전용 키보드 조작이며 별도 DB 쓰기 probe 불필요.

## 검증

첫행/중간/끝/없는키, 재정렬/필터, 동일 업체 유지 fixture 통과. test:erp-contract, dnSpy evidence, manifest 및 ERP write guard(origin/master 기준), production build, diff --check 모두 통과. 운영 단가 저장은 실행하지 않는다. PR/배포 후 별도 탭에서 포커스 이동을 확인하고 사용자 편집 중인 기존 탭은 보존한다.
