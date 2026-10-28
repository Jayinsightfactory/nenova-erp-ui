# 다음차수 불량차감 재발 방지 (2026-10-28)

비고 재저장 후 원문수량 검토차단이 사라지는 경로를 수정한다. 현재 표식 또는 최초 관리검토 이력을 기준으로 차단하며, 차단보다 뒤의 동일 연도·차수·업체·품목·수량·단위·원천·비고 원문 재승인만 해제한다. 일반 저장이 기존 검토표식을 복사하는 것은 새 검토결정으로 간주하지 않는다.

부작용: 조회·등록자격 SQL만 변경. Estimate, WebSalesDefectDeduction, OrderDetail, ShipmentDetail, ShipmentDate, StockHistory, WebProfitReport 모두 보존. 기존 ClassEstimate dnSpy 근거와 저장순서 변경 없음.

검증: 43/44/45/53차 source 검토 상태의 목록/preflight/preview/register 모두 차단·쓰기0. 기존 2025/2026 정상96조합 유지. 실제DB SELECT-only 비고삭제모의, 이전승인/후속승인/다른연도/다른수량 반례 통과. 주광·태림 수기확인 보존. probe-defect-next-period.mjs로 재현 가능. 전체검사·배포결과는 후속 기록.
