# ops/ 스크립트 인덱스 (초안)

> 전체 청사진: [BLUEPRINT_WHITE_LABEL_ERP.md](BLUEPRINT_WHITE_LABEL_ERP.md)  
> 목표: `scripts/` → `ops/{diagnostics,repair,maintenance,archive}/` 이전

## 분류 기준

| 등급 | 설명 | 배포 |
|------|------|------|
| probe | 읽기 전용 DB/전산 진단 | 제외 |
| repair | 데이터 수정 (`--apply` 필요) | 제외, 승인 필수 |
| sync | live·ProductStock·차수 동기화 | 제외 |
| bulk | 대량 fix/unfix/recalc | 제외 |
| test | `__tests__` 또는 `npm run test:*` | CI 포함 |

## 운영 금지 (STOCK_INTEGRITY_DESIGN)

- `repair-negative-product-stock.js --apply` — 웹복구 유령재고 유발 이력

## 자주 쓰는 유지보수

| 스크립트 | 목적 | apply |
|----------|------|-------|
| `recalc-gap-products.js` | 차수 gap + live 동기화 | `--apply` |
| `sync-week-stock-to-live.js` | ProductStock → live | `--apply` |
| `probe-week25-summary.js` | 차수별 gap 요약 | 읽기만 |
| `rollback-26-02-live-remain.js` | 잘못된 live fix 롤백 | `--apply` |

## 정리 예정

- `probe-*` 100개+ → 주차·사건별 `ops/archive/YYYY-MM/` 이동
- `lib/db.js` 미사용 스크립트 → 통합 또는 삭제 후보 목록 작성

*본 파일은 Phase 0 산출물. 스크립트 일괄 이동 시 표 갱신.*
