# 업체 조회 완료 상태 정정

공통차수 PR1672는 CI42933095368 및 Cafe2442934035415로 b34f4fd7 배포 완료.
운영 Chrome 실제2026/45: 수국868의02-only 고객은01=0/02=30/03=0/총30,
01에서도공통3행,품목3178의03 화면에서30/40/90=160과현재03만7입력 확인.
그 뒤 업체정보가 무한 로딩되는 기존 경로를 발견했다. 업무 원장 수정·저장0.

원인: handleSearch가 customerListRequestRef를 증가시켜 주간 useEffect 조회 완료를 무효화한다.
동시에 setLoading 별칭은 현재 farm 탭의 productListLoading만 해제하므로
customerListLoading=true가 남는다. 그룹/품목 변경으로 searchRequest가 바뀌면
handleSearch의 고객 결과도 버려져 목록까지 비는 경로가 있다.

dnSpy 설치 EXE FormShipmentDistribution 재추출: GetOrderWeek/GetCustomerList와
선택 연도·세부차수 조회·저장 순서 확인. 기존 API/SQL을 그대로 호출하는 client-only 정정이다.
운영 읽기 전용 probe: sqlDistributionWorkspaceCustomers('')를2025/2026·45-03으로
실행, 개수/소요시간/식별키 존재 여부만 출력한다. 고객명·개인정보 출력/파일 저장0.

| 기준 | 공통 소비자/정책 |
|---|---|
| 업체 범위 | 명시 year+week, prodGroup='' 전체업체 범위, 기존 SQL 불변 |
| 조회 소유권 | shared loadWorkspaceCustomers가 요청 번호/주간 snapshot을 단독 소유 |
| 완료 | shared callback의 자체 요청 finally가 업체 loading 완료를 보장. 수동 조회의 기존 current-search busy guard는 유지하며 새 요청/연도를 덮어쓰지 않음 |
| 독립성 | product group/searchRequest 변경은 유효한 동일 주간 업체 응답을 버리지 않음 |
| 초기/수동 | useEffect와 조회 버튼이 동일 callback/정책 사용 |
| 오류 | 현재 소유 요청만 오류 표시하고 loading 해제, 이전 요청 오류는 무시 |
| 업무 상태 | 기존 미저장 초안 확인 절차 유지, 자동 주문/분배/날짜 저장0 |

OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, Stock*, Estimate,
ShipmentDetail.Amount/Vat/isFix, WebProfitReport 모두 보존. SQL/API/writer 변경0.
회귀: API를 지연시킨 초기 주간 조회 중 수동 조회 → 완료 후 업체정보 표시;
2025/2026 같은45, 역순 완료와 그룹 전환, 오류 완료·loading 복구, 실제 페이지 확인.
필수 ERP/dnSpy/manifest/writeguard/build 및 가이드 재촬영·CI·배포·운영 검증 후 완료한다.

로컬 최종검증: 실제callback4/지연API 수정전FAIL·수정후2025·2026 PASS/전체Chrome workflow·공통축/격리MSSQL index·writer 및 견적15단·172500원·ECOUNT XLSX 보존 PASS. 전체ERP/dnSpy/manifest213/writeguard0API/최종npm build1worker PASS. 가이드175.85초·6단계·24조작 재촬영/첫중간끝5프레임·실재생/한국어VTT/목차/다운로드2/1920·390 PASS. 운영 ERP 쓰기0. 후속PR·CI·운영배포는 이 기록 시점 미검증.
