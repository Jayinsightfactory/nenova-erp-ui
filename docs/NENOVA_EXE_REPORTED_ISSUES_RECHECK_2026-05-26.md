# nenova.exe 보고 이슈 재검증 (2026-05-26)

## 목적

사용자가 `nenova.exe`에서 오류가 생겼거나 버튼이 작동하지 않는다고 보고했던 항목들을 다시 검증하고, 웹 수정이 같은 DB를 공유하는 전산 기능에 다시 충돌을 만들 가능성이 있는지 확인한다.

## Claude CLI 교차검증 상태

- Claude Code 실행 파일 확인: `C:\Users\USER\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\2.1.138\claude.exe`
- 버전: `2.1.138`
- 실행 결과: `Not logged in · Please run /login`
- 교차검증 프롬프트 저장: `docs/CLAUDE_CROSS_VERIFY_PROMPT_2026-05-26.md`

즉, Claude CLI는 설치되어 있으나 현재 인증이 풀려 있어 실제 모델 검토는 실행되지 못했다. 로그인 후 같은 프롬프트로 재실행 가능하다.

## 운영 읽기 전용 진단

대상 차수:

- `16-01`
- `21-01`
- `22-01`

공통 결과:

- `ShipmentDate` 합계 불일치 또는 `ShipmentDtm` 누락: 0건
- `KeyNumbering` 동기화 필요: 0건
- `usp_DistributeTotal`, `usp_DistributeOne`, `usp_DistributeClear`, `usp_ShipmentFix`, `usp_ShipmentFixCancel`, `usp_StockCalculation`: 모두 존재
- `ShipmentDetail.CustKey` 누락: 각 차수 200건 이상
- `OutQuantity`와 `EstQuantity` 불일치: 각 차수 200건 이상

판단:

- 지금 당장 `nenova.exe` 분배 버튼이 PK 충돌 때문에 멈출 상태는 아니다.
- 지금 당장 확정 SP가 `ShipmentDate` 합계 불일치 때문에 막힐 상태도 아니다.
- 다만 과거 출고 데이터에 `ShipmentDetail.CustKey`가 비어 있는 행이 많다. 신규 웹 저장 경로는 `CustKey`를 채우도록 보강되어 있지만, 과거 데이터 정리 여부는 별도 결정이 필요하다.
- `OutQuantity`와 `EstQuantity` 불일치는 옛 전산/견적 표시 단위 혼재 때문에 정상일 수도 있으므로 무조건 수정하면 안 된다.

## 재검증한 보고 이슈

### 1. `nenova.exe` 21-01 국내왁스 일괄출고분배 버튼 미동작

기록된 원인:

- `KeyNumbering.Category='ShipmentDetailKey'` 값이 실제 `MAX(ShipmentDetail.SdetailKey)`보다 낮았다.
- `usp_DistributeOne`이 이미 존재하는 `SdetailKey`로 INSERT를 시도했다.
- SP CATCH가 상세 오류를 숨겨 화면에서는 버튼이 작동하지 않는 것처럼 보였다.

현재 상태:

- 16-01/21-01/22-01 모두 `ShipmentDetailKey`의 `LastKeyNo`와 실제 최대 key가 일치한다.
- 재발 가능성은 낮아졌지만, 웹이 `ShipmentMaster/Detail` 또는 `OrderMaster/Detail`을 직접 생성하는 모든 경로는 계속 `syncKeyNumbering`을 유지해야 한다.

### 2. 부분확정 차수에서 미확정 품목군 분배까지 막히던 문제

현재 코드:

- `/api/shipment/distribute`는 차수 전체 확정 체크 대신 품목의 `CountryFlower` 기준으로 확정된 detail이 있는지 본다.
- `/api/shipment/adjust`도 같은 품목군 기준 체크를 사용한다.

판단:

- “카네이션이 확정되지 않았으면 카네이션 분배는 가능해야 한다”는 요구에 맞는 방향으로 보강되어 있다.
- 단, 품목의 `CountryFlower`가 잘못되어 있으면 실제보다 넓거나 좁은 범위가 막힐 수 있다. 품목군 마스터 오분류는 여전히 리스크다.

