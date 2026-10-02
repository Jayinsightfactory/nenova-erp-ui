# ShipmentDetail.CustKey NULL — EXE 정상 저장과 웹 조회 오탐 정정

확인일: 2026-10-02. 대상: 주광 요일 분배·견적 및 공유 출고 원장의 거래처 연결 판정.

## 먼저 읽을 결론

**`ShipmentDetail.CustKey=NULL`만으로 데이터 누락·손상이나 SQL 보정 필요성을 판단하지 않는다.**
실제 `nenova.exe`의 `ClassShipmentDetail.Insert/Update`는 CustKey를 기록하지 않는다.
`ViewShipment`는 `ShipmentDetail.ShipmentKey → ShipmentMaster.CustKey`로 거래처를 결정한다.
따라서 상세 CustKey가 NULL이어도 정상 분배·견적 조회에 포함될 수 있다.

이 기록은 기존 [호환 불변식](ERP_COMPAT_INVARIANTS_2026-06-04.md)의 3번을
모든 기존 원장의 조회·인쇄 필수 조건으로 해석했던 판단을 정정한다.
“NULL 거래처 키를 채워야 한다”는 이번 세션의 초기 설명도 철회한다.

## 실제 EXE 근거

- 원본: `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`
- SHA256: `4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63`
- dnSpy CLI로 새로 추출한 `ClassShipmentDetail`에는 CustKey 속성이 없다.
- Insert SQL은 SdetailKey, ProdKey, ShipmentDtm, 환산 수량, OutQuantity,
  EstQuantity, Cost, Amount, Vat, isFix, Descr, EstDescr, **ShipmentKey**를 기록한다.
  **CustKey는 INSERT 열 목록에 없다.** Update도 CustKey를 갱신하지 않는다.
- `FormShipmentDistribution.btnSave_Click`은 ShipmentKey를 설정한 뒤 이 클래스의
  Insert/Update를 호출한다. 요일 변경 경로도 같은 클래스의 Update를 사용한다.
- [저장된 ViewShipment 정의 §7.5](WEB_VS_ERP_CONFLICTS.md)는
  `sm.ShipmentKey=sd.ShipmentKey`로 상세를 연결하고 `sm.CustKey`로 Customer를 연결한다.
  `sd.CustKey=sm.CustKey` 조건은 없다.
- [기존 주차 검증 스크립트](../scripts/verify-week.mjs)에도 native NULL이 정상일 수 있다는
  주석이 이미 있었다. 오래된 문서의 일괄 보정 설명보다 실제 저장·조회 근거를 우선한다.

로컬 추출 근거: `output/weekday-null-customer-native.log`의 Insert 307행/Update 313행,
`output/weekday-compat-distribution.log`의 1103~1119행/1183~1185행,
`output/weekday-compat-estimate.log`의 GetPrintDetail 304행 이후.
output 로그는 로컬 증거이며 배포 산출물이나 저장소 필수 파일은 아니다.

## 운영 읽기 전용 확인

2026년 주광농원(CustKey 533), GET item-trace로 확인했다. 운영 쓰기는 하지 않았다.

| 세부차수 | 양수 출고 상세 | 상세 CustKey NULL | NULL 중 ERP 표시 가능 | 양수 상세 날짜 수량합 일치 |
|---|---:|---:|---:|---:|
| 39-01 | 46 | 43 | 43 | 46 |
| 39-02 | 52 | 36 | 36 | 52 |

NULL 43+36=79건은 새 주광 인쇄 검사가 차단한 79건과 일치했다.
예: SdetailKey 92020 / ProdKey 866 / ShipmentKey 6508은 상세 CustKey=NULL,
상위 CustKey=533, OutQuantity=13, 날짜 수량합=13, ERP 표시 가능이었다.

