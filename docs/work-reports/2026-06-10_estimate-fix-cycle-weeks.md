# 견적 확정 사이클 차수 누락 수정 — 2026-06-10

## 증상

24차 견적서 수량 저장 시 진행 로그:

- 확정 사이클: `24-02`만 해제
- 저장 시도: `24-01` 품목
- 오류: `[24-01] 확정된 차수입니다. 먼저 확정취소 후 수량을 수정하세요.`

## 원인

1. **확정 사이클 산출**: `SubWeeksFix`에 확정으로 표시된 차수만 대상 → `24-01`은 DB 확정인데 메타(`24-02:1`)에 없어 사이클에서 제외
2. **API 검사**: `ShipmentMaster.isFix`만 보면 카테고리 부분 해제 후에도 master=1이면 저장 차단

## 수정

| 파일 | 내용 |
|------|------|
| `lib/estimateFixCycle.js` | 수정 OrderWeek 전체 + trailing 확정 차수 union |
| `pages/estimate.js` | 위 lib 연동 |
| `pages/api/estimate/update-quantity.js` | `ShipmentDetail.isFix` 기준 차단 (master 단독 차단 제거) |
| `__tests__/estimateFixCycle.test.js` | 24-01+24-02 시나리오 |

## MD 정합성

- `docs/NENOVA_EXE_DNSPY_ESTIMATE_EDIT_VERIFY_2026-05-26.md` — 사이클 정책·API 검사 기준 갱신
- `docs/ESTIMATE_FIX_SPEED_OPTIMIZATION_2026-05-27.md` — 단가-only는 사이클 없음 (변경 없음, 여전히 유효)
- `docs/ESTIMATE_EDIT_EXE_PARITY_AUDIT_2026-05-26.md` — update-cost는 master 확정 차단 유지 (수량과 별도)

## 잔여 불일치 없음 (확인)

- 카테고리별 unfix → refix: 기존 `countryFlowers` 전달 흐름 유지
- 차감(Estimate) 행: 사이클 대상에서 제외 (기존과 동일)
- 단가-only 저장: `cycleWeeks = []` (재고 무관, 기존 정책)
