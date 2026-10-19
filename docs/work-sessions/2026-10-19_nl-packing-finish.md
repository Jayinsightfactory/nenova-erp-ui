# 2026-10-19 Holex 1214205: 매칭 완료와 후속 차단 확인

## 요청 / 답변
- 남은 미매칭 확인, 서버 변경 보존 배포, 중복 입고 없이 도착원가까지 검증 요청.
- 사용자: 환율은 업로드 시 네이버 기준, 통관비는 비슷한 이전 자료의 근사값 허용.
- 146행 전부 매칭. 기존 WarehouseKey 7662의 품목·규격·수량·단가와 대조해 35개 공용 매칭 저장. 패킹 82상품행, 16,251송이 생성 확인. ERP 입고 재등록하지 않음.
- PR1083 / 3df9f1c0 배포 성공. 운영 tracked 변경은 배포 백업 경로에 보존됨.
- 네이버 EUR 매매기준율 1,493.64원 (2026-10-19 11:49, 하나은행 251회차) 조회. 과거 업로드 날짜의 환율로 소급한 값이 아니며 현재 검증 시점 참고값. 아직 원가 저장 안 함.
- 비교 후보: 39-2 NL 원가자료.xlsx, CW1541kg, 그외통관비 1,445,612.0178원. 현재 CW2555kg에 비례한 추정은 후보일 뿐 아직 적용 안 함. 추정값을 확정 비용으로 표시하지 않음.

## 추가 발견 / 기준표
실제 PDF를 로컬 파서→원문 검산→입고 어댑터로 재현: 146행, 초안 580,761bytes, rawMetadata 382,420bytes. sourceReview 381,851bytes에는 원문 전체·변경 전후 식별값·행별 검산 근거가 포함된다. 기존 공통 256KiB JSON 제한이 문서 전체 근거에도 적용되어 초안 저장을 거부했다.

| 동작 | 정책 | 근거 / 영향 |
|---|---|---|
| 초안 원문 메타 저장 | 문서 합산 1MiB, 모든 근거 그대로 보존 | 실제 382KB 자료 재현 |
| 행별 근거/검토 메타 | 기존 256KiB 보존 | 행 단위 요청 제한 |
| 초안 전체 | 기존 2MiB / 1000행 보존 | 무제한 확대 아님 |
| 초안 저장 | WebInvoiceDocument/Line/History만 기존 경로 | ERP Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport 보존 |
| 기존 입고 | Warehouse7662 읽기만 | 새 입고 COMMIT 금지 |

dnSpy 근거: FormWarehouseUpload golden 및 앞선 실제 ExcelLoadingPackingList CLI 검증. 저장 순서/SQL writer 변경 없음. 같은 2025/2026 차수 보존 fixture, 초과 문서/행/전체 요청 거절 테스트 추가.

## 미완료 / 미검증
원가 저장은 웹 입고 COMMITTED 작업과 snapshot을 요구한다. 기존 native 입고7662에는 WebInvoiceDocument 연결이 없으므로 입고 재등록으로 우회하지 않는다. 기존 입고와 원가만 안전하게 연결하는 처리 및 추정비용 표시·저장 검증은 아직 미완료. 이번 용량 수정 테스트·배포 결과는 후속 기록한다.

검색어: Holex 1214205 41-02 rawMetadata is too large 146 7662 추정통관비

## 로컬 검증
실제 PDF를 수정된 normalizeInvoiceDraft까지 전달해 146행/16,251송이 통과. test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest --changed-from origin/master, guard:erp-writes --changed-from origin/master, npm run build 모두 종료코드0. 용량 경계·근거 원형 보존·교차연도 테스트9개 통과. ERP writer/SQL 및 확인 상태 변경 없음.
