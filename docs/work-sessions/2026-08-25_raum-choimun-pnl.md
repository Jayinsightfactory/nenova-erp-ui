# 세션 Q&A — 라움 초이문 손익계산서

| 항목 | 내용 |
|------|------|
| 세션 ID | 2026-08-25_raum-choimun-pnl |
| 기간 | 2026-08-25 |
| 화면 | `/raum/pnl` 라움 초이문 손익계산서 |
| 원장 부작용 | 결산 저장은 `WebRaumPnl`/`WebRaumPnlItem`만. 이미지 주문등록은 선택한 거래처 `CustName`으로 기존 `/api/orders`. 전산 일괄수정은 기존 견적/분배 API, 거래처만 라움 또는 초이문 |
| 배포/PR | (이 세션에서 커밋 예정) |
| 다음 채팅 힌트 | `docs/work-sessions/INDEX.md` 와 이 파일을 읽고 이어서. 과거 대화는 그 파일 기준. |

## 이어받을 때 고정된 결정

- 메뉴명은 **라움 초이문 손익계산서**. 화면 상단에서 라움/초이문 선택.
- 같은 페이지·같은 기능(업로드, 매입단가, 전산대조, 저장, 인쇄, 엑셀, 이미지 주문). 결산 키는 `OrderYear + MajorWeek + PartnerCode`.
- 초이문 견적서는 시트명 `32차`처럼 차수만 있고 비고에 초이문. 강남/건대 합산은 라움만.
- 전산 거래처: 라움=`CustName LIKE '%라움%' OR '%트라움%'`, 초이문=`LIKE '%초이문%'` (활성 CustKey 683).
- 매입단가 학습(`WebRaumCostPrice`)은 품목명 기준 공유. 사입/품목매핑도 동일.

### 1. 2026-08-25 — 라움 초이문 손익 탭

**Q.** 라움 손익계산서 메뉴를 라움 초이문 손익계산서로 바꾸고, 라움/초이문 선택, 기존 기능 그대로, 초이문 견적서 양식 업로드.

**A.** `/raum/pnl` 한 화면에 거래처 칩을 넣었다. 초이문 엑셀(`N차` 시트 + 비고 초이문)을 같은 거래명세표 파서로 읽는다. `WebRaumPnl.PartnerCode`로 같은 차수 라움/초이문 결산을 섞지 않는다.

**결과.** 파서 `lib/raumPnlParse.js`, 거래처 `lib/raumPnlPartner.js`, 마이그레이션 `docs/migrations/2026-08-25_web_raum_pnl_partner_code.sql`. 테스트 `npm run test:raum-pnl` 통과. 실제 초이문 양식 32차 수국 화이트 362×2600 파싱 확인.

## 미완 / 다음 세션

- Cafe24 배포 후 화면에서 라움/초이문 전환·업로드 스모크.
- 초이문 전산 창은 라움과 같은 호텔 규칙(N-02+(N+1)-01, 폴백 N-01). 현장 분배가 다르면 그때 조정.

## 커밋하지 말 파일

probe/tmp xlsx, `docs/work-sessions/2026-08-24_arrival-cost-week-farm-group.md` 등 이 작업과 무관한 변경.
