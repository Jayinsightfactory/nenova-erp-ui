# 국가별 발주서 원본·전달 이력과 카톡 대조

상태: 구현·격리 UI 검증 중. 전체 gates/PR/배포는 미완료. 작업자 Carver 단독. 기준 origin/master 4ae7fbee.

## 범위와 현장 흐름

기존 수입부 업무도구의 국가별 발주서(PedidosTool)에 덧붙인다. 새 중복 메뉴는 만들지 않는다.
국가·연도·실제 세부차수 선택은 조회만 한다. 명시 미리보기 생성 뒤에만 Excel을 생성한다.
ETA, 국가별 양식, 단위, 농장별 분리, 품목·업체 충돌 방지와 현재 전체 주문을 유지한다.

다운로드 요청시 직렬화한 실제 XLSX bytes와 SHA256, 행 snapshot, 원천조회시각,
최초 다운로드 요청시각을 팀 공유 이력에 불변 보관한다. OS 저장 완료나 실제 농장 전달로
간주하지 않는다. 반복 요청은 동일 작업 ID로 같은 원본을 돌려주며 다운로드 재시도는
새 버전을 만들지 않는다. 명시적 농장 전달완료는 원본과 별도 append-only 이벤트이고
동일 원본의 재체크는 최초 시각을 유지한다. 마지막 전달본은 다운로드본과 구분한다.
과거 이력은 현재 ERP 상태로 재생성하지 않고 보관된 원본 bytes 그대로 반환한다.

## 부작용 표

| 동작 | OrderMaster/Detail/History | Shipment/Date/Farm | Warehouse/Stock | Estimate/Amount/Vat/isFix/WebProfit | 웹 파일 |
|---|---|---|---|---|---|
| 국가·차수·카톡·변동 근거 조회 | SELECT | 보존 | 보존 | 보존 | 없음 |
| 선별·미리보기 | 보존 | 보존 | 보존 | 보존 | 없음 |
| 명시 다운로드 | 보존 | 보존 | 보존 | 보존 | 원본+snapshot 불변 생성 |
| 명시 전달완료 | 보존 | 보존 | 보존 | 보존 | 별도 최초 이벤트 생성 |
| 과거 열기·재다운로드 | 보존 | 보존 | 보존 | 보존 | 읽기만 |

## 기준 ledger

- 범위: country + OrderYear + exact OrderWeek; 행: CustKey + ProdKey + unit, 원장 상세키 보존.
- 전산 수량: 기존 countryOrderSource/adapter 권위. 중국 OutQuantity와 정확 OutUnit.
- 3시점: 마지막 전달본의 원천 snapshot / 카톡 원문 시각·행 / 현재 등록과 OrderHistory 변경시각.
- 동일 수량만으로 중복 판정하지 않는다. 별도 source ID·주문 상세키·변동키는 별도 근거다.
- 추가가 이미 ERP에 반영됨은 업체·품목·단위·수량·시각·유일 변경 근거가 모두 맞아야 한다.
- 부분 일치, 복수 후보, 정정·취소, 누락 시각, 과거 기준 없는 추정은 검토 상태다.
- 현재 ERP 전체는 항상 출력 기반이다. 확정된 미등록 신규분만 더한다. 검토 행을 조용히
  제외한 채 완료/다운로드하지 않는다. 기존 고객·품목 이름은 표시를 위해 합치지 않는다.
- 원문 좌측/선별 우측; 선택한 근거만 강조. 3번 분석 요약은 기본 접힘.
- 팀 조회/저장/전달 체크는 기존 canManageInvoiceReceipt 권한과 활성 계정으로 제한한다.
- 새 schema/외부 보관 인프라가 필요한 경우 자동 생성·마이그레이션하지 않고 선행작업을 보고한다.
- 설치 Desktop production 보안 origin은 유지한다. 격리 Desktop 테스트는 별도 test profile만 쓴다.

## 선검증 근거

2026-11-19 실제 설치 EXE를 dnSpy.Console.exe --no-color -t FormOrderView로 재확인:
GetData는 ViewOrder와 Product를 읽고 ExportToXlsx는 WYSIWYG이다. 이 기능은 저장/SP를 호출하지 않는다.
운영 SELECT: 중국 2026/47-02 61행/16업체/38품목; 2025 동일차수 27행/2업체/23품목.
OutQuantity 합계 2356/980은 혼합단위 여부 확인 전 발주 합계로 사용하지 않는다.
OrderHistory 실제 컬럼은 OrderHistoryKey,ChangeDtm,ChangeID,ChangeType,ColumName,
BeforeValue,AfterValue,Descr,OrderDetailKey. 현재 API 집계는 상세키·시각을 제거하므로
그 응답만으로 카톡과 등록 동일 건을 확정할 수 없다.

## 검증 계획

100 전달→ERP120+동일 추가20은120(중복0), ERP100+카톡만20은120,
동일 메시지 재선택/다운로드는 불변, ERP110+카톡20은 검토(자동130/120 금지).
동일수량 별도 주문, 다른 업체/품목/단위, 2025/2026 같은47-02, 타국, 취소·정정,
빈 기준본, stale 응답/동시 전달, 권한, 파일 변조, 원본 hash 검증을 포함한다.
실제 중국47-02 동일건은 SELECT 근거가 확보될 때만 실제 검증으로 기록한다.
Desktop 앱에서 미리보기/실제 저장창/Excel 열기/격리 전달체크/재진입·동일bytes를 검증한다.
ERP 필수 gates와 Desktop 메뉴·버전·단위/패키지 smoke·CI 뒤 PR squash와 Cafe24 배포를 수행한다.

가장 큰 약점: 카톡/ERP에 공통 주문 ID가 없어 수량·시각 일치만으로 동일 사건을 입증하지
못할 수 있다. 그 경우 자동 중복제거하지 않고 사용자가 유일 근거를 확인하는 검토 상태를 유지한다.
