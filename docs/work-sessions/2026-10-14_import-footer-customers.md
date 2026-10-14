# 엑셀 분배 검증표 하단 업체명

| 항목 | 내용 |
|---|---|
| 기간 | 2026-10-14 |
| 화면 | /shipment/distribute-import 검증 후 피벗 비교표 |
| 원장 부작용 | 없음: 표시 전용 |
| 배포/PR | 검증 및 배포 진행 중 |
| 이어받기 | 하단 합계의 업체명 표시만 변경. 수량·환산·업로드 동작 보존 |

## 고정된 결정 / 구현 전 기준

- Q. 검증 후 시트 위에만 있는 업체명을 아래 총계에도 표시해 달라.
- A. 상단과 동일한 model.customers 순서와 c.name을 하단 합계 셀에 함께 표시한다.
- 합계는 기존 c.uploadQty 및 fmt를 그대로 사용한다. 필터 적용 범위도 변경하지 않는다.
- 긴 업체명은 줄바꿈하며 새 버튼·탭·스크롤 영역을 만들지 않는다.
- API/SQL/업무키/엑셀 파서/환산/최종 저장은 변경하지 않는다.

| 사용자 동작 | Order/Shipment/Date/Farm | Warehouse/Stock | Estimate/Amount/Vat/isFix/WebProfitReport |
|---|---|---|---|
| 기존 검증 결과 하단 보기 | 전부 보존 | 전부 보존 | 전부 보존 |

## 기준선

- 적용: 기존 shell·표 가로 스크롤·키보드 동선 유지, 1920×1080/100% 기준.
- 해당 없음: 새 입력·새 저장·새 매칭·권한·ERP 조회/쓰기 정책.
- 예외: 표시 전용 변경으로 새 운영 DB probe/저장은 수행하지 않음. 기존 dnSpy/View 계약을 검토하며 ERP parity 재인증으로 주장하지 않는다.
- 지정된 docs/CODEX_SUBTASK_ORCHESTRATION.md는 최신 master에도 없음.

## 검증

- 실행형 shipmentImportFooter: 동일 이름/서로 다른 고객키, 긴 이름, 0, 소수/천 단위 합계, 필터/열순서 변경, 빈 모델, 2025/2026 별도 모델 렌더 및 원본 불변 통과.
- 기존 shipmentImportCustomerChoiceUi에서 새 테스트를 함께 호출하므로 test:shipment-import 및 ERP gate에 포함.
- 실제 PivotComparison을 로컬 fixture로 브라우저 확인: 1920×1080/100% 상·하단 모든 열의 x/width 일치, 긴 이름 줄바꿈 및 합계 수량 아래 정렬 확인. 768px에서도 문서폭 768px, 표1287px는 내부 가로 스크롤로 유지. 새 조작부/모달/포커스 변경 없음.
- npm run verify:erp-change 통과(exit 0): board, 전체 ERP 계약, dnSpy evidence, manifest, 쓰기 guard, Next 생산 빌드. 운영 배포 확인 진행 중. 운영 분배 실행은 하지 않는다.
