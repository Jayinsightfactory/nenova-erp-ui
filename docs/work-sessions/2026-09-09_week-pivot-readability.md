# 차수피벗 업체 강조·품명 검색·한 줄 비고

| 항목 | 내용 |
|---|---|
| 기간 | 2026-09-09 |
| 화면 | `/shipment/week-pivot` |
| 상태 | 구현·로컬 필수 검증 완료, PR·배포 예정 |
| 원장 부작용 | 없음. 화면 표시용 상태·필터·CSS만 변경 |
| 기준 화면 | 1920×1080 CSS px, 확대 100% |

## 이어받을 때 고정된 결정

- 업체 헤더 클릭은 업체 필터가 아니라 강조다. 같은 업체 재클릭/해제 버튼으로 해제하며 반복 헤더도 같은 상태를 공유한다.
- 선택된 연도·차수 범위의 주문 또는 분배 양수 품목을 강조한다. 취소 비고만 남은 0행/가상 빈 업체를 양수로 추정하지 않는다.
- 품명 전용 검색은 `ProdName`·`DisplayName` 대상이며 원본 집계 이후 `visibleProdKeys`만 거른다. 업체 열, 합계 산출, 엑셀의 `prodKeys`는 보존한다.
- 검색 0건에도 검색창/해제 버튼/표 헤더를 유지한다. 숨긴 행의 수정 대기값을 삭제하지 않는다.
- 오른쪽 비고는 업체·내용·삭제 버튼을 한 묶음으로 가로 한 줄 표시한다. 폭을 넘는 내용은 가로 스크롤로 확인한다. 업체 칸의 짧은 비고도 한 줄로 제한하고 전체 내용은 title/오른쪽 비고에서 확인한다.
- 확정/수정 대기/편집/음수재고의 기존 색과 품목 클릭 선택 표시를 보존한다. 비고 삭제는 기존 명시적 확인 절차만 사용한다.

## 작업 전 근거·부작용 표

실제 설치 EXE `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`의 `Nenova.FormQuantityPivot`를 로컬 dnSpy.Console로 재확인했다. `GetData`는 StockMaster의 연도·차수 범위, ViewOrder, ViewShipment와 ShipmentDate, ViewWarehouse, ProductStock을 조회한다. 검색/강조 자체에 저장 과정이 필요하지 않다. 기존 웹 `stock-status?view=customers` 조회는 선택 연도의 OrderMaster/ShipmentMaster와 Product/Customer를 결합하고, 시작/확정재고는 별도 GET을 사용한다. 원장 조회 SQL은 수정하지 않는다.

| 사용자 동작 | 읽기 | 쓰기/보존 |
|---|---|---|
| 업체 강조·해제 | 이미 로드된 `custOrderQty`, `outQty`, 현재 연도·차수 범위 | React 상태만. 모든 원장 보존 |
| 품명 검색·해제 | 이미 로드된 Product 표시명 | 화면 행만. 주문/분배·재고 합계·다운로드 입력 보존 |
| 비고 가로 표시/접기 | 기존 `outDescr`/`descrMap` | CSS/표시 상태만. Descr 원문·삭제 대상 인덱스 보존 |
| 기존 저장·다운로드 | 기존 경로 그대로 | OrderDetail, ShipmentDetail 수량/Amount/Vat/isFix, ShipmentDate, ShipmentFarm, StockHistory, Estimate, WebProfitReport 로직 변경 없음 |

### Q. 업체를 누르면 관련 품목 강조, 품명 필터, 비고 한 줄 표시

A. 원시 고객 행에 적용되는 기존 통합 검색과 새 품명 검색을 분리한다. 비고의 세로 flex 및 업체 칸 줄바꿈을 함께 줄인다. ERP 호환성 가드에 따라 현재 응답의 읽기 전용 확인과 교차연도 fixture를 남긴다.

## 검증 및 배포

- 운영 읽기 전용 확인 완료: 2026-37-01 `customers` 1,024행, `startStocks` 0행, `confirmedStock` 성공. 세 GET 모두 HTTP 200/success=true. 원장 변경 요청은 브라우저 요청 차단으로 0건. 원문 응답은 비공개 `outputs/pivot-readability-probe.json`에만 보관.
- 필수 검증 통과: `npm run test:erp-contract`, `test:nenova-dnspy-evidence`, `test:erp-manifest -- --changed-from a42e02e` (47개 계약), `guard:erp-writes -- --changed-from a42e02e` (변경 API 0개), `npm run build`, `git diff --check`.
- 순수 fixture: `filterWeekPivotProductKeys`는 영문/한글/공백·대소문자, 빈 검색, 미일치, 원본 순서/불변성을 검사한다. `getWeekPivotCustomerHighlightProdKeys`는 주문만/출고만 양수, 0 비고, 잘못된 수량, 다른 업체/범위, 2025/2026 동일 차수 및 명시 연도 충돌을 검사한다.
- 브라우저 fixture: 13품목×18업체×2차수, 상단/반복 업체 헤더 4개 동일 토글·키보드 선택, 검색 0건 복구, 업체 열 유지, 숨긴 수정 대기값 유지, 확정/수정 대기 색 보존, 열 너비 드래그가 강조를 토글하지 않음.
- 비고 18항목은 가로 한 줄/별도 가로 스크롤, 약 54px 행 높이 유지. 내용 클릭/스크롤로 접히지 않음. 전체 원문 title 확인.
- 1920×1080 및 1280×800, 확대 100%에서 검색·업체명·sticky·가로 스크롤·버튼·겹침을 확인했다. 검색 전후 실제 XLSX 22개 시트 내용/숫자/수식 동일. 브라우저 JS 오류 0건, ERP 변경 요청 0건.
- PR·배포: 아직 완료 아님. 로컬 결과 `outputs/pivot-readability-local-smoke.json`, 이미지·XLSX는 비공개 검증 산출물로만 보관.
- `outputs/`와 기존 사용자 수정 `AGENTS.md`, 별개 불량차감 세션 파일은 커밋 대상이 아니다.

## 다음 작업

이 파일의 표시 전용 범위를 유지하고 PR·배포 및 운영 화면 검증을 완료한다. 과거 EXE 37-01 오류 진단은 별도 세션 기록이며 이번 UI 변경으로 해결됐다고 말하지 않는다. 배포 후 최종 결과는 PR 검증 댓글에 남긴다.
