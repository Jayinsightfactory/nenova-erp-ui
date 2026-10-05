# 라움 손익계산서·이미지 주문등록 — nenova.exe 근거

## 2026-09-22 복합단위 참조 보정

FormWarehouseView dnSpy CLI GetData/GetDetail 재실행. WebArrivalCost SELECT에서 Aisha 원본 단당1송이, 호텔 단-5스팀, Product 단당5송이 확인. 명시 포장수로 웹 참조만 환산하며 CostPrice/원본원가/ERP 원장은 보존. 01-2/1-2는 숫자 차수로 합쳐 표시한다. 상세 근거는 work-reports/2026-09-22_hotel-arrival-repair.md.

## 2026-09-21 도착원가·환율 비교

후속 read-only probe: 수국 Product.SteamOf1Bunch=0이나 원가 RawJson.cells의 단당 수량=1 확인. 원본 명시 포장수만 참조 단가 환산에 사용한다. 원본 송이원가×포장수와 원본 단원가가 대조되는 경우에만 통관비의 송이→단 환산을 FX 미리보기에 적용한다. 불명확한 비용 단위는 비교 계산을 차단한다.

로컬 dnSpy CLI로 FormWarehouseView.GetDetail의 WarehouseDetail.UPrice/TPrice 조회를 재확인했다. 호텔 원가 참조는 WebArrivalCostLine + Product SELECT만 추가하며 EXE 저장/SP 경로는 추가하지 않는다. 운영 읽기 probe에서 라움37차 수국의 결산 단위 `대`와 원가 단위 `단`을 확인했다. 참조 계산에서만 대/st를 송이로 정규화하고 Product 환산필드를 사용한다. 단위 불명은 원본값과 경고를 표시한다. 신라 cost history의 화면 제외 분기를 제거하되 PartnerCode/OrderYear 조건은 유지한다. 환율 비교는 브라우저 추정이고 저장/엑셀에 포함하지 않는다. Estimate, ShipmentDetail.Amount/Vat/isFix, WebProfitReport 보존.

## 기능 경계

라움·초이문 손익계산서와 이미지 OCR 초안은 웹 전용 화면이다. 이미지·가격·적요·결산 미리보기는 `WebRaumPnl`/`WebRaumPnlItem`에 저장하며(`PartnerCode`로 라움/초이문 분리), 품목 선택은 기존 `Product` 마스터를 조회한다. 전산 분배 대조·이미지 주문등록의 거래처는 `Customer.CustName` LIKE(라움/트라움 또는 초이문)로 고르고, `OrderWeek`만으로 Master를 찾지 않는다.

이미지 초안의 주문등록만 nenova.exe 주문등록 경로와 공용 `OrderMaster`/`OrderDetail`에 기록한다. 농장분배(`ShipmentFarm`), 출고수량(`ShipmentDetail.OutQuantity`), 출고일(`ShipmentDate`)은 이미지 주문등록에서 생성하거나 수정하지 않는다. nenova.exe 주문등록 화면이 신규 주문 저장 시 빈 `ShipmentMaster`를 준비하는 동작은 `ShipmentMaster`가 없을 때만 재현하며, 기존 출고 상세는 보존한다.

## dnSpy/CLI 확인

- 원본: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\FormOrderAdd.cs`
- CLI 절차:
  `dnSpy.Console.exe --no-color -t FormOrderAdd "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`
- 현재 환경에서는 비대화형 stdout 핸들에서 dnSpy.Console이 `System.IO.IOException(핸들이 잘못되었습니다)`로 종료되어, 동일 원본에서 생성된 decompile 파일과 read-only SQL 근거를 함께 대조했다.

확인한 FormOrderAdd 동작:

