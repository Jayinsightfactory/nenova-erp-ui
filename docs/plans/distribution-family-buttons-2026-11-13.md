# 국가 옆 즐겨찾기 품종 바로 선택

사용자 표시 위치인 국가 이름 오른쪽에 해당 국가의 즐겨찾기 품종 버튼을 둔다. 하나를 선택하면 왼쪽에 그 품종만 표시하고 자동으로 펼친다. 국가 이름/전체를 누르면 품종 전체로 돌아간다. 국가 전체 보기에서는 비즐겨찾기 품종도 선택 가능하다. 기존 Country::FlowerName UI 분류를 사용하고 native CountryFlower를 만들거나 바꾸지 않는다.

분류 선택은 보기 전용 farmFamily 상태로 구분한다. 품목 클릭이 기존 native 작업 범위 prodGroup을 바꾸더라도 다른 품종 목록을 임의로 숨기지 않는다. 전역 품목 검색은 분배 없는 품목도 포함하는 기존 동작을 유지한다. 다른 품종으로 이동할 때 미저장 수량/날짜 확인은 기존 chooseProdGroup 경로를 재사용한다.

기준: 현재 dnSpy FormShipmentDistribution의 품종별 품목 탐색과 기존 UI CounName/FlowerName 분류. 이번 변경의 SQL/API/SP 수정 없음. 선택/즐겨찾기 표시/펼치기는 OrderDetail, ShipmentDetail 수량·단가·Amount/Vat/isFix, ShipmentDate/Farm, Estimate, 재고, WebProfitReport 모두 보존. 실제 저장/확정은 직전 배포의 검증된 경로 그대로다.

회귀: 국가 favorite+품종 favorite 2개/비favorite 1개, 단독 선택시 해당 품종만/강제 펼침/국가로 복귀, 품목 클릭으로 보기 범위 유지, 전역 검색 예외, 다른 연도 동일 차수, 미저장 이동 취소, ERP POST 0. 필수 검사와 가이드 갱신, CI/배포/운영에서 직전 확정·고정헤더 작업까지 함께 확인한다.

검토 중 발견한 임시 업체 초안 보호 누락도 보정: 아직 custDist에 없는 추가 업체의 양수 outInputs도 hasDistributionDrafts가 감지한다. 국가/품종 이동 취소 후 두 임시 업체5/7 유지 및 한 번 저장 회귀로 확인한다. 0/빈 임시행은 초안이 아니며 주문을 만들지 않는다.
