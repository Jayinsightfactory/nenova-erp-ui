# Pivot 전체 필드·컨트롤 정합 체크리스트

작성일: 2026-09-14  
범위: `FormQuantityPivot` 실제 EXE와 `/stats/pivot` 현재 웹 코드의 표시·조작·내보내기 gap inventory

## 구현 후 검증 요약

아래 inventory는 **구현 전 기존 웹 모드**의 차이 기록이다. 신규 기본 `전산 피벗` 모드는 `components/PivotExePanel.js`와 GET `/api/stats/pivot-exe`를 사용한다. 범위 계약은 `fromYear/fromWeek/toYear/toWeek`이며 기존 웹 확장 모드는 별도로 보존한다.

- 2026-09-14 로컬 production build/Chrome mock smoke 통과: 1920×1080, 1366×768, 확대 100%.
- 15개 필드 각각 행/열/값/필터 이동을 실제 좌클릭으로 반복했다. 우클릭·드래그는 사용하지 않았다.
- 빈 다중값 필터 → 결과 없음, 필터 해제 → 복구, AND 조건 거래처 필터, 정렬 메뉴, 전체 접기/펼치기, 실제 XLSX 다운로드 확인.
- 503 실패 시 마지막 성공 표 유지, 입력 범위 변경과 성공 범위 구분, 페이지 가로 넘침 없음. mock 요청은 GET만 있었으며 외부 요청/ERP 원장 쓰기 없음.
- 집계/재귀 OR·NOT/교차연도/원본 숫자/문자 Count/키 충돌/대용량 sparse 모델/XLSX 수치·형식은 실행 가능한 단위 검사로 별도 확인.
- 한 화면에서 25만 셀 초과 또는 원본 20만 행 초과는 명시적으로 범위 축소를 안내한다. 일부만 잘라 완성된 표처럼 제공하지 않는다. 무제한 대용량 네이티브 성능과 모든 DevExpress 부가기능의 동일성까지 검증한 것은 아니다.
- 운영 인증 조회는 배포 후 별도 확인한다. fixture 검사를 운영 DB 전수 대조로 간주하지 않는다.

## 근거와 제한

- EXE 디컴파일 근거: `C:\Users\USER\nenova-decompiled\Nenova\FormQuantityPivot.Designer.cs`, `FormQuantityPivot.cs`.
- 세션 근거: `docs/work-sessions/2026-09-14_pivot-full-controls.md`.
- 웹 근거: `pages/stats/pivot.js`, `lib/pivotFieldRegistry.js`, `lib/pivotStats.js`, `lib/pivotExcelExport.js`, `pages/api/stats/pivot-data.js`, `pages/api/stats/pivot-volume-excel.js`.
- EXE `GetData`는 `StockMaster`/이전 `ProductStock`, `ViewOrder`, `ViewShipment`+`ShipmentDate`+`PeriodDay`+`CodeInfo`, `ViewWarehouse`+`Country`를 `UNION ALL`한다. 이 문서는 읽기·표시·내보내기 검증만 다루며 ERP 원장 쓰기, DB probe, 인증, 배포를 요구하지 않는다.
- 기준 브라우저 검증: 1920×1080 CSS px, 확대 100%. 모든 조작은 좌클릭 기준이며 우클릭 전용 동작은 합격으로 인정하지 않는다. 드래그는 보조 수단일 뿐, 동등한 좌클릭 조작이 없으면 gap이다.

## 1. EXE 15개 필드 ↔ 웹 gap inventory

