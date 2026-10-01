# 임원 모바일 차수별 국가·품종 물량 보고서

## 목표

선택 차수의 국가/품종별 주문량, 입고량, 미입고 현황·비율, 확정 출고량과 직전 등록 차수/전년 동일 세부차수 대비 증감을 모바일 및 엑셀+그래프로 확인한다.

## Git 근거와 선택한 계산

- `docs/DB_STRUCTURE.md`: `OrderDetail` 주문량은 `Product.OutUnit`에 맞는 Box/Bunch/Steam 수량 하나만 골라야 하며, `WarehouseDetail.OutQuantity`와 `ShipmentDetail.OutQuantity`는 단일 OutUnit 값이라 다시 환산하지 않는다.
- `docs/WEB_VS_ERP_CONFLICTS.md` §7.5-7.6: 조회는 `ViewOrder`, `ViewWarehouse`, `ViewShipment`를 사용한다. `ShipmentDetail.isDeleted`, `WarehouseDetail.isDeleted`는 존재/뷰 계약상 필터로 사용하지 않는다.
- `docs/exe-golden/FormProfitReport.md`: 확정 판매량의 기준은 `ShipmentMaster.isFix=1 AND ShipmentDetail.isFix=1`이며 삭제 master 제외, `OutQuantity<>0`이다.
- `docs/exe-golden/FormStockView.md`: 재고 화면의 스냅샷 필터 의미와 `StockMaster.isFix`는 별개다. 본 보고서는 재고 스냅샷을 산출하지 않는다.
- `docs/exe-golden/FormWarehouseView.md`: 입고 뷰는 `OrderYear + OrderWeek`로 조회하고 품목의 `OutUnit`을 표시 단위로 사용한다.

차수는 `OrderYear + OrderWeek`로 식별한다. 직전 차수는 세 ERP View에 실제 존재하는 차수의 바로 앞 행이며, 전년 비교는 정확히 전년도 동일 `OrderWeek`다. 직전 차수가 전년도 말이면 그 실제 차수를 직전으로 선택할 수 있다. 전년동차가 없으면 별도 경고 대신 `비교자료 없음`으로 둔다.

표시 집계키는 `Country + FlowerName + normalize(Product.OutUnit)`이다. 서로 다른 단위는 표/요약/그래프에서 합산하지 않으며, 그래프도 단위별 독립 그룹으로 분리한다. 같은 국가·품종·단위 안에서는 복수 ProdKey를 묶는다. 거래처별 주문 원장은 원천 뷰에 남지만 보고서 표시는 국가/품종 단위다.

`미입고 현황 = max(주문량 - 입고량, 0)`, `미입고 비율 = 미입고 현황 / 주문량` (주문량 0이면 계산 불가). 초과 입고는 별도 표시한다. 이는 주문량 대비 아직 입고되지 않은 수량 현황이며 손실이나 폐기를 뜻하지 않는다. 입고량은 차수 귀속 합계 기준이다.

증감률은 `(현재 - 비교기준) / abs(비교기준)`이며 기준 0, 현재 양수일 때 `신규`, 둘 다 0이면 `변화 없음`, 기준 자료 자체가 없는 때는 `비교자료 없음`이다. 주문·입고·출고 모두 단위별 수량이다.

## Side-effect matrix

| 작업 | OrderMaster/Detail | WarehouseMaster/Detail | ShipmentMaster/Detail | ShipmentDate | ProductStock/StockHistory | Estimate/WebProfitReport |
|---|---|---|---|---|---|---|
| 보고서 조회 GET | SELECT only | SELECT only | SELECT only | 보존/미조회 | 보존/미조회 | 보존/미조회 |
| 엑셀+그래프 생성 | 변경 없음 | 변경 없음 | 변경 없음 | 변경 없음 | 변경 없음 | 변경 없음 |

모든 report SQL은 세 View + Product 읽기만 한다. 조회 endpoint는 GET만 허용하고, 서버에서 JWT와 대표 권한을 각각 확인한다. `/m/executive`의 기존 보호 예시/데모는 수정하지 않는다. 기존 미리보기 JSON이나 샘플 workbook을 실제값으로 오인시키지 않는다.

