# 운송기준원가 데이터 검증 감사 (2026-05-25)

## 배경

이전 대화/문서 기준으로 운송기준원가 메뉴에서 검증이 덜 되었던 항목을 운영 DB와 웹 계산 경로 기준으로 재확인했다.

- 대상 메뉴: `/freight` 운송기준원가
- 기준 문서: `docs/FREIGHT_PIPELINE.md`, `docs/FULL_VALIDATION_AUDIT_2026-05-25.md`
- 원칙: DB 구조와 `Product.FlowerName`은 변경하지 않고, 웹 계산/검증 경로만 확인 및 보완

## 확인된 운영 DB 입력 미완료 항목

최근 2026년 입고 상세 3,000행 기준, 운송료/중량 특수 품목(`ProdKey 2182`, `3100`, `3101`)을 제외하고 확인했다.

| 구분 | 건수 |
| --- | ---: |
| 확인 행 | 3,000 |
| 확인 품목 | 409 |
| `Product.BoxWeight` 미입력 품목 | 395 |
| `Product.BoxWeight` 미입력 행 | 2,925 |
| `Product.SteamOf1Bunch` 미입력 품목 | 38 |
| `Product.SteamOf1Bunch` 미입력 행 | 85 |
| `Product.TariffRate` 및 `Flower.DefaultTariff` 모두 미입력 품목 | 257 |
| `Product.TariffRate` 및 `Flower.DefaultTariff` 모두 미입력 행 | 2,245 |

## 이전 문서에서 남아 있던 품목 상태

`docs/FREIGHT_PIPELINE.md`에 남아 있던 품목 입력 미완료 상태는 운영 DB에서도 아직 남아 있다.

- 중국 장미 7종: `BoxWeight`, `BoxCBM`, `TariffRate` 미입력
  - 2093 버터컵
  - 2388 만달라
  - 2513 프라우드
  - 2742 골렘
  - 2918 시시아 페어리
  - 2961 퀵샌드
  - 3093 케서린
- 3088 ASPARAGUS Preserved White: `BoxWeight`, `BoxCBM`, `TariffRate` 미입력
- 2834 리모늄 스타티스 화이트: `SteamOf1Bunch` 미입력
- 3078 Lisianthus 화이트 600g: `SteamOf1Bunch` 미입력

## 품목군별 우선 확인 대상

최근 입고 기준으로 영향이 큰 순서다.

- 카네이션/콜롬비아: 95개 품목 `BoxWeight`, `TariffRate` 미입력. 단, `Flower` 기본값에는 카네이션 기준이 있어 화면 계산은 fallback 가능.
- 장미/중국: 41개 품목 `BoxWeight` 미입력, 11개 품목 `SteamOf1Bunch` 미입력.
- 기타/중국: 36개 품목 `BoxWeight` 미입력, 27개 품목 `SteamOf1Bunch` 미입력.
- 튤립/네덜란드, 수국/콜롬비아, 카네이션/중국, 태국 모카라 등은 `Flower` 기준값도 비어 있어 운임 분배가 송이수 비율 fallback 또는 경고에 의존할 수 있다.

## 웹 코드에서 확인된 검증/계산 누락

1. 저장 시 화면에서 바꾼 카테고리(`flowerName`)가 snapshot 저장 계산에 일부 반영되지 않았다.
   - 엑셀 다운로드는 `flowerName`을 넘겼지만, 저장 버튼은 넘기지 않았다.
   - 결과: 화면 미리보기와 저장된 `FreightCostDetail.FlowerName`/계산값이 달라질 수 있었다.

2. 저장 시 화면에서 임시로 바꾼 카테고리 기준값(`BoxWeight`, `BoxCBM`, `StemsPerBox`, `DefaultTariff`)이 snapshot 계산에 반영되지 않았다.
   - 결과: 사용자가 화면에서 보정 후 저장해도 서버가 DB 기준으로 다시 계산할 수 있었다.

3. 엑셀 생성 계산에서 `Product.CounName`이 빠져 있었다.
   - `computeFreightCost`는 국가명으로 콜롬비아/비콜롬비아 수량 기준을 분기한다.
   - 결과: 엑셀 캐시 계산값이 화면 계산과 달라질 수 있었다.

4. 엑셀 생성 계산에서 `Flower.DefaultTariff` 조회가 빠져 있었다.
   - 결과: `Product.TariffRate`가 없고 `Flower.DefaultTariff`만 있는 품목은 화면과 엑셀 관세 fallback이 다를 수 있었다.

## 보완 내용

- `/freight` 저장 요청에 row별 `flowerName`을 포함했다.
- `/freight` 저장 요청에 화면 임시 기준값 `flowerOverrides`를 포함했다.
- `/api/freight` 저장 계산에서 `flowerOverrides`를 최종 `flowerMeta`에 반영하도록 했다.
- `/api/freight/excel` 조회에 `Product.CounName`, `Flower.DefaultTariff`를 추가했다.
- `/api/freight/excel` 계산 입력에 `counName`을 포함했다.
- 엑셀용 `flowerOverrides`도 `DefaultTariff`를 반영하도록 했다.

## 추가 확인 결과

- `Gross weight` / `Chargeable weight` 특수 품목은 최근 데이터에서 `UPrice`, `TPrice`가 0으로 확인되어 실제 운송료 합산을 오염시키는 정황은 없었다.
- `운송료` 행은 문서와 동일하게 두 패턴이 섞여 있다.
  - `BunchQuantity > 1`, `UPrice > 0`: Rate × CW 패턴
  - `UPrice = 0`, `TPrice > 0`: Doc/Fee 또는 fixed 운송료 패턴

## 남은 운영 입력 과제

코드 보완 후에도 아래 값은 DB 기준값 입력이 필요하다. 이 값이 비어 있으면 웹은 fallback 계산과 경고에 의존한다.

- `Product.BoxWeight`, `Product.BoxCBM`
- `Product.SteamOf1Bunch`
- `Product.TariffRate` 또는 `Flower.DefaultTariff`
- `Flower.BoxWeight`, `Flower.BoxCBM`, `Flower.StemsPerBox` 기본값

