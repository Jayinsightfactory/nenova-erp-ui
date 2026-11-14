# 2026-11-15 회의정리 메뉴(회의 내용 → AI 화이트보드)

## 질문
네노바웹에 회의 내용을 넣으면 화이트보드로 만들어 주는 "회의정리" 메뉴를 추가해 달라.

## 답변(한 일)
- 메뉴: `업무 매뉴얼 > 회의정리` (`/work/meetings`), `components/Layout.js` MENU_ITEMS 한 곳 등록.
- 넣기: 회의 내용(글) 붙여 넣기 + 제목·날짜·참석자(선택). 음성 올리기는 범위 밖(다음 단계 후보).
- 정리: `POST /api/work/meetings {action:'organize'}` → `lib/meetingBoardLlm.js`(기존 Anthropic 경로, 도구 호출 강제) → `lib/meetingBoard.js` 가 쪽지·선으로 변환.
  - 원문에 없는 근거 문장·담당자·기한은 서버가 비운다(`findQuote`). 화면은 "확인 필요"로 표시.
- 보드: 직접 만든 가벼운 보드(`components/meetings/MeetingBoard.js`). 끌어 옮기기·고치기·더하기·지우기(되돌리기)·잇기·원문 보기, 키보드 조작.
  - 외부 화이트보드 부품을 쓰지 않은 이유: 쪽지·선만 필요하고, 큰 부품은 실행본 크기·라이선스 표시·서버 렌더링 문제가 따라온다.
- 저장: 웹 전용 파일 `data/runtime/meeting-board/<id>.json` (전산 DB 표 없음). 만든 사람만 고침, "직원 모두와 함께 보기"를 켠 회의만 다른 직원이 읽기 전용으로 봄. 지우기 → 지운 회의(되살리기) → 완전히 지우기.
- 내보내기: 그림(PNG) 받기, 인쇄(A4 가로).
- 가이드 영상: `public/guides/work-meetings/staff.mp4` 9단계(1920×1080), `scripts/record-work-meetings-guide.cjs`.

## 메뉴 개발 기본값 확인
| 항목 | 결과 | 근거 |
|---|---|---|
| 화면 틀(_app.js Layout 한 번) | 적용 | `npm run test:ui-layout` 통과 |
| 페이지 주 스크롤·작은 내부 스크롤 없음 | 적용(예외: 넓은 보드 가로 스크롤, 원문 보기 창) | 화면 사진 |
| 키보드 조작 | 적용 | 쪽지 방향키 이동·Enter 고치기·Delete 지우기·Esc, 원문 창 초점 복귀 |
| 저장 전 이탈 경고 | 적용 | beforeunload + 목록으로 가기 확인 |
| 세 상태(불러오는 중·없음·오류) | 적용 | Skeleton / EmptyState / Notice |
| 사용 가이드 영상 | 적용 | `npm run test:workflow-guides` 통과 |
| ERP 원장 영향 | 해당 없음 | SQL 연결 없음, `docs/contracts/meeting-board.json` 전부 preserve |

## 검증
- `node --test __tests__/meetingBoard.test.js` 6/6, 로컬 API 한 바퀴(401·503 AI_NO_KEY·저장·남이 열기 404·검색·지우기·완전히 지우기·다른 사이트 403).
- 로컬 실브라우저 9단계 조작(녹화 스크립트 `--dry-run`).

## 다음 단계 후보
- 음성 녹음 올리기(받아쓰기), 할 일을 내 작업·달력으로 보내기, 여러 사람이 동시에 고치기, 선에 이름 붙이기.
