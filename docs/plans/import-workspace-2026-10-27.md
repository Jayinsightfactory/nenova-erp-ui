# 입고 / 원가 작업 분리

## 추가 요청: 연도·차수 기본값과 입고내역 진입
- 기준: 기존 getCurrentWeek/stepWeek, 클라이언트 mount 후 현재연도(현재2026) 및 현재차수-01. 사용자가 연도/차수 수정 가능. 세부차수01~04 순환과 연도이월은 기존 공용 helper 그대로.
- 조회: OrderYear+OrderWeek 필수, WarehouseMaster SELECT-only. 원가 생성 진입은 기존 WebInvoice 문서 연결을 확인. 원가 다운로드는 기존 승인/STALE/원장대조 검증 유지.
- 부작용: WarehouseMaster/Detail, Stock, ShipmentDate/Farm, Estimate, WebProfitReport 모두 보존. 조회나 다운로드가 입고/원가를 승인하지 않음.
- 원가 문서가 없는 전산-only 입고는 원본 인보이스 연결 필요 안내. 수량/금액/환율을 추정해서 저장하지 않음.
- 검증: 이전연도 동일차수, 미입력/0/배열/유효입력, 500건 제한, SQL 쓰기 부재 fixture.

요청: 입고와 도착원가를 별도로 수행하고 기존 입고를 다시 등록하지 않는다. 패킹 화면의 중복 설명·진단은 접어서 필요할 때만 본다.

## 기준 및 부작용

| 동작 | 기준 | Warehouse / Stock | 웹 문서 / 원가 |
|---|---|---|---|
| 입고 작업 | 기존 preview/commit/readback, 명시 실행 | 기존 계약 유지 | 원가 자동 승인 금지 |
| 원가만 작업, 연결 완료 | 현재 revision COMMITTED operation + readback | 보존 | 기존 원가 검토/다운로드 |
| 기존 전산 입고 연결 | 기존 link-existing의 연도·차수·농장·송장 및 품목/수량/금액 대조 | SELECT만, native writer/SP 호출 금지 | 초안 및 감사 연결만 저장 |
| 연결 불가/미지원/응답 불명 | 자동 신규 입고 fallback 금지 | 보존 | 명확한 오류·재조회 안내 |

기존 전산 연결 지원은 NL/CN/TH 계약을 보존한다. 다른 국가는 웹에서 이미 등록된 동일 문서를 재조회할 수 있지만 전산-only 연결은 검증되지 않은 채 확대하지 않는다.
0/누락/revision stale은 같은 서버 검증을 유지한다. 화면 전환은 문서를 unmount하거나 입력을 버리지 않는다. 원가 계산식·엑셀 양식·환율 기본값 변경 없음.

2026-10-27 실제 dnSpy CLI ExcelLoadingPackingList를 실행해 MakeTempTable / InsertMaster → uspCreateWarehouse → uspStockCalculation을 확인했다. 원가만 경로는 이 경로를 호출하지 않는다. 기존 읽기 probe 근거: docs/exe-golden/FormWarehouseUpload.md. 이번 세션 운영 DB 직접 조회는 미검증.

실제 Chrome 격리 production-build 화면에서 기존입고 연결→원가 입력, 탭 왕복 환율1350 유지, 입고 재등록 비활성을 확인했다. 시험 API: 입고 commit0 / 기존연결1 / 원가승인0. 실제 운영 입고/원가 저장 시험이 아니다. 55회귀, 원가69통과9선택skip, 전체ERP계약·dnSpy·manifest·write guard 통과. 세부 기록: docs/work-sessions/2026-10-27_import-workspace.md.
