# docs/work-reports — 옛 완료 보고 보관함

> 📦 **2026-11-12부터 이 폴더에 새 파일을 만들지 않는다.** 작업 기록은 저장소 맨 위 [`WORK_MEMORY.md`](../../WORK_MEMORY.md) 끝에 날짜·요약·검색어 줄로 남긴다(사장님 결정, 정본 [`docs/canon/CANON.md`](../canon/CANON.md) 4절). 긴 세부가 필요하면 [`docs/work-sessions/`](../work-sessions/)에 두고 `WORK_MEMORY.md` 항목에서 가리킨다.

## 이 폴더의 파일을 옮기거나 지우면 안 되는 이유

2026-11-12 전수 검색 결과, 아래가 이 폴더의 파일 경로를 그대로 가리킨다. 옮기면 근거 연결이 끊긴다.

- 계약 파일: `docs/contracts/*.json` 9개(중국 물량 보드, 견적 원가 수정, 견적 다음 차수 넘김, 수정 동시성, 경영 물량 보고, 농장 주간 보드, 주문 목록 연도 범위, 라움 손익 등)
- 테스트 기준값: `__tests__/fixtures/estimateOverflowCases.json`, `profit-report-22-27.json`, `profit-report-weeks-22-28.json`
- 코드 주석: `lib/estimateCostOnly.js`, `lib/shillaPnlParse.js`, `pages/estimate.js`, `__tests__/` 3개
- 스크립트: `scripts/profit-report-acceptance-harness.mjs`가 `2026-08-13_profit-report-weeks-22-28-acceptance.md`를 이 폴더에 다시 써 넣는다(수동 실행 도구. 이 한 파일은 예외로 계속 갱신될 수 있다)
- 생성 자료: `data/generated/full-development-history.json`

## 지난 기록 찾는 법

파일 이름이 `날짜_주제.md`다. 주제어로 파일 이름을 찾거나, `WORK_MEMORY.md`의 검색어 줄에서 먼저 찾는다.
