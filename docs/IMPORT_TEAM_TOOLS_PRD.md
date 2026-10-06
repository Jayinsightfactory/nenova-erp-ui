# 수입부 업무도구 통합 — 2026-10-06

## 사용자 합의

기존 Packing List HTML, Import Team Checklist HTML, PedidosHome Python, matches_nenova (4).xlsx를 네노바웹 기능으로 옮긴다. 팀 공동 저장·수정과 수정자 이력이 필요하다. 새 메뉴 `/import/tools`에서 패킹리스트 / 국가별 발주서 / 업무 체크리스트 / 변경 이력을 제공한다. 1920×1080 CSS pixel, 100% 기준. 기존 `_app.js` 화면틀을 재사용한다.

## 부작용 계약

이 기능은 파일 변환·업무 보조다. 주문, 분배, 입고, 재고, 확정, 견적 SQL 원장을 읽거나 쓰지 않는다. 업로드 원본을 임의로 ERP에 등록하지 않는다. 웹 공동 업무 상태만 `data/runtime/import-team/`에 저장하며 배포가 덮어쓰지 않는다. 변경자는 인증된 사용자 정보로 서버에서 기록한다. 데이터 버전 충돌은 409로 거부하고 새로고침/재확인을 안내한다. 원장 연동은 별도 설계 대상이다.

## 패킹리스트

기존 국가별 PDF 추출 프롬프트, 매칭, 수량/단가 검증, Excel 스타일/수식 및 다운로드 동작을 보존한다. 품목 카탈로그 Excel 업로드, matches 매핑 가져오기/내보내기, 수동 매칭 확인을 제공한다. 첨부 매칭표 1457행을 초기 기준으로 사용하되 중복/빈 값은 검증한다. API 키는 서버 환경변수만 사용한다. 브라우저 키 입력/저장과 직접 외부 API 호출을 제거한다. 인증된 PDF 분석 API는 허용 국가/파일 크기/형식, 요청 빈도를 제한하고 고정 프롬프트만 사용한다. 실제 업로드 전 PDF가 AI 서비스로 전송된다는 안내를 표시한다. AI 결과는 검토와 출력용이며 원장에 반영되지 않는다.

## 국가별 발주서

PedidosHome의 국가별 원본 Excel 파싱과 파일/시트 생성 로직을 브라우저 JS로 이관한다. 대상은 Colombia, Netherlands, Ecuador, Australia, Thailand, China, Vietnam. 국가·연도·차수와 파일을 선택하고 결과 파일 목록에서 다운로드한다. Python 설치/실행, BAT/바로가기 실행을 요구하지 않는다. 원본의 변환·반올림·박스 계산은 문서와 fixture로 고정한다.

## 체크리스트

원본의 요일별 국가 업무, 미결 업무, 월별 결제 체크, 항공 일정, 휴가, 재배계획을 제공한다. 일일 체크는 요일명만이 아니라 실제 YYYY-MM-DD로 저장하여 다음 주에 체크가 남지 않게 한다. 월/연도도 명시 업무키로 저장한다. 업무 문구의 스페인어·한국어를 보존한다. 입력 문자열은 React 텍스트로 렌더링한다. 휴가·재배 데이터는 원본 파일에 실제 저장값이 없으면 빈 상태로 시작한다.

## 구현 인터페이스

PDF 분석은 계정별 시간당 20회로 제한한다. 서버 파일의 원자적 슬롯 생성으로 같은 서버의 여러 프로세스에도 합산 적용하며 실패한 외부 요청도 횟수에 포함한다. 브라우저 탭 전환은 작성 중인 입력과 변환 결과를 유지한다.

- GET `/api/import/tools/state?key=...` → `{success,value,revision,history}`.
- PUT 동일 URL body `{expectedRevision,value}` → 동일 응답. 삭제는 value=null, 이력은 유지.
- GET `/api/import/tools/state` → 최근 변경 이력 목록(값 전체 제외).
- 공동 키: `packing.aliases`, `packing.catalog`, `checklist.day.YYYY-MM-DD`, `checklist.month.YYYY-MM`, `checklist.pending`, `checklist.flights`, `checklist.vacations.YYYY`, `checklist.planting`.
- `useImportTeamRecord(key, initialValue)` → `{value,save,loading,saving,error,revision,reload}`. `save(nextValue)`는 Promise, 서버 성공 후 상태 갱신.
- 패킹리스트용 `storage.get/set/delete`는 서버 상태를 사용하고 원본 JSON 문자열 계약을 유지한다. 충돌/저장 오류를 숨기지 않는다.
- 컴포넌트: `components/import-tools/PackingListTool.js`, `PedidosTool.js`, `ChecklistTool.js`. 메인 페이지가 탭을 소유한다.

## 완료 기준

샘플 발주 파일 입력과 국가별 변환 테스트, 매칭표 로딩/수동 변경, 공동 상태 재접속·충돌·이력 테스트, PDF API 인증/검증 테스트. 실제 PDF는 미첨부이므로 PDF 정확도 검증에는 추가 원본이 필요함을 명시한다. 전체 ERP 가드·빌드, 1920×1080 브라우저 화면 및 다운로드 검증 후 PR/배포한다. 운영 업무 데이터 생성 없이 smoke한다.

## 2026-10-06 실파일 보완 (위 초기 검증 범위의 후속 갱신)

업무 드라이브 실제 Colombia/China Excel 및 ECUA AWB/NL Holex PDF를 확보했다.
정상적인 0수량은 다운로드 가능하며 파싱 실패를 0으로 대체하지 않는다.
중국 최신 matrix는 숫자 원본과 CustKey/ProdKey/연도/세부차수로 검증한다.
PDF는 파일당20MiB, API JSON30MiB, nginx 해당경로32MiB다.
NL Holex의 검증된 정형 PDF는 로컬 코드로 먼저 읽고 모든 페이지·행·금액·수량을 대조한다.
지원하지 않거나 검증 실패 시 사용자가 별도 AI 버튼을 눌러야 외부 분석한다.
정상 AI 결과는 같은 계정/파일/국가/모델/프롬프트 기준30일·최대100건 재사용한다.
카탈로그 업로드는 미리보기 뒤 기본 병합 또는 명시적 전체교체로 저장하며 기존 수정자/충돌 보호를 유지한다.
자세한 기준은 `plans/import-team-hardening-2026-10-06.md`와 작업 세션의 후속 검증을 따른다.
