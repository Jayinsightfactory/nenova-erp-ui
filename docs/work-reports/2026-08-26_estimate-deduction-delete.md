# 견적서 불량·검역차감 선택 삭제 — 설계 및 검증

## 사용자 요청 / 완료 기준

견적서관리에서 업체를 선택하고 불량차감·검역차감 행을 체크하여 삭제한다.
정상출고, 판매요청, 다른 차감종류는 이 버튼의 대상이 아니다.

| 조건 | 완료 기준 |
|---|---|
| 선택 | 보이는 불량/검역 행만 개별/전체 선택, 업체·연도·차수 전환 시 초기화 |
| 확인 | 선택 건수·품목을 확인한 뒤 명시적으로 실행 |
| 저장 | 연도+부모차수+업체+ShipmentKey+EstimateKey+조회 스냅샷 대조 |
| 원자성 | 선택 행 중 하나라도 변경/삭제/범위 불일치이면 전체 취소 |
| 확정 | 확정 여부와 무관한 Estimate-only 삭제, 확정 SP/재고 계산 없음 |
| 화면 | 같은 업체 목록·합계 재조회, 미저장 단가/수량은 임의 폐기 금지 |
| 동시작업 | 편집 보호+트랜잭션 잠금+수량/단가/품목/유형/단위/금액 스냅샷 |
| 이력 | 삭제 전 원본 전체와 사용자·범위·선택 키를 같은 트랜잭션의 로그에 기록 |

## 선행 근거 (2026-08-26 읽기 전용 확인)

- 실제 dnSpy CLI: `dnSpy.Console.exe --no-color --md 0x0600011B Nenova.exe`.
- `ClassEstimate.Delete`: `DELETE FROM Estimate WHERE EstimateKey = ...`만 실행.
- `FormEstimateView.groupControl3_CustomButtonClick`은 Sort=0 정상출고를 거부하고,
  선택 차감 삭제 확인 후 ClassEstimate.Delete 및 목록 재조회를 실행한다.
- 설치 EXE SHA256: `4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63`.
- 운영 CodeInfo: Category=EstimateType, Descr2=불량차감 또는 검역차감.
  실제 코드는 불량 KR0009/0010/0011/0020/0024, 검역 KR0012/0013/0014/0019.
- Estimate 트리거 `tr_Estimate_SanitizeDescr`은 INSERT/UPDATE 전용이고 DELETE 트리거 없음.
  Estimate 참조 외래키 없음. Estimate에는 CustKey/isFix 없음, ShipmentMaster에서 범위 확인.
- 동일 34-01에 2025/2026 각각 차감 행 존재. 2026-34-02에도 검역/판매요청 혼재.
  고정 여부로 삭제를 막거나 연도를 현재값으로 추정하지 않는다.
- 확인한 2026-34차 최근 차감 12건 중 Web 원장 연결은 0건. 연결이 없는 경우만
  지원하는 것으로 축소하지 않으며, 연결 행 fixture를 별도 검사한다.

## 부작용 표

| 대상 | 변경 |
|---|---|
| Estimate | 검증한 선택 불량/검역 행만 DELETE |
| OrderMaster/OrderDetail | 보존 |
| ShipmentMaster/Detail/Date/Farm 및 확정 플래그 | 보존 |
| ProductStock/StockHistory/Product.Stock | 보존, SP 호출 없음 |
| CustomerProdCost/WeekProdCost/WebProfitReport | 직접 쓰기 없음 |
| WebSalesDefectDeduction (연결된 원장만) | 원본/담당/검수/수량 보존. 선택한 견적 등록 연결만 해제, 이월은 선택 적용수량만 잔여 복원 |
| WebSalesCarryoverApplication | 과거 적용 기록 삭제 금지. 선택 Estimate 삭제 사실은 이력으로 남김 |
| WebSalesDefectDeductionHistory | 연결 취소 before/after 추가, 과거 기록 보존 |
| SystemActionLog / 편집 보호 | 삭제 감사 추가 / 성공한 범위 기준값 갱신 |

다른 차수에 연결된 Estimate나 불량 원장 전체를 삭제하는 `deleteDeductions`는 재사용하지 않는다.
완료된 이월 요청키가 이미 삭제된 Estimate를 가리키면 성공으로 재표시하지 않고
등록 취소됨을 안내한다. 임의 재등록은 하지 않는다.

## 검사 계획

실행형 fixture: 확정행 선택 삭제, 선택 외 행 보존, 2025/2026 동일차수, 다른 업체/차수,
정상출고 키 위조, 판매요청/다른 차감종류, 빈/중복 선택, 조회 후 변경/삭제, 전체 rollback,
연결 원장·부분 이월·과거 적용 기록 보존, 감사 실패 rollback, 재조회 및 버튼 공존.
운영에서는 SELECT와 새 확인 탭의 선택/취소만 검사하고 실제 고객 차감을 삭제하지 않는다.

## 결과

- 읽기 조회 자체의 누락도 발견: EXE GetDetail 웹 변환은 Estimate 행의 ShipmentKey/OrderWeek가
  정상출고 측 JOIN에서만 왔고 수량은 ROUND, 단위는 Product.EstUnit으로 표시했다.
  삭제 요청에는 별도 DeleteSnapshot으로 Estimate 원본 수량/단위/유형/일자/금액/적요를
  전달하고 출고키는 Estimate.ShipmentKey로 연결했다. 기존 화면/인쇄의 숫자는 변경하지 않았다.
- 변경된 실제 GetDetail SQL을 운영 DB에서 SELECT만 실행: 2026/34/업체565, 80행 중
  차감15행, 차감 출고번호/세부차수 누락 0. 검역/불량 코드·원본 수량·단위 확인.
- 기존 EXE SQL 29개, EXE parity 21개, 단가 전용 저장 69개, 화면 단가/스냅샷 검사 통과.
- 체크/전체선택·선택건수·확인 안내·중복 요청 방지·동일 업체 재조회 구현.
- 연결 영업 원본/수입 확인/수량을 지우지 않고 견적 등록 연결만 해제한다.
  일부 이월 삭제는 선택 application 수량만 복원하고 다른 차수의 등록과 과거 이력을 보존한다.
- Claude CLI Sonnet 읽기 전용 별도 검토에서 레거시 유형의 단위 접미사 판정 차이를 발견했다.
  화면/서버를 `estimateDeductionTypes.js` 공통 판정으로 맞추고 단/박스/송이/스팀/대/개/봉지
  허용 및 임의 접미사 거부 실행형 fixture를 추가했다. 잠금 순서는 EstimateKey 오름차순.
- 삭제 뒤 재조회 실패는 빈 목록 성공으로 표시하지 않는다. 조회 범위·요일 변경 뒤 오래된
  응답 적용을 막고 삭제 중 다른 수정은 차단한다.
- 신규 선택/삭제/원본 스냅샷 검사, `npm run test:estimate`, `npm run verify:erp-change` 전체,
  ERP 계약 33개·dnSpy 근거·변경 API 2개 쓰기 보호 검사를 통과했다.
  `origin/master` 대비 변경 범위 검사와 Next.js 운영 빌드(정적 페이지 98개)도 통과했다.
  운영 배포·화면 확인은 이 작업의 변경사항 검토와 배포 실행 기록에서 확인한다.
- 실제 고객 내역 삭제는 수행하지 않았다. 삭제/부분 이월/실패 rollback은 실행형 fixture로 확인했다.
