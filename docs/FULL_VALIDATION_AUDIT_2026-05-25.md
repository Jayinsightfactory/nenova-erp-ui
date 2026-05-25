# NenovaWeb 전체 검증 감사 - 2026-05-25

## 범위

시간을 넉넉히 두고 전체 검증을 시작했다. 이번 라운드는 운영 DB를 읽기 전용으로 먼저 확인하고, 충돌 가능성이 낮고 원인이 명확한 항목만 `+A` 방식으로 보완했다.

검증 범위:

- 출고분배: 부분확정, 출고일, 단가, KeyNumbering, ShipmentDate
- 붙여넣기 주문등록: 매칭 학습 저장 시점, fallback 자동 매핑 후보
- 챗봇: 감사 로그 테이블/응답 저장 구조
- 메뉴/화면: 데스크톱/모바일 메뉴 동기화, 출고분배 품목군 필터
- build 검증

## 운영 DB 읽기 전용 진단 결과

### KeyNumbering

현재 핵심 채번값은 모두 정상이다.

| Category | 실제 MAX | LastKeyNo | 상태 |
|---|---:|---:|---|
| OrderMasterKey | 4968 | 4968 | 정상 |
| OrderDetailKey | 59994 | 59994 | 정상 |
| ShipmentMasterKey | 4910 | 4910 | 정상 |
| ShipmentDetailKey | 74915 | 74915 | 정상 |

### ShipmentDate / 출고일

최근 2026년 출고 데이터 기준으로 `ShipmentDate` 합계와 `ShipmentDetail.OutQuantity` 불일치, `ShipmentDtm` 누락은 발견되지 않았다.

- 최근 mismatch: 0건
- 최근 `ShipmentDtm IS NULL`: 0건

단, 코드상 `/api/shipment/distribute`는 `outDate`가 비면 현재 날짜를 넣고 있었다. 운영 데이터가 지금 깨지지는 않았지만, 사용자가 지적한 “출고일 지정 안 된 상태에서 분배” 위험은 실제 코드에 있었다.

### 단가

최근 생성 데이터 중 `CustomerProdCost`가 있는데 `ShipmentDetail.Cost=0`인 케이스는 발견되지 않았다.

- 최근 1000개 Sdetail 범위 기준: 0건
- `WebCreated=1` 출고도 `MissingDtm=0`, `ZeroCost=0`

단, 코드상 품목 기준 출고분배 저장은 거래처별 단가가 아니라 `selectedProd.Cost`를 보내고 있었다. 품목 마스터 단가가 0이면 단가 0 저장 가능성이 있었다.

### 부분확정

21-01 차수는 실제로 부분확정 상태였다.

| Scope | FixedRows | OpenRows |
|---|---:|---:|
| 국내왁스 | 0 | 5 |
| 콜롬비아카네이션 | 0 | 282 |
| 콜롬비아수국 | 0 | 105 |
| 태국 | 0 | 26 |
| 네덜란드 | 11 | 0 |
| 중국장미 | 43 | 0 |
| 콜롬비아장미 | 78 | 0 |
| 호주 | 16 | 0 |

기존 `/api/shipment/distribute` 저장 로직은 차수 전체에 확정된 row가 하나라도 있으면 막았다. 따라서 21-01에서 콜롬비아카네이션/수국/태국/국내왁스처럼 미확정 품목군도 다른 품목군 확정 때문에 막힐 수 있었다.

## 이번에 바로 보완한 항목

### 1. 출고분배 확정 체크 범위 축소

`/api/shipment/distribute` POST 저장 시 차수 전체 확정 체크를 품목군(`Product.CountryFlower`) 단위 확정 체크로 바꿨다.

효과:

- 카네이션 분배 시 카네이션 품목군만 확정 여부 확인
- 장미/네덜란드/호주 등이 이미 확정되어 있어도 카네이션이 미확정이면 카네이션 분배 가능
- `CountryFlower`가 없는 품목은 `ProdKey` 단위로 확인