### 3. 출고일 미지정 상태 분배 후 오류 가능성

현재 운영 진단:

- 확인한 차수 모두 `ShipmentDate` 합계 불일치/출고일 누락 0건.

이번 추가 조치:

- 출고분배 화면 저장 시 프론트가 임의 계산한 `outDate`를 보내지 않도록 변경했다.
- 서버가 거래처 `Customer.BaseOutDay` 기준으로 출고일을 계산하게 했다.
- 견적서관리 수량 수정은 출고일이 없거나 출고일별 분배가 여러 건인 경우 차단한다.

판단:

- 신규 저장분의 출고일 누락 가능성은 낮아졌다.
- 다만 웹 출고분배는 여전히 `usp_DistributeOne/Total`이 아니라 직접 `ShipmentDetail`/`ShipmentDate`를 쓰므로, 전산 SP와 완전 동일 경로는 아니다.

### 4. 출고분배 수량은 들어가는데 단가가 비는 문제

현재 코드:

- `/api/shipment/distribute`는 `CustomerProdCost` 우선, 없으면 `Product.Cost` fallback을 사용한다.
- `/api/shipment/adjust`도 `CustomerProdCost` 우선, 없으면 `Product.Cost` fallback을 사용한다.

이번 추가 조치:

- `/api/shipment/distribute`가 품목 `OutUnit` 기준으로 박스/단/송이 환산을 하도록 변경했다.
- 기존처럼 입력 수량을 무조건 박스로 보고 `BoxQuantity=qty`, `BunchQuantity=qty*BunchOf1Box`로 저장하던 위험을 줄였다.

남은 리스크:

- 단가가 `CustomerProdCost`에도 없고 `Product.Cost`도 0이면 금액은 계속 0이 된다.
- 이 경우는 저장 오류가 아니라 기준 단가 미등록 문제이므로, 분배 저장 전에 단가 0 경고를 추가하는 것이 좋다.

### 5. 견적서관리 수량/단가 수정과 `nenova.exe` 차이

현재 조치:

- 견적서관리 수량 수정은 출고일 미지정 또는 다중 `ShipmentDate`인 경우 차단한다.
- `ShipmentDate`를 단일 출고일로 덮어써서 전산 출고일 분배를 깨는 위험을 줄였다.

남은 리스크:

- 단가 수정은 확정된 `ShipmentMaster`를 트랜잭션 안에서 `isFix=0`으로 임시 변경 후 `Cost/Amount/Vat`를 수정하고 다시 `isFix=1`로 돌린다.
- 수량/재고는 바꾸지 않지만, `nenova.exe`가 단가 변경 이력을 별도 방식으로 남긴다면 웹과 이력 parity는 아직 완전하지 않다.

## 이번 코드 보강

파일:

- `pages/api/shipment/distribute.js`
- `pages/shipment/distribute.js`

내용:

- 출고분배 저장 시 프론트 기본 출고일 전송 제거
- 서버에서 거래처 `BaseOutDay` 기준 출고일 계산 사용
- 분배 저장 시 `Product.OutUnit` 기준으로 박스/단/송이 환산
- `ShipmentDate.ShipmentQuantity`는 환산 후 canonical `OutQuantity`와 일치하도록 저장

## 우선순위 남은 작업

1. 출고분배 저장 전에 기준 단가가 0인 품목을 경고하거나 저장 차단한다.
2. 과거 `ShipmentDetail.CustKey IS NULL` 데이터를 정리할지 결정한다. 단, 운영 데이터 일괄 수정이므로 별도 백업/롤백 계획 필요.
3. `update-cost` 단가 변경 이력을 `ShipmentHistory`에도 남길지 `nenova.exe`와 비교한다.
4. 웹 분배 저장을 직접 INSERT/DELETE로 유지할지, 전산 SP `usp_DistributeOne/Total/Clear` 기반으로 전환할지 별도 설계한다.
5. 알스트로/수국/카네이션처럼 `OutQuantity`, `EstQuantity`, 표시 단위가 다른 품목의 금액 계산 기준을 샘플 견적서로 재검증한다.

