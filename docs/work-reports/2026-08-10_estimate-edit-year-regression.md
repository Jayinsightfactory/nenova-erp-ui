# 견적서 단가/수량 저장 선택연도 회귀 수정

## 원인

선택연도 엄격화 후 `pages/estimate.js`의 수량, 단가, 수량+단가, 품목정보 네
`runEditWithFixCycle` 호출이 `orderYear`를 전달하지 않았다. 짧은 차수(`32-02`)는
연도를 추정하지 않도록 만든 가드에서 의도대로 중단되었지만, 호출부 누락 때문에 실제
운영 사용자는 이미 선택한 연도를 다시 확인하라는 오류를 받았다.

초기 언어 훅도 서버에서는 `bi`, 브라우저 첫 렌더에서는 localStorage의 `ko/es`로
시작할 수 있어 React hydration 오류 425/418/423의 원인이 되었다.

## 수정

- 네 확정 편집 사이클에 `orderYear: yearStr`를 명시했다.
- 공용 사이클의 빈 연도 기본값을 제거하고, 저장 전에 선택연도를 검증한다.
- 자동 확정취소/재확정은 `force=false`로 실행해 뒤 차수 확정 경고를 우회하지 않는다.
- 단가 API는 `ShipmentMaster.OrderYear/CustKey/OrderWeek`를 잠금 조회하고 요청 범위를
  대조한 뒤에만 `ShipmentKey + SdetailKey/EstimateKey` 행을 수정한다. `once`를 포함한
  모든 저장 모드가 화면의 `custKey`를 필수로 보내므로 거래처 대조를 생략하지 않는다.
- `WeekProdCost` 신규 키를 `OrderYear + OrderWeek + CustKey + ProdKey`로 분리한다.
  기존 연도 미상 행은 추정 보정하지 않는다.
- 언어 훅은 SSR/첫 브라우저 렌더를 `bi`로 맞추고, 저장 언어는 mount 뒤 반영한다.

## Side-effect matrix

| 경로 | 직접 변경 | 보존 |
|---|---|---|
| 단가 | `ShipmentDetail.Cost/EstQuantity/Amount/Vat`, 연결 `ShipmentDate.Cost/Amount/Vat`; 모드별 `CustomerProdCost` 또는 연도별 `WeekProdCost` | `OrderDetail`, `OutQuantity`, `ShipmentFarm`, `Estimate` 신규/삭제 |
| 수량 | 기존 API 계약의 출고/출고일 수량·견적 금액 | 주문수량, 농장배정 |
| 확정 사이클 | 기존 EXE 호환 확정 SP와 재고 재계산 | 명시 확인 없는 음수재고 자동조정 |
| 기존/신규 견적 등록 버튼 | 각 기존 endpoint와 `EstimateType` 계약 | 다른 모달 상태·선택행 |

## 검증 근거

- dnSpy golden: `FormEstimateView.GetData`, `GetDetail`, `btnSave_Click`,
  `ClassShipmentDate.Update`
- 교차연도 fixture: 2025/2026 `32-02`를 서로 다른 확정상태로 분리
- 회귀: 수량/단가/통합/품목정보 각각 확정/미확정 경로, 단가 payload 연도,
  `WeekProdCost` 연도키, legacy 불량/검역 + 불량차감 + 판매요청 + 추가품목 버튼
- 운영 원장 쓰기 시험은 수행하지 않는다.
