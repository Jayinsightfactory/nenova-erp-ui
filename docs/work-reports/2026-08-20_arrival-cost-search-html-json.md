# 작업 완료 보고 — 도착원가 품목검색 HTML JSON 오류

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 18:00 |
| 사용자 요청 | 품목검색시 Unexpected token '<', "<html> <h"... is not valid JSON |
| 브랜치 | fix/arrival-cost-search-html-json |
| 커밋 | (푸시 후 기록) |
| 배포 | (PR merge 후 Cafe24) |

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor 직접** | 원인 분석, 목록 SQL 경량화, HTML 응답 파싱, 테스트·build, commit/PR/배포 | — |

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 화면 오류는 `res.json()`이 nginx 502 HTML을 파싱해서 난 메시지. 품목 검색 GET이 `l.*`(RawJson)와 행마다 `OrderDetail` COUNT를 돌려 타임아웃된 것으로 판단.
2. **구현** — 목록 SELECT에서 RawJson 제외. 품목/농장 검색 중에는 사용량 OUTER APPLY를 0으로 대체. 화면은 `parseJsonResponse`로 HTML을 한국어 오류로 변환.
3. **검증** — arrivalCost 계약 테스트, `test:erp-contract`, dnSpy evidence, write guard, `npm run build`.
4. **마무리** — 도착원가 관련 파일만 커밋·PR·배포.

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/arrivalCost.js` | 명시 컬럼 SELECT, 검색 시 OrderDetail 사용량 스캔 생략 |
| `pages/arrival-cost.js` | `parseJsonResponse`로 HTML 502 안내 |
| `pages/api/arrival-cost/index.js` | BigInt JSON 직렬화 방어 |
| `docs/contracts/arrival-cost.json` | 검색 계약 갱신 |
| `__tests__/arrivalCost*.test.js` | RawJson/HTML 파싱 회귀 |

## 검증 결과

```
npm run test:erp-contract: pass
npm run test:nenova-dnspy-evidence: pass
npm run test:erp-manifest -- --changed-from origin/master: pass
npm run guard:erp-writes -- --changed-from origin/master: pass
npm run build: pass
```

검색은 SELECT만. Order/Shipment/Estimate/Stock 보존.

## 사용자 확인 포인트

- 도착원가에서 `화이트` 등 품목 검색 시 JSON 파싱 오류 없이 결과가 나와야 함
- 서버가 잠깐 죽으면 `서버 연결 오류(502)`처럼 읽히는 안내가 나와야 함

## 미완 / 다음

- Cafe24 배포 후 운영 화면에서 품목 검색 확인
