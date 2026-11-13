# 운영 화면 콘솔·실패요청 점검 (읽기 전용)

`node scripts/ops-console-check.mjs --paths login --chrome "C:/Program Files/Google/Chrome/Application/chrome.exe"`

- 하는 일: 공개 화면을 열어 콘솔 오류(error)와 실패한 요청(4xx/5xx)을 모으고 화면을 캡처한다. report.json + png 가 `data/runtime/ops-console-check/<시각>/` 에 남는다.
- 안전선: 클릭·입력·저장 도구는 코드에서 호출 불가(허용 목록 5개만). 접속 허용 주소는 `--base` 도메인 하나. 구글 통계·CrUX 전송 끔. 로그인 화면 뒤 업무 화면은 다루지 않는다(미검증 영역).
- 종료코드: 0 이상없음 / 1 오류·실패 발견 / 2 점검 자체 실패.
- Git Bash 에서는 경로 인자 앞 `/` 가 변환되므로 `--paths login`(슬래시 생략) 또는 `MSYS_NO_PATHCONV=1` 사용.
- 첫 접속이 14초 걸린 적이 있어 화면 열기 제한은 45초.
- 검증(2026-11-13): /login → 콘솔오류 0·실패요청 0, 없는 주소 → 실패요청 3건 포착·종료코드 1.
