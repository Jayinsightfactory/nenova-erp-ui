# 견적서 단가 전용 저장 — 재고 무변경 설계 (2026-08-26)

## 요청·판정

34-01 단가 수정이 뒤 34-02 확정 때문에 중단된다. 단가 수정은 재고 재계산/증감 없이 처리하고, 별도 버튼으로 업체 품목 지정단가도 동시에 저장한다. 수량 변경, 신규 분배, 일반 확정취소의 기존 안전장치는 유지한다.

사용자 의도인 '재고 계산 없는 단가 저장'은 확정 플래그를 그대로 보존하는 금액 전용 트랜잭션으로 구현한다. 단순 플래그 토글은 필요하지 않으며 중간 미확정 상태를 만들지 않는다. 이는 EXE의 금액 결과를 보존하는 웹 전용 저장 흐름이다. 기존 문서의 blanket 확정해제 요구를 수량 변경/단가 전용으로 구분한다.

## 메인 사전 조사 근거

- 기준 코드 f741b0f, 별도 작업공간 codex/estimate-cost-no-stock.
- dnSpy CLI 및 실제 설치본 소스: FormShipmentDistribution.btnSave_Click은 수량 변경이 없을 때 ClassShipmentDate.UpdateCost를 사용한다. 기존 EstQuantity를 보존하고 Cost/Amount/Vat만 변경한다.
- ClassShipmentDate.UpdateCost: Amount=Round(Cost*Round(EstQuantity,0)/1.1,0), Vat=Cost*Round(EstQuantity,0)-Amount.
- ClassCustomerProdCost: CustKey+ProdKey로 지정단가 저장. 신규 키는 identity.
- 2026-08-26 10:46 KST 운영 SELECT: ShipmentMaster/ShipmentDate/CustomerProdCost에는 트리거 없음. ShipmentDetail 트리거는 UPDATE(OutQuantity)일 때만 수량 변경 비고를 기록하며 금액 UPDATE는 해당 안 됨.
- Estimate 트리거는 일부 기존 비고 문자열 정리. 금액·수량·재고·확정 변경 없음. 이 기존 트리거 자체는 이번 범위에서 변경하지 않는다.
- 실제 usp_ShipmentFixCancel/usp_ShipmentFix는 Product.Stock 증감과 StockHistory 기록을 한다. skipStockCalc는 별도 재계산만 생략한다.
- 실제 두 SP에는 단가를 이전 값으로 덮어쓰는 SQL이 없다. 과거 문서의 '다음 확정 시 단가 되돌림'은 현재 SP 근거로 확인되지 않음.
- CustomerProdCost: AutoKey=int identity PK, ProdKey/CustKey=int not null, Cost=float nullable, Descr=nvarchar nullable. (CustKey,ProdKey) 유일 인덱스 없음. 키 범위 잠금 필요.
- 운영 sys.columns 최종 대조: ShipmentMaster에는 ShipmentDtm이 없다. 과거 DB_STRUCTURE 문서의 필드 추정은 사용하지 않으며, 실제 마스터의 OrderYearWeek/EstimateName/CreateDtm/LastUpdateDtm 등을 기준으로 보존한다. ShipmentDetail/ShipmentDate/Estimate/WeekProdCost의 사용 컬럼도 실제 목록과 대조했다.
- 실운영 2025/2026 모두 34-01/34-02 존재. 2026 34-01 확정상세 879건, 34-02 확정상세 317건(시간에 따라 변경 가능).
- 운영 화면에 사용자 미저장 단가 5건이 있음. 해당 탭 재조회/새로고침/저장하지 않았다.
- 운영 SELECT 표본: 실제 거래처 515/출고 5939의 84816/84817/84820은 단가 11400, 84965는 단가 0, 확정 1. 각 날짜금액 동일. 농장행이 없는 기존 분배도 보존하며 새 농장 생성 금지.
- 운영 원장/DB 구조 변경, 저장 시험은 하지 않았다. 인증정보는 연결에 메모리로만 사용, 출력·커밋 없음.
- 실제 Nenova.exe SHA256: 4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63.
- 10:49 추가 읽기에서 34-02 확정상세가 317→412로 변경됨. 타 사용자 업무가 진행 중이므로 전체 차수 상태를 건드리는 재확정 사이클은 단가 전용 경로에 특히 부적절하다.
- 사용자 미저장 5행을 DOM 읽기로 확인: 수국 염색 연라벤더 0→3400(30송이), Montoya 2700→11000(15단), Blessing 11400→12700(10단), Candlelight 11400→16200(10단), Hermosa 11400→14200(10단). 실제 DB값과 조회 화면의 기존 단가/수량이 일치함. 이 입력을 대신 저장하거나 초기화하지 않는다.

## 부작용 표

