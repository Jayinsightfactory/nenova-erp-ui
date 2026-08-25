# 작업 완료 보고 — 라움 초이문 손익계산서

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/YYYY-MM-DD_{slug}.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-25 |
| 사용자 요청 | 라움 손익계산서 메뉴를 라움 초이문 손익계산서로 바꾸고 거래처 선택·초이문 견적서 업로드 |
| 브랜치 | feat/raum-choimun-pnl |
| 커밋 | (작성 시점 이후) |
| 배포 | 미배포 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 파서·PartnerCode·UI·계약 테스트 직접 구현 | — |

## 한 일

- 메뉴: 라움 초이문 손익계산서. `/raum/pnl`에서 라움/초이문 선택.
- 초이문 견적서(`N차` 시트, 비고 초이문)를 기존 거래명세표 파서로 읽음. 라움은 강남/건대 유지.
- `WebRaumPnl.PartnerCode`로 같은 연도·대차수 결산을 거래처별로 분리.
- 전산 대조/이미지 주문은 선택 거래처 CustName LIKE. 매입단가 학습은 품목명 공유.

## 검증

- `npm run test:raum-pnl` 통과 (실제 초이문 양식 32차 수국 화이트 362×2600 포함)
- `npm run test:ui-layout`, `test:nenova-dnspy-evidence`, estimate year contract, ERP manifest 통과

## 원장

- 웹 결산 쓰기: `WebRaumPnl` / `WebRaumPnlItem`만
- 이미지 주문등록: 기존 `/api/orders`, custName만 라움 또는 초이문
- OrderWeek 단독 Master 조회 없음
