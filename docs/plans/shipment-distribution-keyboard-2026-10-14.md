# 출고분배 선택·키보드·확정 수정이력

## 구현 전 기준

- 사용자 요청: 차수/품목/업체 버튼 선택, 담당자별 품목 즐겨찾기, 키보드 연속 작업, 품목 A–Z, 수량 변경 비고와 붙여넣기 수정이력 공유.
- 선택 기준: Ctrl+Alt+1 차수, 2 품목, 3 거래처, 4 수량; Ctrl+Enter 조회. 화면에 안내하고 브라우저 표준 입력 방향키를 보존한다.
- 즐겨찾기: 기존 UserFavorite의 로그인 UserID + page namespace로 구분한다. 품목은 ProdKey로 식별하며 즐겨찾기 목록도 ProdName A–Z다.
- 저장 전 변경은 임시 비고, 저장 후 verified=true일 때만 완료. 삭제된 출고 상세도 불변 작업 기록에서 이전→이후 수량을 볼 수 있어야 한다.
- 별도 DISTRIBUTE 이력은 절대 출고수량 변경이다. 카톡 ADD/CANCEL 요청 또는 전달 완료 증거로 변환하지 않는다.

## 읽기 근거

- 로컬 실제 Nenova.exe FormShipmentDistribution dnSpy CLI 재확인: outputs/distribution-keyboard-native.txt. 기존 ShipmentDetail 저장 및 ShipmentDate 동기화 경로 유지.
- 2026-10-14 운영 읽기 전용 probe: 2026-41-02 / ProdKey2429 / CustKey478 출고48, 상세95862; CustKey436 출고0. 2025-41-02 동일 품목 조회는 빈 결과. OutUnit=단. 비밀 없는 결과 outputs/distribution-keyboard-read-probe.json.
- 기존 paste-history는 SHIPMENT_ADJUST_BATCH/UNDO만 조회하며 상세 삭제는 ShipmentHistory 조인 연결을 잃는다. SystemActionLog의 NVARCHAR(MAX) Payload에 같은 트랜잭션에서 확정 snapshot을 기록한다.
- 실제 수량 단위는 Product.OutUnit이다. 주문행 표시 단위와 혼동하지 않는다.

## 원장 부작용 표

| 동작 | 읽기 | 허용 쓰기 | 보존 |
|---|---|---|---|
| 선택/검색/단축키 | 기존 분배 GET | 없음 | 모든 ERP 원장 |
| 담당자 즐겨찾기 | UserFavorite | 본인 UserID의 UserFavorite | ERP 원장 |
| 수량 편집 | 화면 초안 | 저장 전 없음 | 원장/완료 상태 |
| 명시 저장 | 정확한 연도+차수+업체+품목 | 기존 ShipmentMaster/Detail/Date, ShipmentHistory, 같은 트랜잭션 SystemActionLog | 기존 농장·확정 차단, OrderDetail, Estimate 직접 생성 금지, StockHistory/WebProfitReport 정책 |
| 붙여넣기 수정이력 | SystemActionLog와 품목/업체 이름 | 없음 | 카톡 요청/전달 판정 |

## 완료 기준

- 기준 1920×1080, 100% 및 작은 화면에서 잘림/겹침/버튼/표 스크롤 확인.
- Tab/Shift+Tab, 방향키/Home/End, Enter/Space, Escape, 단축키 초점 이동과 초점 표시 확인.
- 계정 전환 즐겨찾기 분리, stale 조회 무시, 저장 실패 초안 유지, 성공 readback, 0 삭제 이력, 교차연도 검증.
- 필수 ERP 계약/dnSpy/manifest/write guard/build 통과 후 PR/master/Cafe24 배포 및 읽기 전용 실브라우저 확인.
- 메뉴 기준선: 적용—공통 shell, 페이지 주 스크롤, 키보드, 명시 저장/오류 피드백. 해당 없음—신규 메뉴 등록/인쇄 양식. 기존 일자·농장·집계 기능 유지.

## 상태

구현 및 로컬 필수 검증 완료. ERP 계약, dnSpy, 변경 manifest/쓰기 가드, UI layout, production build 통과. 실제 브라우저5개 테스트에서 키보드·계정별 즐겨찾기·조회/저장 대기 잠금·실패 초안 유지·늦은 이전차수 응답 차단·거래처 단가 보존을 확인했다. 격리 SQL과 실제 이력 컴포넌트 검사도 통과했다. PR/master/Cafe24 및 운영 스모크는 후속 단계다.

상세95862의 읽기 전용 downstream 근거는 Amount305455/Vat30545, 날짜48/1행, 농장0행, MasterFix0, ViewOrder/ViewShipmenttrue, DetailFix1 조건 견적 GetDetail0이다. 2026대차수41 보고서 확정본/이력0. 기존 견적 노출을 보정하지 않는다.

## 후속 요청: Enter 수량 이동 / Ctrl+S 저장
- Enter는 현재 화면의 다음 활성 수량 입력으로 이동하고 값을 선택한다. 마지막 행에서는 저장 버튼에 초점만 이동하며 자동 저장하지 않는다.
- Ctrl+S는 현재 모드의 기존 저장 버튼과 동일한 경로를 호출한다. 조회/저장 중, 완료 모달, IME 조합 및 반복키는 중복 저장을 만들지 않는다.
- UI 입력 동작만 변경하며 기존 연도/차수 업무키, API, native 원장/이력/견적 정책은 유지한다. 위 dnSpy와 동일 업무키 읽기 근거를 재사용한다.
- 메뉴 기본값 적용: 키보드, 발견 가능한 안내, 1920x1080 및 작은 화면 검증. 해당 없음: 신규 메뉴, 신규 매칭/대량반영 및 원장 쓰기 정책. 예외 없음.