- `CheckExistingOrder`: `CustKey + OrderYear + OrderWeek + isDeleted=0`으로 기존 `OrderMaster`를 찾는다.
- `btnSave_Click`: `ClassOrderMaster.Insert/Update` 후 `OrderDetail`을 `ProdKey`별로 저장하고 `OrderHistory`에 주문수량/미발주수량 이력을 남긴다.
- 신규 저장 시 `ShipmentMaster`가 없으면 `OrderYear + OrderWeek + CustKey`로 빈 마스터를 만들고 `OrderYearWeek = OrderYear + OrderWeek.Substring(0, 2)`를 저장한다.
- `GetDataProduct`: `Product`를 기준으로 기존 `OrderDetail`을 LEFT JOIN하고 `od.isDeleted=0`을 적용한다.

## 웹 구현 불변식

### 차수별 매입단가 비교 (2026-08-26)

- 웹 전용 저장자료의 비교 기능이며 EXE 저장 동작을 추가하거나 변경하지 않는다.
- 기준 원천: `WebRaumPnlItem.CostPrice` → GET cost-history → 공용 순수 비교 helper → 상세표 오른쪽 표시.
- 같은 연도·거래처의 활성 결산만 읽는다. 품목키+단위로 비교하고 양쪽 모두 미매칭인 경우에만 정확한 품목명+단위를 사용한다. 수동 행은 일반 행과 분리한다.
- 매입 참고단가/학습단가로 과거 저장값을 덮지 않는다. 미입력과 0을 구분하며 같은 차수에 다른 단가가 있으면 모두 표시한다.
- `WebRaumPnl`/`WebRaumPnlItem` SELECT만 추가한다. 신규 GET의 DDL, 데이터 저장, ERP 원장 변경은 없다.
- `Estimate`, `ShipmentDetail.Amount/Vat/isFix`, `WebProfitReport`, 주문/출고/재고는 보존한다. 엑셀과 인쇄 생성기는 변경하지 않는다.
- 운영 화면 읽기 근거: 2026-08-26 기존 라움 28차 저장 상세에서 수국 화이트/장미/카네이션의 저장 매입단가와 매칭 품목 표시 확인. SQL 스키마는 기존 loadRaumPnlDetail의 동일 필드 확인. 직접 DB 연결 환경 부재로 독립 SQL probe는 미수행하며 배포 후 읽기 화면 값 대조로 검증한다.

### 차수별 매입단가 관리 (2026-09-01)

- EXE에는 라움·초이문 웹 결산 원장이 없으므로 주문·출고·재고 저장 동작을 복제하지 않는다. 기존 웹 전용 `WebRaumPnl`/`WebRaumPnlItem` 저장값만 관리한다.
- 조회 범위는 사용자가 고른 `OrderYear + PartnerCode`의 활성 결산이며 현재 연도 추정값을 쓰지 않는다. 열은 `PnlKey + MajorWeek`, 행은 기존 비교 기능과 동일한 품목키(`ProdKey + Unit + IsCustom`, 미매칭은 정확한 품목명+단위+수동구분)다.
- 저장은 `OrderYear + PartnerCode + MajorWeek + PnlKey`를 잠근 뒤 화면이 읽은 `ItemKey + CostPrice` snapshot과 현재행을 비교한다. 하나라도 달라지면 전체를 취소하고 새로고침을 안내한다.
- 허용 쓰기는 대상 `WebRaumPnlItem.CostPrice/CostSource`와 부모 `WebRaumPnl.UpdatedBy/UpdatedAt`뿐이다. 명시적 0은 보존하고 빈칸은 NULL로 저장한다.
- 과거 차수 수정은 `WebRaumCostPrice` 학습값을 바꾸지 않는다. `Product`, 주문·출고·분배·재고·견적·`WebProfitReport`도 보존한다.
- 손익 목록과 상세의 매입액·이익은 `WebRaumPnlItem.CostPrice × Qty`를 조회 시 계산하므로 저장 후 재조회에서 새 단가가 반영된다.
- 신라 저장 상세에서도 매입단가 칸을 직접 편집할 수 있다. 저장은 전체 결산 재업로드가 아니라 기존 신라 전용 단가 API를 사용하고, 화면을 열 때의 `ItemKey+CostPrice` snapshot을 재검증해 해당 `CostPrice/CostSource`와 부모 수정시각만 변경한다.
- 화면 표시 전용으로 `WebRaumPnlItem.SalePrice/SaleAmount`를 함께 조회해 각 칸에 견적서 판매가·매입금액(`CostPrice × Qty`, 입력 중에는 draft 값 기준)·견적서 금액·수량을 조밀하게 보여준다. 이 두 컬럼은 GET에서만 읽으며 저장 API/SQL에는 포함하지 않는다.
- 매입단가 관리 화면은 라움과 초이문을 전환하지 않고 같은 연도·대차수·품목·단위를 한 공통 단가 셀로 표시한다. 판매가·수량·매입액·견적액은 거래처별로 분리해 보여준다.
- 공통 단가 저장은 해당 연도·대차수의 활성 라움+초이문 결산을 함께 잠근 뒤 `PartnerCode + PnlKey + ItemKey + CostPrice` 전체 snapshot을 대조하고, 존재하는 양쪽 매칭행의 `CostPrice/CostSource`만 한 트랜잭션으로 수정한다. 한쪽 자료가 없을 때 결산이나 품목행을 새로 만들지 않는다.
- 매입단가 관리 화면(`pages/raum/purchase-costs.js`)은 품목 기준으로 압축 표시한다. 전체 공통 차수 열을 늘어놓지 않고, 각 품목에 실제 데이터가 있는 대차수 셀만 최신순으로 붙여 보여준다(빈 칸 없음). 차수 셀 안의 공통 매입단가·라움/초이문 판매가·수량·매입액·견적액과 수정/저장 동작은 그대로 유지한다.

