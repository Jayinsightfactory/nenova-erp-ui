# 인보이스 입고 안전검사 공통화 — 2026-10-08

| 항목 | 내용 |
|---|---|
| 요청 | 다음작업시작 |
| 목적 | 인보이스 → 입고관리 → 실제량 도착원가 통합의 후속 단계 |
| 구현 | SELECT 사전검사 코어와 인증 API; 실제 writer/화면 미연결 |
| 원장 부작용 | 운영 DB/EXE/SP/공용 임시입고/재고 변경 없음 |
| 작업 브랜치 | codex/invoice-receipt-cost-prd / draft PR #960 |
| 배포 | 이번 단계는 운영 미배포. PR은 기존 master와 충돌 상태 |

## 고정된 결정

1. 실제 입고량 원가가 기본, 95% 예상 원가는 비교용이다.
2. 앞선 여섯 WebInvoice 빈 테이블 운영 적용과 이번 API 구현을 실제 입고 등록 완료로 혼동하지 않는다.
3. 공용 TempWarehouseDetail 전체 삭제/소비 경로를 새 인보이스 writer에 재사용하지 않는다.
4. 확정 상태는 CountryFlower 전체, ViewShipment.DetailFix 기준이다. 전후 차수는 StockMaster의 실제 인접키다.
5. 검사 성공은 저장권한/잠금/동시성 보장이 아니다. 향후 writer의 잠금 트랜잭션 안에서 같은 검사를 재실행한다.

## 1. 다음 작업 시작

**Q.** 다음작업시작.

**A.** ERP 호환성 보호/의도해석 절차에 따라 기존 PRD·실제 SQL 증거·dnSpy를 대조했다.
CommonLogic 및 ExcelLoadingPackingList 실제 CLI를 다시 실행했다. CheckData의 품종 조회가
INNER JOIN 뒤 ProdKey=0을 요구해 정상 양수 키에서는 검사 루프가 비어 있을 수 있음을 확인했다.
웹은 CommonLogic의 의도된 현재확정/전미확정/후확정 검사를 명시 적용하고, 조회예외를 0건으로
간주하지 않는다. 기존 EXE나 공용 SP를 수정하지 않았다.

**결과.**
- `lib/invoiceReceiptEligibility.js`: 서버 품목 scope + 공통 조회/판정.
- `pages/api/import/receipts/eligibility.js`: 관리자/수입부, POST 키 목록, 읽기 전용.
- 입력400, 계정403, 조회실패503; 성공에도 commitAvailable=false/erpWritePerformed=false.
- 실제 DB 품목의 CountryFlower만 사용. 수량0/다른거래처/같은품종다른품목을 임의 제외하지 않음.
- golden/DB_STRUCTURE/WEB_VS_ERP_CONFLICTS에 InputDate·계산 OrderYearWeek2·원문통화 정정.
- helper/API 테스트, 실제 격리 SQL fixture, 계약 manifest를 추가했다.

## 검증 기록

- 최종 순수/API 15개 통과. 권한위조/차단 응답 및 sparse 배열 등 입력 경계 보강.
- 격리 SQL2022 compatibility130: `NenovaInvoiceFixture_20261008_7ff1b43d3e93` 통과·정리.
  실제 exported SELECT 실행, 전체 차단/정상/NULL/연도경계/불연속차수/SQL오류,
  Product·StockMaster·ShipmentFixture 및 ERP/staging sentinel 보존.
  ViewShipment는 테스트용 projection이며 native writer/SP parity 검증이 아니다.
- 보강 후 `NenovaInvoiceFixture_20261008_57bffeb9135f` 재통과·정리.
  각 차단 단계 독립/DetailFix0·NULL·2 near-miss, 복수품종 중 한품종만 차단,
  가장 가까운 StockMaster 키 오류를 건너뛰지 않는 fail-closed까지 실행했다.
- `npm run test:erp-contract`: 통과.
- `npm run test:nenova-dnspy-evidence`: 통과.
- 변경 SQL scope guard: 신규 파일 stage 후 통과(변경 API5개 검사).
- `npm run build`: 통과. 신규 eligibility route 생성 확인.
- 최종 코드 기준 빌드 재실행 통과. 독립 검토의 문서/경계 fixture 지적 해소 확인, 추가 blocker 없음.
- UI 변경 없음: 1920×1080 시각 smoke는 이번 단계에 수행하지 않음.

## 미완 / 다음 작업

실제 등록 경로는 아직 없다. 문서 저장/수정·멱등 작업 UUID, native 번호 발급,
공용 staging 미접근 입고/이력/재고 원자적 writer, gate 소유권·EXE 동시성·실패 롤백,
원가 공식/버전/원장 연결, UI와 배포 수용검증을 계속해야 한다.
운영 임의 입고 테스트는 하지 않는다. 정확한 사용자 업무 입력 승인 또는 격리 SQL 검증을 사용한다.
PR960 master 충돌은 통합/출시 단계에서 해결하며 검사 실패 상태로 병합하지 않는다.
기존 미커밋 `2026-10-07_packing-db-product-match.md`는 이 작업에 섞지 않는다.

## 이어받기

`docs/work-sessions/INDEX.md`, 본 파일, PRD §15~17을 읽고 실제 invoice writer 단계 계속.
기반 테이블과 사전검사 완료를 통합 업로드/원가 배포 완료로 보고하지 말 것.