기존 EXE 호환 견적 조회 GET은 HTTP 200, `source=real_db_exe_print`, 94행을 반환했다.
블루 ProdKey 866은 600송이, 공급가 1,363,637원/VAT 136,363원으로 조회됐다.
이는 **기존 SQL 조회 결과 확인**이지 EXE GUI 인쇄나 실제 프린터 출력 검증은 아니다.
로그: `output/weekday-null-customer-trace.log`.

## 문서 정정 시점의 웹 차단 원인

PR #857의 `lib/weekdayEstimatePrint.js` 내 `assessWeekdayPrintEligibility`가
`Number(DetailCustKey) !== Number(MasterCustKey)`를 거래처 오류로 처리했다.
상위 거래처와 정상 View 연결이 있어도 native NULL을 거부하는 **웹 조회 검사의 오탐**이다.

비교·최초 기준 조회에서도 `sd.CustKey=sm.CustKey`를 필수 JOIN으로 쓰는지 별도 점검해야 한다.
이 최초 문서 정정 시점에는 실행 로직 수정·새 배포가 미적용이었다. 후속 구현 상태는 아래 기록을 우선한다.
40차의 미확정 차단 등 다른 사유까지 이 결론으로 정상이라고 간주하지 않는다.

## 다음 작업에서 반드시 지킬 구분

| 상황 | 판단·처리 원칙 |
|---|---|
| 기존 상세 CustKey=NULL | NULL만으로 조회 제외·인쇄 차단·DB UPDATE를 하지 않는다. 상위 ShipmentKey와 실제 View 연결을 확인한다. |
| 웹 신규 INSERT가 CustKey를 기록하는 경로 | 기존 웹 쓰기 정책은 별개다. NULL 허용 근거를 이유로 쓰기 보호를 무조건 제거하지 않는다. |
| 상세 CustKey가 다른 양수 업체 또는 0 | NULL과 동일 취급하지 않는다. 생성 경로·실제 JOIN·업무키를 따로 검증한다. 이번 확인으로 정상/오류가 확정된 것은 아니다. |
| 실제 상위 연결·주문·날짜·금액 오류 | 정상 NULL과 구분해 진단한다. 연도/차수/업체/품목, 유일 연결, 확정 상태 및 날짜 수량·금액 검증은 유지한다. |

- 수정 전 native NULL 정상 행 fixture와 다른 업체 키·교차연도·복수 연결·주문탈락
  음성 fixture를 준비한다. 전체 guard 해제로 해결하지 않는다.
- EXE 원본 저장 SQL → 실제 View/SP 정의 → 동일 업무키 읽기 전용 조회 → 문서 순으로 근거를 대조한다.
  문서와 원본이 다르면 원본을 다시 확인하고 문서의 적용 범위를 정정한다.
- `usp_DistributeOne/Total/Clear` 전체 본문은 이번 조사에서 확보하지 못했다.
  각 SP의 INSERT 열 목록이나 개별 과거 행 생성 주체까지 단정하지 않는다.
- Master의 WebCreated=0은 참고 표식일 뿐 개별 상세 생성 주체의 증명이 아니다.
- **이 NULL 현상 때문에 nenova.exe를 수정하거나 운영 SQL 값을 채우지 않는다.**
  별개의 운영 보정은 원인 입증과 명시 승인 없이는 실행하지 않는다.

## 작업 범위와 인계

### 후속 사용자 화면: 반복 경고와 셀 높이 증가

2026-10-02 사용자 첨부 `codex-clipboard-c55e845b-70cf-4636-8f69-487e3e4a9680.png`에서
39차 상단은 `ERP확정 ✓ · 연결경고 606건`, 각 품종은 `확정·연결경고!`로 보인다.
차수 합계 셀마다 같은 `견적 조회 실패`와 상세 거래처/품목 오류 목록이 반복돼 행이 크게 늘어났다.
또한 상단 ERP 확정 표시와 셀의 미확정 표시가 함께 보이므로, 두 판정의 근거를 분리 점검해야 한다.