### 일반행·(사입)행 매입단가 연결 (2026-09-04)

- `lib/raumPnlConsignedCost.js` — DB 접근이 없는 순수 helper. `pages/raum/pnl.js`(실시간 편집), `lib/raumPnl.js`(단일 차수 저장·다차수 업로드 병합/저장), `lib/raumPnlCostComparison.js`(공통 매입단가 화면 identity)가 공유한다.
- 같은 품목의 일반행과 `IsConsigned`(사입) 행은 수량·매출·사입 여부 행을 절대 합치지 않는다 — 오직 매입단가만 연결한다. 연결 기준은 공백을 정규화한 품목명(끝의 `(사입)`/`사입` 표시는 매칭에서만 제거)과 단위가 정확히 같은 경우다.
- 사입행에 직접 입력한 값이나 출처가 없는 기존 값은 덮어쓰지 않는다. 같은 이름·단위의 일반행 후보 단가가 정확히 하나일 때만 빈 사입 단가를 채우고, 이전에 자동 연결된 값은 일반행 단가 수정을 따라간다. 서로 다른 후보가 여럿이면 자동 선택·평균하지 않는다.
- 손익계산서 화면에서 일반행 매입단가를 수정하면 같은 품목·단위의 빈 사입행이나 기존 자동 연결 사입행에 즉시 반영된다. 서버도 모든 저장 경로(`saveRaumPnl`, `saveRaumPnlImportBatch` → `mergedImportedItems`) 직전에 같은 helper로 재보장하므로 저장·다시 열기·파일 재업로드 병합에서도 규칙이 유지된다.
- ProdKey가 있는 행은 기존 identity(`prod:ProdKey|unit|customPart`)를 그대로 쓴다. ProdKey가 없는 행은 (사입) suffix를 제거한 품목명+단위 기준으로 공통 매입단가 화면에서도 같은 셀에 묶인다.

