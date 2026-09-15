# 2026-09-15 호텔 결산 특이사항

## 요청과 결정

- 사용자: 차수별 매입단가 관리 옆에 특이사항 버튼과 메모 입력 공간을 추가해 달라고 요청.
- 처리: 선택한 라움·초이문·신라·추가 호텔과 연도별로 메모를 저장하고 다시 조회하는 별도 웹 원장을 설계.
- 표시: 마지막 저장 시각과 담당자를 함께 표시.
- 보호: 같은 메모가 다른 화면에서 먼저 바뀌면 덮어쓰지 않고 최신 내용 재조회를 안내.
- 범위: 주문·분배·재고·견적·손익 원장에는 영향을 주지 않음.

## 구현 결과

- 손익계산서 상단 `차수별 매입단가 관리` 바로 옆에 `특이사항` 버튼 추가.
- 최대 5,000자 메모, 호텔·연도 선택, 저장자·저장시각 표시.
- 명시적 SQL 마이그레이션과 배포 단계 적용 스크립트 추가.
- API 계약·UI·동시 수정·교차 호텔/연도 격리 테스트 추가.

## 검증

- `npm run test:raum-pnl`
- `npm run test:erp-contract`
- `npm run test:nenova-dnspy-evidence`
- `npm run test:erp-manifest -- --changed-from origin/master`
- `npm run guard:erp-writes -- --changed-from origin/master`
- `npm run build`

모든 검증을 통과한 뒤 PR 병합, Cafe24 배포, 1920×1080 실브라우저 확인까지 진행한다.
