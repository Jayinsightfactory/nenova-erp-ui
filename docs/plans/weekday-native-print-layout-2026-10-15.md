# 주광 견적 native 인쇄 양식·순서 검증

사용자 요청: 실제 EXE의 품종·품목 출력 순서와 셀 크기/양식을 맞춘다. 기존 선택일당 전체 품목 문서는 유지한다. 품종별 별도 문서 신설은 범위 밖이다. 30단(1박스) 병기는 사용자에게 의미를 확인 중이며 아직 수량·단위 계약을 변경하지 않는다.

근거: 실제 설치 EXE dnSpy FormEstimateView 및 ReportEstimate 재추출(output/estimate-native-*-20261015.cs). 정상/차감 Sort, 유형명, ProductSort.OrderNo, CounName, ProdName SQL collation 순서를 보존한다. A4 210×297mm, 좌우15/상하10mm, 표180mm, 행6.35mm, header88.23121mm, footer간격1.058333mm/행7.5mm. 주광 bundle에서만 nativeLayout을 선택하고 다른 메뉴 출력은 보존한다.

부작용: 모든 Order/Shipment/Stock/Estimate/WebProfitReport 원장·금액·확정·재고SP 보존. SELECT/HTML만 변경. 연도/차수/거래처 범위 및 미확정 출력 정책 유지.

DB 읽기: 활성 네덜란드1305품목, BunchOf1Box양수455/0값850, SteamOf1Box양수44/0값891/NULL369, SteamOf1Bunch양수506/0값793/NULL6. 누락값 추정·DB보정 없음. 개인정보 없는 품목probe output/netherlands-box-probe.json.

기준선: 기존shell/키보드/페이지scroll 적용, 인쇄는nativeA4 별도규격, 화면검증1920×1080/100%. 신규메뉴·입고/분배write 해당없음. 실제native확정제한은 앞선 사용자합의에 따라 미적용(저장분배읽기출력).

추가 합의: 기존 수량 뒤 박스 수만 병기한다(300송이(30),30단(1)). 선택일 저장 분배 OutUnit이 박스이면 실제 ShipmentQuantity를 박스 수로 사용한다. 단/송이이면 등록된 해당박스환산값>0일 때만 나눈다. 0/NULL은 추정하지 않고 원래 수량만 출력. 같은 인쇄행에 환산불명 상세가 섞이면 전체행 괄호를 생략. 수량·단가·금액·확정은 보존, 단가차감 등 등록차감은 기존표시 유지.
