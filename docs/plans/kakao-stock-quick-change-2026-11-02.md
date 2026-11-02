# 카톡 재고 빠른 변경 입력 (2026-11-02)

기존 ERP 원장 변경 없이 웹 재고장 내부 배정만 수행한다. 행 선택 즉시 native dialog가 열리고 업체 초성/부분 검색, 최근 두 달 매출 합계 내림차순 정렬 후 수량 +/- 입력. 기존 API /api/customers/search 전체목록 및 /api/stats/sales?type=monthly&exeParity=1&year=YYYY&month=M 읽기만 재사용. SQL/API 변경 없음. 순위는 CustName+CustArea로 연결하며 중복 매출행 합산; 순위 미조회는 미확인으로 표시한다. 0매출 포함. 선택 기간은 KST 현재월+직전월, 연도 경계는 기존 매출 API 계약 사용. 개인 연락처는 표시/저장하지 않는다.

| 동작 | Customer/ViewShipment/ViewOrder/ShipmentDate/PeriodDay | Order*/Shipment*/Stock*/Estimate/WebProfitReport | UserFavorite |
|---|---|---|---|
| 업체검색/매출순위 | 기존 GET 조회만 | 보존 | 보존 |
| +/- 및 직접수정 | 보존 | 보존 | 저장버튼시 immutable snapshot |
| 복사 | 보존 | 보존 | 보존 |

기본 복사=현재수량만 전체 headings/구분선 유지. 별도 비고·변경내역 포함 복사=ledgerCopy(true). 잔량과 시작수량을 둘 다 보여주되 시작재고 textarea 원문은 원본으로 유지한다. 기존 차수별 scoped key / 취소 overflow / 단위 검증을 calculateLedger로 재사용. 모달 Escape/닫기/적용후 focus 반환. 미적용 시작재고에서는 변경 차단.

검증: 초성 중간검색+매출순/0/연도경계, 팝업 열기/선택/추가/취소/직접입력/다른 차수보존, 두 복사결과 실제 clipboard 비교, 저장 재열기, 390 화면, ERP writes zero. 기존 가드와 CI/build 후 배포/운영 화면 확인.
