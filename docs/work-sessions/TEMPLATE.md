# 작업 세션 보고서 — {TASK-ID}

## 기본정보

| 항목 | 내용 |
|---|---|
| 작업 ID | {TASK-ID} |
| 담당 세션 | |
| 사용자 요청 | |
| 브랜치 | |
| Worktree | |
| 상태 | PLANNED |
| 시작일 | |

## 질문 → 답변 (필수)

대화 순서대로 적는다. 코드 전체가 아니라 결정과 결과만.

### 1. {시각} — {짧은 제목}

**Q.**

**A.**

**결과.** PR / 파일 / 미배포

## 목적

-

## 허용 범위

### 수정 가능한 파일

-

### 읽기/쓰기 DB 범위

-

### 수정 금지

-

## 선행 근거

- [ ] AGENTS.md
- [ ] .claude/CLAUDE.md
- [ ] docs/ERP_FEATURE_CHANGE_CHECKLIST.md
- [ ] docs/ERP_CHANGE_GUARD.md
- [ ] docs/DB_STRUCTURE.md
- [ ] 관련 docs/contracts/*.json
- [ ] 관련 dnSpy Form/Class/SP
- [ ] read-only DB probe

## Side-effect matrix

| 사용자 동작 | Order* | Shipment* | Warehouse* | Stock* | Estimate | Web 전용 |
|---|---|---|---|---|---|---|
| 조회 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 |
| 저장 | | | | | | |

## 구현 내용

-

## 검증

### 정적/계약 테스트

~~~text

~~~

### 실제 테스트

| 대상 | 연도 | 차수 | 업체 | 품목 | 결과 |
|---|---:|---:|---|---|---|
| 웹 | | | | | |
| nenova.exe | | | | | |
| MOYI | | | | | |

### 재조회 비교

- [ ] ViewOrder
- [ ] ViewShipment
- [ ] ShipmentDate
- [ ] ShipmentFarm
- [ ] ProductStock
- [ ] StockHistory
- [ ] Estimate
- [ ] WebProfitReport

## 종료 보고

### 변경 파일

-

### 남은 문제

-

### 다음 세션에 전달

-