|동작|허용|보존/금지|
|---|---|---|
|출고 단가|대상 ShipmentDetail와 기존 연결 ShipmentDate의 Cost/Amount/Vat|모든 수량, EstQuantity, 날짜, 비고, 키, nullable isFix 보존|
|업체 지정단가 동시 저장|위 금액+해당 CustKey/ProdKey CustomerProdCost.Cost (없을 때만 INSERT)|타 업체·기존 다른 차수 출고 단가 수정 금지|
|일회성/차수 즐겨찾기|기존 mode 의미, 즐겨찾기는 OrderYear+OrderWeek+CustKey+ProdKey|런타임 DDL 금지|
|Estimate 단가|해당 Estimate.Cost/Amount/Vat|수량 부호/유형/날짜 보존; 지정단가 저장 대상 아님을 표시|
|실제 수량/추가품목|기존 별도 동작 계약|기존 실제 확정 사이클/후속 차수 가드 유지|

모든 금액 전용 저장에서 확정·재고 SP, Product.Stock/ProductStock/StockMaster/StockHistory, 주문·농장·WebProfitReport 직접 쓰기를 금지한다. 편집보호 revision 및 기존 감사 기록만 별도로 허용한다. 전체 가격 배치는 한 DB 트랜잭션이며 실패하면 전체 취소.

## 수용 기준

- 고정 상세도 금액 전용 저장 성공. 뒤 차수가 확정이어도 재고 작업을 호출하지 않음.
- 연도/거래처/출고/상세/부모차수 소속 검증, 편집 충돌 검증 유지.
- 현재 저장 EstQuantity 그대로 금액 산출. 마스터 단위 환산으로 수량 재작성하지 않음.
- 같은 상세의 여러 출고일: 편집한 행만 수집, 같은 가격 중복은 병합, 다른 가격은 명확히 거부. 모든 연결 날짜의 단가는 EXE처럼 함께 갱신.
- 화면의 Date.Cost와 Detail.Cost가 다를 수 있음. sdateKey를 함께 보내면 그 소속과 해당 Date.Cost를 검증; 구버전 요청은 Detail.Cost 대조 유지. 편집보호를 없애거나 stale 오류를 묵살하지 않음.
- fixed 모드 동일 품목의 서로 다른 새 가격은 첫값을 임의 선택하지 않고 전체 거부.
- 수량·날짜·확정·금액을 저장 직후 재조회 대조. 행수/보존값/금액 불일치면 rollback.
- 새 버튼 '단가 + 업체 지정단가 함께 저장'은 mode=fixed를 명시 인수로 전달. React state 갱신 타이밍에 의존 금지.
- 단가 적용/통합 수정 저장/품목 정보 수정의 price-only 흐름에서 일반 unfix/fix 호출 제거. 물량 변경이 섞이면 기존 물량 계약 유지.
- 사용자 미저장값과 기존 네 등록 버튼 보존.
- 0원, 소수 수량, 음수 Estimate, mixed/null isFix, 중복 날짜, 지정단가 실패 rollback, 교차연도/타 업체/잘못된 상세, 동시 수정 fixture.
- 새 실행 테스트가 실제 공용 저장 모듈을 호출해야 한다. source 문자열 테스트만으로 완료 금지.
- 전체 ERP 검사, dnSpy 근거, 범위·쓰기 검사, build 후 별도 고성능 검토.

## 담당

설계·근거·외부작업: 메인 Codex. 설계 검토: gpt-5.6-sol/high.
UI/연결/문서·테스트 초안: 사용자 요청에 따라 Claude CLI Sonnet (P0_LOCAL), 승인 요청 금지. 핵심 저장 코드 요청이 장시간 반환되지 않아 해당 요청만 종료하고, 기존 고성능 검토 하위 작업이 저장 모듈·실행 테스트를 이어 구현했다.
구현자는 운영 DB/브라우저/비밀값/다른 작업공간을 접근하지 않는다.

## 검증 결과

- 단가 전용 저장 모듈 실행 검사 69건 통과: 확정/미확정/nullable 상태, 후속 차수 확정, 일회성/지정단가/차수단가, 음수 견적, 0원, 다중 출고일, 실패 전체취소, 연도·업체·출고 소속, 저장 후 보존값 대조.
- 화면 단가 확인값/수량 동시 수정 연결 검사 22건 통과. 미편집 행이 중복 수집되지 않도록 정확한 행 키로 수집한다.
- 기존 견적서 인쇄 57건, 추가 품목등록 22건 및 불량/검역 버튼 보존 검사 통과.
- test:estimate 및 verify:erp-change(전체 계약/근거/변경범위/쓰기 보호/운영 빌드) 통과. 마지막 스키마 보완 후 최신 기준 코드 683a3a5와 합친 상태에서도 전체 검사를 다시 통과했다. origin/master 대비 manifest/write guard도 통과했다.
- 운영 검증은 SELECT와 화면 읽기만 수행했다. 실제 고객 단가/지정단가 저장 시험은 하지 않았으며, 사용자 미저장 입력 5건을 건드리지 않았다.
