# 실제 확정 주문 대조 (2026-11-04)

목적: 기존(068465f1 이전) vs 개선 분석의 매칭·수량·단위 정확도, 새로 측정한 지연·provider실제 토큰 비교. 과거 저장되지 않은 timing/token은 추정값과 섞지 않는다.

- 원장 SELECT only. 실제반영 verified=true, committedCount>0, 전체entries완결,단일sourceIdentity인 SystemActionLog만 truth 후보. sourceIdentity/연도와 서버 원문을 정확히 연결,부분처리·undo·원문없음·coverage불명은 제외하고 제외수 표기.
- 서버 data/runtime/paste-analysis의 같은원문/연도 저장분석과 영업방 GET 원천을 사용. cache를 정답으로 삼지 않으며 정답은 확정payload의 업체/품목/action/qty/unit.
- 과거baseline route/review pinned 2f191418, current live logic 같은master/alias/unit snapshot 사용. handler DB/저장/로그 adapter는 SELECT snapshot 조회만;쓰기호출 실패. response에 원장적용 없음.
- 최초inspect 실행은 model0. paired 재실행은 최대8원문/32model calls/실제누적400k input tokens/30s request/no retries, sequential. 집계·hashed case와불일치형태만 출력, 원문/업체명/개인정보/키는 출력·저장하지 않는다.
- 운영코드 변경 전 shadow 비교. 발견한 문제는 익명fixture로 보완하고 전체계약/build/CI후 배포. 별칭들을 일괄 보정하지 않는다.

기준선: 새UI없음/ERP원장부작용없음. 지금목적은 실제자료검증이며 PC간단창은 후속.
