# Nenovaweb 호환성 범위·작업 가드

최종 갱신: 2026-08-03

## 1. 이 저장소의 호환성 목표

`nenova-erp-ui`의 호환성 목표는 Google Play/Expo Android 빌드가 아니라
브라우저에서 동작하는 Nenovaweb과 같은 MSSQL을 사용하는 `nenova.exe`의
조회·저장 결과를 일치시키는 것이다.

- 대상: `https://nenovaweb.com`, Next.js/React 브라우저 UI, 공유 MSSQL 원장
- 비교 대상: `nenova.exe`의 View/Stored Procedure/Form 저장 순서
- 핵심 키: `OrderYear + OrderWeek + CustKey + ProdKey`
- Android 15/16 edge-to-edge, AAB, 16KB `.so`, Expo SDK 경고는 MOYI/네이티브
  앱 저장소의 범위다. 이 저장소에서 해당 경고를 이유로 Expo·Android 파일을
  변경하지 않는다.
- `/m` 경로는 Nenovaweb의 모바일 웹 화면일 뿐이며, 네이티브 앱 호환성 작업으로
  간주하지 않는다. 네이티브 앱 작업이 필요하면 별도 앱 저장소와 별도 계약으로
  분리한다.

## 2. 작업 분류와 부작용 표

| 작업 유형 | 읽는 원장 | 쓰는 원장 | nenova.exe 영향 | 필수 확인 |
|---|---|---|---|---|
| 웹 전용 설정 | 필요 범위의 ERP 원장 | 웹 전용 테이블만 | 없음 | 계약·스키마·write guard |
| 주문/출고/분배/재고/견적 | ViewOrder/ViewShipment 및 원장 | ERP 테이블/SP | 직접 영향 | dnSpy·read-only probe·downstream |
| 인쇄/엑셀 | ERP 조회 결과 | 파일 응답 | 저장 영향 없음 | 표시값과 원본 업무키 대조 |
| 모바일 웹 UI | 기존 API | 기존 계약 범위 내 | API 결과만 영향 | 브라우저 smoke·회귀 테스트 |
| Expo/Android 네이티브 | 이 저장소 범위 밖 | 이 저장소에 변경 금지 | 없음 | MOYI 저장소에서 별도 수행 |

현재 수입부 농장 결제일 설정은 `WebImportFarmPaymentDay`만 upsert하며,
`WarehouseMaster/Detail`, `Order*`, `Shipment*`, `ProductStock`, `Estimate`,
`WebProfitReport`를 변경하지 않는다. 선택 농장 필터와 엑셀 다운로드도 읽기
범위만 제한해야 한다.

## 3. ERP 기능 변경 고정 순서

1. `AGENTS.md`, `docs/ERP_FEATURE_CHANGE_CHECKLIST.md`,
   `docs/ERP_CHANGE_GUARD.md`, `docs/DB_STRUCTURE.md`를 읽는다.
2. `docs/NENOVA_DNSPY_CLI_WORKFLOW.md`에 따라 실제 EXE Form/Class/SQL과
   저장 순서를 확인하고 `docs/exe-golden/*.md`에 근거를 남긴다.
3. 동일 업무키의 운영 DB를 읽기 전용으로 대조하고 사용자 동작별
   `OrderDetail/ShipmentDetail/ShipmentDate/Stock/Estimate` 부작용 표를 작성한다.
4. 계약 JSON과 교차연도 fixture를 갱신한다.
5. 아래 검증을 통과한 뒤에만 커밋·배포한다.

```powershell
npm run test:erp-contract
npm run test:nenova-dnspy-evidence
npm run test:erp-manifest -- --changed-from HEAD^
npm run guard:erp-writes -- --changed-from HEAD^
npm run build
```

## 4. 오류 안내 원칙

호환성 가드는 사용자를 막기 위한 일반 오류가 아니라 다음 행동을 안내해야
한다. 예를 들어 확정 차수 단가 수정이면 “29-02 확정을 먼저 해제한 뒤 다시
저장할까요?”처럼 필요한 해제·재저장·재확정 단계를 제시하고, 음수재고면
부족 품목과 부족수량을 보여준 뒤 사용자의 명시적 보정 확인을 받아야 한다.
자동으로 전년도 주문을 재사용하거나 주문 0행을 만들어 오류를 숨기면 안 된다.

## 5. 배포 판정

검증 실패·dnSpy 근거 누락·연도 없는 Master scope·운영 DB read-only 대조 누락
상태에서는 배포하지 않는다. 배포 후에는 동일 업무키의 ViewOrder/ViewShipment,
견적 노출, 확정 매출, 농장 분배 원장을 브라우저 smoke와 함께 확인한다.
