# 네덜란드 단가 재조회 복원 — 2026-11-02

사용자 확인: `네노바웹 물량 바로 불러오기` 재조회 뒤 단가가 사라짐.
원인: live 원본은 수량을 재생성하지만 저장된 ShipmentDetail.Cost를 가격 입력에 복원하지 않음. local draft identity가 수량까지 포함하므로 업로드/분배 후 내용이 바뀌면 이전 가격 draft도 찾지 못함.

기준/부작용:
- 같은 OrderYear + OrderWeek + CustKey + ProdKey의 기존 preview.currentCost를 원화 견적단위 단가로 사용. Product.Cost/다른 차수/다른 업체 가격으로 대체하지 않음.
- 재조회 전 미반영 입력은 같은 scope의 정확한 업무키 또는 일치하는 원문 식별자로만 이동. 원문 동일 주소/수량만으로 매칭하지 않음. 0/빈칸 구별.
- DB 현재 단가를 자동 입력과 구별해 브라우저 임시복원에는 변경된 입력만 보존. 단순조회값이 이후 DB 최신단가를 덮어쓰지 않음.
- 같은 품목의 업체별 단가가 다르면 일괄 가격으로 합치지 않고 해당 업체를 개별 단가로 유지. 기존 작업저장·엑셀은 동일 prices/config를 보존.
- 재조회: Order/Shipment/Date/Farm/Warehouse/Stock/Estimate/Amount/Vat/isFix/WebProfitReport 모두 보존. SQL/API writer 변경 없음. 최종반영은 기존 재검증/명시확인/단일사용 plan 절차 유지.

선확인:
- 설치 Nenova.exe를 dnSpy.Console -t ClassShipmentDate 재추출: UpdateCost는 ShipmentDate.Cost 및 ROUND(EstQuantity,0) 기반 Amount/Vat를 SdetailKey 단위로 갱신. 기존 저장정책 유지.
- 운영 SELECT-only 2025/2026 같은44-02 네덜란드: 출고2/122행, 모두양수단가. 2026/44-02/Cust13/Prod1874 Cost16500 isFix1 Date1/Farm0/ViewOrder1/ViewShipment1. 단가 삭제사고가 아닌 UI 복원누락 근거.
- 기준선: 화면틀/스크롤/키보드/복원/명시반영 적용. 새 메뉴·권한·마이그레이션 해당없음. 기존 초안키의 업무 매칭/수량 보호는 완화하지 않고 가격만 별도복원.

검색어: dutch live price restore 재조회 단가 currentCost 44-02

검증 중간 기록:
- pure price + 실제 acceptSource 실행: 저장값/0/빈칸, 업로드 vs LIVE, 재검증 payload, 2025/2026 및 차수/업체/품목 분리 통과.
- test:pivot, 작업저장/엑셀 회귀, dnSpy evidence, manifest, write guard, production build 통과.
- 격리 SQL fixture: Docker가 꺼져 첫 실행 실패. 기존 허용된 로컬 컨테이너를 시작해 전체 통과 후 해당 컨테이너 종료. 운영 DB write 없음.
- 실제 Next+Chrome: 15000/0 로드 → DB16000 최신 반영 → 18500 입력 → 수량 변경 재조회/전체 페이지 새로고침 후18500/0 보존, 각 로드 두 번 read-only preview, ERP apply0회 통과.
- 첫 브라우저 실패는 자동화의 숫자입력 전체선택 실패(기존값 뒤에 붙음). Ctrl+A 실제 키 입력으로 수정하고 입력 직후 값 검증 추가.
- 전체 ERP 계약 첫 실행은 Node native CSPRNG 초기화 실패로 종료되어 재실행 중. 완료/배포는 후속 기록.
- 메뉴 기준선: 적용(기존 화면틀/외부스크롤/키보드 숫자입력/저장복원/명시 ERP반영), 해당 없음(새 메뉴/권한/DB스키마), 예외 없음.
