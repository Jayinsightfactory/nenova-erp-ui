# 2026-11-11 출고분배 농장정보 업체검색

## 요청 / 변경

- 농장정보 탭은 품목을 선택한 뒤 오른쪽에 해당 품목의 업체 분배 행을 보여주지만 업체명 검색 입력이 없었다.
- 거래처 검색 입력을 품목 분배 표 제목 옆에 추가했다. 이미 불러온 업체 행과 화면에서 추가한 미주문 업체 행만 필터링하며, 검색 중 `표시/전체` 개수를 보여준다.
- 검색은 렌더링 범위만 바꾼다. 주문/출고 입력·전체 합계·선택 상태·저장 API/SQL은 변경하지 않는다.
- 회귀: `shipmentDistributionBrowser.test.cjs`의 실제 브라우저 합성 fixture가 `Zulu` 검색 시 대상 행만 남는 것, `1/2곳` 표시, 48단 전체 합계 보존 및 검색 해제를 확인한다.

## 견적서 관리와 출고일 변경

- 농장정보/업체정보의 날짜 셀은 같은 `DistributionInlineDates` → `DistributionDateEditor` → `/api/shipment/distribution-dates`를 쓴다. 저장 확정 전에는 DB 변경이 없다.
- 실제 설치 `Nenova.exe` dnSpy CLI로 `FormShipmentDistribution` 및 `FormEstimateView` 재추출(exit 0): `FormEstimateView.GetPrintDetail/GetExcelDetail`은 `ViewShipment`-`ViewOrder`, `ShipmentDate.ShipmentDtm=PeriodDay.BaseYmd` 정확 일치, `DetailFix=1`, 양수 `ShipmentDate.EstQuantity`를 조회한다.
- 따라서 날짜 저장 후 견적서 관리의 해당 날짜별 수량/표시와 견적·ECOUNT 출력일이 바뀐다. 총 출고수량·견적수량·총 매출·확정상태는 날짜 저장 가드가 보존한다. 날짜별 공급가/부가세 분할은 반올림으로 소액 재배분될 수 있으며 저장 전 미리보기에 금액 차이가 안내된다.
- 원장 영향표: 업체검색=ERP table 전부 preserve(읽기/표시만). 기존 날짜 편집은 `ShipmentDate`의 같은 상세 날짜배분만 교체하며 `OrderDetail`, `ShipmentDetail.OutQuantity/Amount/Vat/isFix`, `Estimate`, 재고, `WebProfitReport` 보존.
- SQL 변경·운영 DB 쓰기 0. 기존 실제 운영 read-only 견적 진단 근거는 `docs/exe-golden/FormShipmentDistribution.md` 및 `docs/exe-golden/FormEstimateView.md`에 있다.

## 검증

- `node __tests__/shipmentDistributionBrowser.test.cjs`: PASS; synthetic rows filter to the matching farm tab customer, `1/2곳` count updates, 48.00 total stays unchanged, clear restores rows.
- `node --test __tests__/shipmentMajorInlineDates.test.cjs __tests__/shipmentDistributionCustomerLoading.test.cjs`: PASS.
- `node scripts/test-distribution-dates-sql.cjs`: PASS (격리 SQL fixture, 운영 쓰기 0).
- 실행한 dnSpy CLI: `FormShipmentDistribution`, `FormEstimateView` 모두 exit 0. 임시 추출 로그는 사용자/customer 데이터를 포함할 수 있어 저장소에 넣지 않는다.
- `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, changed manifest 213건, write guard(변경 API 0), `npm run build`: PASS.
- workflow video를 합성 API·1920×1080으로 재촬영. `npm run test:workflow-guides`, numbered guide 검증, 첫/중간/마지막 프레임 검토 및 Chrome HTML5 재생·자막·목차·390px player 확인: PASS. 가이드 길이184.9초/20fps, 업체 검색 입력과 결과가 장면3에 포함.
- CI, Cafe24 배포 및 운영 브라우저 smoke는 후속.

검색어: 출고분배, 농장정보, 업체검색, customer search, DistributionDateEditor, ShipmentDate, GetPrintDetail, GetExcelDetail, PeriodDay
