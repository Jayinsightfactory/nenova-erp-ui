# 품목 기본값 일괄 입력 근거 (2026-10-19)

## 후속 사용자 호환 기준 정정
웹 기능을 유지하되 EXE가 읽는 독립값을 보존한다는 최종 요청에 따라 아래 과거 자동 곱셈 정책은 폐기한다. 1박스송이 독립 입력 열을 추가하고 단수/단당 송이를 변경해도 기존 SteamOf1Box는 유지한다. 사용자가 1박스송이를 직접 입력한 경우에만 변경한다. 같은 preview/save 정책과 실제 MSSQL fixture로 77/0/NULL 보존을 검증한다.

실제 CLI 실행: `dnSpy.Console.exe --no-color -t ClassProduct "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`, 같은 명령의 `-t FormProductAdd`.
FormProductAdd.btnSave_Click은 spnBunch/Steam/Box를 각각 BunchOf1Box/SteamOf1Bunch/SteamOf1Box에 넣어 ClassProduct.Update를 호출한다. ClassProduct.Update의 WHERE는 ProdKey, Product만 UPDATE하고 LastUpdateID/Dtm을 기록한다. 원래 저장은 Stock 등 넓은 필드도 포함하지만 새 웹 일괄 입력은 이를 재사용하지 않는다.

read-only 운영 DB probe: Product BunchOf1Box/SteamOf1Bunch/SteamOf1Box는 문서의 DECIMAL과 달리 실제 FLOAT(53). BoxWeight/BoxCBM DECIMAL(10,3), TariffRate DECIMAL(10,4), LastUpdateID NVARCHAR(50). 표본 ProdKey1/2/3은 단수0/단송이3/박스송이0/무게·CBM·관세NULL. trigger trg_Product_NormalizeTinyStock은 NOT UPDATE(Stock)이면 RETURN: 새 SQL은 Stock을 SET하지 않는다. 원본 SELECT 결과는 로컬 .tmp-product-*-result.json에 보관(커밋 제외).

기존 웹 개별 저장은 박스송이=BunchOf1Box*SteamOf1Bunch. 새 일괄 저장도 단위환산 항목을 명시 변경한 경우만 이 파생값을 미리 보여주고 저장한다. 무게/CBM/관세만 변경할 때는 EXE의 독립 박스송이를 보존한다. 기존 원장 수량의 소급 재계산/SP 호출은 없다. 이후 입력과 조회의 환산은 바뀐 마스터를 사용하므로 영향 없음으로 표현하지 않는다.

| 사용자 동작 | Product | SystemActionLog | Order/Warehouse/Shipment/Stock/Estimate/WebProfitReport |
|---|---|---|---|
| 필터·드래그·입력·미리보기 | 읽기/브라우저 초안 | 없음 | 보존 |
| 명시 저장 | 선택 5필드 + 필요한 박스송이 + 수정자/시각 | 같은 transaction에 전후 기록 | 보존 |

기준 ledger: 필터는 기존 productCatalogFilter, selection은 현재 표시 ProdKey 직사각형, 빈값은 변경없음/0은 명시0, 관세 UI%를 /100, 모든 수치는 유한·비음수·표현가능 정밀도. 요청 최대500품목(대량 잠금 상한), stale/삭제/필드허용목록/동시변경/저장 readback 하나라도 실패하면 전체 rollback. 권한은 기존 withAuth 유지. 기준 스냅샷6필드 필수; 보호필드와 재고를 UPDATE하지 않는다. 연도별 전표는 조회/쓰기 대상이 아니다.
