# 주광 원본 양식 엑셀 다운로드

- 요청: 주광 견적서에서 업로드했던 주광 발주내역 엑셀과 동일한 디자인·셀 양식으로 다운로드.
- 결정: 원본 File을 현재 브라우저 메모리에 보관하고 원본 XLSX ZIP의 명시 연결 숫자셀만 수정. 신규 엑셀 표 생성 금지. 변경이 없으면 원본 바이트 그대로.
- 보존: 품종 구역, 시트·열 순서, 셀 병합·테두리·서식·열 너비·인쇄 설정·그림 및 미연결 셀, 선출고·발주총량·비고·수식. 수량 수정시 Excel full calculation 표시를 설정.
- 수량: 현재 파일 UUID/조회 범위에 연결한 업체·품목·연도·실제 세부차수·날짜·단위의 전산 날짜 합계 또는 절대 초안. 윌슨은 이미 포함된 합계이므로 다시 더하지 않음. ERP 적용 후 초안이 없어져도 원본 연결을 유지.
- 재업로드: 같은 업무키의 기존 입력 수량을 보존하여 새 원본에 연결. 다른 범위 입력은 방해하지 않음. 수량·조회·원본·범위가 다운로드 도중 변경되면 다시 다운로드하도록 오류.
- 제한: 원본 서버 저장 없음. 페이지 새로고침 후 재업로드 필요. 미연결 셀은 원문. XLS 원본 다운로드는 가능하나 수량 변경은 XLSX 재업로드 필요. 단위 불명·중복·이동·수식 셀은 자동 변경하지 않음.
- ERP 부작용: 다운로드는 브라우저 파일 생성만. OrderDetail, ShipmentDetail, ShipmentDate, ShipmentFarm, StockMaster/ProductStock, Estimate/WebProfitReport, 확정 상태 모두 보존. API/SQL 쓰기 변경 없음. 같은 날 직전 주광 변경의 설치 EXE dnSpy 및 읽기 전용 DB 근거 재사용, 원장 보정 없음.
- 검증: 실제 ZIP 내용 보존 및 수식 재계산 표시, 전산 적용 후 연결·교차연도·0/불명·절대값·윌슨 합계 fixture. 필수 ERP 계약/dnSpy/manifest/쓰기 가드/최종 빌드 모두 통과. 실제 Workspace callback 재업로드·비동기 6건, 원본ZIP 보존, 수량연결 5건 및 전체 weekday-distribution 통과.
- 화면: 기준 1920×1080 CSS /100%. CUA 초기화 failed to write kernel assets 오류가 지속되어 기능별 직접 화면 검증 미완료. 테스트 통과 후 사용자 기본 배포 지시에 따라 PR·master·Cafe24·서버 및 Actions 브라우저 smoke 확인.

## PR·배포

PR #939 CI verify 통과(1m32s), master 병합 092e0376c41802c3560b4a5f956c932a727b1d00. Cafe24 자동 배포 run 37573123674 success (4m50s). 서버 smoke 및 Actions 로그인/차수피벗 hydration·일반/팝업 shell 실브라우저 검사 통과, 운영 반영 완료. 원본 ZIP 보존은 실제 바이트/실제 Workspace 콜백으로 검증했으며 대상 UI 직접 화면 검증은 도구 오류로 남음.
