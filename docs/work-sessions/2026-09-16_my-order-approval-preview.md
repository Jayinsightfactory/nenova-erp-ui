# 주문 변경사항 승인 후 등록

Q. 품목 추가·수량 변경 후 변경등록을 누르면 실행 로그에 변경 품목과 수량을 한눈에 보여주고 승인 후 등록을 시작해 달라.

A. 추가등록/변경등록은 실행 로그 승인 창을 연다. 품목별 기존→최종 수량, 증감, 신규/증가/감소와 품목 수를 표시한다. 승인 전 POST는 없다. 승인한 payload와 현재 선택 범위·수량·단위·기준수량이 달라지면 새 승인표를 보여주고 다시 승인받는다. 돌아가기는 초안을 보존한다.

## 부작용과 기준
| 동작 | OrderMaster/Detail/History | Shipment/Date/Farm | Estimate/WebProfitReport |
|---|---|---|---|
| 승인표 열기·취소 | 보존 | 보존 | 보존 |
| 승인 | 기존 my-customer ADD/REPLACE API만 호출 | 보존 | 보존 |

선택 연도+차수+업체+품목, expectedCurrentQty, 명시 0 출고보호, 단위환산 및 기존 트랜잭션을 유지한다. 품목 선택 자체를 자동으로 변경하지 않는다. 승인표의 입력 payload를 그대로 저장하며 단위는 기존/최종 비교를 위해 OutUnit으로 표시한다.

근거: 직전 작업에서 실제 dnSpy FormOrderAdd GetChanges(Modified)/OutQuantity/OrderHistory 순서 및 2026/40-01 Cust565 Prod2101 130단 read-only probe 확인. 이번 변경은 서버 SQL·수량정책을 바꾸지 않고 브라우저 승인 단계를 대체한다. 운영 주문 시험 쓰기 금지.

검증 통과: ERP 계약, dnSpy 근거, manifest, write scope guard, build. Mocked browser 1920×1080 및 768/390에서 승인 전 요청 0, 취소 요청 0, 승인 시 1회, 변경된 초안 재승인, 신규/감소 표, ADD delta 전송 확인. 교차연도·업체·차수·단위·기준수량 fingerprint와 기존 서버 stale/zero/atomic 회귀 통과. 운영 쓰기 0건. 배포 결과는 최종 보고 참조.
