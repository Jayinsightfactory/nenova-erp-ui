# 작업 기록 — 2026-06-16 세션

**일자:** 2026-06-16  
**목적:** 재고 이상 복구 · 견적 비고(EXE) 정리 · 주문 즐겨찾기 등록 시 업체 변경

> 다음 작업 시작 전 **체크리스트**는 문서 맨 아래 「다음 작업 시 확인」 참고.

---

## 1. 26-02 재고 복구 (유령재고)

### 증상
- NENOVA.EXE 재고관리에서 26-02 차수에 갑자기 생성된 재고
- 25-02 마감은 정상이었음

### 원인
- 잘못된 `scripts/fix-26-02-live-remain.js`가 103품목 `live=0` 처리 → 롤백 필요

### 조치 (운영)
| 단계 | 명령/작업 | 결과 |
|------|-----------|------|
| 롤백 | `node scripts/rollback-26-02-live-remain.js --apply` | 잘못된 live=0 복구 |
| 스크립트 삭제 | `fix-26-02-live-remain.js` 제거 | 재실행 방지 |
| 동기화 | `node scripts/sync-week-stock-to-live.js 26-02 --min=1 --no-out-guard --apply` | 11건 반영 |
| 수동조정 | Pink Mondial 등 5건 | 유지(의도적 조정) |

### 코드 변경
- `scripts/sync-week-stock-to-live.js` — **`--no-out-guard`** 옵션 추가 (출고 대비 live 부족 시 ps=0 내리기 우회)

### 검증
- 유령재고 0건
- 수동조정 5건 유지 확인

---

## 2. 네덜란드 25-01 유령재고

### 증상
- 네덜란드 품종에서 전차수 재고가 비정상 표시
- 25-01(25차) `prev=0`, 입출고 없이 `ps>0` 패턴 — 중국과 동일

### 조치
```bash
node scripts/recalc-gap-products.js --country=네덜란드 --apply
# 25-01 → 26-02 연쇄 적용
```

### 진단 스크립트
- `scripts/probe-nl-week-detail.js`
- `scripts/probe-stock-by-country-flower.js`

---

## 3. 25차(25-01) 전 품종·전 국가 복구

### 요청
- 중국장미/중국기타 등 25차 문제 → **전 품종 25차 복구**

### 조치
`scripts/recalc-gap-products.js` 전 국가 연쇄:

| 차수 | 처리 건수 | gapsAfter |
|------|-----------|-----------|
| 25-01 | 80 | 0 |
| 25-02 | 25 | 0 |
| 26-01 | 68 | 4 |
| 26-02 | 29 | 4 |

### 참고
- 25-01: 유령 29→0, 중국장미 유령 6→0
- 26-02 잔여 4건: **음수 차수잔량(수동조정, live=0)** — 정상으로 판단

### 진단 스크립트
- `scripts/probe-week25-summary.js`
- `scripts/probe-china-flower-stock.js`
- `scripts/probe-stock-by-flower.js`

---

## 4. 견적서 검역차감 비고 — EXE 표시 제거

### 증상
- EXE 견적서 관리에 `차감수량 -1>-2...` 비고가 계속 표시
- 웹은 `sanitizeEstimateDescrForDisplay`로 숨기지만 EXE는 `Estimate.Descr` 원문 표시

### 원인
- `pages/api/estimate/update-quantity.js`가 수량 변경 시 `Descr`에 `차감수량` append

### 조치

| # | 파일 | 내용 |
|---|------|------|
| 1 | `pages/api/estimate/update-quantity.js` | Estimate 수정 시 `Descr` append **제거** |
| 2 | `scripts/cleanup-estimate-deduction-descr.mjs` | DB 기존 데이터 정리 (24-01 2건 등) |
| 3 | `docs/migrations/2026-06-16_estimate_deduction_descr_trigger.sql` | `fn_SanitizeEstimateDescr` + `tr_Estimate_SanitizeDescr` |
| 4 | `scripts/apply-estimate-descr-trigger.mjs` | 트리거 적용 스크립트 |
| 5 | `__tests__/estimateInvariants.test.js` | 연속 붙임 케이스 테스트 추가 |
| 6 | `docs/NENOVA_EXE_PRINT_DESCR_PATCH.md` | FormEstimateView dnSpy 패치 가이드 갱신 |

### DB 트리거 (미적용 시)
```bash
node scripts/apply-estimate-descr-trigger.mjs
# 또는 docs/migrations/2026-06-16_estimate_deduction_descr_trigger.sql 수동 실행
```

### EXE 잔여
- 트리거로도 안 잡히는 화면이 있으면 `docs/NENOVA_EXE_PRINT_DESCR_PATCH.md` dnSpy 패치 검토

---

## 5. 주문 즐겨찾기 — 등록 시 업체 검색·변경

### 요청
- 즐겨찾기 저장 후 **등록대상 차수**에 주문등록할 때
- 업체 검색해서 **다른 업체명**으로도 주문등록 가능하게

