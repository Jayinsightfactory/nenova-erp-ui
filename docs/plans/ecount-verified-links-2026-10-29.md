# 검증된 거래처 연결

## 근거와 기준
- guard-nenova-erp-changes 적용. 로컬 dnSpy CLI ClassCustomer BusinessNumber/Manager/GetData 재확인 exit0. Customer와 확정 ShipmentMaster→ShipmentDetail 읽기 전용 probe.
- 340: 동명 원본2개 중 두 번째 코드. 2026-09-02~10-21 네노바 매출8건이 원본09-08~10-27과 금액 일치(날짜 +6일). 첫 코드는 기간 거래행0.
- 351: 양수매출3일 중2025-07-30/08-13 두 금액이 대지원예2의08-05/08-19에 일치. 대지원예(X)에는 해당 거래없음. 나머지 금액은 불일치하여 원장 수정하지 않음.
- 646: 2025/2026 여러 매출일 대지원예2와 금액 일치, 최근 일부 금액차이는 원본 그대로 보존. 351/646 같은 원장 공유 사용자 명시 승인.
- 사업자번호와 원본 코드가 다를 수 있다. 검증 예외3개만 원문 없는 sourceHash/localIdentityHash로 고정. 이름만 일치하거나 검색 첫 행으로 연결하지 않음.
- 목록·수집·저장 공통 resolveLinks. 현재 이름/로컬 식별정보 변경, 원본 코드 변경, 다른 업체 충돌, canonical 비활성 또는 담당자분리 시 차단. 현재 전표 보고서 사업자 식별값은 검증 원본코드와 일치해야 함.
- 모든 활성 고객에 대해 충돌 확인 후 기존 담당자/SS3 권한 필터. shared owner가 같을 때만 alias. 미배정/비활성 사용자 권한 확대 없음.
- 별칭 조회와 최신화는 canonical646 snapshot/queue 한 개. 수집 목록은340/646만 포함. 최근1개월과 교차연도 달력/입금−판매 계산 변경없음.

## 부작용
|동작|읽기|쓰기|보존|
|---|---|---|---|
|연결·권한 확인|Customer/UserInfo|없음|모든 ERP원장|
|전표 조회|ECOUNT E040723|없음|ECOUNT 전체|
|수집·요청|기존 웹snapshot|WebEcountSnapshot append|Customer/OrderDetail/ShipmentDetail/ShipmentDate/Estimate/WebProfitReport/재고|

화면틀/키보드/스크롤: 기존 버튼 유지, 공유원장 설명 추가. 원장 반영 확인: 해당없음(원본 읽기전용). 스키마 변경없음.
