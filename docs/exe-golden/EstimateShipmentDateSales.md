# 출고일 기준 매출 — 2026-11-06

실행: `& 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe' --no-color -t FormEstimateView 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'`
실제 출력 86,774 bytes 확인. 원본 `C:\Users\USER\nenova-decompiled\Nenova\FormEstimateView.cs`.

GetDetail: ViewShipment + ViewOrder (OrderYearWeek2/CustKey/ProdKey), ShipmentDate by SdetailKey.
DetailFix=1, vs.EstQuantity>0. 날짜별 EstQuantity/Cost/Amount/Vat는 ShipmentDate 원본.
Estimate 별도 UNION: EstimateDtm/Quantity/Cost/Amount/Vat, ShipmentMaster로 업체·차수 확인.
btnSave_Click → ClassShipmentDate.Update는 EstQuantity/Amount/Vat/Descr만 수정.
새 탭은 저장·확정 메서드를 호출하지 않는다. PeriodDay/원차수는 날짜 범위를 제한하지 않는다.
주문 존재는 동일 OrderYear/OrderWeek/CustKey/ProdKey의 EXISTS로 확인해 JOIN 중복 합산을 방지한다.

## SELECT-only read-only probe

2026-11-06 운영 SELECT: 2026/45-01, CustKey489, ProdKey866, SdetailKey101747,
ShipmentDate 2026-11-10, EstQuantity30, Amount76364, Vat7636, DetailFix=true,
동일 네 키 ViewOrder 1행, ShipmentFarm 0행. 농장배정 유무를 견적 노출 조건으로 사용하지 않는다.
ShipmentDate 실제 컬럼: SdateKey,ShipmentDtm,ShipmentQuantity,SdetailKey,EstQuantity,Cost,Amount,Vat,Descr.
고객명·개인정보·인증정보는 기록하지 않았다.

## 기준표 / 부작용

|동작|기준|소비자|원장 영향|
|---|---|---|---|
|직접 기간 조회|필수 업체, 시작~종료 포함, 날짜 YYYY-MM-DD 엄격검증|API/화면|SELECT only|
|즐겨찾기|업체+시작/종료 요일, 월~금 기본, 사용자별 서버 저장|기존 /api/favorites|UserFavorite만 저장|
|과거 기간|시작 요일에서 7일씩 이전, 종료 요일 포함, 12기간씩 더 보기|공유 기간 helper/API|SELECT only|
|수량|ShipmentDate.EstQuantity, Product.EstUnit|품목·기간·차수 구성|변환/반올림 없음|
|매출|저장 Amount+Vat, Estimate는 EstimateDtm 기준 별도 조정 표시|공유 집계 helper|재계산/쓰기 없음|
|원차수|내부 OrderYear+OrderWeek, 화면 44-1 형식|공유 집계 helper|기존 차수 집계 불변|

OrderMaster/OrderDetail, ShipmentMaster/ShipmentDetail.Amount/Vat/isFix, ShipmentDate,
ShipmentFarm, Estimate, 재고, WebProfitReport: 모든 조회·탭·기간 이동에서 보존.
즐겨찾기는 기존 사용자 소유권 검사가 있는 API만 사용하고 ERP 저장 API를 호출하지 않는다.
날짜 미지정/미확정은 확정 출고 매출에 포함하지 않는다. 특수비고의 자유 텍스트 날짜를 추측하지 않고
수량분배/출고일 지정이 저장한 ShipmentDate를 사용한다.

메뉴 기준: 반응형/페이지 스크롤/표 가로스크롤/키보드/실패 표시/가이드 적용.
업로드·초안·원장 저장 전 확인은 해당 없음(읽기 전용). 가이드는 합성 자료만 사용.
