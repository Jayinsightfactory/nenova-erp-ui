# 작업 완료 보고 — 호텔+미우 통합게시판 주문입력

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-19 18:40 |
| 사용자 요청 | 여러 이미지·텍스트를 한 업체로 합쳐 총수량 주문등록. 가로분배표는 다른 버튼, 홈은 입력. 지정업체 즐겨찾기+차수. 주문만 더하기. 1차/2차 수정. 환산 |
| 브랜치 | feat/hotel-miu-intake |
| 커밋 | (PR 병합 시 기록) |
| 배포 | 검증 후 Cafe24 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 구현·계약·테스트·배포 | — |
| **Claude Code** | 미사용 | — |
| **Codex** | 미사용 | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 홈은 이미지/텍스트 합산 주문입력, 기존 잔량분배표는 `/sales/shilla-miu-allocation`으로 이동.
2. **구현** — 즐겨찾기 업체+차수, 파싱·자모 매칭, overlay만 저장, `source=hotel-miu-board`로 주문만 가산, 1차/2차 차이 수정.
3. **검증** — `hotelMiuIntake`/`test:board`/`test:erp-contract`/`build`.
4. **마무리** — PR → master 병합 → Cafe24 배포.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `pages/sales/shilla-miu-board.js` | 호텔+미우 홈: 붙여넣기·텍스트 합산 후 주문등록(더하기) |
| `pages/sales/shilla-miu-allocation.js` | 기존 잔량분배표 (주문입력 버튼으로 홈 복귀) |
| `pages/api/sales/hotel-miu-parse.js` | 이미지/텍스트 파싱, 공통매핑 읽기 + overlay, 자모 후보 |
| `pages/api/sales/hotel-miu-intake.js` | 1차/2차 이력·게시판 전용 매칭. Order/Shipment SQL 없음 |
| `lib/hotelMiuIntake.js` | 파싱·환산(대→박스)·overlay·batch delta |
| `docs/contracts/hotel-miu-intake.json` | 주문 create-positive, 출고 preserve |

원장 부작용: 주문등록은 `OrderMaster`/`OrderDetail`/`OrderHistory`만 가산. 출고·견적·매출 원장은 보존. 웹 테이블 `WebHotelMiu*`.

---

## 검증 결과

```
hotelMiuIntake tests passed
shilla miu board tests passed
ERP contract manifest tests passed
Nenova dnSpy evidence guard passed
UI layout/menu contract passed
npm run test:erp-contract → exit 0
npm run build → Compiled successfully
```

---

## 사용자 확인 포인트

- 메뉴 **호텔+미우 통합게시판** → 홈에서 지정업체 칩(추가/취소)과 차수를 고른다.
- 표 사진 Ctrl+V 또는 엑셀 텍스트를 여러 번 넣은 뒤 **주문등록 (더하기)**. 출고분배는 하지 않는다.
- 같은 품목은 합쳐지고, `대`는 박스로 환산된다.
- 등록 후 1차/2차 수량을 따로 고치면 차이만큼 주문수량만 바뀐다.
- **잔량분배표** 버튼으로 기존 가로분배 화면으로 간다.

---

## 미완 / 다음

- 운영 DB에 `WebHotelMiuIntakeBatch` 등은 첫 저장 시 자동 생성(마이그레이션 SQL도 저장소에 있음).
