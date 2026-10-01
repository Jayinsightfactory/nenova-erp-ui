# 2026-10-01 차수별 국가·품종 물량 보고서

| 항목 | 내용 |
|---|---|
| 세션 ID | 019f5032-9276-72a2-8709-29b719c67702 |
| 기간 | 2026-10-01 |
| 화면 | 임원/대표 모바일 차수별 보고서 `/m/executive-volume` |
| 원장 부작용 | 없음. ViewOrder/ViewWarehouse/ViewShipment + Product 읽기 전용, 엑셀 다운로드 |
| 배포/PR | PR #844 생성 및 GitHub CI 통과. 운영 DB raw 대조/병합/Cafe24 배포는 미완료 |
| 다음 채팅 힌트 | 작업 브랜치 `codex/director-volume-report`에서 contract, report, Q&A 및 배포 검증부터 이어간다. |

## 이어받을 때 고정된 결정

- 기존 `/m/executive` 예시/데모 흐름은 실제 운영자료와 섞지 않는다.
- 국가 + 품종 + `Product.OutUnit` 단위로 집계한다. 단위가 다른 품목은 총합/그래프 비교에서 절대 합치지 않는다.
- 전년 기준은 정확히 같은 `OrderWeek`의 `OrderYear-1`; 직전 차수는 View들에 존재하는 차수의 시간 순서상 바로 앞 차수다.
- 주문/입고는 Product.OutUnit 수량을 선택하고, ShipmentDetail.OutQuantity는 재환산하지 않는다.
- 실출고는 `ShipmentMaster.isFix=1 AND ShipmentDetail.isFix=1`; 미입고는 손실·폐기가 아니라 주문량 대비 입고량 차이 현황이다.
- 모든 보고서 동작은 읽기 전용, 대표 사용자만 조회 가능. 주문·출고·재고·견적·매출 원장은 그대로 둔다.
- Git 근거·데이터 계약·검증은 완료했으나 원시 운영 DB probe, PR, Cafe24 배포는 수행 전이다. 배포를 완료했다고 주장하지 않는다.

### 1. 2026-10-01 — 보고서 범위 확인과 구현

**Q.** 국가별로 해당 차수 영업 주문량, 실제 입고량/미입고율, 전차수·전년동차 입고 증감, 실제 출고량과 두 기간 대비 증감을 하나의 Excel+그래프로 자동 확인하고 싶고 품종마다 다른 단위를 표시해야 한다.

**A.** Git 문서의 ERP View/품종단위/확정 출고 근거를 사용해 읽기 전용 API와 대표 권한 전용 모바일 페이지, 차수 선택, 표/단위별 그래프, Excel 파일을 구현했다. 운영 원장 저장이나 보정은 없다. 사용자가 “Git에서 데이터확인해서 작업하면 되잖아”라고 해 Git에서 버전 관리되는 SQL/계약/dnSpy 근거를 중심으로 구현을 계속했다. production DB 접속환경은 worktree에 없어서 별도 raw 행 수/합계 대조는 하지 않았다.

**결과.** 순수 정책/교차연도 테스트, `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, 계약 manifest/write guard, `npm run build`, GitHub PR CI 통과. `codex/director-volume-report`에 커밋 `f8d73bc1`을 푸시하고 PR #844를 열었다. 운영 배포/실브라우저 스모크는 미완료.

### 2. 미입고 지표 의미 명확화

**Q.** 미입고는 손실이 아니라 단순 미입고 현황이다.

**A.** 모바일 보고서와 엑셀에서 지표명을 `미입고 현황`/`미입고 비율`로 통일하고, 주문량 대비 입고량 차이이며 손실·폐기를 뜻하지 않는다는 설명을 표시한다. 수량 계산과 원장 조회 범위는 바꾸지 않는다.

## 미완 / 다음 작업

1. 운영 읽기 전용 DB 또는 허용된 로그인 웹 조회 경로에서 동일 `OrderYear + OrderWeek + Country + FlowerName + OutUnit` 조건으로 각 View 원천을 비교하고 숫자 대조 결과를 report에 기록한다. 쓰기는 금지.
2. 현재 열린 PR #844를 DB 대조 결과와 합쳐 재검토한다.
3. 배포 가능 조건 충족 후 master 병합, Cafe24 배포, 1920×1080 및 모바일 브라우저 스모크, Excel 다운로드 열기 검증.
4. 이 session note 외에 임시/probe 생성 파일은 없다.
