# 라움 손익계산서·이미지 주문등록 — nenova.exe 근거

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
- 화면 표시 전용으로 `WebRaumPnlItem.SalePrice/SaleAmount`를 함께 조회해 각 칸에 견적서 판매가·매입금액(`CostPrice × Qty`, 입력 중에는 draft 값 기준)·견적서 금액·수량을 조밀하게 보여준다. 이 두 컬럼은 GET에서만 읽으며 저장 API/SQL에는 포함하지 않는다.

- 업무키: `OrderYear + OrderWeek + CustKey + ProdKey`
- `OrderMaster.Manager`는 `UserInfo.UserID`로 해석한다.
- `OrderYearWeek`는 전산 raw 형식인 `OrderYear + 대차수`만 사용한다.
- 이미지 등록은 100% 매칭·수량 양수 검사를 통과한 뒤 `/api/orders`의 기존 트랜잭션 경로를 사용한다.
- 이미지 매칭 패널의 `매칭 저장`은 `WebRaumPnl/WebRaumPnlItem` 결산 초안만 저장하고 패널을 닫는다. `주문등록`은 별도 버튼에서만 실행되며, `초기화`는 화면의 업로드·매칭 상태만 비우고 저장된 결산/전산 주문을 변경하지 않는다.
- 같은 품목이라도 가격이 다르면 결산 행을 합치지 않는다. 주문등록 요청에서는 가격을 제거하고 `ProdKey + 단위`별 수량만 합산한다.
- 라움 이미지 표의 단위는 `박스`, `단`, `스팀(대)` 3종으로 인식한다. 공유 DB/nenova.exe 저장 시 `스팀(대)`는 기존 전산 canonical 값인 `송이`로 변환하며, 주문의 세 환산수량 공식은 `/api/orders`의 기존 경로를 그대로 사용한다.
- 2026-07 샘플 표에서 확인된 현장 약칭(몬디알, 화이트스프레이/스노우플레이크, 코랄리프, 프라도민트, 도젤, 지오지아, 두바이, 휘슬러, 피피)은 이미지 원문을 보존한 별도 매칭 검색명으로만 보정한다. 원문 품목명/매칭 품목 마스터를 변경하지 않는다.

## read-only downstream 확인 항목

- `ViewOrder`: 선택 연도·차수·라움 `CustKey`·품목이 보이는지
- `OrderDetail`: `BoxQuantity/BunchQuantity/SteamQuantity/OutQuantity/EstQuantity`가 품목 단위 규칙으로 채워지는지
- `ShipmentMaster`: 신규 주문 시 빈 마스터만 생성되고 기존 `ShipmentDetail`이 없는지
- `ShipmentDetail`, `ShipmentDate`, `ShipmentFarm`, `Estimate`, `WebRaumPnl`: 이미지 주문등록 전후 수량/금액/행이 보존되는지
