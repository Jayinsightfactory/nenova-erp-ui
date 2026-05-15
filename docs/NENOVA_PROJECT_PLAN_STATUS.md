# NenovaWeb 작업내역 / 페이지 기획 / 남은 구현

작성일: 2026-05-15

## 현재 큰 방향

Nenova.exe의 메뉴, 데이터, 기능 방식을 웹에서 최대한 동일하게 재현하고, 웹에서만 가능한 자동화 기능을 추가한다.

핵심 업무 흐름:

1. 붙여넣기 주문등록
2. 출고분배
3. 출고확정
4. 히스토리 기록
5. 차수피벗/엑셀 다운로드
6. 재고관리 동시 반영
7. 경영지원/이카운트 데이터 검증

## 최근 완료 작업

| 구분 | 완료 내용 | 상태 |
|---|---|---|
| EXE 분석 | Nenova.exe 구조, Forms, 주요 SP, DB 흐름 분석 | 완료 |
| 메뉴 검증 | EXE 메뉴와 웹 메뉴 매칭 감사 문서 작성 | 완료 |
| 기능/데이터 검증 | 주문/출고/재고 핵심 테이블과 값 매칭 감사 | 완료 |
| 주문등록 | `OrderMaster/Detail` 실제 테이블 기준 보강, 히스토리/재고계산 연결 | 완료 |
| 출고분배 | `ShipmentMaster/Detail`, `ShipmentDate`, `ShipmentHistory` 실제 흐름 보강 | 완료 |
| 차수피벗 | 주문등록 후 차수피벗/엑셀로 바로 이동 가능 | 완료 |
| 재고관리 | `StockHistory`, `usp_StockCalculation` 기준 보강 | 완료 |
| 이카운트 점검 | 경영지원 화면이 ERP 원본이 아닌 웹 계산값임을 문서화 | 완료 |
| 차수 확정 현황 | 확정/미확정/부분확정 상태, 구간 확정취소, 음수재고 품목 표시 | 완료 |
| node_modules | `npm ci`로 의존성 설치, `npm run build` 통과 | 완료 |

## 페이지별 현황

| 페이지 | 목적 | 현재 상태 | 남은 작업 |
|---|---|---|---|
| `/orders/paste` | 붙여넣기 주문등록 | 실제 주문/출고/피벗 흐름 연결 | 실제 DB 케이스 반복 검증 |
| `/shipment/distribute` | 출고분배/출고일 지정/확정 | 전산 SP 확정, 검증 모달 존재 | 화면 사용성 정리, 부분확정 케이스 검증 |
| `/shipment/fix-status` | 차수 확정 현황/구간 취소 | 신규 구현 완료 | 운영 DB에서 구간 취소 실측 검증 |
| `/shipment/week-pivot` | 차수피벗/엑셀 | 주문등록 후 바로 이동 가능 | 히스토리 표시 방식 확정 |
| `/stock` | 재고관리 | 실제 StockHistory/StockCalculation 기준 보강 | Product.Stock vs ProductStock 차이 진단 |
| `/sales/status` | 판매현황 | 웹 출고 기준 계산 | 이카운트 판매전표 원본 비교 필요 |
| `/sales/ar` | 채권현황 | 판매현황과 단가 기준 맞춤 | 이카운트 미수/수금 원장 비교 필요 |
| `/sales/tax-invoice` | 세금계산서 진행 | 웹 TaxInvoice 기준 | ERP 세금계산서 진행단계 원본 연동 필요 |
| `/purchase/status` | 구매현황 | 웹 ImportOrder 기준 | 이카운트 구매 원장/코드 매핑 검증 필요 |
| `/finance/bank` | 입출금 조회 | 웹 수동/샘플 테이블 | 신한은행 또는 ERP 원본 연동 필요 |
| `/finance/exchange` | 환율 관리 | 웹 CurrencyMaster 기준 | ERP/기준환율 원본 결정 필요 |
| `/ecount/dashboard` | 이카운트 연결/전송 현황 | push/log 중심 | 원본 pull/비교 현황 추가 필요 |
| `/dev/project-plan` | 작업내역/기획/남은구현 현황판 | 신규 구현 | 계속 업데이트 필요 |

## 아직 구현/검증 못한 핵심

1. 이카운트 ERP 원본과 웹 경영지원 숫자의 100% 매칭
2. 이카운트 판매/채권/세금계산서/구매 원본 조회 또는 ERP 엑셀 업로드 대조
3. Nenova.exe 전체 메뉴별 화면/버튼/데이터값 100% 실측 검증
4. 실제 운영 DB에서 차수 구간 확정취소 테스트
5. Product.Stock과 ProductStock 차이 진단 및 보정
6. 신한은행 입출금 API 또는 대체 원본 연동
7. Railway 운영환경 DB 접속/IP 화이트리스트 점검
8. `npm audit` 보안 경고 처리
9. 경영지원 화면에 “ERP 검증전/불일치/일치” 상태 표시
10. 모든 주요 쓰기 작업의 복구/롤백 시나리오 정리

## 다음 추천 순서

1. 운영 DB에서 `/shipment/fix-status` 조회만 먼저 확인
2. 1개 좁은 구간으로 확정취소 테스트
3. Product.Stock vs ProductStock 차이 리포트 추가
4. 이카운트 판매전표/채권 데이터 대조 방식 결정
5. 경영지원 화면에 ERP 검증상태 컬럼 추가
6. Railway 배포 전 보안/환경변수/빌드 재검증
## 2026-05-15 Full Audit Update

- Fixed order popup group state, group totals, and pivot popup navigation.
- Added common week normalization so `2026-17-01` is handled as DB week `17-01`.
- Applied normalization to shipment distribute, stock, stats pivot, shipment list, shipment Excel, order history, and warehouse pivot APIs.
- Corrected stats pivot order quantity to use `OrderDetail.OutQuantity` instead of mixed `Box+Bunch+Steam` totals.
- See `docs/FULL_FLOW_AUDIT_2026-05-15.md` for the current full-flow audit.
