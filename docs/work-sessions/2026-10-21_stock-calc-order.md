# 공통 SQL 차수순서·에콰도르 재고 보정

## 사용자 요청
“공통 SQL 재계산 함수 정렬도 수정하고, 재고 보정까지 검증해서 배포까지 끝내줘.”
18차 실제 다운로드와 27~31차 SQL/원본 비교 후속도 포함한다.

## 결정과 구현
- 기존 수량·금액 계산식 보존, 실제 list_cursor SELECT에 연도·차수 정렬만 추가한다.
- 현재 운영 정의 SHA256을 고정하고 backup → ALTER → 동일 원천 대사 → 기존 승인 보정 → native CALC를 같은 transaction에서 실행한다.
- 미승인/다른 정의/서명/권한·설정 변화/보호 원장 변화는 중단한다. 기본 preview는 SELECT-only.
- 기존 계획 이후 운영 후속 재고가 변했으므로 오래된 지문을 재사용하지 않는다. 최신 preview/rehearsal 지문만 apply한다.
- master 4e9b3a94 기준 전용 worktree/branch. 기존 작업트리의 다른 변경을 보존했다.

## 검증 상태
- 정렬-only·계산식 보존·near-miss·교차연도·legacy 순서·백업/DDL/native/대사 실패 회귀 통과.
- 전체 gate/CI/배포/실DB 통합 rehearsal/apply 및 최종 다운로드는 진행 중(미검증).
- EXE GUI와 실사 재고는 별도 확인 범위. SQL 일치가 물리 재고 인증은 아니다.

## 검색어
공통SQL CALC CURSOR ORDER BY 에콰도르 31차 기초기말 4850 중복차감 원자보정
