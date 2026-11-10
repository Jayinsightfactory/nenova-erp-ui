# 2026-11-10 출고분배 두 작업공간 재구성

## 사용자 기준 / EXE 근거
- 사용자 최신 지시가 기존 A-Z only/공통 품종필터 규칙보다 우선한다. 즐겨찾기 국가·품종·품목 우선, 같은 우선순위 안에서 A-Z. 미즐겨찾기는 하단, 삭제/누락으로 처리하지 않는다.
- actual dnSpy CLI FormShipmentDistribution outputs/native-dual.txt: txtOrderWeek_EditValueChanged는 ViewOrder.CountryFlower(국가+꽃) 선택. GetProductList→grdViewShipment→Farm은 품목 중심, GetCustomerList→grdViewCust_FocusedRowChanged는 업체/날짜 중심. native ShowGroupPanel=false이며 웹의 품종 접기/즐겨찾기 우선은 사용자 요청 확장이다. native의 Week-only SQL은 재사용하지 않고 명시 연도+차수 유지.
- 농장정보: 국가 선택 → 즐겨찾기 품종/품목 우선의 품종 펼치기/접기 → 품목 선택 → 거래처/농장. 접기 자체는 작업품종·수량을 바꾸지 않는다. native 일괄분배의 작업품종은 명시 선택/선택 SKU의 실제 국가+꽃으로 유지.
- 업체정보: 차수의 업체 목록·업체 검색/주문없는 업체 → 해당 업체 품목. 농장 탭의 국가/품종 선택을 후보나 품목 필터로 전파하지 않는다. 두 작업공간의 선택과 초안을 보존한다.
- 두 탭에 저장 출고일 보기(전체/미지정/실제 날짜) 제공. 표시 분류는 실제 ShipmentDate 양수 수량의 일자, 주문만 있고 날짜가 없거나 주문없는 후보는 미지정. 일자별 입력은 기존 공용 DateEditor만 사용. 목록 수량은 차수 합계라고 명시하여 날짜별 수량과 혼동하지 않는다.

| 동작 | Order* | ShipmentDetail/Date/Farm | Stock* | Estimate/WebProfitReport |
|---|---|---|---|---|
| 즐겨찾기 우선정렬·품종 접기 | 보존 | 보존 | 보존 | 보존 |
| 탭별 후보·출고일 분류 조회 | 보존 | 보존 | 보존 | 보존 |
| 수량·단가 명시 저장 | 기존 정책 | 기존 writer | 기존 guard | 기존 downstream |
| 출고일 명시 저장 | 보존 | 기존 date-only transaction | 보존 | 보존 |

## 기준 원장
- 분류 GET workspaceDateIndex: OM/OD/Product/Customer 활성 + 선택 OrderYear/Week, SM은 연도/차수/업체 일치, SD는 품목 연결, Date는 실제 양수 ShipmentQuantity. SD.CustKey NULL 정상, Master.CustKey 권위. 단가/매출 집계나 DDL 없음. 임의 ISO 달력 추정 없음.
- 공용 date lookup은 상품/업체/업체+상품 세 키의 실제 날짜 집합을 만든다. NULL 행은 미지정. 없는 후보도 미지정. 조회 실패는 오류로 표시하고 미지정으로 단정하지 않는다.
- 날짜·화면 필터/접기는 초안만 보존하며 save 대상/총량을 변경하지 않는다. 저장 범위와 native SP 선택 키는 기존 정책 유지, Country-only를 꽃 단위 write key로 사용하지 않는다.
- 교차연도/즐겨찾기0·false/접기 유지/외부 검색/독립된 업체 선택/날짜 다중행/날짜 미지정/실패·stale/부분 수량 보존 및 양수 주문등록 경로 회귀. 실제 합성 Chrome1920/390/키보드와 안내영상, 필수 ERP gates/CI/배포/운영 조회.

## 최종 안전 동작
- 업체 탭은 농장 작업품종을 참조하는 상단 확정/취소/꽃 일괄분배를 표시하지 않는다. 업체 수량 저장의 기존 해당 변경품목 확정사이클은 유지한다.
- 미저장 수량·단가가 있으면 탭 변경을 차단하고 저장/변경취소를 안내한다. 정상 탭 이동 시 기존 선택 업체·품목을 다시 조회해 반대 탭에서 저장한 최신 값을 반영한다. 추가 업체 조회는 순차 실행하여 공용 요청 세대값으로 앞 업체 응답이 무효화되지 않게 한다.
- 현재 UI 합성Chrome: favorite-first 가족/SKU, 접기 Enter, 실제 날짜 필터, 두 탭+출고일지정 공용 날짜편집 미리보기/명시저장, 독립 업체 미국품목, 2025/2026 빈45-03 품목추가, 미저장 탭이동 차단, 390뷰포트 PASS. 기존 전체 workspace browser 저장실패/재시도/중복저장/단가/업체이동/선등록/담당자/늦은응답/뷰포트 회귀도 PASS. 운영 쓰기0.
- 기존 downstream 실제SQL fixture를 재실행하여 양수주문→native shipment date/금액→견적/ECOUNT XLSX 및 이전연도 보정 sentinel·rollback PASS. 이카운트 서비스 입력/수정 없음.
