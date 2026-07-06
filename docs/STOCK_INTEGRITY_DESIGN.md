# 재고 정합 설계 — 유령재고·이중재고 drift 재발 방지

> **최종 갱신:** 2026-06-25 (전체 차수 검증·진동 패턴 반영)  
> **사건:** [26-01 웹복구·잔량 정리](work-reports/2026-06-25_undo-web-recovery-26-01.md) · [25-01 음수 복구](work-reports/2026-06-24_negative-product-stock-repair.md)  
> **연계:** [출고 확정 exe 정합](SHIPMENT_FIX_EXE_RECONCILE.md) · [ERP 불변식](ERP_COMPAT_INVARIANTS_2026-06-04.md)

---

## 1. 왜 반복되는가

nenova는 **같은 품목에 재고가 두 갈래**로 존재한다.

```
┌─────────────────────┐     usp_ShipmentFix/Cancel      ┌──────────────────┐
│  Product.Stock      │ ◄──────────────────────────────│  nenova.exe 실시간 │
│  (live, SP ± 누적)   │                                │  재고 화면         │
└─────────┬───────────┘                                └──────────────────┘
          │  직접 UPDATE (웹복구 스크립트 등) ──► drift 위험
          │
          ▼
┌─────────────────────┐     prev + 입고 − 출고 + 조정   ┌──────────────────┐
│  ProductStock       │ ◄── usp_StockCalculation ────────│  차수별 잔량      │
│  (차수 스냅샷)       │                                │  피벗·26-1 잔량   │
└─────────────────────┘                                └──────────────────┘
```

| 실패 패턴 | 대표 증상 | 2026-06 사례 |
|-----------|-----------|--------------|
| **A. 웹복구 유령** | `StockHistory`에 `웹복구:Product.Stock→ProductStock` | 43품목, +1,665, 25-02 기록 → 26-1 전파 |
| **B. 차수 이월 유령** | 전주 `ProductStock`이 그대로 이월, `live`는 0 | 네덜란드 Sanguisorba ps=1700, live=0 |
| **C. live 과다** | `Product.Stock`만 팽창, 차수잔량은 정상 | 튤립 live=1110, ps=165 |
| **D. 확정 후 calc 누락** | `ShipmentDetail.isFix=1`인데 `ProductStock` 어긋남 | 25-01 카테고리 scoped fix |
| **E. 배치 스크립트 진동** | 한 스크립트가 고치면 다음이 되돌림 | sync → reconcile(잔량정리 삭제) → align(live=ps) → 가드 재발 |
| **F. live 전역 vs 차수 스냅샷 오검** | 과거 차수에 `liveGap` 검사 | 61차 전부 NG로 오판, 잘못된 bulk fix 유발 |
| **G. 가드 보정 후 align** | exe 확정 가능했으나 다시 차단 | `fix-guard-negatives` 직후 `align-live-to-ps`가 live를 ps로 되돌림 |
| **H. 음수 AfterValue 이력** | `StockHistory.AfterValue<0` | `sync-week-stock-to-live` live→ps 시 음수 ps 전파 |

**핵심:** A는 **금지 스크립트**로, B·C는 **차주(26-1)에 표시**되며 비고에 안 보일 수 있다. E·G는 **스크립트 실행 순서** 위반 시 반복된다.

---

## 2. 설계 원칙 (반드시 지킬 것)

### 2.1 단일 진실 공급원 (SoT)

