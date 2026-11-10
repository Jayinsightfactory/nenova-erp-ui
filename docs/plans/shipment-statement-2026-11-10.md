# 출고내역서 구현 기준

요청: 홈 출고내역서 메뉴, 연도+메인차수 전체 세부차수 조회, 담당자→업체, 기본출고요일 잔량, 개별요일 수정, 국가+품목군 묶음, 저장+요일별 업체 XLSX. 추가 요청: 드래그 여러 품목 선택 후 출고일 일괄 지정. 실제 ERP 날짜 변경은 범위 밖.

## 기준 ledger
|항목|정본|소비자|
|---|---|---|
|연도·메인차수 필수|사용자+scope, SELECT-only probe|list/open/save/export|
|전체 실제 세부차수|명시연도+두자리 메인차수 prefix|공용 SQL reader|
|활성 Master/Customer/Product, 양수 상세|ViewShipment/EXE+probe|목록/편집/저장재검증|
|상세 CustKey NULL 허용|실제EXE/2026-10-02 정정|Master.CustKey 기반조회|
|수량/단가|sd.OutQuantity/Cost 원값, 단가NULL은 미등록,0원보존|sourceRows/편집/XLSX|
|품목합산|ProdKey+단위+단가, 원본 PK/차수 연결보존|공용core|
|달력|선택연도+메인차수 PeriodDay 7개 exact날짜, 수~화|화면/출력|
|기본요일|기존 저장설정 우선, 없으면 Customer.BaseOutDay 0수1일2월3화4목5토6금|공용allocation/편집/출력|
|기본요일변경|명시지정 보존, 미지정 잔량만 이동|공용allocation/미리보기/저장|
|일괄지정|선택행 전체수량을 지정요일 최종값으로 대체, 변경표 후 명시적용|bulkMove/브라우저|
|분류|국가+꽃 품목군 키, 하나의묶음만,미지정기본출력|preferences/outputBlocks|
|쓰기권한|기존ERP와같이 로그인한 사용자; 담당자는필터|withAuth/API|
|웹작성본|연도+메인차수+CustKey별불변버전,CAS|store/read/export|
|원본변경|원본hash변경409,명시초기화 후재작성|load/save|
|동시저장|expectedVersion대조+exclusive atomic hardlink|store|

## 원장 부작용
조회는 ERP SELECT만. 편집은 브라우저초안만. 저장은 SERIALIZABLE 읽기 원본 재검증 후 data/runtime/shipment-statements/{year}/{major}/{customer}/{revision}.json에 별도작성본만 저장. 스키마추가 없음. 런타임영역은Git제외이며기존code-only배포가보존. 기존revision은덮어쓰거나삭제하지않음. actorUserId/저장시각/원본snapshot보존. 고객기본출고요일DB는보존하며웹설정은다음차수에재사용.

OrderDetail/ShipmentDetail/ShipmentDate/ShipmentFarm/Estimate/WebProfitReport/ProductStock/StockHistory 모든 ERP 쓰기0, SP0. Amount/Vat/isFix/ShipmentDtm 보존. 실제날짜편집 메뉴와 API를 재사용하지 않는다. 엑셀은 저장된 exact version만 export하며, 다운로드실패는저장성공과구분. 원본 변경 뒤에도 이전저장본 다운로드가능.

## 메뉴 기본값 판정
|기준|판정|근거|
|범위·개선|적용|신규메뉴와Layout한줄등록만|
|단일shell/페이지스크롤/1920·390|적용|실제브라우저 회귀. 가로표 및명시dialog만스크롤예외|
|키보드|적용|checkbox ↑↓/Space·Shift범위,표준Tab,dialogEscape·초점복귀|
|이동맥락·미저장|적용|scope변경확인,beforeunload/SPA이동확인,요청seq fence|
|파일업로드·매칭|해당없음|원본ERP읽기만;첨부는출력양식참고|
|ERP실제반영전확인|해당없음|ERP writer없음;일괄요일대체는미리보기후명시적용|
|초안·이력·진행|적용|웹작성본불변revision/재조회/CAS,실패재시도표시|
|전산안전|적용|실제dnSpy+양연도운영SELECT,계약+실행회귀|
|사용가이드|적용|실제최종화면·합성API녹화,한국어VTT/5목차/화면연결|
|검증·배포|진행중|최종결과WORK_MEMORY에append|

실제 증거: docs/exe-golden/ShipmentStatement.md. 신규 회귀는 test:shipment-statement 및 pretest:erp-contract에 연결. 운영개인정보/인증정보촬영없음. 실제브라우저시험·가이드모든API는합성fixture,운영ERP쓰기는하지않음.

최종 로컬: 전체 ERP pre/core/post·dnSpy·manifest209·writeguard1API·ui-layout·workflow11업무12영상·webpack1worker build PASS. 빌드된production서버의1920/390 실제Chrome에서드래그/키보드/기본요일/그룹/저장·복원·엑셀/가이드재생PASS. 운영배포결과는WORK_MEMORY후속기록.
