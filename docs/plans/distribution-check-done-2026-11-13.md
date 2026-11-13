# 양쪽 분배 탭 카톡 완료 표시·차수 확정현황

농장/업체 탭은 동일 카톡 패널 한 인스턴스를 공유한다. 메시지별 수동 작업완료는 초록색이며 탭/새로고침 후 유지, 해제 가능. 완료는 ERP 저장·확정 근거가 아닌 업무 확인 표시이다. 서버 웹 전용 runtime 파일에 원문/사용자정보 없이 요청 발췌의 SHA256 키·완료여부·revision·시각만 저장한다. 수정된 요청은 다른 키로 취급한다. 동시 수정은 immutable next-event 원자 링크 CAS로 충돌409, 서버 성공 전 녹색 표시 금지.

선택 차수 옆 확정현황 버튼과 빨간 카테고리 버튼은 읽기 전용이다. 설치EXE FormShipmentDistribution dnSpy GetFixStatus의 ViewShipment.DetailFix=1 판정(기존 C-11)을 재확인했고 현재 동일2025/2026 46-01을 SELECT probe했다. 명시 OrderYear+OrderWeek, CountryFlower별 total/fixed 집계. 전부확정은 빨간버튼, 일부만확정은 '(일부)'로 구분, 0건은 확정없음. 조회실패/로딩은 이전차수 결과 대신 상태 표시. 버튼은 해당 차수 현황만 열며 확정/취소/저장을 호출하지 않는다.

| 동작 | 허용 | 보존 |
|---|---|---|
| 탭·카톡 조회/필터·확정현황 | GET, UI 표시 | 모든 ERP 원장 |
| 수동 작업완료/해제 | 웹 runtime 완료 이벤트만 추가 | OrderDetail/ShipmentDetail/ShipmentDate/ShipmentFarm/Estimate/StockHistory/ProductStock/WebProfitReport 및 수량·금액·확정 |

기준: 완료키=SHA256([원본 메시지 identity, 표시 요청 발췌]), 명시boolean/expectedRevision/requestId, 인증·동일사이트 POST·원문/기타필드 거부, no-store. 상태 미조회/저장실패는 체크 미확정 및 오류, 15초 자동조회는 완료상태도 재조회. 양쪽 탭 공통, 다른 사용자의 웹 완료표시도 같은 서버 기록으로 확인한다. ERP 업무키나 네이티브 저장순서 변경 없음.
