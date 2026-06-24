# 작업 완료 — 견적서 비고 단가 변경 내역 숨김

**일자:** 2026-06-24  
**관련:** [견적 인쇄·EXE 비고 세션](2026-06-24_session-estimate-print-fix-status.md), [`NENOVA_EXE_PRINT_DESCR_PATCH.md`](../NENOVA_EXE_PRINT_DESCR_PATCH.md)

---

## 증상

견적서 관리 비고(적요)에 단가 수정 시마다 운영 로그가 누적·표시됨.

```
차감단가 14000>12000
차감단가 12000>11500
```

대표: `[검역차감]` 행 — 단가 여러 번 조정 시 비고가 길어짐.

## 원인

`POST /api/estimate/update-cost` 가 **Estimate 전용 행**(차감 등) 단가 변경 시 `Estimate.Descr`에 `\n차감단가 {구단가}>{신단가}` 를 append.

- 웹 그리드는 `sanitizeEstimateDescrForDisplay` 로 숨기도록 되어 있었으나, **DB 원문**은 그대로 남음.
- nenova.exe 견적 화면·인쇄는 DB `Estimate.Descr` 를 필터 없이 표시.

## 조치

| 파일 | 내용 |
|------|------|
| `pages/api/estimate/update-cost.js` | `Estimate.Descr` 에 `차감단가` 로그 **미기록**. 이력은 API `changes[]` 만 |
| `pages/api/estimate/index.js` | `loadItems()` 반환 시 `sanitizeDescrTextForPrint` 로 운영 로그 제거 |
| `__tests__/estimateInvariants.test.js` | 다중 줄 `차감단가` · 실제 메모 유지 테스트 추가 |

표시 규칙(기존): `lib/estimateInvariants.js` — `isOperationalEstimateDescr`, `sanitizeDescrTextForPrint`

## 결과

| 경로 | 단가 변경 비고 |
|------|----------------|
| nenovaweb 견적서 그리드 | 미표시 ✅ |
| nenovaweb 견적 조회 API | 미표시 ✅ |
| nenovaweb 인쇄 (`formatEstimatePrintDescr`) | 미표시 ✅ (기존) |
| 이후 단가 수정 | DB `Estimate.Descr` 에 추가 안 됨 ✅ |
| **기존 DB에 쌓인 `차감단가`** | 웹 조회 시 필터됨. exe는 DB 원문 → 아래 정리 |

## 기존 DB 정리 (exe / 인쇄)

```http
GET  /api/dev/estimate-print-descr-cleanup?week=25-02&cust=거래처명
POST /api/dev/estimate-print-descr-cleanup  { "week": "25-02", "apply": true }
```

- `Estimate.Descr` · `ShipmentDetail.Descr` · `ShipmentDate.Descr` 에서 운영 로그만 제거.
- exe 근본 해결: dnSpy `FormPrintEstimate` — [`NENOVA_EXE_PRINT_DESCR_PATCH.md`](../NENOVA_EXE_PRINT_DESCR_PATCH.md)

## 검증

```bash
npm run test:estimate
```

## 미포함 (별도 이슈)

- `update-quantity.js` 의 `차감수량` append — 화면/API sanitize 로 숨김. DB 기록은 유지.
- `Estimate.Descr` 전체 길이 cap — 마스터 가이드 열린 항목 #15.

## 커밋

(미커밋 — 배포 시 `update-cost.js`, `index.js`, `estimateInvariants.test.js` 포함)