### 변경 파일
- **`pages/orders/paste-template.js`** (주문 즐겨찾기 큰 창 — `paste.js`의 `openTemplateWindow`로 열림)

### 구현 요약
| 항목 | 내용 |
|------|------|
| `RegisterCustomerPicker` | `/api/customers/search` 검색, 드롭다운 선택 |
| `registerCust` state | 즐겨찾기 `draft.custKey`와 분리 — 등록 전용 |
| `syncRegisterCust()` | 즐겨찾기/원본 주문 로드 시 기본값 동기화 |
| UI | 등록대상 차수 옆 「등록 업체」 + 검색창 |
| 변경 표시 | 원본 업체명 배지 + 「원본으로」 버튼 |
| `registerDraft()` | `registerCust.custKey`로 POST, 확인/검증 메시지도 변경 업체 기준 |

### 사용 흐름
1. 즐겨찾기 또는 원본 주문 불러오기 → 기본 등록 업체 = 저장된 업체
2. 「등록 업체」 검색창에서 다른 업체 선택
3. 등록대상 차수 입력 → **주문등록**

### 미반영
- `pages/orders/paste.js` 내 `registerTemplateDraft` — UI에서 호출 안 함(레거시). 실사용은 `paste-template.js`만.

### 테스트 (수동)
- [ ] 즐겨찾기 불러온 뒤 다른 업체 검색·선택
- [ ] 확인 다이얼로그에 선택 업체명 표시
- [ ] 등록 후 전산 조회 일치
- [ ] 「원본으로」 클릭 시 즐겨찾기 저장 업체 복귀

---

## 변경·추가 파일 목록 (코드)

```
pages/orders/paste-template.js          # RegisterCustomerPicker, registerCust
pages/api/estimate/update-quantity.js   # Descr append 제거
scripts/sync-week-stock-to-live.js      # --no-out-guard
scripts/rollback-26-02-live-remain.js   # 롤백용 (신규)
scripts/recalc-gap-products.js          # gap recalc (신규/운영)
scripts/cleanup-estimate-deduction-descr.mjs
scripts/apply-estimate-descr-trigger.mjs
docs/migrations/2026-06-16_estimate_deduction_descr_trigger.sql
__tests__/estimateInvariants.test.js
docs/NENOVA_EXE_PRINT_DESCR_PATCH.md
```

---

## Git / 배포 상태 (2026-06-16 기준)

- **미커밋** — 위 파일 다수 로컬 변경·신규 (`git status` 확인 필요)
- 최근 커밋 HEAD: `bf3eb35` (견적 인쇄 Excel 등 — **오늘 세션 작업과 별개**)
- **배포 여부 미확인** — paste-template 업체 변경, 견적 Descr, 재고 스크립트는 운영 반영 전 검토 필요

---

## 다음 작업 시 확인 (체크리스트)

### 배포·커밋
- [ ] `paste-template.js` 업체 변경 기능 커밋·배포
- [ ] `update-quantity.js` Descr append 제거 배포
- [ ] 견적 Descr DB 트리거 운영 DB 적용 여부 (`apply-estimate-descr-trigger.mjs`)
- [ ] `cleanup-estimate-deduction-descr.mjs` 잔여 건 없는지 재확인

### 재고
- [ ] 26-02 전 품종·국가 스팟 체크 (유령재고 재발 없음)
- [ ] 26-02 음수 4건 — 수동조정 의도 확인만 (추가 조치 불필요 가능)
- [ ] `sync-week-stock-to-live --no-out-guard` 사용 시 주의사항 문서화 여부

### EXE
- [ ] EXE 견적서 관리에서 `차감수량`/`차감단가` 비고 사라졌는지 확인
- [ ] 필요 시 `NENOVA_EXE_PRINT_DESCR_PATCH.md` FormEstimateView 패치

### 주문 즐겨찾기
- [ ] 운영에서 다른 업체로 등록 E2E 테스트
- [ ] 즐겨찾기 **저장** 데이터는 원본 업체 유지되는지 확인

### 기타 (이전 세션 잔여)
- [ ] 견적 Excel·체크박스 등 로컬 미커밋 변경 정리 여부
- [ ] `docs/STOCK_INTEGRITY_DESIGN.md` — `repair-negative-product-stock.js --apply` 운영 금지 준수

---

## 관련 문서

- [work_history.md](../work_history.md)
- [STOCK_INTEGRITY_DESIGN.md](../STOCK_INTEGRITY_DESIGN.md)
- [SHIPMENT_FIX_EXE_RECONCILE.md](../SHIPMENT_FIX_EXE_RECONCILE.md)
- [NENOVA_EXE_PRINT_DESCR_PATCH.md](../NENOVA_EXE_PRINT_DESCR_PATCH.md)
- [2026-06-16_shipment-fix-exe-reconcile.md](2026-06-16_shipment-fix-exe-reconcile.md)
