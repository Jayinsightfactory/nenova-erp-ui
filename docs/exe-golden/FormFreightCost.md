# FormFreightCost — nenova.exe 연동 경계 기록

## 근거

`nenova.exe`에는 운송기준원가 웹 화면과 동일한 스냅샷 화면이 없으므로, 원천 입고 자료는 전산 `FormWarehouseView`의 조회 구조를 기준으로 한다.

- `lib/exeWarehouseViewSql.js`의 `FormWarehouseView GetData`는 `WarehouseMaster`와 집계된 `WarehouseDetail`을 읽는다.
- `lib/exeWarehouseViewSql.js`의 `FormWarehouseView GetDetail`은 `WarehouseKey`로 입고 상세를 읽는다.
- 운송기준원가의 저장 결과는 `FreightCost`/`FreightCostDetail` 스냅샷이며 `WarehouseMaster`/`WarehouseDetail`, 주문, 출고를 수정하지 않는다.

## 검색 계약

- 운송기준원가 페이지는 API가 한 번 반환한 BILL/AWB 그룹 목록을 화면에서만 검색한다.
- 검색 대상은 AWB, 농장명, 차수, 인보이스 번호, 입고일, 그룹 키다.
- AWB의 공백과 하이픈은 무시하므로 `006-45360346`과 `00645360346`은 같은 검색어로 처리한다.
- 검색어 변경은 SQL 조회나 저장을 다시 실행하지 않으며 ERP 공용 테이블을 변경하지 않는다.
- 검색 중에도 현재 선택된 그룹은 select 옵션에 남겨 선택 상태와 상세 화면을 보존한다.

## 연도 경계

2025년과 2026년에 같은 차수명이 존재해도 검색 기능은 이미 API가 반환한 그룹의 표시 여부만 바꾼다. 따라서 검색어 입력으로 주문·출고·입고 행을 생성하거나 갱신하지 않는다. 연도별 원천 데이터의 선택과 저장 범위는 기존 `WarehouseKey`/스냅샷 API 계약을 따른다.

`read-only` 검색 변경은 `WarehouseMaster`, `WarehouseDetail`, `FreightCost`, `FreightCostDetail`의 데이터를 직접 수정하지 않는다.
