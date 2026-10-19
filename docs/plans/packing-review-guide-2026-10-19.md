# 패킹 원문 확인 안내

## 근거 / 범위
- 사용자 Cloudland 13행 캡처: 수동 품목 매칭 완료와 원문 검증 필요 동시 표시.
- VERIFIED_BASELINE_UNAVAILABLE는 자동 원문 검산 증거 부재이며 DB 품목 미매칭이 아님.
- 실제 dnSpy CLI ExcelLoadingPackingList MakeTempTable/CheckData/InsertMaster 재확인: 연도·차수 별도, 품명+SIZE 대조, 입고 SP 다음 재고계산. 이번에는 해당 writer 변경 없음.
- 직전 운영 SELECT: 신규 업로드 로그 없음, 기존 2026/41-02 1214205만 존재. Cloudland 실제 원문은 아직 미확보. 이번 화면 확인만으로 해당 수량의 정확성을 보증하지 않음.

## 기준 / 부작용
| 동작 | 기준 | 쓰기 |
|---|---|---|
| 사유·해결 경로 표시 | 기존 sourceReview.reasons | 브라우저 표시만 |
| 행 이동 | sourceInvoiceIndex + sourceLineIndex | 모달 열기·초점만 |
| 확인 후 미리보기 | assertPackingSourceReviewed 통과한 현재 원본만 경고 해제 | 생성/ERP 저장 검증 변경 없음 |
| 다음 단계 차단 안내 | 기존 sharedReady/saving/processing/latestShared/matchingComplete | 기존 오류 상태/문제 로그 경로 사용 |

Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport 전부 보존. API/SQL/수량/단가/원문 확인 의무를 변경하지 않는다. 잘못된 파일/연도/수량/확인 플래그는 기존 검증으로 계속 차단한다.

## 기본값
페이지 자체 스크롤 유지, 명시 모달 예외. 버튼/입력 Tab·Enter 및 기존 Escape 유지, 대상 행 초점 이동. 실제 ERP 적용 전 확인 유지. 운영 쓰기 시험 없음.

## 검증
미리보기 수동 확인 유지/파일·연도·수량 변경 무효화/0 단가 보존, 사유 안내 회귀. 전체 검사·배포 결과는 세션 기록 참조.
