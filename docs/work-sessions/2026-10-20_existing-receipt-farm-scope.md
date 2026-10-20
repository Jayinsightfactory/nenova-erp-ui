# 기존 입고 농장 조회 조건 바로잡기

| 항목 | 내용 |
|---|---|
| 화면 | 수입부 인보이스 → 기존 입고 유지·원가만 연결 |
| 원장 부작용 | 없음. WarehouseMaster/Detail/Farm/재고/주문/견적/매출 보존 |
| 배포 | 검사·배포·실저장 진행 중, 아직 미검증 |

## 고정 결정
- 2026 42-01 HUBFRESH / XJ-2026-NN006 / 기존 입고 7671을 새로 만들지 않는다.
- 환율 215는 사용자 지정. Populus는 15단 원가, 원문 송이값 임의 보정 없음.
- Farm에 없다는 이유로 기존 입고를 없다고 판단하지 않는다.
- Farm 선택 없으면 같은 연도·차수·송장·입고연도의 활성 입고가 정확히 한 건이어야 한다.
- Farm을 명시 선택한 경우 활성 Farm 검증과 농장 조건을 그대로 유지한다.
- 품목/단가/단수/금액 전체 대조, 잠금 안 재검증, 전체 원장 스냅샷 보존은 유지한다.

## 조건과 영향
| 조건 | 근거 / 소비 지점 |
|---|---|
| FarmKey 생략/null | EXE FarmName 직접 저장, loadExistingReceiptHeader에서 연도·차수·송장·입고연도 유일성 검사 |
| 명시 FarmKey(0/오래된 값 포함) | 활성 Farm 정확히 1행 없으면 차단; 다른 농장으로 폴백 금지 |
| 표시/미리보기/저장 | previewExistingReceiptLink → loadExistingReceiptHeader 공유; 저장에서는 UPDLOCK/HOLDLOCK, 전체 digest 재검증 |
| 문서 revision/상품 대조/작업번호 | 기존 검사 유지, 수량 또는 금액 불일치와 재시도 중복 차단 |
| 신규 입고 | 기존 Farm 필수 및 native writer 조건 변경 없음 |

| 동작 | Warehouse/Farm | Order/Shipment/ShipmentDate/ShipmentFarm | Estimate/Amount/Vat/isFix/WebProfitReport | 웹 문서/작업/이력 |
|---|---|---|---|---|
| 기존 입고 대조 | 조회만 | 보존 | 보존 | 조회만 |
| 원가 연결 | 조회만 | 보존 | 보존 | 기존 계약에 따라 저장 |

### 1. Q. 기존에 있는데 없는 것으로 나오나? 바로잡아.
A. 웹 연결 경로가 활성 Farm 행을 무조건 요구했다. EXE MakeTempTable은 FarmName을 직접 저장하고 ViewWarehouse는 Farm을 LEFT JOIN한다. 별도 농장 목록 누락이 기존 입고 부재를 뜻하지 않는다. 선택을 생략한 경우 유일한 기존 입고를 조회하고 농장·입고일·송장을 확인창에 표시하도록 수정한다.

근거: 로컬 실제 decompile ExcelLoadingPackingList.MakeTempTable/InsertMaster 및 docs/exe-golden/FormWarehouseUpload.md, WEB_VS_ERP_CONFLICTS §7.6. 읽기 전용 Farm HUB 검색 0건, 입고 7671 존재 및 상품 64행/2280단/57230 CNY 대조. 수정 전 전체 입고 snapshot SHA256 8C68F7F7A765021D19F479E56E93393DC12CAAD3FE032E77BD2FD68ED9A66194. 개인 원본·probe 임시 파일은 커밋하지 않는다.

메뉴 기준선: 기존 메뉴 연결/간결한 한국어 안내/기존 확인창 및 키보드 표준 동작 적용. 신규 메뉴·화면틀·ERP 쓰기 해당 없음. 회귀·실배포·실제 원가 저장 및 Excel 재검증은 진행 중.

검증: 신규/기존 범위 회귀 31개 통과. 원가/내보내기/작업대 관련 71개 통과, 환경 의존 9개 생략. 전체 test:erp-contract, dnSpy evidence, manifest, write guard 및 webpack build 통과. 운영 SELECT로 정확히 입고7671 한 건, Farm0건, 기존 웹 연결0건 재확인. 브라우저 보관 작업64행/미매칭0 복원 확인. 배포와 실제 원가 저장·다운로드 검증은 아직 미완료.
