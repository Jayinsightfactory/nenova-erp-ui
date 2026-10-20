# 2026-10-20 44-1차 음수 주문의 Pivot 통계 누락 진단

## 요청
콜롬비아 카네이션·수국을 음수로 주문등록했으나 Pivot 통계에서 보이지 않는 원인 확인. 사용자 메뉴확인: Pivot 통계.

## 확인 결과
2026/44-01 ViewOrder 음수 주문: 카네이션26행/-76박스, 수국4행/-17박스. 입력값은 원장 조회에 존재한다.
StockMaster20264401(StockKey291)이 있으며 해당 음수30행 모두 StockList 연결조건 충족.
최신 origin/master(bafc5868)의 기본 전산피벗 sqlQuantityPivotGetData 주문분기 WHERE vo.OutQuantity > 0 때문에 음수행 제외.
동일 SQL의 운영 읽기 조회: 콜롬비아 해당2품종 주문403행(카네이션323/수국80), 음수0행. 저장된음수30행이 정확히 빠진다.
실제 설치 Nenova.exe FormQuantityPivot를 dnSpy.Console로 재추출하여 동일 OutQuantity>0 조건 확인.
해당음수행 NoneOutQuantity=0이므로 미발주 분기에도 나오지 않는다.
출처: lib/exeQuantityPivotSql.js:34, pages/stats/pivot.js 기본mode=exe, docs/exe-golden/FormQuantityPivot.md.
원본 증거는 기존 세션작업트리 outputs/pivot-negative44-native.txt, pivot-negative44-probe.json, pivot-negative44-api-query.mjs에 보존. 개인정보/고객명 저장없음.

## 범위
원인진단만 수행. 주문/출고/재고/견적/매출 DB쓰기, 코드수정, 배포 없음. 실제 로그인된 사용자 화면의 필터상태는 미검증.
음수주문을 보여주려면 전산피벗의 양수전용 조회정책을 별도수정해야 한다. 기존EXE동작과 다른 웹확장이므로 계약/회귀검증을 동반해야 한다.

## 이전에는 표시됐다는 후속 질문
변경이력상 b46355a8(2026-09-14)에서 기본전산피벗 모드도입. 기존웹피벗은 양수전용주문조건없음. 전산SQL양수조건은 c5feda67(2026-07-06) 이후동일. 브라우저 localStorage statsPivotMode 유무에따라 기본전산/저장legacy가달라짐. 사용자의이전모드/브라우저저장값과당일배포일은미검증. 원인설명을모드전환가능성과확정코드이력으로구분.


## 후속 수정 요청과 기준 (2026-10-20)
사용자: 음수 주문도 피벗에 표시하고 합계에서 차감, 모든 국가·차수 적용 후 배포.
기준: StockList의 전체 연도차수 키와 기존 인증/범위 검증 보존. 주문 분기만 OutQuantity<>0; 0/NULL 제외, 단위 변환 없음, 기존 필터·보기 설정 보존. 화면 모델과 XLSX는 동일 부호 있는 SUM 사용.

| 동작 | OrderMaster/Detail | ShipmentMaster/Detail/Date/Farm | Warehouse/Stock/StockHistory | Estimate/Amount/Vat/isFix/WebProfitReport |
|---|---|---|---|---|
| 피벗 조회·필터·합계·엑셀 | 보존 | 보존 | 보존 | 보존 |

메뉴 기본값: 적용—기존 화면·키보드·스크롤 유지, 조회와 엑셀 같은 집계. 해당 없음—신규 메뉴, 입력/매칭/ERP 반영, 권한 변경. 예외—native 양수전용 주문 조회와 달리 사용자 요청에 따라 웹 음수 주문 읽기 확장.

운영 읽기 재검증: 20264401 기존1112행 전부동일, 음수주문31행/-103만 추가. 콜롬비아 수국·카네이션30행/-93 포함. 20264402(466행), 20254001(1719행)은 음수없음/변화없음. 기존·변경 SQL 결과의 원본 행 전체를 메모리에서 대조, 고객정보 출력/저장없음. 새 회귀 18개 연도·차수·국가 조합과 음수전용/상쇄0·XLSX 통과.

검증: test:pivot / manifest / write guard / build 통과. 브라우저 1920x1080·1280x800 synthetic +10/-3와 합계7 표시 확인. 전체ERP 검사 로컬 C:558MB로 activity health 검사가 실패, 관련 테스트 임계값1GB. 캐시삭제 자동승인차단으로 삭제없음. CI의 전체검사 통과 후 배포. 운영 로그인 세션 화면은 아직 미검증.
