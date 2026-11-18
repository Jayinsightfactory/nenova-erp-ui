# BALVERDE 기존 입고 누락 필드 읽기 진단

## 후속 명시 승인

사용자 `보정해줘` 승인 수신. 아래 최초 진단의 승인 대기는 이 항목으로 대체한다. 정확한 두 입고의 검증된 누락 필드만 허용하며 수량·가격·금액·재고 변경은 제외한다. 신규 보정 helper/script와 계약·반례 테스트를 배포한 후 백업→rollback rehearsal→별도 연결 원복 확인→동일 지문 CAS 적용→후속 불변 지문 확인 순서로 진행한다. 기존 범용 correction API는 상세 DELETE/재INSERT로 PK가 바뀌므로 이번 최소 보정에 사용하지 않는다.

2026-11-18 SELECT-only. 운영 수정 승인 전이며 실제 정정 0건. 원본 PDF/행별 업무 자료는 저장소에 복사하지 않는다.

## 대상과 원본 신원

|연도/차수|WarehouseKey|InvoiceNo|상세키|박스|송이|USD|
|---|---:|---|---|---:|---:|---:|
|2026/46-02|8073|25571|49674~49679|93|2790|2211|
|2026/47-02|8162|25587|50455~50459|69|2070|1683|

- 46-02 실제 단독 CI의 SHA256 `8dee457a880cb2c6c52e861d56dcf81f085151c5f24dc90597869daf002ed62a`는 저장 WebInvoiceDocument와 일치. 6행 수량/단가/금액도 원장과 일치. 전체 합본 CI의 해시와 혼동하지 않는다.
- 47-02 저장 원본 SHA256 `e6daaeac008c5c283785909f40a70b0ad04fa235cbd26b6a675cf185d7411f94`, 파일명 `47-2 Hortensias CI Invoice.pdf`, AWB `99204727822`. 로컬/Google Drive 검색에서 실제 CI PDF는 아직 확보하지 못했다. 저장 웹 원문행은 5행 모두 원장 수량/가격과 일치하지만 실제 PDF 독립 대조는 미검증.
- 로컬 `47-02_Hortensias.xlsx`는 11월26일 ETA 발주서이며 이 입고 송장의 원본/변환 패킹으로 사용하지 않는다.
- 사용자 첫 화면의 134박스/USD3468 신원은 미확인. 8073/8162에 덮어쓰지 않는다.

## 누락과 보존

- OrderCode는 11행 모두 빈 문자열.
- 8073의 49674/49675/49677/49678/49679: BunchQuantity 및 SteamOf1Bunch NULL. 보완 후보 단수 90/510/90/1500/30, 단당송이 1.
- 8162의 50455/50456/50458/50459: 같은 두 필드 NULL. 보완 후보 단수 120/270/900/30, 단당송이 1.
- 49676/50457은 기존 단수570/750 및 단당1이 있어 보존한다. SteamQuantity는 11행 모두 존재한다.
- BoxQuantity/SteamQuantity/SteamOf1Box(30)/OutQuantity(박스)/EstQuantity(송이)/UPrice/TPrice/ProdKey/헤더는 현재 자료를 보존한다. 운영 Product 마스터의 포장비율을 전역 수정하지 않는다.

## 확인된 원인과 native 매핑

- `invoiceReceiptWriter.js` 신규 INSERT는 OrderCode를 `N''`로 고정하고 UPDATE/readback에도 OrderCode를 포함하지 않는다.
- `invoiceReceiptValidation.js`는 Product.SteamOf1Bunch/BunchOf1Box로 누락 단수를 환산한다. 해당 다섯 품목의 두 마스터값은 모두0이라 NULL을 유지한다. 유일한 light pink는 Product.SteamOf1Bunch=1이라 단수가 채워졌다.
- 저장 WebInvoiceLine 11행의 sourceEvidence.packing은 모두 stemsPerBunch=1/stemsPerBox=30인데 기존 검증은 이 근거를 사용하지 않았다. 신규 adapter의 CO family 보완은 새로 생성하는 초안에만 적용되며 기존 원장을 소급 정정하지 않는다.
- 실제 decompile `ExcelLoadingPackingList.MakeTempTable`은 엑셀 A(COD)→OrderCode, G→SteamOf1Bunch, H→SteamOf1Box, I→BunchQuantity, J→SteamQuantity, K/L→UPrice/TPrice. `Insert`는 Master bulk copy→uspCreateWarehouse→native stock calculation 순서다.
- 현재 `importPacking.js` buildSheet19_2는 COD에 `String(idx+1)`을 쓴다. 따라서 현재 변환 경로의 순번 근거는 존재하지만, 실제 원본 변환파일 또는 동일 source-line 매핑 재생 대조 없이 운영 OrderCode를 임의 채우지 않는다. PDF의 ORD 값과 혼동하지 않는다.

## 최소 정정 계획 (승인 전 실행 금지)

1. 47-02 실제 원본 PDF를 위 SHA로 확보하여 송장25587·5행을 독립 대조한다. 두 원본에서 동일 생성기를 재생해 COD를 확정한다(유료 AI 재호출 금지).
2. 예상 범위는 최대11상세행: 검증된 OrderCode만 보완하고 위9행의 단수/단당송이만 채운다. 기존 값/원본 신원/키/수량·가격 지문이 바뀌면 중단한다.
3. 명시 운영 승인 후 정확한 두 Master+11Detail 잠금, 기존 지문 재검증, 최소 UPDATE, readback 및 실패 전체 rollback. 원본/감사 이력 보존 방식도 먼저 확정한다. 새 입고 재등록/삭제·전역 Product 수정 금지.
4. OutQuantity/EstQuantity와 단가·금액이 바뀌지 않는 범위면 재고CALC/확정해제/재확정을 하지 않는다. 다를 경우 별도 영향 계획과 승인이 필요하다.
5. 46-02 해당 품목의 활성 출고38행은 모두 확정, 47-02 해당 출고는 현재 조회0행. 이 집계는 BALVERDE만의 출고 소유권이 아닌 대상 품목 전체 범위다. ProductStock 두 차수 스냅샷이 존재하므로 보호 지문에 포함한다. Shipment/ShipmentDate/Farm/Estimate/손익 및 전년도 원장도 보존 확인한다.

## 현재 기능 작업 상태

명세서 이름 연결/Farm 명시등록 UI와 Desktop1.3.40 메뉴 연결 구현 완료. 대상 및 기존 패킹 하네스81 PASS/기존skip1, 실제 Electron 스모크 PASS, ERP 전체 계약 재검증 PASS, dnSpy/manifest226/쓰기 가드 PASS. 최종 build 진행 중. PR/CI/배포 및 기존 원장 정정 완료로 주장하지 않는다.