- 업무키: `OrderYear + OrderWeek + CustKey + ProdKey`
- `OrderMaster.Manager`는 `UserInfo.UserID`로 해석한다.
- `OrderYearWeek`는 전산 raw 형식인 `OrderYear + 대차수`만 사용한다.
- 이미지 등록은 100% 매칭·수량 양수 검사를 통과한 뒤 `/api/orders`의 기존 트랜잭션 경로를 사용한다.
- 이미지 매칭 패널의 `매칭 저장`은 `WebRaumPnl/WebRaumPnlItem` 결산 초안만 저장하고 패널을 닫는다. `주문등록`은 별도 버튼에서만 실행되며, `초기화`는 화면의 업로드·매칭 상태만 비우고 저장된 결산/전산 주문을 변경하지 않는다.
- 같은 품목이라도 가격이 다르면 결산 행을 합치지 않는다. 주문등록 요청에서는 가격을 제거하고 `ProdKey + 단위`별 수량만 합산한다.
- 라움 이미지 표의 단위는 `박스`, `단`, `스팀(대)` 3종으로 인식한다. 공유 DB/nenova.exe 저장 시 `스팀(대)`는 기존 전산 canonical 값인 `송이`로 변환하며, 주문의 세 환산수량 공식은 `/api/orders`의 기존 경로를 그대로 사용한다.
- 2026-07 샘플 표에서 확인된 현장 약칭(몬디알, 화이트스프레이/스노우플레이크, 코랄리프, 프라도민트, 도젤, 지오지아, 두바이, 휘슬러, 피피)은 이미지 원문을 보존한 별도 매칭 검색명으로만 보정한다. 원문 품목명/매칭 품목 마스터를 변경하지 않는다.

## read-only downstream 확인 항목

### 신라 품목 연결/통합 단가 표시 — 2026-09-07

- 메인이 기존 `FormOrderAdd.cs`의 `GetDataProduct` 326행부터 직접 재확인했다. Product.ProdKey와 OutUnit/박스·단·송이 환산필드는 독립적이다. 새 dnSpy 실행 결과로 주장하지 않는다.
- 신라 결산의 사용자가 선택한 품목 연결은 웹 결산행 ProdKey만 저장한다. EXE 주문 저장/확정 경로를 호출하지 않으며, Product·주문·출고·재고·견적 원장은 보존한다.
- 활성 Product 검색과 저장 시 활성 재검증은 같은 `isDeleted=0` 기준이다. 신라 행의 연도/차수/부모/행/기존 원본 snapshot을 잠금 대조한다. 전역 이름 학습은 금지한다.
- 같은 ProdKey+단위는 차수별 매입단가 화면에서 함께 보지만 신라 가격과 라움·초이문 공통 가격은 별도 저장한다. 단-5스팀/8스팀 등을 단으로 추정 환산하지 않는다.
- 실행형 회귀: `shillaPnlProductMatch.test.js`, `shillaPnlCombinedPurchaseCost.test.js`, `shillaPnlIntegration.test.js`. 운영 검증은 사용자 자료를 임의 변경하지 않는 화면 조회·검색으로 한정하며 실제 연결 시험 수행 여부는 최종 보고에 구분한다.

### 동일 호텔 자동 연결 후속 — 2026-09-07

- 사용자 요청으로 명시 옵션에서만 선택연도·신라·정확 품목명/단위 그룹의 빈 연결을 함께 채운다. 다른 기존 연결 충돌은 전체 취소한다. 신라 엑셀 preview/save도 유일한 활성 품목 연결을 같은 helper로 재사용한다.
- 기존 단일행 경로는 옵션 생략/false에서 유지한다. 공통 연도 잠금 후 부모/행/Product 순서로 재검증하며, GET에는 자동 쓰기를 추가하지 않는다.
- 원본명·수량·금액·단가·비율과 ERP 원장은 그대로다. dnSpy의 주문/분배/재고 경로를 추가 호출하지 않는다. `shillaPnlHotelMatch.test.js`가 다른호텔/연도/단위/custom/충돌/해제/실패rollback 및 원본값 불변을 검사한다.

### 미매칭 일괄 연결 — 2026-09-07

