# 차수피벗 대비/비고/엑셀 변경내역

## 사전 기준
사용자 스크린샷35-01: 어두운 차수헤더에 글씨색 직접지정 없음. 비고는 오른쪽 끝7px nowrap, 엑셀 차수피벗 시트에는 비고열 자체 없음.
- UI 헤더는 모든 확정상태 배경에서 흰 글씨를 명시한다. 테마 전역 th 글씨색보다 우선.
- 기존 pvDescrOpen을 상단 비고(변경내역) 토글로 노출. 수량칸 아래에도 기존 outDescr를 표시하고, 오른쪽 집계비고는 업체명과 줄바꿈/가독성 개선. 숨김은 UI만, 원문삭제/DB변경 아님.
- 엑셀 차수피벗 시트에 매 차수 수량 변경내역 텍스트열 추가, 업체별 기존 descrMap을 그대로 묶음. 화면 숨김과 무관하게 출력. 수량셀은 숫자/SUM 유지, 텍스트열 합계 제외.
- 기존 조회의 같은 연도 범위를 사용. API/SQL/업무키/단가/수량/입고/출고/재고 산식 변경 금지.
- 조회 응답에 비고가 있는 0수량 품목도 유지. 삭제되어 응답에 없는 과거 원장을 새로 복원하지 않는다.
- 기존 설치된 xlsx-js-style을 다운로드 writer에만 적용해 비고 줄바꿈을 저장한다. 업로드 reader는 기존 xlsx 그대로.

## 근거/부작용
dnSpy.Console.exe -t FormShipmentDistribution 실제 실행: btnSave_Click의 classShipmentDetail.Descr=dr[Descr] 확인. 웹 stock-status GET의 outDescr는 같은 연도/차수/업체/품목의 ShipmentDetail.Descr 집계. 사용자 스크린샷은 운영35-01 표시근거이며 현재 별도 운영 DB probe 및 브라우저 재검증은 연결상태 확인 필요.
모든 이번 동작은 브라우저 렌더/파일 다운로드만. Order/Shipment/ShipmentDate/ShipmentFarm/Estimate/Stock/매출/손익 원장 보존.

## 검증
- test:pivot-adjust, test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest(--changed-from origin/master), guard:erp-writes, build PASS.
- XLSX styled write/read roundtrip에서 숫자·SUM·0수량 비고·텍스트 안전성·wrapText 보존 검증.
- 연결 Chrome 탭 0개로 실제 화면 클릭 검증은 미완료. 배포 자동 스모크와 구분해 보고한다.