## 구현 범위 및 검증 상태

- 신설 `/m/executive-volume`, `/api/m/executive-volume`, 모바일 홈의 대표 권한 전용 메뉴 링크.
- 모바일 표는 국가 요약 카드로 묶고, 국가 카드를 누르면 품종별 주문·입고·미입고·확정출고와 직전/전년 증감이 펼쳐진다. 국가는 같은 국가여도 단위 합계를 단위별로 분리해 박스·단·송이를 서로 합치지 않는다.
- 독립 계약 `docs/contracts/executive-volume-report.json` 및 교차연도/단위 fixture `__tests__/executiveVolumeReport.test.js`.
- 기본 차수는 Git에 정의된 View의 실제 차수 중 최신이다. UI는 동일 사용자 인증 세션에서 선택 차수를 조회한다.
- 수동/운영 데이터 수정 없음. 보고서 읽기 API의 실 DB 실행은 본 구현 환경에서 수행하지 않았다. 기존 웹 화면에서 재고 요약을 읽은 것을 원시 주문/입고/출고 세부행 대조로 주장하지 않는다.
- 로컬 새 기능/전체 ERP 테스트, 계약·dnSpy evidence gate, manifest·write-scope guard, Next build 및 GitHub PR CI는 통과했다. PR #844 (`codex/director-volume-report` → `master`)는 2026-10-01 병합됐다. 최초 보고 시점에는 운영 데이터 대조/배포를 보류한다고 기록했으나 이후 PR이 실제 병합되었고, `master` 배포 workflow도 2026-10-01 07:48 UTC에 성공했다.
- 배포 기록은 workflow 완료 사실만 증명한다. 실제 ERP API/DB에서 동일 연도/차수·국가·품종·단위의 원시 합계 대조는 별도 수행되지 않았으므로 수량 정확성을 실측했다고 주장하지 않는다.

## 회귀 위험

1. “입고량”은 Warehouse의 차수 귀속 합계 기준이다. 미입고 현황은 주문량과 해당 입고량의 차이를 보여주며, 손실·폐기·검수판정을 의미하지 않는다.
2. FlowerName 분류가 마스터 간 일관되지 않으면 같은 품종이 분리된다. ProdKey 원자료를 엑셀 표에 제공하지 않으므로 추가 세부 검증이 필요하다.
3. 전년동차 자료 부재, 기준 0, 음수 보정 수량을 변화율로 단정하지 않도록 fixture와 UI 상태를 둔다.
4. EXE 호환성은 조회 View 계약을 유지하고 쓰기 경로를 만들지 않는 것으로 제한한다. 견적/매출/재고 원장에 추가 부작용은 없다.

## 국가별 상세 펼침 UI 추가 (2026-10-01)

- 원인: 평면 품종 표가 모바일에서 너무 넓어 가로 스크롤이 필요하고 국가별 개괄을 빠르게 보기 어려웠다.
- 변경: 국가별 요약 목록을 먼저 보이고 각 카드를 눌러 해당 국가 품종 상세를 확인한다. 품종 카드에 주문·입고·미입고 수량/비율·확정출고와 입고/출고의 직전·전년 비교를 표시한다. 그래프와 엑셀 상세 내역은 기존대로 둔다.
- 집계 보존: 요약은 `국가 + OutUnit`별로만 합산한다. 품종간 단위가 다른 수량은 한 숫자로 더하지 않는다.
- 검증: `node __tests__/executiveVolumeReport.test.js`, `git diff --check`, `npm run build`.
- 부작용 표: 국가 카드 펼침/접기는 브라우저 표시 상태만 변경한다. View/API 요청, Excel 생성은 기존 읽기 전용 흐름을 유지하고 주문·입고·출고·재고·견적·매출 원장은 보존한다.
- 배포 상태 정정: 이전 PR #844는 이미 병합·배포 완료. 이번 국가별 접기/품종 상세 수정은 이 기록 갱신 시점에 후속 PR/배포 대기 중이다.
