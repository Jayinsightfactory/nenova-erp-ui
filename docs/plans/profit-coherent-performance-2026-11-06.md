# 최근 손익 지연 진단 (앱·원장 변경 없음)

운영42 XLSX는2.5초 성공했으나 후속독립검산이120초 timeout, 44는최초본표가120초내완료되지않았다. 이는 아직 HTTP오류/전송중단/서버계산지연 중 어느것인지 확정하지 못했다. PM2 restart266/uptime05:36:34Z와배포시각의관계도현재설정만으로원인을단정하지않는다.

승인된진단만수행:

- 기존 profit-download-smoke workflow의 `readonly_api=true`: context→선택연도/차수 main GET 각1회, 전체180초deadline, Chrome/XLSX/output/audit/retry 없음. HTTPstatus/body.code/elapsed/financialbasis/outcome만로그. 토큰·원자료·비고·예외본문/stack 금지.
- 기존 deploy workflow diagnose_performance_only의 runtime script에 PM2 max_memory_restart/watch유무·개수/cron_restart/auto-restart/delay만익명허용필드로추가. 전체환경·watch경로·비밀값 출력금지. PM2설정변경/서비스restart/재배포없음.
- 앱금융source/API/DB/수식/조회정책 변경0. 원인확정후성능보완은 별도승인/검증대상이다. 사용자화면/업무순서 변경없으므로새가이드해당없음.

우선 `profit-download-smoke.yml --ref codex/profit-coherent-performance readonly_api=true year=2026 week=44` 한개만실행한다. main이실패하면출력요청을추가하지않는다. 기존독립검산timeout과본표조회진단을분리한다. script/workflow 및privacy/deadline/교차연도양성·반례 대상검사를수행한다. 운영실행결과는부모가추가한다.
