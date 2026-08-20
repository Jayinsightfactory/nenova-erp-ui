# 작업 완료 보고 — 호텔+미우 박스당 계수 매칭 overlay 저장

> Cursor(지휘탑)가 매 작업 종료 시 작성.

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 |
| 사용자 요청 | 반올림 박스단위 수정가능하고, 매칭데이터개념으로 저장되게해줘 |
| 브랜치 | feat/hotel-miu-box-factor-map |
| 커밋 | (배포 후 기입) |
| 배포 | (배포 후 기입) |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 지휘탑 — 구현, 테스트, 커밋/PR/배포 | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 확인표 박스당은 이미 수정 가능했으나 세션 전용. 품목 매칭과 같이 `WebHotelMiuProductMap` overlay로 남기면 다음 주문등록에도 같은 계수가 나온다. `Product` 마스터는 쓰지 않는다.
2. **구현** — `prodbox:{ProdKey}` 토큰 + `PerBox` 컬럼, GET prodKeys merge, POST `saveBoxFactor`, 확인표 onBlur/등록 시 저장.
3. **검증** — `node --test __tests__/hotelMiuIntake.test.js` 및 ERP 가드.

---

## 부작용 행렬

| 동작 | Order | Shipment | Product | WebHotelMiuProductMap |
|---|---|---|---|---|
| 확인표 박스당 입력(키 입력) | preserve | preserve | preserve | preserve |
| 박스당 blur / 주문등록 | preserve | preserve | preserve | upsert `prodbox:{ProdKey}` PerBox |
| 다음 확인표 GET prodKeys | preserve | preserve | read | overlay가 Product 계수보다 우선 |

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/hotelMiuIntake.js` | `boxFactorOverlayRecord`, `mergeProductBoxFactors` |
| `pages/api/sales/hotel-miu-intake.js` | PerBox 컬럼, GET merge, `saveBoxFactor` |
| `pages/sales/shilla-miu-board.js` | 박스당 onBlur·등록 시 overlay 저장 |
| `docs/migrations/2026-08-20_web_hotel_miu_product_map_perbox.sql` | ALTER PerBox |
| `docs/contracts/hotel-miu-intake.json` | SAVE_BOX_FACTOR_OVERLAY |

---

## 사용자 확인 포인트

- 주문등록 확인표에서 박스당을 고치고 칸을 벗어나면 매칭 데이터처럼 저장됨
- 같은 품목을 다음 차수에서 주문등록하면 고친 박스당이 다시 나옴
- 전산 품목 마스터(Product)와 출고분배는 바뀌지 않음

---

## 미완 / 다음

- ensureTables가 운영 첫 요청에서 ALTER를 적용함. 별도 운영 SQL은 필수는 아님
