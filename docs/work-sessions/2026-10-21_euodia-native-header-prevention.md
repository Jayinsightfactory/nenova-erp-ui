# 유오디아 업로드 주문 이후 EXE 분배 오류 — 2026-10-21

| 항목 | 내용 |
|---|---|
| 사용자 요청 | 재발 방지 수정과 기존 작업 영향 확인 |
| 대상 | 웹 업로드 주문등록 → NENOVA.EXE 분배 저장 |
| 원장 | 이번 턴 운영 SELECT만, 코드에 누락 출고 헤더 준비 추가 |
| 배포 | 필수 검증 후 PR/배포 진행 |
| 다음 힌트 | docs/plans/native-missing-master.md |

## 고정 결정
- 고객이 잘못 입력한 문제가 아니다. 웹 order-import-final의 빈 ShipmentMaster 준비 누락이다.
- 10/09 11:35:37.683 감사: 정확 CustKey/2026-43-01/ProdKey2226/1박스, 주문 생성시각과 일치.
- 8/26 dc604aca의 주문전용 분기에서 헤더 준비를 제외했다. 최근 음수 피벗 EXE 2바이트 수정은 관련 없음.
- 실제 EXE FormOrderAdd는 빈 ShipmentMaster를 준비한다. 웹 업로드도 기존 생성 분기를 같은 주문 transaction에서 실행한다.
- 기존 수량/날짜/농장/확정/재고/Estimate/WebProfitReport는 자동 수정하지 않는다. 기존 헤더 재사용.
- 내 업체/영업 붙여넣기 별도 계약 및 실행파일 자체는 이번 변경 대상 아님. 모든 native 오류 해결로 확대 해석 금지.

### 1. Q. 이것도 기존 작업 영향인가? 재발 방지까지 해줘.
A. 감사 기록과 실제 native SQL을 대조해 웹 업로드 호환 누락을 확인했다. 해당 저장 분기 수정.
원본 EXE 자체 패치는 검토했으나 원천이 확정되어 웹 업로드의 기존 검증된 헤더 생성 로직을 사용한다.

### 2. 검증
실제 createOrder 실행형 fixture: 신규/재등록/전년도 동일차수/삭제헤더/다른업체/세부차수/
기존확정헤더 보존/1박스→10단/헤더 생성실패/후속 주문실패 전체 rollback 통과.
이전 복구 당시 주문10/분배10/date10 미확정. 이번 readback은 동일10단, DetailFix=true,
Amount90909/Vat9091, 날짜10/25, FarmRows0, EstimateRows0, native quote join ready1.
이번 턴에는 해당 확정·금액 변경을 수행하지 않았고 다시 덮어쓰지 않는다.
확정 매출 대상 공급가90909/Vat9091. 실제 EXE 재조회·손익화면 렌더는 미검증.

## 인계/제외
- 운영 probe는 primary worktree outputs/euodia-*.mjs, 원문/자격증명/생성파일은 커밋하지 않음.
- 자동검사 생성 data/generated 변경은 이 PR과 무관하여 제외.
- 웹 배포 후 자동 적용된다. EXE 설치파일 변경/전 직원 재설치 없음.
