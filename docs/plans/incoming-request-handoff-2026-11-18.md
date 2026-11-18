# 입고 직접 수정에서 영업지원 요청 연결

사용자 선택: 영업지원이 수정 반영·재확정까지 처리한다. 직접 수정의 확정 차단을 풀지 않고, 입력값을 보존해 기존 approval 요청으로 등록한다. 요청 등록은 web_mgmt.ApprovalRequest/ApprovalAudit/SystemActionLog만 쓰며 ERP 원장은 최종 승인 전 보존한다. 기존 최종 승인 writer의 농장-only 확정/수량/금액/날짜 보존 및 수량 변경의 원자 해제→수정→재확정 계약을 유지한다.

실제 dnSpy CLI ClassWarehouseMaster 확인(2026-11-18): FarmName 문자열과 WarehouseKey 저장. 이번은 SQL·EXE 저장 순서 변경 없음. 운영 SELECT WK8050/2026/46-01 활성1/상세1, 현재 FarmName은 이미 Faguaflowers Intl LLC(첨부 화면 이후 변경됨). 영향 품목 확정 상세 46-01 23행/46-02 13행. 운영 원장 수정·요청 생성은 수행하지 않는다.

기준표: 직접 저장은 기존 preview.canCommit/확인 체크 유지. 영업지원 요청 전환은 같은 원장키/연도/차수/모드/농장/파일/사유를 유지하고 approval draftPreview로 재검증한다. 확정 존재는 요청 등록 차단 조건이 아니며 원장 stale/부적합 농장은 기존 서버 검증으로 차단한다. create/saveDraft→GET revision→submit을 사용하고 응답 유실 시 같은 operationId/작성된 requestId로 재확인한다. 제출 후 영업지원 검토 화면 링크를 제공한다. 농장-only는 확정 해제가 필요 없으며 안내한다.

검증: 확정으로 직접 저장 차단된 2026/46-01에서 요청 전환 후 농장/사유/업무키 보존, 요청만 생성, create/submit 응답 유실 재시도 중복 방지, 2025 동일차수 혼동 방지, 파일교체 payload 보존, 취소/초점/390px. 기존 ERP/가이드 필수 검사와 운영 읽기 스모크.
