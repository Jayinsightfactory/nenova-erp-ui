# 입고 전 원본·품목·수량 대조

요청: 기존 최종 입고 확인창에서 품목/수량을 누르면 원본이 확대·강조되어 보이게 한다. 별도 확인 단계나 ERP 계산식을 추가하지 않는다.

## 기준과 소비자
- 문서 연도/차수/농장/송장/lineId: 현재 InvoiceReceiptWorkbench 선택 문서만 사용. 타 문서·타 연도 조회 없음.
- 박스/단/송이: 기존 어댑터 sourceFields의 각각 명시 필드 그대로 표시. null은 미기재, 0은 0. 수량 합산·환산 없음.
- 원본 위치: 해당 sourceFields가 지정한 review_evidence를 보존. 정확한 수량 근거가 없으면 descriptionEvidence의 품목행으로 대체하되 품목행 기준임을 명시. 모두 없으면 위치 확인 필요. XLSX는 유일한 정확 품명행만 강조.
- 확대: 수량 선택 시 PDF 150%, 수동 100~300%. 색상 주황색, 선택 버튼 aria-pressed, 키보드 기본 버튼 Enter/Space/Tab. 900px 이하는 세로 배치.
- 최종 확인: 기존 amountSourceReady/amountChecked/금액 일치/busy 검사와 서버 preflight/commit 그대로. 이 UI는 일치 인증이나 저장 완료를 만들어내지 않는다.

## 부작용 및 downstream
| 동작 | 웹 초안 | Warehouse/Stock/Product | Order/Shipment/Estimate/WebProfitReport |
|---|---|---|---|
| 대조 열기·수량 선택·확대 | 보존 | 보존 | 보존 |
| 새 분석의 위치 근거 전달 | 기존 sourceEvidence JSON에 근거만 포함 | 보존 | 보존 |
| 명시 입고 확인 | 기존 writer 계약 그대로 | 기존 계약 그대로 | 기존 보존 계약 그대로 |

기존 dnSpy FormWarehouseUpload MakeTempTable의 박스/단/송이 분리 계약 유지. 신규 SQL, SP 변경, 운영 DB 수정 없음.

## 메뉴 기준선
적용: 원본/예정값 병렬 대조, 명시 확인, 키보드, 1920·1280, 원문 긴 이름 줄바꿈, 가이드.
예외: 원본 PDF는 확대 검토를 위한 모달 내부 스크롤 사용. 목록은 새 고정 세로 스크롤을 만들지 않음.
미검증: 실제 운영 입고 저장(사용자 금지), 근거 없는 스캔 원문의 숫자 좌표 자동 탐색.
