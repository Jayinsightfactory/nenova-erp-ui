# 작업 완료 보고 — 호텔+미우 합산 저장 후 주문등록

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 09:50 |
| 사용자 요청 | 한 번 입력에 두 번 추가됨. 주문등록 무반응. 업체 먼저 저장하고 1합산/2합산으로 쌓은 뒤 주문등록 |
| 브랜치 | feat/hotel-miu-draft-flow |
| 커밋 | (PR 병합 시 기록) |
| 배포 | 검증 후 Cafe24 |

## AI 구성

| 담당 | 역할 |
|------|------|
| Cursor | 분석·구현·검증·커밋/PR/배포 |

## 원인

- 붙여넣기 핸들러가 페이지와 왼쪽 칸에 둘 다 붙어 같은 이미지가 두 번 들어감.
- 업체를 고르지 않으면 주문등록이 막히는데 안내가 화면 맨 아래라 반응이 없는 것처럼 보임.
- 입력하자마자 주문을 쓰려 해서, 업체 이름 아래 합산을 쌓는 흐름이 없었음.

## 작업 흐름

1. 붙여넣기 한 번만, 1.5초 잠금.
2. 업체를 먼저 고른 뒤 품목을 넣고 **N합산으로 저장**(웹 DRAFT, 주문 원장 없음).
3. 1합산 · 2합산을 나란히 표시한 뒤 **주문등록 (더하기)** 가 합친 수량만 주문에 가산.
4. 계약·테스트·빌드 후 PR 병합·Cafe24 배포.

## 변경 요약

| 파일 | 내용 |
|------|------|
| `pages/sales/shilla-miu-board.js` | 업체 먼저, 합산 저장, 1합산/2합산 표시, 마지막에 주문등록 |
| `pages/api/sales/hotel-miu-intake.js` | recordBatch 기본 DRAFT, markRegistered |
| `lib/hotelMiuIntake.js` | DRAFT/REGISTERED 헬퍼, 합산 병합 |
| `docs/contracts/hotel-miu-intake.json` | SAVE_DRAFT_BATCH 추가 |
| `__tests__/hotelMiuIntake.test.js` | 붙여넣기 1회·DRAFT 흐름 검사 |

## 부작용 행렬

| 동작 | Order | Shipment | Web |
|------|-------|----------|-----|
| 이미지/텍스트 분석 | 보존 | 보존 | overlay 읽기 |
| N합산 저장 | 보존 | 보존 | DRAFT INSERT |
| 주문등록 (더하기) | OrderDetail +delta | 보존 | DRAFT → REGISTERED |
| DRAFT 합산 수정 | 보존 | 보존 | 라인 UPDATE |
| 주문반영 합산 수정 | 서명 delta | 보존 | 라인 UPDATE |

## 검증 결과

```
node __tests__/hotelMiuIntake.test.js
node __tests__/shillaMiuBoard.test.js
npm run test:ui-layout
npm run test:nenova-dnspy-evidence
node scripts/check-erp-contract-manifest.mjs --changed-from origin/master
node scripts/check-erp-write-contracts.mjs --changed-from origin/master
npm run build
```

모두 통과.

## 사용자 확인 포인트

1. 업체를 먼저 검색·지정한다.
2. 이미지 한 번 붙여넣으면 이번 입력에 한 번만 들어간다.
3. 미매칭은 품목 매칭 후 **N합산으로 저장**.
4. 1합산 / 2합산이 나란히 보인 뒤 **주문등록 (더하기)**.
5. 안내 문구는 화면 위쪽에 뜬다.
