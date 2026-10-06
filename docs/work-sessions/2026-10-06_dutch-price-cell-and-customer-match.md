# 네덜란드 물량표 셀 원화 입력·업체 연결

## 요청과 결정

- 물량표 고객 셀에서 원화값을 직접 입력하고 같은 품목의 비주광 행에 즉시 공유한다. 주광은 거래처별 가격을 유지한다.
- 셀 입력은 브라우저 초안에 즉시 반영하고 이전 검증/계획은 폐기한다. ERP 저장은 별도 검토·승인·적용 동작만 수행한다.
- 내려받는 통합 Excel에는 숫자만 표시하고 `단가` 설명 문구는 추가하지 않는다. 업체명은 위 줄, CL은 아래 줄, 요일/수량/가격은 가운데 정렬하며 가격 도형은 안쪽 여백을 없앤다.
- 데스크톱 기본 화면을 약 70% 시각 배율로 구성하고 작은 화면에서는 100%로 복구한다.
- 업체 자동매칭은 퍼지/부분 CL 비교 대신 정확한 DB ID 연결을 보강한다.

## 코드 조사에서 확인한 구조

- 직접조회는 선택 연도·차수 Pivot JSON으로 존재 여부를 확인한 뒤, 새로 생성한 인증 엑셀을 다시 파싱한다. Excel 생성기는 `_keymap`에 거래처키를 넣지만 네덜란드 파서는 이를 버리고 헤더 문자열만 보냈다.
- 임의 업로드 파일에서 `_keymap`을 자동 신뢰하지 않도록 계약이 막고 있다. 이번 구현은 새로 생성한 LIVE 응답에서만 정확한 헤더·현재 pivot 응답의 활성 `CustKey` 교차를 사용한다. 중복/비활성/불일치 키는 자동 선택하지 않는다.
- `pivotStats`의 호환용 `orders`는 업체명 키를 유지하되, 네덜란드 파일 생성용 `ordersByCustKey`와 `customersByKey`를 추가해 동일 업체명이 서로 섞이지 않도록 했다.
- 동일 비주광 품목 단가는 `dutchPriceKey`가 이미 공통키를 사용한다. 원본 매트릭스에 즉시 편집 컨트롤을 연결해 키 적용을 눈으로 바로 확인할 수 있게 한다.

## 부작용 경계

| 사용자 동작 | OrderDetail | ShipmentDetail | ShipmentDate | ShipmentFarm | Estimate/WebProfitReport/재고 |
|---|---|---|---|---|---|
| 화면 셀 원화 입력 | 보존 | 보존 | 보존 | 보존 | 보존 |
| Excel 내려받기 | 보존 | 보존 | 보존 | 보존 | 보존 |
| 기존 확인·승인 후 ERP 적용 | 기존 Dutch apply 계약 범위만 | 기존 preview/apply 계획 범위만 | 기존 apply 계약 범위만 | 기존 보존·제로정리 분기 | 보존 |

운영 DB 쓰기나 단가 적용을 이 세션에서 실행하지 않는다.

## 검증 및 배포

- 회귀 fixture: 단가 입력 즉시 공유, 주광 개별가격, 서로 다른 ProdKey 보존, 혼합 매칭, Escape 취소 시 연결 셀의 기존 값/미입력 상태 복원.
- 엑셀/수량 fixture: CustKey별 주문 분리, 같은 표시명 업체의 데이터 혼합 방지, 품명 윗줄·CL 아랫줄 유지, 숫자만 표시하는 가격 도형.
- `npm run test:dutch-volume-distribution`, `npm run test:dutch-volume-distribution-sql`, `npm run test:pivot`, `npm run test:erp-contract`, `npm run test:erp-manifest -- --changed-from origin/master`, `npm run test:nenova-dnspy-evidence`, `npm run guard:erp-writes -- --changed-from origin/master` 통과.
- 1920×1080 기준 로컬 페이지 스모크는 로그인 화면으로 리다이렉트되어 인증 없이 내부 보드를 렌더링할 수 없었다. 사용자 자격증명은 요청·입력하지 않았으며, 배포 후 가능한 인증된 read-only 스모크는 별도로 수행한다.
- 프로덕션 빌드 결과와 PR·Cafe24 배포·라이브 스모크 상태는 완료 시 추가 기록한다.