- 이번 사진만으로 606건 전체가 NULL 오탐이라고 단정하지 않는다. 앞서 입증한 주광39차79건과 구분한다.
- 후속 실행 수정 대상: native NULL을 실제 연결 오류와 구분하는 공통 조회/검증 조건,
  ERP 확정과 페이지 최초 기준 확정의 상태 구분, 동일 차수 오류의 중복 표시 축소.
- 같은 차수 오류 상세는 상단 또는 하나의 내역창에서 확인하고, 품목 셀에는 해당 품목의
  수량/상태만 짧게 보여주는 방향으로 검토한다. 이는 후속 UI 제안이며 구현 완료 기록이 아니다.
- 스크린샷은 사용자 제공 화면 근거다. 이 추가 기록에서 서버 재조회·코드 수정·배포는 수행하지 않았다.

이번 정정·저장 작업은 MD와 작업 지침만 변경한다. EXE, 운영 SQL 데이터/스키마,
애플리케이션 실행 코드는 변경하지 않았다.
[세션 Q&A 및 배포 상태](work-sessions/2026-10-02_weekday-exe-compatibility.md)를 함께 읽는다.

## 후속 ‘수정’ 구현 — 2026-10-02

- `lib/weekdayCustomerLink.js`에 공통 판정을 두었다. 유효한 양수 Master 고객에 대해 상세의 **명시적 NULL 또는 같은 양수 키**만 허용한다. 0·다른 고객·키 미제공은 거부한다.
- 비교·품목·최초 기준·이월 잔량·비고 조회는 ShipmentKey로 연결한 상위 고객을 기준으로 정상 NULL을 포함한다. 명시적으로 다른 고객인 상세는 비교에서 연결 오류로 표시하고 저장 지문을 발급하지 않는다. 기준/이월 집계는 invalidCount로 차단한다.
- 비교 응답의 Master 고객과 원본 상세 고객을 분리했다. 동시 수정 지문에는 원본 NULL을 그대로 넣으며, 저장 시 NULL을 채우지 않는다. 기존 상세 CustKey를 UPDATE하지 않는다.
- ERP 확정 판정에서 정상 NULL을 연결 경고로 세지 않는다. ERP `isFix`와 페이지 최초 기준 확정은 별개이며 후자는 ‘기준 미확정’으로 표시한다. 과거 기준을 자동 덮어쓰거나 재확정하지 않는다.
- 차수 전체 견적 오류는 차수 헤더의 접힌 상세에 한 번만 표시한다. 품목 합계 셀에는 짧은 ‘조회실패’ 버튼만 두며, 클릭한 선택칸 내역에서 전체 사유를 확인한다.
- 인쇄/저장의 미확정·교차연도·중복 연결·주문·정확 날짜·수량·금액·방향별 재고·원자 롤백 보호는 유지한다.
- EXE 파일·운영 SQL 데이터·스키마·SP는 수정하지 않는다. 운영 시험 저장도 하지 않는다. 격리된 SQL fixture에서만 저장/롤백을 검증한다.

### 별도 남은 진단 API 범위

기존 범용 `distribute-diagnose`, `exe-errors`, `item-trace`에는 NULL을 엄격하게 해석하는 과거 진단/보정 제안이 남아 있을 수 있다. 이번 주광 요일 화면의 저장·인쇄 경로가 호출하는 API는 아니다. 이를 정상 NULL의 일괄 보정 근거로 사용하지 않는다. 해당 진단 API 자체의 전면 정정은 별도 범위로 남기며, 이번 변경을 ‘ERP 전체 진단의 오탐이 모두 제거됨’이라고 설명하지 않는다.

### 검증과 배포 상태

1920×1080 / 100% 로컬 브라우저 fixture에서 50개 품목, 차수별 오류 상세 1개, 접힌 기본값, 품목 셀 반복 오류 없음, 상세 내부 스크롤과 선택 내역 접근을 확인했다. 운영 반영 및 최종 SQL/ERP 검사 결과는 후속 작업 기록과 PR을 확인한다. GUI 프린터 출력이나 운영 쓰기는 검증한 것으로 주장하지 않는다.
