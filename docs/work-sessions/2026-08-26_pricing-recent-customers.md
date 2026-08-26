# 업체별 단가관리 최근 거래업체 기본 목록

Q. 업체 선택에는 최근 거래업체만 표시하고, 특별히 검색하면 과거 업체도 찾고 싶다.

A. 기본은 KST 오늘 포함 90일 내 양수 주문/출고가 있는 업체. 검색어 입력 시 기존 전체 활성·담당자 지정 업체에서 업체명/담당자로 검색한다. 기간은 사용자 미지정이므로 90일로 정하고 화면과 진행 안내에 표시했다.

## 범위

- `pages/master/pricing.js`, `pages/api/master/pricing-matrix.js`, 공용 `pricingCustomerSelection.js`.
- SELECT-only 고객 거래 메타데이터. 기존 CustomerProdCost 조회/PUT, EXE parity 조회 함수 변경 없음.
- PK joins OrderMasterKey/ShipmentKey. 년도 반복 차수 JOIN 없음. 미래 일자는 제외.
- 검색 전환으로 선택된 업체를 삭제하지 않음. 전체 선택/해제는 현재 보이는 목록에만 적용.
- dnSpy CLI FormCustomerProdCost SetCombo/GetData/btnModify_Click 확인. 실제 운영 기존 목록123업체 읽기 확인. 직접 DB 환경 없음.

## 검증

pricingCustomerSelection 실행형 필터/선택 fixture, test:erp-contract, dnSpy evidence, manifest, ERP write guard, build(98 pages), diff --check PASS.

## 상태

배포 및 실제 기본목록/검색어 해제 스모크 예정. 운영 단가 저장은 실행하지 않는다.
