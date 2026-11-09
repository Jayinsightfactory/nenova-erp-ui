# 업로드 업체 선택 및 담당업체 분배단가 — 2026-11-09

## 근거와 기준표
- fresh origin/master ba8ec4d76. dnSpy CLI 실제 FormShipmentDistribution 재실행: GetCustomerList는 연도+차수+업체로 ViewOrder/ViewShipment를 연결하고 Customer로 업체명 조회. FormOrderAdd 기존 golden의 주문저장 계약 유지.
- SELECT-only: Customer 경원원예277/원당 태광플라워491/아이엠（미우）456. 공유 매칭에 남대문청화☆→277, 미우→456, 양주태광→592 존재. 남대문경원/원당태광의 정확 저장 별칭 없음.
- AppLog 2026-10-30 17:25:23 Cust277/46-01 7품목, 17:48:03 Cust491/46-01 4품목. 11월9일 이 두 키 주문등록 로그 없음. 2026/46차 두 업체/미우 ShipmentDetail0. 현재 증거로 미우 오등록 원인이나 발생시각 단정 불가.
- 현행 uploadFile은 이전 cust를 전송; metadata 매칭 실패 시 import-parse는 이전 선택으로 fallback. 화면은 이를 자동매칭 성공으로 표시. 단가 있으면 orderPrice 강제. 이 재현 가능한 위험 경로를 제거한다.

|동작|주문|출고/날짜/농장|견적/매출/손익/재고|
|---|---|---|---|
|파일분석/업체선택/담당자목록|보존|보존|보존|
|주문등록만(기본)|기존 FINAL_SNAPSHOT 계약|기존 빈 연결헤더만, 실제분배 보존|기존 계약 보존|
|별도 분배단가수정|보존|기존 update-cost의 Cost/Amount/Vat만, 수량/날짜/isFix 보존|기존 update-cost 계약 유지|

- 매 업로드: 기본 mode=order. 이전 orderPrice/priceOnly/가격열 유무 무관.
- 파일 업체 자동판정 불가: 이전 업체 승계 금지, 명시 재선택 필수. 공유 붙여넣기 resolver 규칙 변경 없음.
- 업체목록: 선택 연도+대차수, 활성 ShipmentMaster와 ShipmentDetail이 존재하는 업체. 담당자=Customer.Manager→UserInfo.UserID. 미지정 별도 그룹. 색+문자 레이블 병행. 선택된 업체/세부차수로만 기존 writer 호출.
- 새 탭: 주문즐겨찾기/거래명세표 Excel 옆 버튼, 파일업로드 초안 유지, 주문등록 radio에서는 priceOnly 제거. 담당자 그룹 선택은 읽기전용 표시.
- 교차연도: 2025 동일차수 제외/2026만 선택. 단가0은 유효 입력 유지. omitted/stale mode는 order로 초기화.
- 필수검증/실브라우저/가이드영상/CI/배포는 진행 후 결과를 기록한다.

## 47차 실제 원본 재현
- 업무 드라이브에서 11월9일 15:51 남대문경원, 16:04 원당태광 업로드 원본 확인. 각 본문 Sheet1은7/4행, 참고 `장미,카네이션 물량`은13행. 기존 rowCount+pricedCount*2 점수는 참고 시트를 선택.
- 참고 제목의 미우와 별도 셀07차를 첫12행 문자열 연결로 합쳐 `*미우 (아이엠) 카네이션 / 장미 발주서 구분 품종` /07차 추출. 공유 저장별칭 미우→456에 fuzzy 일치해 실제 resolver가 미우456을 반환함을 SELECT 자료로 재현.
- 수정 후 동일 두 원본은 Sheet1, 업체 남대문경원/원당태광,47차,7/4행. 원당태광은 기존 resolver491, 남대문경원은 확인된 업로드 전용 별칭→현재 Customer.CustName 정확 경원원예 유일키277로 조회. 공용 매칭 문서/운영 주문 수정0.
- 템플릿은 실제 파일/개인정보를 저장하지 않는 synthetic7/4 대 참고13행 회귀 fixture. 업체명+차수 일치 우선, 차수 불일치 차단, 명시 시트 선택, 셀연결07차 오인 방지, 별칭 누락/중복 차단.

## 읽기전용 검증
- 동일 세 키의 2025/47차 ViewOrder63/ViewShipment63/ShipmentDate63/ShipmentFarm0; 2026/47차는 모두0. 2026 대상 확정매출0(행 없음). 이번 조사에서 ERP 쓰기0. 이전연도63건을 현재 주문으로 취급하지 않음.
- 수정 import-price-customers handler를 실제 SELECT 어댑터로 실행: 2026/45차 HTTP200, 분배업체67(담당지정66/미지정1), 담당자 그룹명 모두 존재. 실제 담당자 개인정보는 증거파일 미저장.
- 브라우저 연습 fixture1920/390: 가격열 있어도 order 초기화, orderPrice선택 후 재업로드도order, 업체미매칭 해제, 별도탭+담당자그룹+재조회, Tab/ShiftTab, 원장쓰기 차단 PASS. 영상은 최종 source 변경 후 재촬영.

## 메뉴 기본값 판정
|기준|판정|근거|
|---|---|---|
|공통 shell/1920·390 화면/페이지 세로스크롤|적용|기존 _app 단일 shell, 담당목록 내부 높이 제한 제거, 실제 브라우저 캡처|
|키보드/명시 저장/오류 안내|적용|기본 button/radio/search, Tab·ShiftTab 검증, 기존 저장 확인 재사용, 업체 미확정 등록차단|
|매칭 범위/원장 보호/연도|적용|업로드만 명칭별칭, 글로벌 저장변경0, 기존 FINAL_SNAPSHOT/update-cost writer, 2025/2026 SELECT 대조|
|초안 맥락|적용|가격탭 이동 전 업로드 업체·차수 저장, 복귀·초안저장에 원래 값 유지|
|새 탭 사용 가이드|적용|실제 UI+합성 fixture MP4/한국어VTT/목차/소스해시, WorkflowGuide 연결|
|신규 메뉴·스키마|해당 없음|기존 /orders/import 안 화면 전환, 신규 ERP writer/테이블 없음|
|원장 보정|해당 없음|운영 오등록 확인되지 않음, 조사/촬영 쓰기0|
