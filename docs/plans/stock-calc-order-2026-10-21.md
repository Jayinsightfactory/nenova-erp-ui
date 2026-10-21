# 공통 재고 CALC 순서 수정 및 목적 확인 보정

## 승인과 실제 근거
- 사용자: “공통 SQL 재계산 함수 정렬도 수정하고, 재고 보정까지 검증해서 배포까지”. 공유 EXE 프로시저의 정렬 한 곳 변경을 명시 승인했다.
- 실제 dnSpy FormStockView.GetData 및 SQL 원천 근거는 `ecuador-stock-cost-2026-10-21.md`를 잇는다. 실제 프로시저는 임시테이블 생성에만 ORDER BY가 있고 list_cursor SELECT에는 없다.
- 읽기 전용 임시 커서 재현에서 35-01이 34-02A/B보다 먼저, 42-01이 41-03보다 먼저 실행됐다. 기존 보정 두 번은 native 결과 불일치로 전부 rollback, 영구 보정은 없었다.

## 고정 기준 / 부작용
|단계|동작|보존 / 중단 조건|
|---|---|---|
|기본 preview|SELECT 및 계획|공유 DB 변경 없음|
|orderingFixApproved 명시|알려진 전체 정의 SHA256 일치 후 커서 SELECT에 ORDER BY OrderYear, OrderWeek 추가|다른 정의·서명된 모듈·설정/매개변수/권한 변화 중단|
|백업|실제 정의, 옵션, 권한, 매개변수, 지문을 ignored private 파일에 먼저 저장|백업 실패 시 DDL 없음|
|통합 rehearsal|SERIALIZABLE + IDLE V2 gate 잠금, ALTER와 보정/원생 CALC를 같은 외부 transaction에서 수행|수량식·원가식·native 호출 계약 유지; 실패 시 모두 rollback|
|apply|동일 원천·범위·정렬 변경의 성공한 rollback rehearsal만 허용|별도 연결 readback; 결과 불명 시 자동 재시도 없음|

기존 재고 보정 계약의 업무키 OrderYear+OrderWeek+ProdKey, 2025 제외/후속연도 포함,
정확한 legacy 노드 승인, 기존 StockHistory 보존/중복 차감 상쇄를 그대로 적용한다.
Product.Stock, 주문/출고/농장/출고일/입고/견적/수동 보고서/확정 revision 및 비대상 재고는 보존한다.
프로시저 정렬 변경은 모든 미래 CALC 호출에 적용되지만 이번 데이터 재계산은 승인 품목 범위뿐이다.
일반 GET/UI는 DDL을 실행하지 않는다. 메뉴/화면/입력/키보드 변경 없음.

기존 Owner V2 capability의 `NenovaStockGateOwnerV2Hash`는 실제 SQL UTF-16 정의의
SHA256과 일치해야 한다. 그 속성만 같은 transaction에서 갱신하고 나머지 속성은 보존한다.
SQL Server 버전별 CREATE/ALTER 저장 차이는 검토한 두 정의의 정확한 hash만 허용한다.
SET 옵션은 sp_executesql을 감싼 동일 batch에서 적용한다. 변경 전후 capability IsReady=1을 요구한다.

## 검증
- 정의 near-miss/중복 cursor/잘못된 해시, 설정·권한·서명 보존, 백업/ALTER/native/readback 실패의 중단 회귀.
- 교차연도 및 34-02A/B → 35-01, 41-03 → 42-01 순서 fixture.
- verify:erp-change 및 dnSpy/manifest/write guard/build → PR CI → Cafe24 배포.
- 운영 통합 rollback, 별도 연결 원천·정의 복원 → apply → 전체 대상 스냅샷/보호 원장 대사.
- 실제 18차 다운로드 및 27~31차 SQL/엑셀 재검증. 실사재고와 사용자 EXE GUI는 별도 확인 범위.
