# AGENTS.md — nenova-erp-ui (네노바웹 ERP) — Codex/Claude 공용

먼저 읽기: `.claude/CLAUDE.md`(프로젝트 규칙·체크리스트), 루트 `CLAUDE.md`(DB 규칙), `docs/NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md`, `docs/DB_STRUCTURE.md`. 전역 규칙은 `~/.codex/AGENTS.md`.

## 이 저장소의 함정
- **로컬 체크아웃(`C:\Users\USER\nenova-erp-ui`)은 origin/master보다 수백 커밋 뒤.** 그 위에 커밋하면 남의 기능 삭제로 잡힌다. 수정은 항상 `git worktree add ../nw-<이름> -b <브랜치> origin/master` → PR. push 전 `git diff origin/master --stat` 눈으로 확인.
- Windows CRLF: `git -c core.autocrlf=false commit`. 머지 전 `--ignore-space-at-eol`로 전 줄 변경 아님 확인.
- 새 API/`pages/api/**`·주문·출고·견적·재고 변경은 `docs/contracts/*.json` 계약 등록 필수(`scripts/check-erp-contract-manifest.mjs`), `npm run test:erp-contract`·`guard:erp-writes` 통과. exe-golden(`docs/exe-golden`) 산식·수식 변경 금지.
- DB 스키마 변경은 마이그레이션 SQL 제안만(사용자가 SSMS 실행). 웹 전용 테이블/파일만 쓰기. ERP 원장(OrderDetail·ShipmentDetail 등) 쓰기는 계약 범위 안에서만.
- 빌드는 `next build --webpack` 고정(Turbopack 금지). 배포는 master push → GitHub Actions → Cafe24 pm2.
- 차수 수정은 `verify:week` 전후 검증. 분배 정답은 엑셀 물량표. 견적=ShipmentDate.EstQuantity(>0), 판매현황 금액은 저장 `sd.Amount`.
- 은행: 신한 API 코드 `lib/shinhanApi.js`(키 미설정 시 비활성). 하나은행 API는 자격 부결. 업무 드라이브 인보이스↔엑셀 짝 `lib/workDrivePairs.js`.

## 검증
- 배포 후 `https://nenovaweb.com/api/ping` 200, 버전 배지 = 커밋 해시.
