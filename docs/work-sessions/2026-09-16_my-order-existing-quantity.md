# 내 업체 주문등록 기존 주문 표시·증감

## 요청과 결정
- Q: 기존 주문이 있어도 우측 입력 품목이 0으로 표시된다. 기존 주문에 추가하거나 수량을 줄일 수 있어야 한다.
- A: 우측은 선택 연도·차수·업체의 기존 주문과 입력 초안을 표시한다. 왼쪽은 추가 수량, 오른쪽은 최종 수량이다. 수정하지 않은 기존 주문은 저장 대상이 아니다.
- 추가등록은 delta만 전송한다. 직접 최종 수량을 고쳤으면 추가등록을 막고 변경등록으로 저장한다. 변경등록은 명시 수정품목만 최종값으로 한 번 전송한다. 추가 초안이 함께 있으면 current + converted delta를 최종값으로 포함한다.
- 빈 최종값은 오류, 명시 0만 삭제 요청이다. X는 초안 취소이며 원장 삭제가 아니다.

## 기준·부작용
| 동작 | OrderMaster/Detail/History | ShipmentDetail/Date/Farm | Estimate/WebProfitReport |
|---|---|---|---|
| 조회·편집·X | 보존 | 보존 | 보존 |
| 추가등록 | 기존 ADD 정책: 양수 가산·이력 | 보존 | 보존 |
| 변경등록 | 기존 REPLACE 정책: 명시 최종값·이력, 출고 있으면 0 차단 | 보존 | 보존 |

업무키는 OrderYear + OrderWeek + CustKey + ProdKey. CurrentQty는 서버의 활성 주문 OutQuantity 합계이며 expectedCurrentQty로 동시 수정을 차단한다. SQL·서버 쓰기 정책·재고 재계산 경로는 변경하지 않는다.

## 근거
- 2026-09-16 dnSpy CLI 실제 FormOrderAdd 재확인: GetDataProduct.OrderCnt=OutQuantity, GetChanges(Modified)만 저장, OrderMaster→OrderDetail→OrderHistory 순서.
- 앞선 읽기 전용 DB probe: 2026/40-01 CustKey565 태림원예, 활성 주문 45품목, ProdKey2101 주밀리아 OutQuantity130. 웹 운영화면도 45품목/130단 확인. 원장 쓰기는 하지 않았다.
- DB_STRUCTURE의 과거 CASE 수량 설명보다 현재 dnSpy OutQuantity 및 기존 실행 계약을 우선한다.
- 회귀: 10+3=13, 최종7, 명시0/빈값/음수/NaN, 박스환산, 미입력 보존, 교차연도·동시수정 기존 API 테스트.
- 하위작업 운영 문서는 해당 worktree에 없어 적용할 수 없었고, 독립 하위작업 없이 수행했다.

## 검증·배포
ERP 계약검사, dnSpy 근거 검사, manifest, 변경 API 쓰기 guard, production build 통과. API mock 브라우저 검증(1920×1080, 768/390)에서 기존 표시·ADD 10+3·REPLACE 13→7·미입력 보존·빈칸/Esc·명시0·X·박스환산·409 재시도 차단 통과. 운영 주문 쓰기 0건. 최종 배포 상태는 작업 보고를 따른다.