| # | EXE 바인딩 / 표시 캡션 | EXE Designer 근거 | 현재 웹 위치·현재 동작 | Gap / 합격 기준 |
|---:|---|---|---|---|
| 1 | `CustName` / 거래처명/농장명 | `FormQuantityPivot.Designer.cs:217-222` | `lib/pivotFieldRegistry.js`의 `custName`, `pages/stats/pivot.js`의 `showCustDetail`, `sortedCusts`; 주문·출고 거래처 열 및 입고 농장 열로 분리 표시 | 유사 기능은 있음. EXE처럼 하나의 필드가 좌클릭으로 열 배치·순서를 바꾸는지 확인. 거래처/농장 표시와 내보내기 열이 같은 배치 상태를 따라야 함. |
| 2 | `CounName` / 국가 | `:225-230` | registry `country` → `rows[].country`; 표 머리글·컬럼 필터 | 구현 있음. 좌클릭 정렬/필터와 필터 후 화면·CSV 값이 일치해야 함. |
| 3 | `OrderWeek` / 주문차수 | `:237-242` | `pages/stats/pivot.js`의 `weekStartInput`, `weekEndInput`, `data.weeks` 및 차수 헤더 | 조회 범위로는 구현됨. Field List의 필드로는 등록되지 않음. EXE처럼 차수 열을 좌클릭으로 필드 배치/순서 제어할지 명시·구현해야 함; 범위 조회 시 연도·차수 열이 분리되어야 함. |
| 4 | `Quantity` / 수량 | `:250-258`, 숫자 `N2` | registry `qty` → `totalOrder`; `PivotWeekMeasureCells`, `formatPivotNum` | 구현 있음. 주문/입고/출고/전재고/현재고 및 합계의 표시와 CSV 숫자값을 검증. 0은 임의의 비공개 값으로 취급하지 않음. |
| 5 | `FlowerName` / 꽃 | `:261-266` | registry `flower` → `rows[].flower`; 행·필터 | 구현 있음. 좌클릭 필터에서 세션의 수국/카네이션 예시가 선택되고 화면·CSV가 줄어드는지 확인. |
| 6 | `ProdName` / 품목명(색상) | `:267-275` | registry `prodName` → `cleanPivotProdName()` 결과; `pivotProductSearch` 별칭 검색 | 구현 있음. 별칭 검색은 현재 조회 rows의 canonical 옵션만 사용해야 하며 다른 연도 원장을 읽거나 쓰지 않아야 함. |
| 7 | `CountryFlower` / 품목명 | `:276-280` | 현재 registry에 `CountryFlower`/별도 필드 id 없음. `lib/pivotStats.js`는 country/flower/prodName만 row로 반환 | 명시적 gap. EXE 필드명·캡션을 좌클릭으로 행/열/필터에 배치하고 화면·내보내기에 표시할 데이터 계약이 필요함. `ProdName` 또는 국가+꽃으로 추정 대체하지 말 것. |
| 8 | `CustArea` / 지역 | `:281-285` | registry `area`; `columnGroup`; `colGroupOrder`; `pages/stats/pivot.js`의 지역 헤더/필터 | 구현 있음. 좌클릭 배치와 그룹 순서 변경 후 화면·CSV에서 동일 계층을 확인. |
| 9 | `ListType` / 구분 | `:286-291` | registry `secPrev/secOrder/secIncoming/secOut/secNone/secCur`; `sectionsFromColumnZone`; Filter Editor의 `구분` | 의미상 구현됨이나 EXE 원자료의 `01. 전재고`, `02. 주문`, `03. 미발주수량`, `04. 출고`, `03. 입고`, `05. 현재고`와 현재 라벨/열 순서를 대조해야 함. `03.미발주`와 `03.입고`를 혼동하지 말 것. |
| 10 | `ShipmentDtm` / 출고일 | `:292-300` | registry `outDate`; `lib/pivotStats.js`의 `outDateMap` (확정 출고 `ShipmentDetail` 기준) | 구현 있음. EXE의 `ShipmentDate` 표시(날짜+요일 텍스트)와 웹의 날짜 형식·집계 범위를 대조해야 함. 행 필드 토글, 필터, CSV에 모두 반영되어야 함. |
| 11 | `OrderYear` / 주문년도 | `:303-312` | `data.orderYear`, 상단 연도 입력 및 차수 헤더에 사용. registry 필드 목록에는 없음 | 명시적 gap. EXE처럼 Field List의 좌클릭 배치 가능한 필드인지, 또는 조회 고정 축인지 제품 결정을 기록해야 함. 어떤 경우에도 `OrderWeek` 단독으로 연도 의미를 대체하지 말 것. |
| 12 | `UPrice` / 입고단가 | `:313-321`, 숫자 `N2` | registry `inPrice`; `rows[].inPrice`; Field List 값/행 토글 및 CSV 옵션 | 구현 있음. EXE의 입고 원자료 `ViewWarehouse.UPrice`와 웹 집계·표시·내보내기 소수점/0 값을 대조. |
| 13 | `OrderNo` / AWB | `:324-328` | registry `awb`; `rows[].awb` 및 행 토글/CSV 옵션 | 구현 있음. 입고 행의 `OrderNo`가 AWB로 보이고 좌클릭 필터·CSV에 포함되는지 확인. |
| 14 | `CustDescr` / 비고 | `:329-333` | registry `descr`; 주문 detail 설명 및 customer `custDescr`가 별도 경로로 사용됨 | 부분 구현. EXE `CustDescr`의 주문/입고/재고별 빈 문자열 규칙과 웹 `descr`/`custDescr` 혼합을 대조해야 함. 필드 배치·필터·CSV가 하나의 undocumented 합성값을 만들지 않아야 함. |
| 15 | `TPrice` / 입고총단가 | `:334-339`, 숫자 `N2` | registry `inTotal`; `rows[].inTotal`; Field List 값/행 토글 및 CSV 옵션 | 구현 있음. EXE `ViewWarehouse.TPrice`의 합산·반올림 및 웹 `inTotalMap` 합산 결과를 대조. `UPrice`와 같은 값으로 대체하지 말 것. |

