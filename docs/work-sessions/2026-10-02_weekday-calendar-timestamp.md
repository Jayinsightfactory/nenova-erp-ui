# 주광 날짜 이동 저장 시각 오차단

| 항목 | 내용 |
|---|---|
| 화면 | /estimate/weekday |
| 작업공간 | work/jugwang-weekday-test-deploy |
| 범위 | 정상 출고일의 문자열 표현 차이로 인한 저장 전 차단 수정 |
| 원장 부작용 | 진단/검증은 운영 SELECT only. 스키마/SP/운영 수량 보정 없음 |
| 진행 | PR852 병합·Cafe24 배포·운영 read-only 검증 완료 |

## 고정된 결정

- 중심 기본값 현재 ERP 업무주+1, 마감 잔량 직접 수정과 이월·이력은 앞선 PR850/851 유지.
- 표시된 38-01 일요일7박스 셀은 unique nonzero 업무차수 편집키 사용; 취소0 원문 보존.
- 최초기준 잔량 계산셀과 웹 마감 잔량 수정은 별개다. 수동 이월은 ERP 재고가 아니다.
- 이번 날짜 오류는 exact 비교를 삭제하지 않고 SQL datetime 표현을 맞춰 해결한다.
- 운영 고객 원장을 시험 저장하지 않는다. 사용자의20→15/0→5 초안은 자동 적용하지 않는다.

### 1. 중심+1과 잔량 수정 재확인

Q. 중심차수 +1 기본, 잔량 직접 입력 수정.

A. 운영 1920×1080/100% 읽기 확인: 2026-10-02 전산 업무주40→기본41,
carry GET 성공309 context행, 마감 수정 팝업 활성. 1280×800 화면 이탈 없음.

### 2. 일요일 수량 편집 불가 캡처

Q. 38-01 9/20 수국 블루7박스 입력이 안 된다.

A. 최신 운영 input의 값7/enabledtrue/포커스 성공, 38-02 취소0 원문 유지 확인.
운영 편집 저장은 하지 않았다. 기존 배포 수정이 실제로 적용된 상태다.

### 3. ERP 저장 시각 오류 캡처

Q. 40-01 10/4 20→15박스, 10/1 0→5박스 저장 시 PeriodDay 시각 불일치.

A. 운영 스키마 BaseYmd=nvarchar, ShipmentDtm=datetime 확인. 두 원문은 날짜만/자정시각
문자열이지만 실제 EXE JOIN은 WeekDay1로 정상. 실제 CLI ClassShipmentDate.Insert는
ToShortDateString이며 FormEstimateView는 exact datetime JOIN이다.
달력 SELECT는 BaseYmd를 SQL datetime으로 먼저 변환한 뒤 style121로 직렬화한다.
같은 helper를 운영 SELECT-only executor로 실행해 10/1·10/4 정확 timestamp 통과 확인.

처음 SELECT에서는 DetailFix1, 후속 SELECT에서는0이 관찰됐다. 이 작업은 상태를
변경하거나 원복하지 않았다. 후속 OutQuantity20/금액은 동일하고 확정 견적 노출0이었다.
다른 작업의 실제 변화와 웹 표현 오차단을 혼동하지 않는다.

## 산출물·검증

- 계획: docs/plans/weekday-calendar-timestamp-2026-10-02.md
- 계약: docs/contracts/weekday-distribution-apply.json
- 코어: lib/weekdayDistributionApply.js의 readWeekdayCalendar
- 회귀: __tests__/weekdayDistributionApply.test.js, 격리 MSSQL harness
- 재현 SELECT: scripts/probe-weekday-calendar-timestamp.mjs (명시 env파일, 비밀 출력 금지)
- 로컬 output/timestamp-* 로그는 커밋하지 않는다.

검증 결과: 구현 작업 gpt-6.1-sol/high/P0_LOCAL의 focused Node42 및 격리 SQL 두
harness 통과. 기계 검증 gpt-6-luna/high/P0_LOCAL의 ERP 전체 회귀, dnSpy 근거,
manifest77개, 변경 API scope guard(이번 API 파일 변경0), 빌드 모두 exit0.
격리 SQL은 실제 nvarchar 날짜만 표현·20→15+5 exact JOIN과 단가/확정/총량/재고
보존, 일치하는 nonmidnight 보존 및 다른 시각 전체 rollback을 검사한다.
원장 저장 SQL의 전반적 변경이 아니라 SELECT 표현식 두 군데와 공통 helper export만
변경했다. 메인은 실제 운영 SELECT-only 공통 helper 및 브라우저 읽기를 확인했다.
독립 검토 gpt-6-astra/high/P0_LOCAL: P1/P2 없음, 별도 focused24/24 PASS.
빌드 exit0은 기계 검증 완료 보고 및 로그를 메인이 확인했다.

## 병합 결과

- PR https://github.com/Jayinsightfactory/nenova-erp-ui/pull/852
- 코드 head cc4459a40a76b0b69b690685ffdec9100aa7c8d1
- PR ERP Contract Guard 36945343054 SUCCESS
- squash merge 08470316ca169afc86960dae89499b307d7dbfe0
- master ERP Contract Guard 36945473112 SUCCESS
- Cafe24 Deploy 36945473016 SUCCESS (2026-10-02 KST)
- 운영 공개 버전08470316 및 build-1790900508286 확인.
- 1920×1080/100%,1280×800 read-only smoke PASS: 기본41, carry GET309행,
  일요일7박스 입력 enabled/focus, 이월 수정 팝업 화면 안, 상·하단 스크롤 동기화,
  JS 오류0. 운영 원장/최초/비고/마감 잔량의 테스트 저장 없음.
- 배포 뒤 같은 SELECT-only helper 날짜 검증 PASS. 저장된20박스와 금액은 그대로,
  당시 DetailFix0/확정 견적 노출0. 사용자의20→15+5 초안은 자동 저장하지 않았다.
- 사용자는 화면 새로고침 및 '전산 새로고침'으로 최신 snapshot을 읽은 뒤 저장한다.
  중간의 실제 확정 상태 변경을 stale 검증으로 보호한다.
- 최종 결과 문서 후속 커밋은 로컬 보관만 하여 불필요한 재배포를 만들지 않는다.

## 이어받기

이 문서와 계획·계약을 읽고 이어서. 이번 코드 수정·배포는 완료다.
운영 사용자 초안 자체를 저장 시험했다거나 적용됐다고 추정하지 않는다.
