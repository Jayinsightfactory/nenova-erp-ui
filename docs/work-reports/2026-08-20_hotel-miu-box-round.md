# 작업 완료 보고 — 합산 주문등록 박스 반올림/반내림

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/YYYY-MM-DD_{slug}.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 |
| 사용자 요청 | 합산 주문등록 확인표에서 박스로 떨어지지 않는 품목만 반올림/반내림. 수국 40송이·30송이=1박스면 반올림 시 2박스 주문. |
| 브랜치 | feat/hotel-miu-box-round |
| 커밋 | (push 후 기록) |
| 배포 | (Cafe24 ping 후 기록) |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor 직접** | 확인표 박스맞춤 UI, Product 계수 GET, 계약/테스트, 검증, 배포 | — |

이 변경은 합산 확인표의 주문 payload만 바꾸는 소규모 UI+읽기 API라 Cursor가 이어서 구현했다.

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 확인표에서만 반올림/반내림. 합산 DRAFT는 원문 유지. 출고분배 없음.
2. **구현** — `boxRoundHint`/`buildRegisterItems`, GET `prodKeys` Product SELECT, 확인표 버튼.
3. **검증** — `hotelMiuIntake.test.js`, `test:ui-layout`, `test:nenova-dnspy-evidence`, `guard:erp-writes`, `test:erp-manifest`, `npm run build`.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/hotelMiuIntake.js` | 송이=`SteamOf1Box`, 단=`BunchOf1Box`. remainder>0만 반올림/반내림. |
| `pages/api/sales/hotel-miu-intake.js` | GET `prodKeys` → Product 계수 SELECT (쓰기 없음). |
| `pages/sales/shilla-miu-board.js` | 확인표에 1박스/나머지/주문/반올림·반내림. |
| `docs/contracts/hotel-miu-intake.json` | READ_BOX_FACTORS + REGISTER_ORDER_ADD 박스맞춤. |
| `__tests__/hotelMiuIntake.test.js` | 40송이/30 → ceil 2, floor 1. 60송이는 버튼 없음. |

---

## 부작용 행렬

| 동작 | Order | Shipment | 합산 DRAFT |
|------|-------|----------|------------|
| 확인표, 버튼 안 누름 | 원문 송이/단 가산 | 유지 | 유지 |
| 반올림 | ceil 박스 가산 (`unit: 박스`) | 유지 | 원문 유지 |
| 반내림 | floor 박스 가산 (0이면 제외) | 유지 | 원문 유지 |
| GET prodKeys | 유지 | 유지 | 유지 |

---

## 검증 결과

```
hotelMiuIntake tests passed
UI layout/menu contract passed
Nenova dnSpy evidence guard passed
ERP write scope guard passed
ERP contract manifest guard passed
next build --webpack 성공
```

---

## 사용자 확인 포인트

- 호텔+미우 통합게시판 → 합산 저장 → 주문등록
- 수국 40송이(1박스 30송이)에서 반올림 → 주문 2박스, 반내림 → 1박스
- 60송이처럼 정수 박스면 버튼 없음
- 같은 버튼을 다시 누르면 원문 수량으로 돌아감

---

## 미완 / 다음

- 배포 후 실브라우저에서 반올림 버튼과 Cafe24 SHA 확인
