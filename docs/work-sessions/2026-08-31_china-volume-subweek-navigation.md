# 자동 중국물량표 실제 세부차수 이동

## 질문

자동 중국물량표에서도 `35-01` 다음이 `36-01`로 건너뛰지 않고, 네덜란드 물량표처럼 `35-02`를 포함한 실제 세부차수 순서로 이동하게 해 달라는 요청.

## 답변·결정

- 원인은 중국 화면이 `OrderWeek`를 계산식으로 증감해 `-02` 세부차수를 조회하지 않은 것이었다.
- 선택 연도의 활성 `OrderMaster`에 실제 존재하는 차수를 `/api/stats/pivot-weeks?source=orders` 공용 조회로 가져온다.
- 화면 선택과 이전·다음 버튼은 DB 목록만 사용하므로 `35-01 → 35-02 → 36-01` 순서를 보존한다.
- 조회는 선택한 `OrderYear + OrderWeek`를 그대로 피벗·중국 작업본 API에 전달한다.
- ERP 원장 쓰기는 없으며 주문·출고·입고·재고·견적 원장은 모두 보존한다.

## 검증

- `npm run test:pivot`
- `npm run test:erp-contract`
- `npm run test:nenova-dnspy-evidence`
- `npm run test:erp-manifest -- --changed-from origin/master`
- `npm run guard:erp-writes -- --changed-from origin/master`
- `npm run build`

모두 통과.
