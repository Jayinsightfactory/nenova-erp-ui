# 과거 자동자료 재노출 및 삭제견적 연결 원장 정리

## 사용자 확인과 수정 범위

사용자는 43차 희경 Yukari Cherry15단, 레바논2단 및 주광 수국화이트를 잘못된 자료로 확인하고 같은 문제를 찾아 해결하도록 요청했다. 40차 희경9955/레바논9913 실제 과거 견적과 혼동하지 않는다. 전수 등록 가능 검사는 원문 신고 사실성의 검증이 아니므로 과거 보고의 정상 판정을 그 의미로 사용하지 않는다.

## 읽기 전용 근거

- 실제 설치 EXE에 dnSpy CLI `--no-color -t ClassEstimate` 실행: Estimate Insert/Update/Delete 외 주문·출고·재고 쓰기 없음. 웹 원장 정리는 이 Delete를 호출하지 않는다.
- 현재 원장722=희경15단(원문38-2/원장40),740=레바논2단(원문39-2/원장40). 두 행의 실제43차 Estimate는 없고 과거 ESTIMATE_UNLINK 후 일반 등록후보로 다시 노출됐다.
- 주광화이트859=90송이,868=10송이,877=1박스. 연결키10802/10804/10805의 실제 Estimate 없음. 원장에는 적용43 및 REGISTERED/COMPLETED가 남았다. 원문표시는40-1.
- 전체 활성 원장에서 자동원천+ESTIMATE_UNLINK78행/24업체, 실제연결견적없음65행/17업체 확인(중복집합 있음). 이는 전부 오등록 확정 목록이 아니며 자동 재등록/완료 표시를 보류할 검토 대상이다.
- 연결 원문 서버 보유범위는2026-04-15~09-14,4635메시지로10월 신고 부재를 입증하지 못한다. 과거 동일품목 언급만으로 지금차수 신고나 승인을 추정하지 않는다.

## 기준·부작용

| 동작 | 웹 원장/History | Estimate/Application | Order/Shipment/Date/Farm/Stock/WebProfitReport |
|---|---|---|---|
| 전체 진단 | SELECT | SELECT | 보존 |
| 재등록 차단/표시 정정 | 조회 metadata만 | 보존 | 보존 |
| 사용자 확인5행 정리 | 기존 manage-archive soft-delete, 전후원장 History | 보존 | 보존 |

원천 일반표식은 등록을 막지 않는다. 과거 명시 해제 이력과 실제 견적 부재는 별도 조건이다. SQL projection이 서버 저장행/History/Estimate를 다시 읽고 클라이언트가 false로 위조해도 해제하지 못한다. 기존 정상 자동/수동96조합 검증은 그대로 유지한다. 별도 승인 없는 전체78/65행 삭제 및 기존 정상 견적9955/9913 수정은 수행하지 않는다.

수정: salesDefectAutoSource의 공통 순수 판정/SQL projection, 등록 scope 및 final locked reread, 목록 eligibility/완료/선택/상세 문구, 순수 등록계획. 새 스키마/DDL/EXE수식 변경 없음. 메뉴 기준선 적용: 기존 키보드/선택 흐름 유지, 검토 이유 표시. 새 메뉴/레이아웃은 해당 없음.

## 검증·복구

- five incident fixtures로 목록/완료/선택/preflight/preview/register의 동일 코드 및 쓰기0 확인. 정상 자동/수동 양성96조합 유지.
- scripts/reconcile-reviewed-defect-sources.mjs 기본은 SELECT-only. --apply는 사용자 확인한5PK의 업체/품목/수량/연도/버전/격리근거가 그대로일 때만 기존 archive API의 preview→apply를 실행한다. 이미 정리된 행은 재실행하지 않는다.
- 실제 Estimate/ShipmentDetail/ShipmentDate의 대상업체2026 전체 행수·checksum을 보정 전후 비교한다. 이전 상태는 기존 WebSalesDefectDeductionHistory에 저장되므로 원문·키·감사·적용이력과 복구 근거를 보존한다. 원문·자격증명·개인정보를 로컬 파일로 내보내지 않는다.
- 필수 ERP gates/build/CI 통과 후 배포하고 그 다음 archive를 실행한다. 나머지 격리행은 원문과 승인 근거로 확인할 때까지 검토목록에 남긴다.
