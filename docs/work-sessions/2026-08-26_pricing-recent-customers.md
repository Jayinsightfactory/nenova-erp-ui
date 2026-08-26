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

PR #365 병합(54bedf7), 배포 run 32929551534 성공. 운영 화면 버전54bedf7 확인.
실브라우저: 기본 최근90일 77/전체123업체, 기본에서 제외된 가나안꽃집 검색 시 1건 노출, 검색어를 키보드로 지우면 최근77개 복귀. 기존 선택 1개 유지. 운영 단가 저장/ERP 쓰기는 실행하지 않았다.

페이지 로드 콘솔에서 React hydration #418/#423 경고가 관찰됐다. 기존 localStorage 초기 state와 관련 가능성이 있으나 이번 변경 원인으로 확정하지 않았으며 별도 진단 대상이다. 위 업체선택/검색 동작은 정상 확인했다.
