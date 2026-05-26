# Claude CLI 교차검증 결과 및 반영 기록 (2026-05-26)

## 실행 상태

- Claude CLI 연결 확인됨
- 실행 파일: `C:\Users\USER\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\2.1.138\claude.exe`
- 버전: `2.1.138`
- 전체 프롬프트는 예산 제한으로 중단됨
- 축약 프롬프트는 읽기 전용 리뷰로 완료됨

## Claude가 지적한 핵심 위험

1. `/api/shipment/distribute`에서 `Product.OutUnit` 기준으로 `OutQuantity` 의미가 바뀌는 위험
   - 기존 안정 규칙: `OutQuantity=qty`, `EstQuantity=qty`, `BoxQuantity=qty`
   - 변경 위험: 단/송이 품목에서 `OutQuantity`가 단 또는 송이 기준처럼 저장될 수 있음
   - 예상 영향: `nenova.exe` 잔량 계산, 이미 분배됨 판단, 확정/해제 흐름과 충돌 가능

2. 견적서 수량 수정에서 `ShipmentDate` 0건인 경우가 차단되지 않음
   - 출고일 지정 데이터가 없는 상태로 수량 수정이 진행되면 `ShipmentDetail`과 `ShipmentDate` 정합성이 깨질 수 있음

3. 견적서 출력의 동일 품목/다른 단가 분리 출력은 요구사항과 맞고 안전함
   - 단, 같은 품목이 여러 줄로 보일 수 있으므로 단가가 다른 행임을 유지해야 함

## 반영한 수정

- `pages/api/shipment/distribute.js`
  - 출고분배 저장 시 `Product.OutUnit` 분기 저장을 중지
  - `nenova.exe` 호환 안정 공식 유지:
    - `OutQuantity = qty`
    - `EstQuantity = qty`
    - `BoxQuantity = qty`
    - `BunchQuantity = qty * BunchOf1Box`
    - `SteamQuantity = qty * SteamOf1Box`
  - 서버에서 `Customer.BaseOutDay` 기준 출고일을 계산하는 변경은 유지
  - 업체별 품목단가관리(`CustomerProdCost`) 우선, 없으면 `Product.Cost` fallback 유지

- `pages/api/estimate/update-quantity.js`
  - `ShipmentDate`가 0건이면 견적서관리 수량 수정 차단
  - 출고일 없는 상태에서 수량 수정이 진행되어 DB 정합성이 깨지는 경로를 막음

## 남은 주의점

- `ShipmentDetail`/`ShipmentDate`를 직접 수정하는 웹 경로는 계속 `nenova.exe`와 충돌 검증 대상임
- 향후 단/송이 UI 입력을 별도로 지원하려면 DB 저장 직전에 반드시 박스 기준 `qty`로 정규화해야 함
- `Product.OutUnit`은 표시/엑셀/인쇄 단위 판단에는 사용할 수 있지만, 출고분배 저장 공식에는 바로 적용하면 안 됨