- 같은 호텔 자동 연결을 여러 품목에 대해 한 번에 명시 적용한다. GET은 원본명+단위별 미연결 그룹만 반환하며, POST는 선택 그룹의 구성과 연결 상태를 잠금 재조회 후 모두 성공하거나 모두 롤백한다.
- `FormOrderAdd.GetDataProduct`의 Product 식별키와 단위를 다시 읽어 확인했다. 이 기능은 결산용 연결키만 바꾸므로 EXE 주문·확정·재고 프로시저를 호출하지 않는다. 원본 수량과 판매가/매입가, 금액, 기존 연결은 보존한다.
- 실제 읽기 근거: 직전 운영 반영 5af40aa8의 신라 35차 6개 미연결 품목과 한글 쉬머 검색의 국가·길이별 후보를 확인했다. 독립 운영 SQL 연결은 없으며, 실제 자료 저장 시험과 읽기 확인을 구분하여 보고한다.
- 회귀: `shillaPnlBulkMatch.test.js`의 연도/호텔/단위/완전한 그룹 snapshot/활성 Product/부분 실패 롤백, `shillaPnlBulkMatchUi.test.js`의 선택·검색·저장 확인과 실패 안내.

- `ViewOrder`: 선택 연도·차수·라움 `CustKey`·품목이 보이는지
- `OrderDetail`: `BoxQuantity/BunchQuantity/SteamQuantity/OutQuantity/EstQuantity`가 품목 단위 규칙으로 채워지는지
- `ShipmentMaster`: 신규 주문 시 빈 마스터만 생성되고 기존 `ShipmentDetail`이 없는지
- `ShipmentDetail`, `ShipmentDate`, `ShipmentFarm`, `Estimate`, `WebRaumPnl`: 이미지 주문등록 전후 수량/금액/행이 보존되는지
# 2026-09-15 모든 호텔 차수별 매입단가·도착원가 참조

- 라움·초이문 공통 단가 계약은 유지한다. 신라 및 `WebPnlHotel`의 활성 등록 호텔은 각 `PartnerCode` 안에서만 `WebRaumPnlItem.CostPrice/CostSource`를 수정한다.
- 아래 2026-09-15 원가 조회 범위는 2026-10-05 다음1차 참조 보정으로 대체되었다. 상세 웹 표의 도착원가 참조는 `WebArrivalCostLine`을 `OrderYear + ProdKey + IsCurrent=1`로 읽는 조회 전용 정보다. 선택 대차수 자료가 있으면 그 세부차수를 모두 표시하고, 해당 품목에 선택 대차수 자료가 없을 때만 같은 연도의 가장 가까운 이전 대차수 세부차수를 `이전 최신 차수`로 표시한다. 미래 차수와 이전 연도 값은 사용하지 않는다.
- 단위 환산은 `Product.SteamOf1Box/BunchOf1Box/SteamOf1Bunch` 근거가 있을 때만 한다. 이 참조값은 `loadRaumPnlDetail` 원장이나 엑셀/인쇄 모델에 저장하지 않는다.
- EXE 주문·출고·재고·견적 원장은 모두 보존한다.

### 2026-10-05 신규 호텔 매칭

메인 dnSpy CLI 실행: `C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe --no-color -t FormOrderAdd "C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe"`. 이번에는 성공하여 FormOrderAdd 소스 출력을 확인했다. GetDataProduct는 Product.ProdKey와 OutUnit/단위환산 필드를 구분한다. 저장된 decompile의 동일 메서드도 재확인했다.

읽기 전용 운영 probe: WebPnlHotel 활성 은화 `hotel_87bc41c16ae5`, 2026 결산 1건. Customer 활성 신라호텔 446, 라움 680, 초이문 683, 호텔여분 690. 이름으로 임의 선택하지 않으며 실제 연결은 사용자가 고른 활성 CustKey만 저장한다.

품목 연결 동작은 WebRaumPnlItem.ProdKey와 부모 감사 필드만 변경하고 업체 연결 동작은 WebPnlHotelCustomerMap만 변경한다. Product, Customer, OrderMaster/Detail, ShipmentMaster/Detail, ShipmentDate/Farm, StockHistory, Estimate, WebProfitReport는 보존한다. 품목 연결은 같은 호텔·연도에만 재사용하며 전역 이름 학습 및 ERP 분배 수정은 활성화하지 않는다.


### 2026-10-05 호텔 다음1차 도착원가 참조 보정

