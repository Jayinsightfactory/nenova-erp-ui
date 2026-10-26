# 인보이스 중량 전달·빈 초안 복원

## 근거와 기준
- 실제 운영 UI 읽기: 44-1 송장25529 원문 확인창 GW759.7kg, quote `GRSWGHT 759,70`; 입고 초안 GW/CW는 공란. 39행 매칭과 날짜/Farm 자동입력은 정상.
- 원인: adapter가 review_evidence의 값을 읽지 않음. saved draft 재개는 새 source의 중량을 무시함.
- 실제 dnSpy ExcelLoadingPackingList 재확인: 기존 상세/헤더→uspCreateWarehouse→uspStockCalculation 순서 보존. SQL writer/SP 수정 없음.
- 원문 evidence 우선, 명시 null/단위충돌/비숫자는 미확인. kg만 자동입력. NET→CW, GW→CW 대체 금지.
- saved draft는 같은 sourceHash/documentId/연도/차수일 때 미입력 중량만 보완. 수기값/명시0/수기삭제/기등록/결과불명 보존.
- CW 미입력은 화면에서 원문 없음/확인 후 입력 안내. 원가 필수값 검증 유지, 임의0 저장 금지.

## 부작용
| 동작 | 웹 초안 | Warehouse/Stock | Order/Shipment/Estimate/WebProfitReport |
|---|---|---|---|
| 분석값 연결/중량 수정 | 화면만; 명시 저장 시 기존 revision 경로 | 보존 | 보존 |
| 격리 입고·원가 시험 | 로컬 fixture만 | 기존 writer 시험 | 보호 스냅샷 비교 |
| 코드 배포 | 스키마 변경 없음 | 운영 쓰기 없음 | 보존 |

UI 기준: 기존 페이지 스크롤/표/키보드 입력 적용, 새 메뉴 및 새 shell 해당 없음. 계약 invoice-auto-flow 적용. 실제 비용 없는 CW/환율/운임은 TEST_ONLY로 시험.
