# 44-03 호접란 웹 표시 단건 보완 인계

- 날짜: 2026-11-24
- 작업자: Codex /root/audit_web_evidence
- 저장소/브랜치: nenova-erp-ui / codex/profit-orchid-4403-1124
- 위치: C:/Users/USER/nw-cdx-profit-orchid-4403-1124
- 상태: 구현·읽기 검산·전체 ERP 검증·운영 빌드 통과, PR·배포 진행 전
- 연결 목표: g17. 학습 추가 없음(기존 원본 보존 원칙).

## 사용자 의도와 확인
1. 2026년44-03 Cloudland 호접란 White 업로드230 CNY는 오입력이며 실제23 CNY/송이임을 사용자 확인.
2. 웹 주차별 매출자료만 보완. DB/저장·확정 원본 보존, 표시·엑셀·중국 항공 합계 일관, 적용·배포 승인.
3. 과거 박스60 추정은 폐기. 실제SQL은 BoxQuantity1, 송이600이므로 송이 단가만 사용.
4. 별도 요약·전후 이익률 UI 작업을 보존하고 단건 보완을 우선, PR 분리.

## 구현과 증거
lib/profitOrchid4403.js 순수 exact 투영, lib/profitOrchid4403Data.js SELECT 연동. 원천 identity와 합계·평가식을 증명할 때만138000→13800 CNY. 원본 객체 clone, 중복 적용 차단, 누락/변경/수기 우선값 불일치 시 원본+검토 경고.

실제 API 로더 SELECT-only692회, 웹/생성출력 일치 및 중국 배·항공 원금액/표시 반올림 합계 일치. 입고·snapshot6 전후 해시 동일. dnSpy FormWarehouseView 실제 설치본 읽기 확인. 상세 숫자는 docs/plans/profit-orchid-4403-2026-11-24.md 참조.

## 남은 범위
- 최종 build 결과, pstack 재확인, PR·CI·머지·Cafe24 배포·운영 GET/실제 XLSX 스모크·원본 재조회는 완료 후 추가 기록.
- 45차 저장본5 기초는 이전44기말을 유지하므로 보완된44기말과2649129.374원 차이. 다른 차수 확장 승인 전 수정 금지.
- 별도 C:/Users/USER/nw-cdx-profit-summary-neighbor-1124에는 미완 UI 변경이 보존됨. 가이드 실브라우저 dry-run 초기 요청 count 불일치 미해결. 이 작업에 합치거나 삭제하지 말 것.

## 재개 지시
위 worktree git status와 WORK_MEMORY 마지막 항목을 확인한다. `.verify/verify-final2.log` 전체검증 결과 확인 후 pstack 선실행, PR/CI/squash/배포와 profit-download-smoke workflow(year2026,week44,orchid_4403=true)를 수행한다. `scripts/probe-profit-orchid-4403.cjs --api`는 SELECT-only 원본 해시 대조이며 환경값 출력 금지. 운영 DB·원본 snapshot 갱신 금지. 45기초 이월 차이와 UI 미완 작업을 부모에게 별도로 보고한다.