## 2. EXE 컨트롤·메뉴 검증

| EXE 조작 | 정확한 좌클릭 액션 | 예상 화면 결과 | 예상 내보내기 결과 | 현재 웹 위치 / gap |
|---|---|---|---|---|
| 시작 차수 | `주문차수` 시작 선택기를 좌클릭하고 주문년도·차수를 선택 | 시작 차수가 선택되고 해당 범위 데이터의 첫 차수로 표시 | EXE 통계 내보내기와 같은 현재 범위만 포함 | `pages/stats/pivot.js` 상단 `weekStartInput`; 구현 있음. 연도는 별도 전달되어야 함. |
| 종료 차수 | 종료 선택기를 좌클릭하고 주문년도·차수를 선택 | 시작~종료 차수가 각각 열로 표시되고 연도 반복 차수가 합쳐지지 않음 | 파일에 선택 범위의 차수 열만 포함 | `weekEndInput`, `data.weeks`; 구현 있음. 교차연도/역순 오류를 확인. |
| 새로고침 / EXE `btnSearch` | `새로고침` 버튼 좌클릭 | `GetData`와 동등한 읽기 조회 후 표 갱신, 오류 시 화면 오류 배너 | 직전 성공 조회가 보존되며 오류 다운로드를 만들지 않음 | `pages/stats/pivot.js` `load`; API `pages/api/stats/pivot-data.js`. 구현 있음. |
| 엑셀 / EXE `btnExcel` | `엑셀` 버튼 좌클릭 | 저장 동작 또는 저장 오류를 명확히 표시 | EXE는 `ExportToXlsx(... WYSIWYG)`로 현재 Pivot 배치·표시 상태를 XLSX 저장. 웹은 현재 `handleExcel`이 `Pivot통계_*.csv`를 생성하므로 XLSX/WYSIWYG gap | `handleExcel` 및 `lib/pivotExcelExport.js`; 명시적 gap. |
| 닫기 / EXE `btnClose` | 닫기 버튼 좌클릭 | Pivot 창/팝업이 닫힘 | 파일 생성 없음 | 웹 `?popup=1`의 상단 shell에는 닫기 equivalent가 확인되지 않음. 명시적 gap으로 smoke 확인 필요. |
| `Reload Data` | Pivot 필드/헤더의 메뉴를 좌클릭으로 열고 `Reload Data`를 좌클릭 | 현재 선택 범위로 데이터 재조회 | 재조회 후 내보내기는 새 표 상태 반영 | 웹 Field List에는 `Reload Data` 메뉴 항목이 없고 상단 `새로고침`만 있음. 상단 버튼으로 동일 동작을 대체할지 또는 메뉴를 추가할지 결정. |
| `Best Fit` | 필드 메뉴를 좌클릭으로 열고 `Best Fit`을 좌클릭 | 선택 필드 열 너비가 내용에 맞게 조정 | WYSIWYG 파일의 해당 열 너비/내용이 조정 상태 반영 | 웹에는 일반 고객 열 range와 resize 로직은 있으나 EXE식 필드별 `Best Fit` 좌클릭 메뉴는 없음. gap. |
| `Order` → 처음/왼쪽/오른쪽/끝 | 필드 메뉴와 `Order` 하위 메뉴를 모두 좌클릭 | 선택 필드가 행/열 영역 내에서 처음·왼쪽·오른쪽·끝으로 이동 | 화면과 내보내기 열/행 순서가 동일 | 웹 `columnZone`/`colGroupOrder`는 드래그 중심이고 일부 토글은 좌클릭. 네 개 명령의 명시적 좌클릭 메뉴는 없음. gap. |
| `Show Field List` | 필드 메뉴를 좌클릭으로 열고 항목을 좌클릭 | 행/열/필터/값 Field List 표시·숨김 | 현재 배치 상태를 반영한 결과 | 웹 `🗂 필드 목록` 버튼 좌클릭과 registry는 있음. EXE 메뉴 위치와 동등한 접근 경로를 smoke 확인. |
| `Show Filter Editor` | 필드 메뉴를 좌클릭으로 열고 항목을 좌클릭 | 조건 편집기 표시, 조건 적용 후 행이 필터링됨 | 필터된 현재 표시 결과만 내보내며 원본 데이터는 변경하지 않음 | 웹 하단 `Edit Filter` 좌클릭 및 `showFilterEditor` 모달은 있음. 필드 메뉴에서 직접 접근하는 경로는 gap 후보. |

