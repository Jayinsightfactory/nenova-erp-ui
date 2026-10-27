# 기존 입고 원가 계산·다운로드 (2026-10-27)

## 계약
- 인보이스 파일/웹 문서가 없는 기존 입고도 연도 + 세부차수 + WarehouseKey로 조회한다.
- WarehouseMaster와 WarehouseDetail/Product를 SELECT로만 읽는다. 삭제 Product의 과거 입고도 보존한다.
- 원가 계산은 기존 검증 공식만 재사용한다. 원문 통화/운송/환산 근거가 없으면 확인 입력하며 0으로 추정하지 않는다.
- 상품 수량/가격은 서버가 다시 읽는다. 클라이언트 상품 payload는 신뢰하지 않는다.
- 조회 지문과 재조회가 다르면 재조회 요구. 교차 연도·차수 요청은 거절한다.
- 계산 파일은 미승인 계산본으로 표시한다. 기존 승인 원가 내보내기 검증은 유지한다.
- 기존 확정 원가/매입액/손익/재고/입고/주문/견적에는 쓰지 않는다.

## 부작용 행렬
| 작업 | native 입고·재고 | 웹 승인 원가 | 응답 |
|---|---|---|---|
| 입고 조회 | 읽기만 | 없음 | 자료/누락값 |
| 계산 | 읽기만 | 없음 | 계산 또는 오류 |
| 다운로드 | 읽기만 | 없음 | 미승인 XLSX |

## EXE 근거
dnSpy Console ExcelLoadingPackingList 재실행: UPrice/TPrice/SteamQuantity 개별 복사,
uspCreateWarehouse 이후 uspStockCalculation 호출. 이 기능은 두 호출 및 TempWarehouseDetail을 사용하지 않는다.

## 검증 상태
구현 및 테스트 진행 중. 운영 데이터 쓰기 금지.