| 작업 | SoT | 웹이 할 일 |
|------|-----|------------|
| 출고 확정/취소 | `usp_ShipmentFix` / `Cancel` | SP만 호출. 직접 `Product.Stock` UPDATE 금지 |
| 차수 잔량(`ProductStock`) | `usp_StockCalculation` | 카테고리 fix **후 차수 전체** 재계산 (`shipmentFixReconcile.js`) |
| 수동 재고조정 | `StockHistory` + SP | [§3.2](#32-수동-재고조정-규칙) 준수 |
| 음수 `Product.Stock` | **과출고·확정 불일치** 신호 | ProductStock 스냅샷으로 **맞추지 않는다** |

### 2.2 금지 (운영·개발 공통)

| 금지 | 이유 |
|------|------|
| `repair-negative-product-stock.js --apply` | 음수를 과거 `ProductStock`으로 올리면 **유령 재고** (2026-06-24 사고) |
| scoped fix 후 `usp_StockCalculation` 생략 | `ProductStock` / `StockMaster` drift |
| `Product.Stock`만 UPDATE하고 차수 재계산 생략 | live ↔ ps 분리 |
| `StockHistory`에 차수잔량·live **둘 다** 잘못된 delta 기록 | 26-1 네덜란드 1차 sync 실패 원인 |
| bulk unfix/fix 후 **probe 없이** 차주 업무 | 26-1 잔량 폭증 체감 지연 |
| `sync` 직후 `reconcile` (잔량정리 미보호) | sync가 만든 `*잔량정리:` 이력이 reconcile에서 삭제 → **진동** |
| `fix-guard-negatives` / `fix-exe-guard-adjust` 직후 `align-live-to-ps` | 가드용 live·수동보정이 ps=0으로 **되돌아감** |
| `StockHistory.AfterValue < 0` 기록 | exe·차수잔량에 음수 전파 (live→ps sync 시 특히 위험) |
| `Descr`에 `음수정리:` 사용 후 reconcile | `reconcile-week-remain`이 해당 이력 **삭제** → 보정 무효 |
| 전체 차수에 `live` vs `ProductStock` 비교 검증 | `Product.Stock`은 **전역 1값** — 과거 차수 liveGap은 항상 오탐 |
| 배치 복구 스크립트에 **짧은 exec 타임아웃** | 01-01만 해도 15분 초과 → 중간 상태로 DB 방치 |

### 2.3 허용 복구 사다리 (위에서만 아래로)

```
1. fix-parity-audit / probe-negative-stock-week     ← 상태 파악
2. POST /api/shipment/fix-reconcile (또는 probe-reconcile-week --apply)
3. bulk-refix-weeks (운영 판단, 대칭 깨짐 시만)
4. reconcile-week-remain → recalc-gap-products      ← 차수잔량 공식 정합 (§4.5)
5. sync-week-stock-to-live (차주 live↔ps gap, §4) — **1회만**, reconcile 전에 하지 말 것
6. fix-exe-guard-adjust (exe 가드만, §4.6)         ← align 금지
7. undo-web-recovery-stock (웹복구 이력 잔존 시만)

✗ repair-negative-product-stock.js --apply  ← 사다리에 넣지 않음
✗ fix-guard-negatives → align-live-to-ps    ← 가드 보정 되돌림
✗ sync → reconcile → sync 반복              ← 잔량 진동
```

---

## 3. 쓰기 경로 규칙

### 3.1 확정·취소 (`pages/api/shipment/fix.js`)

- `usp_ShipmentFix` / `Cancel` 호출 후 **항상** `reconcileWeekAfterScopedOperation()`
- 응답 `parity.exeAligned` 확인. `FIXED_PENDING_STOCK`이면 §4 probe

### 3.2 수동 재고조정 규칙

| 상황 | `StockHistory` | `Product.Stock` |
|------|----------------|-----------------|
| **차수잔량(ps)만 과다**, live 맞음 | `Before=ps`, `After=live`, delta=`live−ps` | `live` 유지 |
| **live만 과다**, ps 맞음 | **기록 없음** (차수 ledger 이미 맞음) | `ps`로 UPDATE |
| 사용자가 nenova/web에서 수동 조정 | 해당 차수 1회. `Descr`에 사유 | SP 후속 calc |
| **exe 확정 가드**(remain/productRemain&lt;0) 보정 | `Descr` = **`수동보정:차수잔량`** (reconcile이 삭제하지 않음) | `Before`/`After` = live 축, delta = 필요량 |

→ 구현: `scripts/sync-week-stock-to-live.js` (검증된 분기)  
→ 가드 보정: `scripts/fix-exe-guard-adjust.js` — **`음수정리:` 사용 금지** (reconcile 삭제 대상)

**AfterValue 규칙:** `StockHistory.AfterValue`는 **0 미만 금지**. live→ps 동기화 시 `afterVal = max(0, ps)`.

### 3.3 스크립트가 DB에 쓸 때

- `Descr`에 **`웹복구` 접두사 사용 금지** (과거 사고 키워드). 신규 sync는 `26-01잔량정리:` 등 명시적 라벨
- **`음수정리:` 접두사 사용 금지** — `reconcile-week-remain`이 일괄 삭제함. 수동 보정은 **`수동보정:차수잔량`**
- `ChangeID` = 운영 계정 (`nenovaSS3` 등), 배치는 로그에 건수·차수 기록
- `--apply` 전 **반드시** dry-run + `probe-week-stock-gaps.js` 샘플
- 일괄 복구(`fix-all-weeks-remain`, `fix-ng-weeks-remain`)는 subprocess **timeout=0** (무제한)

---

## 4. 차수 전환·주간 운영 체크리스트

### 4.1 확정·bulk 작업 직후 (같은 차수)

```bash
node scripts/probe-fix-parity-audit.mjs <week>
node scripts/probe-negative-stock-week.js 2026 <week>
```

- `negativeLiveCount` > 0 → **§2.3 사다리 2~4**만. `repair-negative-product-stock.js` 사용 금지 (§2.2)

### 4.2 신규 차수 오픈 후 (예: 25-02 → 26-01)

```bash
# dry-run
node scripts/probe-week-stock-gaps.js <new-week> --min=5
node scripts/probe-week-stock-gaps.js <new-week> --country=네덜란드 --min=5

# gap 있고 adj26=0 품목만
node scripts/sync-week-stock-to-live.js <new-week> --min=5        # dry-run
node scripts/sync-week-stock-to-live.js <new-week> --min=5 --apply
```

- `adj26 ≠ 0` (수동 조정) 품목은 **자동 스킵** — 의도적

### 4.3 웹복구 잔존 점검 (주 1회 또는 사고 후)

```bash
node scripts/probe-web-recovery-stock.js <week>
# cnt > 0 → undo-web-recovery-stock.js --apply
```

### 4.4 운영 차수(예: 26-01) 정합 파이프라인 — **고정 순서**

아래 순서를 바꾸거나 중간에 `align-live-to-ps`를 끼우지 않는다.

```bash
# 1) 검증 (운영 차수만 liveGap 검사)
node scripts/verify-all-weeks-stock.js --current=26-01 --min=1

# 2) 차수잔량 정합 (배치 잔량정리·음수정리 삭제 + 재계산)
node scripts/reconcile-week-remain.js 26-01 --apply

# 3) live↔ps gap (필요 시 1회, --include-manual 주의)
node scripts/sync-week-stock-to-live.js 26-01 --min=5 --apply

# 4) exe 확정 가드 (remain/productRemain<0)
node scripts/fix-exe-guard-adjust.js 26-01 --apply

# 5) psGap 잔여만 타깃 재계산 — align-live-to-ps 대신 사용
node scripts/recalc-gap-products.js 26-01 --apply

# 6) 재검증
node scripts/probe-exe-negative-guard.js 26-01
node scripts/verify-all-weeks-stock.js --current=26-01 --min=1
```

| 단계 | 하면 안 되는 것 |
|------|----------------|
| 2 이후 | `align-live-to-ps` (가드·수동보정 live를 ps로 덮음) |
| 3 이후 | `reconcile-week-remain` (방금 만든 `*잔량정리:` 삭제) |
| 4 이후 | `align-live-to-ps` |
| 일괄 | `fix-week-remain-pipeline` 안의 마지막 `align-live-to-ps` — 가드 보정 직후면 **스킵** |

래퍼: `scripts/fix-week-remain-pipeline.js` — 운영 차수 일괄 시 위 2~3을 묶음. **가드 보정(4)은 별도 실행.**

### 4.5 전체 차수 검증·복구 (주 1회 또는 사고 후)

```bash
# 검증 — liveGap은 --current 운영 차수에만 의미 있음
node scripts/verify-all-weeks-stock.js --current=26-01 --min=1

# NG 차수만 (61차 전부 돌리지 말 것 — DB 부하·타임아웃)
node scripts/fix-ng-weeks-remain.js --apply --current=26-01
```

| 검사 항목 | 적용 범위 | 통과 기준 |
|-----------|-----------|-----------|
| **psGap** | 모든 차수 | `prev+입고−출고+조정` = `ProductStock` |
| **liveGap** | **운영 차수만** (`--current`) | `Product.Stock` = 해당 차수 ps |
| **negPs** | 모든 차수 | 차수잔량 ≥ 0 |
| **batch** | 모든 차수 | `%잔량정리:%` StockHistory = 0 |
| **guard** | 운영·확정 차수 | exe `remain`/`productRemain` ≥ 0 |

### 4.6 exe 확정 차단 해소 (`fix-exe-guard-adjust`)

- **remain&lt;0** (차수 공식 과출고): `StockHistory` +delta, `Descr`=`수동보정:차수잔량`
- **productRemain&lt;0** (live 부족): 동일 Descr로 live 축 보정 후 `usp_StockCalculation`
- 보정 후 **`align-live-to-ps` 실행 금지** — ps가 아직 0이면 live를 다시 0으로 만듦
- `fix-guard-negatives`는 `Product.Stock`만 올리는 임시 방편; **반드시 4.4의 4단계로 대체·보완**

---

## 5. 진단·복구 스크립트 매트릭스

| 스크립트 | 용도 | apply |
|----------|------|-------|
| `verify-all-weeks-stock.js` | 전체 차수 psGap·negPs·batch·guard (+ 운영 차수 liveGap) | 읽기 전용 |
| `probe-week-stock-gaps.js` | live vs ps vs 차수 공식 (단일 차수) | 읽기 전용 |
| `probe-exe-negative-guard.js` | exe 확정 가드 잔여 품목 | 읽기 전용 |
| `probe-web-recovery-stock.js` | `웹복구` StockHistory | 읽기 전용 |
| `classify-live-ps-gap.js` | 국가별 phantom/live bloat 분류 | 읽기 전용 |
| `reconcile-week-remain.js` | `*잔량정리:`·`음수정리:` 삭제 + 재계산 | `--apply` |
| `recalc-gap-products.js` | psGap/liveGap 품목만 `usp_StockCalculation` | `--apply` |
| `sync-week-stock-to-live.js` | §3.2 규칙으로 동기화 (`afterVal≥0`) | `--apply` |
| `fix-exe-guard-adjust.js` | exe 가드 — `수동보정:차수잔량` 이력 | `--apply` |
| `fix-ng-weeks-remain.js` | 검증 NG 차수만 reconcile+recalc | `--apply` |
| `fix-week-remain-pipeline.js` | reconcile→sync→align 래퍼 | `--apply` (가드 보정 **별도**) |
| `undo-web-recovery-stock.js` | 웹복구 43건형 롤백 | `--apply` |
| `rollback-sync-week-stock.js` | 잘못된 `26-01잔량정리` 롤백 | `--apply` |
| `probe-reconcile-week.mjs` | 차수 `usp_StockCalculation` | `--apply` |
| `align-live-to-ps.js` | live←ps 강제 | `--apply` — **§4.4 가드 보정 후 금지** |
| `fix-guard-negatives.js` | live만 올리는 임시 가드 해소 | `--apply` — `fix-exe-guard-adjust` 우선 |
| `fix-all-negative-stock.js` | 음수 live·AfterValue&lt;0 이력 | `--apply` — 운영 차수만, 후속 reconcile 필수 |
| `repair-negative-product-stock.js` | ~~ProductStock→live 음수 맞춤~~ | **🚫 운영 금지** |

---

## 6. 코드·UI 재발 방지 (현재·권장)

### 6.1 구현됨 ✅

| 위치 | 내용 |
|------|------|
| `lib/shipmentFixReconcile.js` | scoped fix 후 차수 전체 calc |
| `lib/shipmentFixGuards.js` | 부분 카테고리 fix 차단, 하위 차수 검사 |
| `pages/estimate.js` | exe 정합 열, 재고 정합 복구 버튼 |
| `sync-week-stock-to-live.js` | live↔ps 이중 기록 방지 분기, live→ps 시 `max(0,ps)` |
| `verify-all-weeks-stock.js` | 운영 차수 liveGap 분리 검증 |
| `fix-exe-guard-adjust.js` | exe 가드 — reconcile이 삭제하지 않는 수동보정 |

### 6.2 권장 (미구현 ⏸)

| 항목 | 효과 |
|------|------|
| `repair-negative-product-stock.js` 실행 시 **exit 1 + README 링크** (apply 차단) | A 패턴 원천 차단 |
| 차주 첫 로그인 / 견적 화면 **gap>0 배너** (`probe-week-stock-gaps` API) | B·C 조기 발견 |
| GitHub Actions 주간 `verify-all-weeks-stock.js --current=<운영차수>` (NG 시 실패) | E·F·G 조기 발견 |
| `bulk-refix-weeks.mjs` 종료 훅 → 자동 `probe-week-stock-gaps` | D 후속 점검 |
| `fix-week-remain-pipeline`에서 가드 보정 후 **align 단계 제거** | G 패턴 코드 차단 |

---

## 7. 불변식 보강 (재고)

기존 [ERP_COMPAT_INVARIANTS](ERP_COMPAT_INVARIANTS_2026-06-04.md)에 더해:

| # | 불변식 |
|---|--------|
| R1 | `Product.Stock` 음수는 **복구 신호**이지 ProductStock 스냅샷 동기화 대상이 아니다 |
| R2 | `StockHistory(OrderWeek=W)`의 delta는 **해당 차수** `ProductStock` 공식에만 합산된다 — 타 차수 비고에 안 보일 수 있음 |
| R3 | live↔ps 수정 시 **한 축만** 쓴다: ps 과다→History+live, live 과다→Product.Stock만 |
| R4 | 수동 조정(`adj26≠0`) 품목은 배치 sync에서 **절대 덮어쓰지 않는다** |
| R5 | 확정·bulk·음수복구 스크립트 실행 후 **probe 로그**를 남긴다 |
| R6 | `StockHistory.AfterValue`는 **0 미만이면 안 된다** — live→ps sync 포함 |
| R7 | `liveGap` 검증은 **운영 차수(`--current`)에만** 적용한다 — `Product.Stock`은 전역 1값 |
| R8 | `sync` → `reconcile` → `sync` **연쇄 실행 금지** — `*잔량정리:` 이력이 삭제되며 진동 |
| R9 | exe 가드 보정은 `Descr`=`수동보정:차수잔량`; `음수정리:`는 reconcile이 삭제한다 |
| R10 | 가드·수동보정 직후 `align-live-to-ps` **금지** — live를 ps로 되돌려 확정 재차단 |

---

## 8. 사건 타임라인 (참고)

| 일자 | 이벤트 | 조치 |
|------|--------|------|
| 2026-06-23~24 | 카테고리 bulk unfix/fix, `repair-negative --all` | 음수 0이나 **웹복구 43건** |
| 2026-06-25 | 26-1 잔량 급증 신고 | `undo-web-recovery` + NL/전체 `sync-week-stock-to-live` |
| 2026-06-25 | 전체 61차 검증·복구 | sync↔reconcile↔align **진동** 확인, §4.4~4.6·R6~R10 추가 |
| 2026-06-25 | 본 설계 문서 | 재발 방지 절차 고정 |

---

## 9. 작업 전 읽기 순서 (재고 건드릴 때)

```
1. 본 문서 §2 금지·§2.3 사다리·§4.4 파이프라인 순서
2. SHIPMENT_FIX_EXE_RECONCILE.md §4 (4.4는 🚫 참고만)
3. 작업 후 §4.1·§4.5 체크리스트 실행
4. work-reports/2026-06-25_undo-web-recovery-26-01.md — 실제 수치
```

---

## 10. 관련 문서

- [SHIPMENT_FIX_EXE_RECONCILE.md](SHIPMENT_FIX_EXE_RECONCILE.md)
- [NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md](NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md) §H·§K
- [WEB_VS_ERP_CONFLICTS.md](WEB_VS_ERP_CONFLICTS.md) — 이중 재고
- [PRE_WORK_CONFLICT_CHECK_2026-05-25.md](PRE_WORK_CONFLICT_CHECK_2026-05-25.md)
