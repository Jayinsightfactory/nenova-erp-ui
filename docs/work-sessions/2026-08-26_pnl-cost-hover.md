# 매입단가 입력칸 차수별 미리보기

## 요청

Q. 오른쪽 차수별 비교가 너무 멀다. 매입단가에 마우스를 대면 미리보기처럼 보여 달라.

A. 매입단가 입력칸 hover/focus에 동일 품목 차수별 저장값을 가까이 표시한다. 기존 비교열은 유지한다.

## 기준·부작용

- 기존 `costComparison.weeks/rows` 사용. 별도 API, DB 조회·쓰기 추가 없음.
- 해당 행 품목과 현재 연도/거래처의 저장된 값만 표시. 미저장 입력값으로 과거값을 대체하지 않음.
- 입력은 그대로 가능. Escape로 닫기, 마우스를 미리보기로 이동해도 읽을 수 있음.
- 화면 밖/가로 스크롤 잘림 방지를 위해 body portal+fixed 위치, 최대 높이 적용.
- 주문·출고·재고·견적·손익 저장/계산 및 엑셀·인쇄 생성기는 보존.

## 상태

- PR #362 / 운영 `f741b0f`, 배포 run 32918276282 성공(2m41s), hydration PASS.
- test:erp-contract, test:raum-pnl, dnSpy evidence, manifest, write guard, build PASS.
- 라움 28차 수국 화이트 입력칸 클릭/focus에서 32~27차 저장단가 표시. Tooltip 좌표가 화면 안임을 확인, Escape 후 tooltip 0개 확인.
- 초이문 33차 수국 화이트 입력칸 클릭/focus에서 33/32차 2,200원 표시. 브라우저 error 없음.
- 브라우저 도구는 locator hover를 지원하지 않아 독립적인 hover-only 자동 동작은 미검증. 동일 show 핸들러가 mouseenter/focus에 연결되고 실제 클릭/focus 경로는 검증함. 입력/저장/전산수정은 실행하지 않음.
- 별도 기존 이슈: 첫 reload 시 localStorage 거래처 복원과 loadList 응답 경합으로 초이문 설명+라움 목록이 일시 남는 현상 관찰. 거래처 재선택 시 정상. 본 UI-only 변경 범위 외이며 후속으로 목록 요청 sequence guard 필요.
