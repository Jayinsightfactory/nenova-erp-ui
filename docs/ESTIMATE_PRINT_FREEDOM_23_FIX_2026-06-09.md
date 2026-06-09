# 견적서 출력 Freedom 23-1/23-2차 합산 오류 (2026-06-09)

## 증상

- `nenova.exe` 출고분배: Freedom 장미 수량/분배 **정상**
- 견적서 출력(nenovaweb `/estimate`): **합산값(단가×수량 vs 공급가)** 불일치

## 원인 1 — 견적서 출력 HTML 집계 (코드, 이번 수정)

`pages/estimate.js` `buildEstimateHtml()`:

- 23-01 + 23-02 를 **같은 ProdKey** 로 한 줄에 합산 (적요에 `1차 N단, 2차 M단` 표시)
- 합산 후 **Amount/Vat 는 더하는데 Cost(단가)는 첫 행 값 유지**
- 알스트로만 실효 단가 재계산하고 **장미(Freedom 포함)는 미적용**
- 결과: `수량 × 단가 ≠ 공급가`, 하단 합계와 눈으로 더한 금액이 어긋남

### 수정

합산 직후 모든 품목에 실효 단가 적용:

- 일반: `Cost = round(Amount / Quantity)`
- 알스트로: `Cost = round((Amount+Vat) / Quantity)`
- 합계는 **집계 후** `Amount`/`Vat` 합으로 계산

## 원인 2 — ShipmentDetail vs ShipmentDate 불일치 (데이터, 기존 이슈)

`docs/ESTIMATE_COST_SOURCE_FIX_2026-05-27.md` 참고.

- 출고분배 화면: `ShipmentDetail` 기준 → 정상
- `nenova.exe` 견적관리/인쇄: `ShipmentDate`/`ViewShipment` 조인 → **Cost/Amount 0** 이면 합계 틀림

## 검증 (운영 nenovaweb)

### 1) 데이터 불일치 조회 (Freedom, 23차)

```http
GET /api/dev/estimate-cost-source-audit?week=23-01&prod=Freedom&limit=100
GET /api/dev/estimate-cost-source-audit?week=23-02&prod=Freedom&limit=100
```

`DetailAmount` vs `DateAmount` / `ViewAmount` 차이 확인.

### 2) ShipmentDate 동기화 (필요 시)

```http
POST /api/dev/estimate-cost-date-sync?scope=all&week=23-01&prod=Freedom&apply=1
POST /api/dev/estimate-cost-date-sync?scope=all&week=23-02&prod=Freedom&apply=1
```

### 3) 견적서 출력 재확인

- nenovaweb 견적관리 → 23차 거래처 선택 → 인쇄
- Freedom 행: `수량 × 단가 = 공급가`, 하단 합계 일치

## 배포

```bash
cd nenova-erp-ui
npm run build
# 운영 배포 후 위 검증 3단계 실행
```
