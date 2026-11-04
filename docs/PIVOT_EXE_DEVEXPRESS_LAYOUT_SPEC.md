# 전산(nenova.exe) DevExpress PivotGrid 동일 디자인·조작 규격 (2026-11-04)

대상: `/stats/pivot` 전산 피벗 모드(`components/PivotExePanel.js` + `components/PivotExeGrid.js`), `/warehouse` 발주관리.
근거: 설치본 `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe` 디컴파일 `FormQuantityPivot.Designer.cs`, `FormOrderHistory(.Designer).cs` (`C:\Users\USER\nenova-decompiled\Nenova`) 및 사용자 제공 exe 캡처 2장.
원칙: 디자인·조작법만 exe와 동일하게 바꾼다. 웹에서 추가한 기능(즐겨찾기, 세부/메인차수, 입고 보기, 환율, 도착원가·분배단가, 고급 필터, 표시 설정, 소수점, 0표시, 소계 토글)은 전부 유지한다. SQL/API/ERP 원장은 변경하지 않는다(발주관리 데이터 원천 교체는 §4 참고).

## 1. exe 필드 정의 (dnSpy)

### FormQuantityPivot (Pivot 통계) — 15 native 필드
| Area | AreaIndex | Caption | Column | 비고 |
|---|---|---|---|---|
| Row | 0 | 국가 | CounName | |
| Row | 1 | 꽃 | FlowerName | |
| Row | 2 | 품목명(색상) | ProdName | Width 189 |
| Column | 0 | 주문년도 | OrderYear | |
| Column | 1 | 주문차수 | OrderWeek | ShowTotals=false, ShowGrandTotal=false |
| Column | 2 | 구분 | ListType | |
| Column | 3 | 거래처명/농장명 | CustName | |
| Data | 0 | 수량 | Quantity | N2 |
| Filter | 0 | 품목명 | CountryFlower | |
| Filter | 1 | 지역 | CustArea | |
| Filter | 2 | 출고일 | ShipmentDtm | ShowTotals=false |
| Filter | 3 | 입고단가 | UPrice | N2 |
| Filter | 4 | 입고총단가 | TPrice | N2 |
| Filter | 5 | AWB | OrderNo | |
| Filter | 6 | 비고 | CustDescr | |
웹 추가 필드(유지): 거래처 주문코드 CustOrderCode, 분배단가 DistCost, 도착원가 ArrivalCost → 기본 Filter 영역 맨 뒤.

### FormOrderHistory (발주 관리 · 그룹박스 "≡ 발주 목록")
| Area | AreaIndex | Caption | Column | 비고 |
|---|---|---|---|---|
| Row | 0 | 국가 | CounName | |
| Row | 1 | 꽃 | FlowerName | |
| Row | 2 | 품목명(색상) | ProdName | Width 189 |
| Row | 3 | C.N. | OrderCode | |
| Column | 0 | 입력일자 | ChangeDtm | 날짜 d |
| Data | 0 | 변경수량 | AfterValue | N2 (= AfterValue − ISNULL(BeforeValue,0)) |
| Filter | 0 | 주문주차 | OrderWeek | |
| Filter | 1 | 거래처명 | CustName | |
| Filter | 2 | 단위 | OutUnit | |
상단 조건: 차수(lueOrderWeek, 기본=최신 차수), 품목(lueCountry = CountryFlower, 빈값 허용). 버튼: 새로고침, 엑셀(WYSIWYG xlsx "발주 목록"), 닫기. 셀 더블클릭 → FormHistory(원본 행 drill-down 목록).
exe SQL (GetData, 읽기 전용):
```
SELECT CONVERT(VARCHAR, oh.ChangeDtm, 23) ChangeDtm, o.OrderWeek, c.CustName, p.CounName, p.FlowerName, p.ProdName,
       o.OrderCode, oh.ChangeType, oh.ColumName, (oh.AfterValue - ISNULL(oh.BeforeValue,0)) AfterValue,
       u.UserName ChangeUser, p.OutUnit
  FROM ViewOrder o JOIN OrderHistory oh ON o.OrderDetailKey = oh.OrderDetailKey
  JOIN Customer c ON o.CustKey = c.CustKey JOIN Product p ON o.ProdKey = p.ProdKey
  JOIN UserInfo u ON oh.ChangeID = u.UserID
 WHERE 1=1 [AND o.OrderWeek = @week] [AND p.CountryFlower = @countryFlower]
```

## 2. 화면 구조 (DevExpress PivotGrid 기본 레이아웃, exe 캡처 기준)

