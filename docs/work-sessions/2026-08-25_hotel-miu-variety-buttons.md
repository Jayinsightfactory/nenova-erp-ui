# 세션 Q&A — 호텔+미우 품종 버튼

| 항목 | 내용 |
|------|------|
| 세션 ID | 2026-08-25_hotel-miu-variety-buttons |
| 화면 | `/sales/shilla-miu-board` |
| 원장 부작용 | Product FlowerName 읽기만. Order/Shipment 표시 필터로 안 바뀜 |
| 배포/PR | feat/hotel-miu-variety-buttons |
| 다음 채팅 힌트 | 출고일은 ShipmentDate 쓰지 말고 웹 overlay로. 품종 칩은 보기 필터이며 주문등록은 전체 품목 |

## 이어받을 때 고정된 결정

- 품종 라벨: `FlowerName` → `CountryFlower` → 품목명 접두(ROSE/수국 등) → 기타
- 버튼: `전체` + 품종 칩 멀티토글. 빈 선택=전체 그룹 표시
- localStorage `hotel-miu-variety-filter`는 화면만. 확인표에서 숨겨도 주문등록은 전 품목
- 이 게시판은 Shipment/Estimate를 쓰지 않음

## 질문 → 답변

### 1. 2026-08-25 — 품종별 묶음 버튼

**Q.** 품종별로 묶은 상태로, 버튼 형태로 활성화 선택 가능하게

**A.** 주문반영 내역·확인표에 전체/수국/장미 칩과 품종 헤더를 넣었다. GET prodKeys가 FlowerName/CountryFlower를 읽어 그룹한다.

**결과.** 브랜치 feat/hotel-miu-variety-buttons

## 미완

- 출고일 추가(웹 overlay)
- 한 화면에 3개 차수 레이아웃은 compact 표로만 일부 대응
