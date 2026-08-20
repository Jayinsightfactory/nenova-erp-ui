# 작업 완료 보고 — 콜롬비아 배분 풀 선택·CW/GW 표시

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/2026-08-19_colombia-alloc-pool-selector.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-19 |
| 사용자 요청 | 층별 환율 뜻, APOLLO는 포워딩 업체이니 웹에서 콜카장알루/콜카장알루수국 선택, CW vs GW에 따라 배분 |
| 브랜치 | `cursor/profit-report-rule-alignment-0d71` |
| 커밋 | (푸시 후 기록) |
| 배포 | 미배포 — PR 검증 후 master 병합 시 Cafe24 배포. `IncludeHydrangea` 컬럼은 deploy.yml이 빌드 전 마이그레이션 적용 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 요청 분석, 구현, 테스트, 커밋/PR | — |
| **Claude Code** | 미사용 | — |
| **Codex** | 미사용 | — |
| **Cursor 직접** | git / 테스트 / PR | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 이전 슬라이스는 APOLLO 혼적을 자동으로 수국 풀에 넣었다. 사용자는 APOLLO가 포워딩 업체이며 화면에서 고르길 원했다.
2. **구현** — `WebColombiaWeekly.IncludeHydrangea`(0=콜카장알루, 1=콜카장알루수국), 그외통관비 반차수 select, CW/GW 배지.
3. **검증** — 순수 계산·계약·가드·빌드.
4. **마무리** — 커밋/PR 갱신.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `docs/migrations/2026-08-19_web_colombia_alloc_pool.sql` | `IncludeHydrangea FLOAT NULL` |
| `lib/colombiaFlowerClassification.js` | 콜카장알루/콜카장알루수국 라벨, `applyColombiaHydrangeaBoxes` |
| `lib/customsForwardingCalc.js` | 수국은 `includeHydrangea`일 때만 비율에 포함. `colombiaRatioMode` 배지 |
| `lib/customsForwarding.js` | schema `@4`, 저장 컬럼, 저장 플래그만으로 박스 병합 |
| `components/CustomsClearancePanel.js` | 반차수 select + CW/GW 배지 + 수국 미리보기 |
| `pages/api/sales/customs-clearance.js` | `allocPool`, `suggestedHydrangea`, `ratioMode` |
| `pages/api/sales/forwarding-clearance.js` | 같은 저장 플래그로 S 배분 |

---

## 사용자 확인 포인트

- 그외통관비 콜롬비아 1차/2차: 기본 **콜카장알루**. 수국까지 나누려면 **콜카장알루수국**을 고르고 저장.
- 배지: `CW 670 > GW 655 → CBM` 또는 `GW ≥ CW → 무게`.
- APOLLO 혼적이 있으면 힌트만 보인다. 자동으로 수국 풀을 켜지 않는다.
- 기존재고 원화는 전차수 금액(그때 환율)을 유지하고, 이번 입고만 이번 환율이다.

---

## 미완 / 다음

- 운영 DB에 `IncludeHydrangea` 컬럼은 배포 워크플로가 빌드 전에 적용한다. 로컬 GET은 마이그레이션 전이면 503 `MIGRATION_REQUIRED`.
- ERP 원장 WRITE 없음.