```
┌ 그룹박스 제목줄: "≡ Pivot 통계" / "≡ 발주 목록"  (회색 바, 굵게 12px) ───────────────────────┐
│ ① 필터 영역 (가로 한 줄, 전체폭)  [품목명][지역▾][출고일][입고단가][입고총단가][AWB][비고] │
├──────────────────────────────┬───────────────────────────────────────────────────────┤
│ ② 데이터 영역 헤더 [수량]     │ ③ 열 영역 필드 버튼 [주문년도▲][주문차수▲][구분▲][거래처명/농장명▲] │
│ (회색 빈칸)                    │ ④ 열 값 트리:  ⌄ 2027                                   │
│                              │               ⌄ 39-02                                  │
│ ⑤ 행 영역 필드 버튼            │          ⌄ 01. 전재고  │ ⌄ 05. 현재고                   │
│ [국가▲][꽃▲][품목명(색상)▲]    │ (값 필드 2개 이상이면 마지막 줄에 측정값 이름)              │
├──────────────────────────────┼───────────────────────────────────────────────────────┤
│ ⌄국내 │⌄기타 │Chargeable weight│   592,860.14   │   592,860.14                          │
│       │      │Gross weight     │   558,031.22   │   558,031.22                          │
│       │ 기타 Total (연녹색)     │ 1,150,891.36   │ 1,150,891.36                          │
│ 국내 Total (연녹색, 굵게)       │ 1,168,275.46   │ ...                                   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```
- 필드 배치판(별도 deck)은 없앤다. 필드 버튼은 위 ①②③⑤ 위치에만 산다. 영역이 비면 회색 빈칸에 옅은 안내 "여기에 필드를 놓으세요"(DevExpress 기본 문구와 같은 역할).
- 모든 필드 버튼 공통 스타일: 높이 22px, 배경 `#fdfdfd`→`#ececec` 세로 그라데이션, 테두리 1px `#a7a7a7`, 글자 12px `#1e1e1e`, 좌우 패딩 6px, 버튼 사이 간격 2px, 영역 배경 `#f0f0f0`. 정렬 상태는 오른쪽에 ▲/▼ (행·열 영역만, exe와 동일). 필터가 걸린 필드는 오른쪽에 깔때기(▾) 아이콘이 항상 보이고, 아니면 hover 시에만 보인다.
- 열/행 값 헤더: 배경 `#f3f3f3`, 접힘 가능한 그룹값 앞에 `⌄`(펼침)/`›`(접힘) 글리프, 클릭하면 접기/펼치기. 그룹값은 세로 병합(rowSpan).
- 소계 행/열: "{값} Total", 배경 `#e5f2dc`(연녹색), 굵게. 총계: "Grand Total" → 한글 "총계", 같은 연녹색.
- 숫자 셀: 오른쪽 정렬, N2(천단위 콤마, 소수 2자리; 웹의 소수 자릿수 설정이 우선), 글자 11~12px, 테두리 1px `#d4d4d4`, 흰 배경.
- 전체 테두리 1px `#9d9d9d`. 글꼴은 사이트 공통(맑은 고딕 계열).

## 3. 조작법 (DevExpress 기본 + 웹 유지 기능)
| 조작 | exe | 웹 구현 |
|---|---|---|
| 필드 이동/순서 | 버튼을 잡아 영역 간 드래그, 같은 영역 안에서 순서 변경 | 동일 (HTML drag). 드롭 위치는 파란 삽입선. 영역 밖(회색 빈칸)에 놓으면 그 영역 끝 |
| 정렬 | 행·열 필드 버튼 클릭 → asc/desc 토글 | 동일. 필터·데이터 영역 버튼 클릭은 값 필터/집계 메뉴 |
| 값 필터 | 버튼 오른쪽 깔때기 클릭 → 체크 목록(전체 선택, OK/Cancel) | 기존 FilterValueDialog 재사용 |
| 컨텍스트 메뉴 | 우클릭: Reload Data / Best Fit / Order(처음·왼쪽·오른쪽·끝) / Hide / Show Field List / Show Filter Editor | 우클릭 + 좌클릭 보조(버튼 hover 시 작은 ⋯) 모두 기존 FieldMenu 열기 |
| 그룹 접기 | 값 헤더 ⌄ 클릭 / 더블클릭 | 동일 |
| 열 너비 | 헤더 경계 드래그, 더블클릭 자동맞춤 | 기존 유지 |
| 필터 편집기 | 하단 Prefilter 패널 "[국가] In (…)" 클릭 → 편집 | 표 아래에 적용 필터 한 줄 표시(기존 pivot-applied-filters). 클릭 시 해당 값 필터/고급 편집 |
| 상단 조건 | 시작/종료 연도·차수(노란 배경 `#FFF5E3` 룩업), 새로고침·엑셀·닫기 큰 버튼(오른쪽) | 동일 배치. 아이콘은 텍스트 대체 가능 |
| 웹 추가 기능 | 없음 | 툴바 아래 `▸ 웹 추가 기능` 접이식 띠 1줄(기본 접힘, localStorage 기억): 세부/메인차수, 입고 보기, 환율, 소수점·0표시·소계·총계, 표시 설정, 기본 배치 복원, 즐겨찾기, 필드 목록, 필터 편집, 모두 펼침/접기 |

## 4. 발주관리 데이터 원천
현재 웹 `/warehouse`는 WarehouseDetail(입고) 입력일자 피벗이라 exe(OrderHistory 주문 변경 이력)와 **데이터 의미가 다르다**. exe 카피를 위해 새 API `GET /api/warehouse/order-history-pivot?week=&countryFlower=`가 §1 SQL을 파라미터 바인딩으로 그대로 실행한다(SELECT only). 기존 WarehouseDetail 피벗은 "기존 웹 보기" 토글로 유지한다.

## 5. 검증
- `npm run test:pivot-exe` 전부 통과 + 새 fixture(커스텀 필드 레지스트리, FormOrderHistory 레이아웃).
- 브라우저(localhost:3000, 로그인 쿠키): 필드 드래그 4영역 이동, 정렬 토글, 값 필터, 접기, 엑셀, 즐겨찾기 저장/적용, 환율 적용이 재배치 후에도 동작. 1920×1080 및 1366 폭 확인.
