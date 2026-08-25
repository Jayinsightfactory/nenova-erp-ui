# 작업 완료 보고 — 호텔+미우 품종 버튼 묶음

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-25 |
| 사용자 요청 | 품종별로 묶은 상태로, 버튼 형태로 활성화 선택 가능하게 |
| 브랜치 | feat/hotel-miu-variety-buttons |
| 커밋 | (푸시 후 기입) |
| 배포 | (Cafe24 후 기입) |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 지휘탑 — 품종 칩 UX, GET FlowerName, 테스트·계약·배포 | — |
| **Claude Code** | 사용 안 함 | — |
| **Codex** | 사용 안 함 | — |
| **Cursor 직접** | git / gh / Cafe24 | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 주문반영 내역·확인표를 `Product.FlowerName`으로 묶고, 전체/품종 토글 칩으로 화면만 필터. 출고일 추가는 이번 범위에서 제외(Shipment 쓰기 금지).
2. **구현** — GET `prodKeys`에 FlowerName/CountryFlower, `historyVarietyLabel` + 칩/그룹 UI, localStorage 표시 필터.
3. **검증** — `node --test __tests__/hotelMiuIntake.test.js`, `test:erp-contract`, `test:nenova-dnspy-evidence`, `test:erp-manifest`, `guard:erp-writes`, `npm run build`.
4. **마무리** — PR squash-merge 후 Cafe24.

---

## 부작용 행렬

| 동작 | Order | Shipment | Product | Estimate |
|---|---|---|---|---|
| 품종 버튼 켜기/끄기 | preserve | preserve | read FlowerName/CountryFlower | preserve |
| 주문등록(확인표 필터 중) | create-positive (전체 품목) | preserve | preserve | preserve |

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/hotelMiuIntake.js` | 품종 라벨·칩·그룹·localStorage 헬퍼 |
| `pages/sales/shilla-miu-board.js` | VarietyChipBar, 그룹 헤더, compact 표 |
| `pages/api/sales/hotel-miu-intake.js` | GET Product FlowerName/CountryFlower |
| `docs/contracts/hotel-miu-intake.json` | READ_REGISTER_HISTORY 품종 버튼 |
| `docs/exe-golden/FormOrderAdd.md` | 표시 그룹만, 원장 쓰기 없음 |

---

## 사용자 확인 포인트

- 주문반영 내역 위에 **전체 / 수국 / 장미 …** 버튼. 빈 선택=전체, 품종 헤더로 묶여 보임.
- 확인표도 같은 칩. 숨긴 품종도 주문등록에는 포함.
- 전산 품목 마스터·출고분배는 안 바뀜.

## 미완 / 다음

- 출고일 추가는 웹 overlay로 별도 요청 시 (ShipmentDate 쓰지 않음).
