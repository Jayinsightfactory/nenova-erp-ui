# 출고분배 행내 월~일 입력
사용자: 버튼 대신 행 옆 월화수목금토일 수량칸과 월/일. 실제 dnSpy outputs/inline-dnspy.txt FormShipmentDistribution ymd1..7/day1..7 및 ShipmentQuantityToEstQuantity 확인. native WeekDay=일1..토7, 웹은 월2..일1 표시순서.
표시/초안은 Order*, SD/Date/Farm, Stock*, Estimate/Profit 모두 보존. 저장은 기존 canonical date-only preview/snapshot/lease/gate/serializable/audit 경로만. writer/수량/금액/확정 정책 변경0. 묶음 읽기는 Master 연도+차수+업체+품목, 실제 PeriodDay timestamp. 화면 기준 날짜/수량과 새 canonical context 비교 후 다르면 덮어쓰기 차단. 달력추정/0가짜주문 금지.
날짜초안 존재 시 기존 수량저장 비활성. 차수/품목/업체/탭 미저장보호. 월~일/실제날짜/합계/소수/0/음수/달력누락·중복/교차연도/동시변경/견적·이카운트·매출보존/Chrome1920·390·키보드/안내영상/필수ERP gates 검증.

확인한 운영 달력: 2025/46 11/12~11/18,2026/46 11/11~11/17 각각7요일. 실제 월~일 배열은 원차수 달력의 요일순서이며 날짜순 강제/ISO 새 날짜 생성 없음.
격리SQL: full baseline의 0날짜 보존·Master업체(상세CustKey NULL)·이전연도99·다른연도달력 fallback0. 기존 canonical Date저장 actual SQL의 gate/lease·fixed·정확7일·15견적단/172500gross/ECOUNT XLSX·rollback/stale/교차연도 및 Order/Farm/Stock/Estimate/Profit 보존 PASS.
Chrome 합성자료: 월~일/실제날짜7칸, 행에서0.4+0.6 직접입력, 합계부족 확인버튼차단, 상단수량저장/CtrlS 차단, preview행값승계→명시저장, 출고일지정·업체탭 동일입력, stale canonical GET이면 입력/저장차단, 행날짜취소/탭이동차단,390화면 PASS. 기존 전체 workspace 및 양연도 미국 catalog/선주문등록 브라우저 PASS. 운영 쓰기0.
