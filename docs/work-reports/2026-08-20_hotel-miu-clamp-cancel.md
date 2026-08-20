# 작업 완료 보고 — 호텔+미우 합산 삭제 잔량 초과 취소

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 |
| 사용자 요청 | Hydrangea White 취소 수량이 현재 주문수량(0.33)보다 크다. 주문등록내역 삭제·수정이 안 됨 |
| 브랜치 | feat/hotel-miu-clamp-cancel |
| 배포 | (배포 시 기록) |

---

## AI 구성

| 담당 | 역할 |
|------|------|
| **Cursor** | 원인 확인, 잔량 clamp, 테스트, PR/배포. Claude CLI 없음 |

---

## 작업 흐름

1. **분석** — 합산 삭제가 1440송이 등을 취소로 보내는데, 전산 Hydrangea White는 0.33박스만 남아 API가 전체를 롤백. 웹 합산도 안 지워짐.
2. **구현** — hotel-miu-board만 남은 수량을 0으로 숨기거나 skip. 다른 source는 기존 거부. 화면은 이 오류여도 합산 카드를 지움.
3. **검증** — hotelMiuIntake 테스트, erp-contract, guard, build.
4. **마무리** — PR squash-merge 후 Cafe24.

---

## 부작용 행렬

| 동작 | Order | Shipment | 합산 |
|---|---|---|---|
| 합산 삭제, 전산 잔량 < 합산 | 잔량 0으로 숨김 | preserve | 삭제 |
| 합산 삭제, 전산 이미 0 | skip | preserve | 삭제 |
| paste/my-customer 초과 취소 | reject (기존) | preserve | n/a |

---

## 사용자 확인 포인트

- 새로고침 후 라움 34-01 합산 **삭제** 또는 수정. Hydrangea White 오류 없이 카드가 사라져야 함.
- nenova.exe에서 수국 화이트 0.33박스도 0이 됨.
- **다시 더하기는 누르지 말 것** (삭제하려는 중이면 수량이 다시 올라감).
