# 승인 인보이스 원가를 기존 도착원가 본표에 연결

## 의도와 기준
- 업로드 재작업 없이 승인된 ACTUAL 원가를 기존 검색/품종/차수/농장 본표에서 읽는다. 저장 자체는 기존 WebInvoiceCostRevision/Line이 정본이다.
- 조회 때 ERP와 현재 문서 버전을 기존 readInvoiceCosts로 대조한다. STALE/DRAFT/EXPECTED_95는 현재 원가로 승격하지 않는다.
- 엑셀 원장과 인보이스 원장을 복제하거나 덮지 않는다. 같은 품목의 출처별 차이는 비교로 표시하고 합산하지 않는다. 인보이스는 입고·상세·승인버전 키로 중복 제거한다.
- 페이지 검색·품종·누락 판단·페이지 개수는 동일한 가상 읽기 원천을 사용한다. 연도+숫자 세부차수를 유지한다.
- 인보이스 행은 이 페이지의 매칭/배분 저장 대상이 아니다. 수입부 업무도구에서 수정·재승인한다. 환율 미리보기는 국가별 승인공식과 다른 기존 단순식 적용 금지.

## 부작용
| 동작 | WebInvoiceCost* | WebArrivalCost* | Warehouse*/Product/Order*/Shipment*/Stock*/Estimate/WebProfitReport |
|---|---|---|---|
| 기존 도착원가 본표 조회 | 현재 승인 읽기 | 읽기 | 보존(입고·품목만 SELECT) |
| 원가 승인 | 기존 writer 그대로 | 복제 없음 | 기존 계약 그대로 |

## 선검증
- 실제 dnSpy.Console.exe -t FormWarehouseView 실행. GetData/GetDetail은 WarehouseMaster/Detail/Product 읽기, 삭제 이벤트의 StockHistory/native 계산은 이번 기능에서 호출하지 않음.
- 운영 태국2026/38-01 Warehouse7345와 승인87E5F1E7의19행, 362단·3184993.955819KRW를 읽기 대조할 것. 교차연도 fixture 포함.
- 메뉴 기본값: 기존 shell/페이지 스크롤 적용, 출처/수정경로 명시, 인보이스 행 저장 버튼 없음. 새로운 ERP 쓰기/신규메뉴 해당없음.

## 검증 상태
운영 SELECT로 기존 엑셀19행과 승인19행 확인. 통합 SQL 조회는 INVOICE19행만 기본반환하고 비교19행 보존. 실제 listArrivalCost/varieties API 코어로 태국19행/비교19행/태국품종 확인. 운영 쓰기 없음. 전체 gate/브라우저/배포 진행 중.
