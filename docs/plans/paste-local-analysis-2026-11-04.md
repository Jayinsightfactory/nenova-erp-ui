# 붙여넣기 Claude 호출 절감 (2026-11-04)

최신 사용자 목적: Claude API 사용량·분석 대기시간 절감. Python 서비스 신설 대신 기존 JS 규칙/DB alias 사용. 앞서 요청한 재고 UI 개편은 별도 후속으로 남겨 이번 비용 개선과 분리한다.

분석 읽기 SQL/대상/ERP 쓰기/최종 저장 검증 변경 없음. Customer/Product/OrderDetail 읽기와 Web 매칭 snapshot 로딩은 기존 그대로. Order*/Shipment*/Stock*/Estimate/WebProfitReport 모두 보존. EXE 근거 ProductMatching.md/FormOrderAdd; 키/단위/차수 규칙 보존, SQL 변경없으므로 신규 native저장/probe 불필요.

1. 모든 원문 줄이 허용한 차수/구분선/정확업체/명시수량+단위 문법에 들어오고 기존 자연어파서 결과와 업체·수량·동작·개수가 일치할 때만 최초 Claude 해석 생략. 미확인 메모/암시수량/복잡표현/품목형 업체명은 기존 전체분석 유지. 혼합/인라인은 초기 gate 제외.
2. 현행 활성 Product와 유일한 정확 이름 또는 명시적 manual=true/auto!=true 서버별칭이 일치하며 국가/화종/길이/믹스/운송료 충돌이 없을 때만 로컬 확정. fuzzy/자동학습/중복별칭/충돌은 AI 또는 미매칭 유지.
3. 동일 검증 task dedup 후 결과를 원래 row ID로 분배. 실패/null/미결은 기존대로 확인필요. source/수량/단위/차수 수정금지.
4. 응답에 실제 modelCalls/inputTokens/outputTokens/로컬parse/로컬match/미결tasks/elapsedMs 추가. 모형호출 없는 정형fixture와 근접실패fixture 비교. 실제운영 정확도/평균절감율은 데이터없이 주장하지 않는다.

메뉴 기본선: 적용=기존 분석/미리보기/확인후저장; 해당없음=신규메뉴/UI개편/원장쓰기; 예외없음. 카톡재고는 이미 Claude0회인 규칙분석 유지.
