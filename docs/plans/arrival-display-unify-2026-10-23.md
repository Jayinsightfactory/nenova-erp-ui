# 최신 원가 표시 통합 (2026-10-23)

## 기준과 부작용
- 사용자: 모든 최신 참고 표시를 승인 인보이스 원가에 연결. 과거 확정 원가·매입액·손익·재고 보존.
- SELECT-only: WebArrivalCostLine/Product, WebInvoiceDocument/Operation/CostRevision/CostLine 및 승인 원가의 live receipt 대조. 조회에서 schema 생성/저장/SP 호출 금지.
- 최신 = 명시 선택 연도의 숫자 세부차수 최댓값. 품목키 정확 연결, 단위 환산 실패를 옛 원가로 숨기지 않음. 농장별 근거 보존.
- 승인 인보이스는 기존 loadArrivalInvoiceRows의 APPROVED ACTUAL/current revision/operation/live MATCH 및 TEST_ONLY 제외를 공유. 기존 현재 엑셀 근거와 합치되 동일 업무범위는 인보이스 우선.
- 화면 단일값이 필요한 카탈로그/피벗은 최신차수의 환산 가능한 농장 최고가(기존 단일값 정책), 근거 차수·단위·출처를 표시. 호텔/원장 비교는 모든 농장 표시.
- 카탈로그 수동 엑셀 override는 명시 예외로 유지/표시. 손익에 자동 입력되는 raumPnl의 기존 getArrivalCostsWithFallback는 변경하지 않음.

| 영역 | 처리 | 보호 |
|---|---|---|
| 도착원가 본표·호텔 비교 | 공용 승인 조회 유지 | 기존 원본·손익 보존 |
| 카탈로그·물량 피벗·전산 피벗 | 최신 참고 공용 조회 | 물량·매출 불변 |
| 입고 상세·운송기준원가·재고평가 상세 | 최신 참고 별도 열 | 당시 실제/계산값 불변 |
| 인보이스 검토/원가 다운로드 | 해당 문서 승인 원가 유지 | 타 송장 최신값으로 문서 바꾸지 않음 |
| 과거 손익·국가평균·확정 엑셀 | 당시 계산 유지 | 최신 참고값 계산 투입 금지 |

## 선검증
- dnSpy.Console --no-color -t FormWarehouseView 실제 실행: GetData WarehouseMaster, GetDetail WarehouseDetail, 삭제 ClassWarehouseDetail 경계 확인.
- SELECT 운영 probe: 2026 현재 엑셀10,592행, APPROVED ACTUAL revision3건. 수정 없음.
- 회귀 계획: 연도/숫자차수/단위불명/복수농장/미승인·stale·TEST_ONLY/조회실패·동시응답/원장보존.
- 기준선: 기존 shell/페이지스크롤/native 키보드 유지, 신규 쓰기·원장 변경 해당없음.