- 은화호텔 2026년 39차 `ItemKey=7738`, `ProdKey=2330` 왁스 화이트의 매칭·단위(`단`)는 정상이다. 읽기 전용 DB probe에서 같은 연도 `40-1`의 활성 양수 도착원가가 확인되었으나 기존 `MajorWeek<=39` 조건이 이를 제외했다.
- 명시적인 웹 업무 근거는 `lib/raumPnl.js:lookupErpRefPrices`의 호텔 N차 참조창 `N-02 + (N+1)-01`이다. EXE가 이 웹 전용 원가 참조 정책을 정의한다고 주장하지 않는다. 당차수 기존 표시를 보존하면서 정확히 같은 연도 다음 대차수의 1차만 추가하며, 다음2차·더 먼 미래·다른 연도는 계속 제외한다. 당차수와 다음1차가 모두 없을 때만 이전 최신 대차수로 대체한다.
- 로컬 dnSpy CLI 재실행(성공): `C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe --no-color -t FormWarehouseView "C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe"`. `GetData`의 `wm.OrderYear/OrderWeek`, `GetDetail`의 `WarehouseDetail.UPrice/TPrice` 조회를 확인했다. 저장된 decompile `C:/Users/USER/nenova-decompiled/Nenova/FormWarehouseView.cs`도 대조했다.
- 실제 helper의 읽기 전용 조회 결과: `7738 → 40-1 / 11450.6709원/단`, `isNextHotelWeek=true`. 같은 세부차수 중 최고 원가를 선택하는 기존 규칙을 보존했다. 출처: `CHINA 중국 원가자료 (40-1차) - 해상.xlsx`, `해상` 42행, `MELODY`.
- 읽기 범위는 `WebArrivalCostLine + Product`뿐이다. `WebRaumPnlItem.CostPrice`, 원본 도착원가, 주문·분배·입고·재고, `Estimate`, `ShipmentDetail.Amount/Vat/isFix`, `WebProfitReport` 모두 보존한다. 참조는 화면 JSON에만 포함되며 엑셀·인쇄 저장 모델을 바꾸지 않는다.
- 실행 fixture는 `__tests__/raumPnlArrivalReference.test.js`: 39→40-1, 40-2/41-1 제외, 2025/2027 동일 상품 제외, 현재+다음1차 표시순서, 양쪽 없을 때 이전 최신, 잘못된 차수 문자열, 배치 조회의 품목별 선택차수, source/cost 불변을 확인한다.


### 2026-10-05 모든 호텔 저장 매입단가 참조

- `/api/raum/hotel-cost-history?year=2026`은 인증된 GET만 허용한다. `listPnlHotels`의 기본·활성 등록 호텔을 대상으로 해당 연도 활성 `WebRaumPnl`의 저장 `WebRaumPnlItem.CostPrice`만 SELECT한다. NULL은 제외하고 0은 보존하며 호텔 코드와 등록부 이름을 함께 반환한다.
- 운영 DB 읽기 검증: 2026년 764행(라움 499, 신라 213, 초이문 50, 은화 2), 다른 연도 0행, NULL 원가 0행, 명시적 0원 1행. 은화 39차 왁스 화이트 `ProdKey=2330`의 저장값은 `8280원/단`이다. 별도 도착원가 참조 `11450.6709원/단`으로 덮거나 대신 표시하지 않는다.
- 같은 상품이라도 다른 단위·수기행은 구분한다. 다른 호텔 간 비교는 같은 양수 ProdKey+단위+수기여부가 모두 맞는 경우만 가능하며 품목 미연결 행의 이름 fallback은 현재 호텔 내부로 제한한다. 저장값의 환산·합산·평균·자동복사는 없다.
- 이 조회는 EXE 저장 경로를 추가하지 않는다. 위 FormWarehouseView 읽기 근거와 공유 Product 식별자를 사용하며 주문/분배/재고/견적/매출 원장을 모두 보존한다. 기존 현재호텔 비교 API와 가격 편집 동작도 보존한다.
- `__tests__/pnlHotelCostHistory.test.js`에서 GET-only/auth/year/active registry/0·NULL/서로 다른 저장값 유지/단위·품목키·수기여부 전달/쓰기 SQL 부재를 검증한다.
