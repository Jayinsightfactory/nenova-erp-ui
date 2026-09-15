# 농장 불량 원본 범위·업체 표시

## 요청과 완료 기준

- 누락으로 보이는 불량 원본의 실제 조회 범위를 검증한다.
- 같은 연도 활성 원본을 모두 조회하고, 선택 기간 밖·차수 확인 필요·분석 제외 사유를 구분한다.
- ‘불량 N건’의 펼친 근거에 업체명과 수량을 표시한다. 내부 CustKey/customerIdentity는 반환하지 않는다.
- 사용자 표시 이름은 ‘불량 분석’. 기존 compact 피드백 목록과 저장·삭제·이미지 권한은 보존한다.
- 기준 viewport 1920×1080, 100%; 작은 화면 겹침·스크롤도 검사한다.

## 사전 근거

- 저장된 실제 dnSpy `FormSalesDefectView.GetData`: ShipmentMaster/Estimate의 금전 불량차감 조회. 품질 원본과 금액 원장을 임의 합치지 않는다.
- sourceSQL: 선택 연도 `WebSalesDefectDeduction`, DeductionType='불량차감', Product 표시명 보조.
- 기존 qualityGroups/qualitySignals는 수입 확인·양수 수량·품목·농장·유효 차수가 있어야 분석한다.
- UI는 단위별·반복 조건별 목록, 농장 상위 12개, 선택 이슈 차수로 일부만 보여준다.
- 운영 읽기 전용 probe: https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/34919316967
- 2026년 원본 436, 삭제 24, 활성 412. 활성 중 미확인 55, 농장 미지정 80, 품목 미지정 0, 0 이하 수량 0, 업체명 누락 0. 사유는 중복된다. 기존 SQL 적격 행은 332.
- CustName 포함 필수 원본 컬럼 존재 확인. 이름·비밀값은 workflow 로그로 출력하지 않았다.
- 운영 기존 화면(de6b86fb) 읽기 확인: 농장·품목 185개, 기본 단위의 자동 이슈 22개.
  기존 ‘미확인/농장·품목 미지정 104행’에는 삭제 24건도 섞여 있어 설명이 부정확했다.
  새 화면은 삭제·활성·보완 필요를 분리한다.

## 데이터 계약과 부작용

| 동작 | 조회 | 변경 |
|---|---|---|
| 전체 원본/펼친 업체 근거 | WebSalesDefectDeduction, Product | 없음 |
| 기존 확인된 불량률 | 위 원본, 동일 연도 ViewWarehouse | 없음 |
| 기간·상태·검색·펼치기 | 받은 원본의 화면 필터 | 브라우저 상태만 |

원본 불량, Estimate, ShipmentDetail Amount/Vat/isFix, OrderDetail, ShipmentFarm,
ShipmentDate, Warehouse, StockHistory, WebProfitReport는 모두 보존한다.
불완전 원본 표시가 기존 피드백 생성 검증을 우회하지 않도록 qualityGroups는 유지한다.
보존식: sourceTotal=activeTotal+deletedCount;
activeTotal=inRangeCount+outOfRangeCount+invalidWeekCount.
기본 목록은 기간 내+차수 확인 필요, 기간 밖 버튼으로 해당 원본도 조회한다.
기존 API 역할·활성 계정 검증을 그대로 사용하고 저장된 업체명만 표시한다.

## 검증 상태

- core/transaction/coverage/UI/compact tests, 전체 `test:erp-contract`, manifest 60개,
  dnSpy evidence, ERP write guard, 최신 master 통합 build 통과.
- 로컬 synthetic fixture만 사용하는 실제 Chrome 검증: 1920×1080, 100%.
  전체 원본 66=활성65+삭제1, 36~37 범위의 활성65=기간내63+기간밖1+미상1.
  기간 밖 버튼은 12차 1행, 보완 필요는 미확인·농장 미지정·차수 미상 3행,
  전체 활성은 단위와 무관하게 65행을 표시했다.
- 표 높이378px, scrollHeight2824px, sticky header; 문서 가로폭1920px, overflow없음.
- 실브라우저에서 업체 상세가 48px grid 칸으로 잘리는 것을 발견해 전체행 span으로 수정.
  재빌드 후 gridColumn='1 / -1', 업체 상세폭886px 확인.
- 기존 피드백 24개 fixture 행117.5px, 선택 상세 전체 이력8개 유지.
- 760×900: 문서폭760px, 표만 내부 가로스크롤; 주요 필터/접기 버튼 화면내 접근 확인.
- 모든 로컬 API를 fixture로 가로채고 GET 외418로 막았다. 운영 저장/삭제/ERP 쓰기 없음.
- 고성능 검토: 연도 선필터 후 dedupe, 표시명만 projection, 업체 grid span 확인. 잔여P0/P1 없음.
- PR https://github.com/Jayinsightfactory/nenova-erp-ui/pull/610. 운영 스모크는 배포 후 기록.
