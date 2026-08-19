# 작업 완료 보고 — 견적서 추가 품목등록 농장 제거·단가만 적용

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/YYYY-MM-DD_{slug}.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-19 09:20 |
| 사용자 요청 | 견적서 추가 품목등록에서 농장설정 제거, 업체 단가 리스트는 단가만 선택, 확정 차수는 풀고 수정 후 재확정 |
| 브랜치 | `fix/estimate-additional-batch-cycle` (origin/master `a95100a` 기준) |
| 커밋 | 진행 중 |
| 배포 | Cafe24 배포 예정 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 요청 확인, 견적 추가품목·단가·확정 사이클 경로 분석, 구현, 계약 테스트 | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — `OrderRegisterDistributeModal`이 농장 필수, 단가 옵션에 업체명을 앞에 두고, 확정 사이클은 이미 `runEditWithFixCycle`을 탐.
2. **구현** — origin/master 위에 견적 파일만 수술식 패치. 농장 UI/검증/전송 제거. 단가 선택은 `applyReferenceCostOnly`로 금액만 반영. 모달은 담기만, `pages/estimate.js`의 [수정 저장]이 수량·단가·추가품목을 한 사이클에 처리. master `adjust.js`의 농장 생략 보존을 유지하고 덮어쓰지 않음.
3. **검증** — `npm run test:estimate` 및 ERP 가드.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/estimateAdditionalProduct.js` | 농장 필수 제거, 단가 전용 적용 헬퍼 |
| `components/estimate/OrderRegisterDistributeModal.js` | 농장 UI 제거, 단가만 적용, 즉시 저장 대신 `onQueue` 담기 |
| `pages/estimate.js` | `pendingAdds` + [수정 저장] 한 사이클, 기존 수량 미변경 시 `skipFinalStockCalc` |
| `pages/api/estimate/additional-product-context.js` | 농장 후보 제거, `CustomerProdCost` 단가 원천, 응답에서 custKey 제거 |
| `pages/api/shipment/adjust.js` | `estimateAdditional` 플래그만 수신. master 농장 생략 보존 유지 |
| `docs/contracts/estimate-additional-product.json` | `shipmentFarm: preserve`, `priceSelection: cost-only` |
| `__tests__/estimateAdditionalProductContract.test.js` | 농장 불필요·단가 전용 회귀 |

---

## 검증 결과

```
estimate additional product: 20 passed, 0 failed
npm run test:estimate — pass
shipmentFarmContract / shipmentDownstreamImpactContract / shipmentPivotAdjustContract — pass
npm run test:nenova-dnspy-evidence — pass
npm run test:erp-manifest -- --changed-from HEAD^ — pass
npm run guard:erp-writes -- --changed-from HEAD^ — pass
```

---

## 사용자 확인 포인트

- 견적서관리 → 추가 품목등록: 농장 드롭다운이 없어야 함
- 업체 단가/참고단가 선택 시 화면 업체가 바뀌지 않고 단가 숫자만 채워져야 함
- 확정된 02차는 저장 시 해제 → 등록 → 재확정 로그가 보여야 함

---

## 추가 반영 (같은 날 후속)

- 추가 품목은 즉시 저장하지 않고 목록에 담음
- 수량·단가·추가 품목을 [수정 저장] 한 번에 확정해제→저장→재확정
- 기존 출고수량이 안 바뀌면 재확정 재고계산 생략 (이미 확정된 스냅샷 유지)

---

## 미완 / 다음

- 테스트 통과 후 커밋/PR/master 병합/Cafe24 배포
