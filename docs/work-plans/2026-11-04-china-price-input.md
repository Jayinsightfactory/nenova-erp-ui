# 중국 물량표 분배단가 입력 기준표

## 요청과 범위
중국 자동물량표에서 업체×품목 단가를 입력하고 명시 등록·분배 적용 시 저장한다.
사용자 확인: 실제 저장·재조회는 격리 SQL에서만 수행한다. 운영 시험 쓰기 금지.
박스번호는 기존 웹 메타데이터이며 ERP 가격/수량으로 변환하지 않는다.

## 구현 전 근거
- 2026-11-04 설치 Nenova.exe에 dnSpy.Console을 실행: FormShipmentDistribution.btnSave_Click은 Cost, ROUND(EstQuantity) 기준 Amount/Vat를 상세에 저장하고, 수량이 같으면 ClassShipmentDate.UpdateCost로 날짜별 금액만 갱신한다. 두 경로는 한 transaction이다.
- ClassShipmentDate.UpdateCost 실제 SQL: Amount=ROUND(Cost*ROUND(EstQuantity,0)/1.1,0), Vat=Cost*ROUND(EstQuantity,0)-Amount.
- SELECT-only scripts/probe-china-price-read.cjs: 2026/45-02, CustKey533/ProdKey3384/SdetailKey101048, Out25/Est25/Cost10500/Amount238636/Vat23864, DetailFix=true, ViewOrder1, DateQty25, FarmRows0. 확정행이며 테스트 변경하지 않는다.
- 기존 China preview는 명시 unitPrice를 거부한다. 기존 공유 writer는 이미 단가와 날짜 금액 readback을 제공하므로 이를 재사용하고 새로운 SQL writer를 만들지 않는다.
- 오래된 DB_STRUCTURE/WEB_VS 환산 설명보다 실제 native와 실행형 distributeUnits/chinaOrderUnits를 우선한다. 환산식 변경 없음.

## 기준과 소비자
|기준|값/원천|소비자|
|---|---|---|
|업무키|명시 year/week/custKey/prodKey|표시 초안, preview, 잠금 apply, readback|
|단가|KRW, Product.EstUnit 기준; 빈칸/누락=null(기존 보존), 명시0 유효; 0..1e9 유한값|공통 순수 정규화 함수, 화면→entries, 서버 normalizeDutchEntries|
|저장본|기존 CellsJson.unitPrice; 과거 없는 필드=null|작업 저장/복원, 수정, 인보이스 재적용|
|범위|중국 explicit pairs만; 업체 간 자동 전파 없음|기존 preview/snapshot/writer|
|확정/동시수정|기존 공통 snapshot/fixed 검사 보존|preview/preflight/transaction|
|단위|분배수량 OutUnit, 단가 EstUnit|기존 monetary writer; 수량 환산 변경 없음|
|재매칭|서로 다른 품목의 가격은 자동 이관하지 않음|기존 대상 셀의 가격만 보존|
|다운로드|이번 요청은 웹 입력→ERP 저장; 기존 수량 XLSX 포맷 보존|export|

## 사용자 동작별 부작용
|동작|웹 작업본|OrderDetail|ShipmentDetail/Date|Farm|Stock/Estimate/WebProfitReport|
|---|---|---|---|---|---|
|단가 입력|브라우저 초안; preview 무효화|보존|보존|보존|보존|
|작업 저장|기존 WebChinaVolumeBoard CAS 저장|보존|보존|보존|보존|
|검증|읽기/서버 plan|보존|보존|보존|보존|
|등록·분배|명시 plan|기존 주문 보존, 없는 양수 주문만 기존 native 생성|기존 SET 수량 + 명시 단가/Amount/Vat 원자 저장; 날짜 readback|가격만 변경 시 보존, 수량은 기존 정책|직접 변경 금지|

## 검증 계획
실행형 양성/반례: 공란·누락·0·양수·음수·NaN·false·상한초과, 과거 작업본, invoice 재적용, 교차연도,
실제 SQL 단가만/수량+단가/신규양수/0원/확정/동시변경/후반실패 rollback/금액 readback 변조.
현재 단계는 구현 전 기준이며 완료/배포 증거가 아니다.

## 후속 실행 기록
- China/Dutch 실제 격리 SQL fixture 모두 PASS. China UI helper가 만든 payload를 실제 preview/apply에 전달해 저장 후 별도 SELECT로 Cost/Amount/Vat를 대조했다. 테스트 DB는 이름·localhost·컨테이너 무마운트 가드 후 생성하고 종료 시 해당 DB만 정리했다.
- 추가 운영 SELECT: 같은 업무키 InGetDetail1, 확정 판매금액238636/Vat23864, ShipmentDate Cost10500/Est25/Amount238636/Vat23864. 전년도 같은 업무키 행 없음. 원장 쓰기 없음.
- 가격 단위는 분배 OutUnit이 아니라 기존 ERP EstUnit이며 검토창에 표시한다. 수량/금액 환산식을 새로 만들지 않았다.
- 최초 로컬 build는 page collection의 ERR_INVALID_PACKAGE_CONFIG로 실패. 의존성 JSON/resolve 정상 재확인 후 CIRCLE_NODE_TOTAL=2로 동시 worker를 줄여 build PASS. 운영 빌드 설정은 변경하지 않았다.
