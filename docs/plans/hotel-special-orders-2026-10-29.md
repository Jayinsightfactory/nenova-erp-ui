# 호텔 특수매칭·최종수량·누락·이력

사용자: DB 없이 특수매칭 합산, 저장한1/2/3차 수정, 총수량 등록 전 조절/누락, 등록 히스토리, 소수 올림/내림/반올림.

|동작|기준/소비자|OrderMaster/Detail/History|ShipmentMaster/Detail/Date/Farm·Estimate·WebProfitReport·Stock|
|---|---|---|---|
|특수매칭|직접입력 이름 NFKC/공백정리+정규단위, 같은 이름/단위만 합산. 실제 ProdKey 없음. owner/year/week 초안에 저장|보존|보존|
|차수 수정|명시 n차 수정 후 품목/수량/단위 수정. 원본 증거 보존. 최종수량 조절과 업체분류 초기화|보존|보존|
|최종수량|원본 합산 별도 보존, 명시0 유효, Product.OutUnit 일치 검증, 같은 helper로 분류/미리보기/등록|보존|보존|
|누락|행 유지, 합산/분류/등록에서는 제외, 되돌리기 가능. 미매칭도 제외 가능|보존|보존|
|소수 조절|현재 표시 단위의 정수 ceil/floor/round, 명시 버튼만, 음수/빈값/NaN 거부|보존|보존|
|최종 등록|연도+차수+업체+품목 합산을 기존 my-customer ADD/expectedCurrentQty로 전달. 기존 주문에 가산, 단위/중복/미분류는 차단|기존 writer 변경|기존 주문전용 보존 계약|
|히스토리|의도/원본합계/최종값/누락/특수항목 snapshot을 먼저 서버CAS 저장. receipts 실제응답/전후 수량/상태 보관. 잠금 이후 snapshot 불변|보존|보존|

## 증거
2026-10-29 실제 dnSpy CLI FormOrderAdd btnSave_Click·UnitQuantity 재확인: Master→Detail(Out/Est 별도)→History. 웹은 기존 my-customer ADD·expectedCurrentQty 정책 재사용(SQL 변경 없음).
SELECT-only 2026/45-01 Cust680: ViewOrder0(2025 동일키0), ViewShipment0, ShipmentDate0, ShipmentFarm0, 연결Estimate0, 확정Amount/Vat0, DetailFix=1+ViewOrder+PeriodDay 견적노출0. 직접 쓰기 없음. 과거 DB_STRUCTURE의 IDENTITY/CASE 현재수량은 실제 writer/golden과 충돌하므로 따르지 않음.

## 검증 기준
2025/2026 동일차수, 특수이름/단위경계, 1/2/3차 합산·수정, 누락·복원·명시0, 소수3방식, stale 단위, 서버CAS/잠금 이력, 기존 ADD before/after, 부분실패 및 응답유실. 운영 시험주문 생성하지 않음. 브라우저 격리환경으로 등록까지 검증.
메뉴 기준: 기존 shell/페이지세로스크롤/키보드/등록 전 확인/서버 초안·히스토리 적용. 가로표·모달 스크롤 예외. 실브라우저1920/작은화면 확인 후 PR/CI/배포.

## 실행 검증
- WebProfitReport 2026/45 SELECT-only0. 관련32개 실행 테스트 통과.
- 실제 컴포넌트에 격리 API 주입: 특수1.5+2.5+3=7, DB 매칭 POST0. 1차 이름/수량 수정 후 일반 합계11.5, 최종ceil12→라움2/호텔여분10의 ADD 요청, 미매칭 누락·특수 payload 제외. 저장 재열기 및 snapshot 원본11.5/최종12/누락 보존.
- floor11.8→11, round11.49→11, ceil11.2→12, Escape99입력 취소→12.
- 부분실패 모형: 라움10 저장/검증완료, 호텔여분20 응답유실→확인필요. 현재조회15/25, 재등록 비활성.
- 1920x1080 및390x844에서 페이지너비 초과0, 작은화면 히스토리 가로스크롤 보완. 테스트용 instrumentation 비활성은 복원, 임시 로컬 페이지는 제거. 재현 harness는 __tests__/fixtures/HotelOrderWorkspaceHarness.jsx(운영 포함 안 함).