### 2. 출고일 fallback 보정

`outDate`가 없는 경우 현재 날짜를 넣지 않고, 거래처 `BaseOutDay`와 차수 기준으로 출고일을 계산하도록 했다.

계산 실패 시 저장을 차단한다.

### 3. 단가 fallback 보정

서버에서 단가를 다시 확인한다.

우선순위:

1. 요청 body의 명시 단가
2. `CustomerProdCost.Cost`
3. `Product.Cost`

품목 기준 UI에서도 거래처별 `단가`를 보내도록 보완했다.

### 4. 저장 실패 감지

출고분배 화면에서 `fetch` 응답을 확인하지 않아 API가 실패해도 화면에서 성공처럼 보일 수 있었다. 이제 `res.ok`와 `data.success`를 확인하고 실패 메시지를 띄운다.

### 5. 붙여넣기 거래처 매핑 학습 지연

거래처 수동 매칭은 선택 즉시 저장되던 구조였다. 이제 주문 저장 또는 일괄 등록+분배가 성공한 뒤에만 거래처 매핑을 학습한다.

품목 매핑은 이미 일괄 분배 성공 건에 대해서만 저장되는 흐름이었고, 이번에 거래처도 같은 방향으로 맞췄다.

### 6. 모바일 메뉴 동기화

모바일 홈의 데스크톱 메뉴 복제본에 `/orders/kakao-audit`를 추가했다.

그룹명도 데스크톱과 맞췄다.

- `재고/통계` -> `통계화면`
- `코드/관리자` -> `코드관리`

### 7. 출고분배 품목군 필터 오타 수정

출고분배 품목군 목록의 `네달란드`를 실제 DB 값인 `네덜란드`로 수정했다.

## 붙여넣기 매핑 점검

현재 파일 기준:

| 항목 | 건수 |
|---|---:|
| `order-mappings.json` 전체 | 428 |
| auto=true | 232 |
| fallback suspects 격리 파일 | 171 |

과밀 prodKey 상위:

| ProdKey | 매핑 수 |
|---:|---:|
| 889 | 20 |
| 553 | 15 |
| 721 | 12 |
| 1425 | 11 |
| 447 | 11 |
| 2760 | 10 |
| 251 | 10 |

현재 `parse-paste`에는 과밀 prodKey를 그대로 신뢰하지 않는 guard가 있다. 다만 `order-mappings-fallback-suspects.json`의 후보가 많으므로 다음 라운드에서 실제 품목명 기준으로 수동 복구/삭제를 해야 한다.

## 챗봇 점검

운영 DB에는 아직 `_chat_audit` 테이블이 생성되어 있지 않았다.

현재 구조상:

- 챗봇 답변이 실제로 한 번 기록될 때 `lib/chat/audit.js`가 테이블을 자동 생성한다.
- `/api/m/chat-audit`는 테이블이 없어도 0건으로 응답한다.

따라서 “현재 DB에 저장된 대화 내용”은 아직 확인할 데이터가 없다. 다음 검증은 실제 챗봇 질의 5-10개를 실행한 뒤 `_chat_audit`의 `RouteFlags`, `RiskFlags`, `DebugJson`, 답변 내용을 확인하는 순서로 진행해야 한다.

## 남은 고위험 검증

1. `ShipmentFarm` 갱신 정책과 견적서 출력의 exe parity
2. `StockList` 정의 부재와 `Product.Stock`/`ProductStock` 차이
3. `usp_DistributeTotal/One/Clear`와 웹 직접 분배 로직의 결과 1:1 비교
4. Ecount/경영지원 화면의 원본 원장 대조
5. fallback suspect 매핑 171건 수동 정리
6. 실제 카톡 문장 샘플로 주문등록+분배+견적서까지 end-to-end 재검증

## 검증

- `next build` 통과
- 기존 Turbopack 경고는 동일: `next.config.js` -> `pages/api/dev/git-log.js` import trace

