# 웹·EXE 공통 SQL 처리 확인

| 항목 | 내용 |
|---|---|
| 기간 | 2026-10-08 |
| 화면 | /orders/paste 붙여넣기 주문등록 영업방 수신함 |
| 원장 부작용 | 읽기 전용 SQL 조회·표시 계산. 주문/분배/재고/견적/매출 및 수동확인 원장 쓰기 없음 |
| 배포/PR | codex/paste-confirmation-evidence → master → Cafe24; 최종 결과는 연결 PR 기록 |
| 다음 채팅 | 이 기록, distribution-sales-inbox / distribution-live-history 계약 |

## 이어받을 때 고정된 결정
- 사용자가 웹에서 처리했든 EXE에서 처리했든 동일한 SQL 근거로 확인한다.
- 원문과 동일한 연도·전체 차수·업체·품목·변경 방향·환산수량이 정확히 대조된 요청은 `전산확인`이다. 현재 수량이 비슷하다는 이유로 완료하지 않는다.
- 원문 전체 요청이 확인된 경우만 전체 자동 확인. 일부 일치는 항목만 표시한다. 기존 수량 후보는 `수량확인`으로 구분한다.
- 확인 취소 이후 실제 SQL 변경이 있을 때만 완전한 SQL 근거로 다시 확인할 수 있다. 조회 시각/asOf는 처리 시각이 아니다.
- 조회 한도는 각 OrderHistory/ShipmentHistory 10,000건. 10,001번째 sentinel이 있으면 범위를 좁히도록 안내하고 강한 확인은 차단한다.

### 1. 처리했는데 계속 미확인
**Q.** SQL 데이터와 카톡을 대비하는 자동화가 부족하다. 처리했는데 미확인으로 남는다. 웹/EXE 어디서 작업해도 결과가 매칭되어 확인되어야 한다.

**A.** `confirmedHistoryRequests`가 정확한 SQL 증거를 산출했으나 compact 항목 계산에서는 사용하지 않았다. 웹 성공 감사기록이나 기존 수량 후보만 항목 완료에 연결돼 있었다. 정확한 SQL 결과를 unique raw-line ID로 항목/전체 확인에 연결했다. 중복·추가·누락·다른 범위 요청과 주문만의 이력은 완료하지 않는다.

2026/41-01은 1,000건 이력 제한에 걸려 전체 증거 판정이 차단됐다. 정확한 연도/전체 차수/7일 범위·timeout은 유지하고 이력만 10,000건으로 확대했다.

**읽기 근거.** 설치 EXE FormShipmentDistribution dnSpy CLI의 ShipmentHistory→ShipmentDetail→ShipmentMaster 연결 재확인. 운영 read-only probe는 2026/40-02 Cust533/Prod389 event105309 0→1, Prod456 event105310 0→1, 2026/40-01 Cust436/Prod866 event105879 1→0과 원문 일치를 확인했다. 변경 전 화면은 미확인이었다. 원문/API 전체 자료는 비공개 TEMP 진단파일에만 두고 커밋하지 않는다.

**검증.** exact SQL/부분/중복/합산/native timestamp/수동 취소 선후, 1,001·10,000·10,001건 경계 및 기존 교차연도 fixture를 검사한다. 전체 verify:erp-change와 1920×1080/100% Chrome UI smoke 통과. 1366/1100 반응형, Tab/Shift+Tab·Enter·Space·초점 표시, 실패 후 기존 결과/초안 보존을 확인했다. 격리 smoke는 SQL-only 전체 완료, partial SQL 항목만 확인, ORDER_ONLY 미확인, 수량 후보 구분 및 수동 취소보다 이후 SQL 근거 우선 모두 통과했고 외부 요청/금지 쓰기는 0회였다. 최종 운영 배포 결과는 PR에 기록한다.

## 후속 검증 및 제한
- 정확한 근거가 부족한 요청은 미확인으로 남긴다. 미확인은 미처리 확정이 아니다.
- 운영 확인은 조회만 수행하며 실제 주문·분배·수동확인 버튼을 누르지 않는다.
- 임시 `.confirmation-probe.cjs` 및 TEMP 운영 원문은 커밋하지 않는다.