## 3. 필수 좌클릭 smoke checklist

각 항목은 1920×1080, 100%에서 수행하고 화면 결과와 다운로드 파일을 함께 기록한다.

- [ ] `/stats/pivot?popup=1`을 열고 시작/종료 차수를 각각 좌클릭 선택한다. 2025/2026에 같은 차수명이 있는 fixture에서 연도 열과 차수 열이 섞이지 않는다.
- [ ] `새로고침`을 좌클릭한다. API 요청에 `orderYear`, `weekStart`, `weekEnd`가 전달되고 표의 국가·꽃·품목·구분·수량이 갱신된다.
- [ ] 필드 목록을 좌클릭으로 열고 `지역`, `출고일`, `입고단가`, `입고총단가`, `AWB`, `비고`, `수량`을 각각 켜고 끈다. 각 필드가 화면과 내보내기에 나타나거나 사라진다.
- [ ] `국가`, `꽃`, `품목명(색상)`, `지역`의 필터 버튼을 좌클릭해 콜롬비아·수국/카네이션·품목을 선택한다. 표시 행 수와 표 값이 줄고, `엑셀` 결과에도 같은 필터가 적용된다.
- [ ] Field List의 필터 영역에서 필드를 좌클릭해 열고 값 체크박스와 `전체선택`/`전체해제`를 좌클릭한다. 빈 선택은 전체 통과가 아니라 의도한 전체 해제로 표시되어야 한다.
- [ ] `Edit Filter`를 좌클릭하고 조건 2개를 추가해 `OK` 또는 `Apply`를 좌클릭한다. 조건 설명과 결과 행이 일치한다. `Cancel`은 화면을 변경하지 않는다.
- [ ] `합계`/`상세`, 각 구분 섹션, 거래처/농장 표시를 좌클릭 전환한다. 주문·입고·출고의 열 구조와 합계가 상태에 맞게 변하고 원장 쓰기는 발생하지 않는다.
- [ ] 필드 순서를 좌클릭 가능한 명령으로 바꾼다. 현재 웹이 드래그만 제공한다면 이 항목은 실패로 기록하고 `Order` 네 명령 구현 gap으로 남긴다.
- [ ] `Best Fit`을 좌클릭한다. 필드별 너비 변화와 화면 가림/겹침이 없고, 1920×1080 첫 화면에서 주요 버튼·필터·오류 배너가 접근 가능하다.
- [ ] `엑셀`을 좌클릭한다. 현재 구현의 기대 결과는 `Pivot통계_*.csv`이며, EXE parity 목표는 현재 Pivot 배치가 보존된 WYSIWYG `.xlsx`다. 두 결과를 구분해 기록하고 CSV를 XLSX라고 부르지 않는다.
- [ ] `물량표 다운받기`와 `차수·품종별(선택)`은 Pivot 통계 `btnExcel`과 별도 기능으로 실행한다. 선택 차수·품종이 파일명과 시트/행 결과에 반영되고 Pivot 통계의 XLSX gap을 대체하는 것으로 판정하지 않는다.
- [ ] 팝업 닫기 동작을 좌클릭한다. 닫기 버튼이 없거나 우클릭/브라우저 뒤로가기만 가능하면 실패로 기록한다.
- [ ] 모든 조작을 좌클릭만으로 반복한다. 우클릭 컨텍스트 메뉴, 우클릭 전용 핸들러, 키보드만 필요한 숨은 동작은 합격 조건에서 제외한다.

## 4. 완료 판정

- [ ] 15개 EXE 바인딩 필드가 모두 실제 웹 위치 또는 위 표의 명시적 gap으로 분류되어 있다.
- [ ] `CountryFlower`, `OrderYear`/`OrderWeek` 필드 노출, EXE WYSIWYG XLSX, `Best Fit`, `Order` 네 명령, 필드 메뉴 직결 Filter Editor, 팝업 닫기의 미확정 사항을 구현 사실처럼 기록하지 않았다.
- [ ] 화면·내보내기 결과와 API/원장 의미를 혼동하지 않았다. 이 체크리스트 수행 중 ERP 쓰기·운영 DB 변경·커밋·배포를 하지 않는다.
- [ ] 실제 구현 후에는 필수 계약/빌드 검증을 메인 작업에서 수행하고, 본 문서는 그 결과를 임의로 선기록하지 않는다.
