# nenovakakao 연동 검토

작성일: 2026-05-27

## 확인한 저장소

- `nenovakakao`
  - 위치: `C:\Users\USER\Documents\Codex\2026-05-15\codex-nowlink-kr-nenovaweb-com-git\nenovakakao`
  - GitHub: `https://github.com/Jayinsightfactory/nenovakakao.git`
  - 현재 커밋: `8cd6959 nenova agent v2.1 - 카톡 수집/분류/시트 자동화 전체 코드`
- `nenova-erp-ui`
  - 현재 웹에는 `/orders/kakao-audit` 수동 붙여넣기 검증 페이지가 있음.
  - 아직 `nenovakakao` Google Sheet를 직접 읽는 API는 없음.

## nenovakakao 데이터 흐름

`nenovakakao`는 카카오톡 Ctrl+S 저장 파일을 읽고, 메시지를 분류한 뒤 Google Sheet에 append하는 구조다.

주요 파일:

- `scripts/incremental_sync.py`
  - 카톡 저장 폴더: `C:/Users/USER/Downloads/카톡대화데이터`
  - Google Sheet: `https://docs.google.com/spreadsheets/d/1pXLVZqiMwWt6Vh0IhWwASBvgLtZqLnbHXMWqOLNwAXU/edit`
  - 서비스 계정: `C:/Users/USER/nenova_agent/data/gsheet_credentials.json`
  - 증분 상태: `data/sync_state.json`
- `core/classifier.py`
  - 메시지를 `major`, `minor`, `sequence`, `product`, `variety`, `quantity`, `unit`, `supplier`, `direction`, `thread_id` 등으로 분류.
- `scripts/update_product_matching.py`
  - 카톡 품목/거래처 표현과 nenovaweb DB 마스터 매칭 후보 생성.

Google Sheet 주요 탭:

- `이벤트로그`: 원본 메시지. 시각, 방이름, 파이프라인, 발신자, 원문, 메시지ID.
- `비즈니스이벤트`: 구조화된 업무 이벤트. 이벤트ID, 시각, 이벤트타입, 차수, 품목, 품종, 수량, 단위, 방향, 거래처, 방이름, 발신자, 원문요약, thread_id.
- `의사결정추적`: 불량/이슈 대응 흐름.
- `메시지분류`: 전체 메시지의 분류 결과.
- `품목매칭`, `거래처매칭`: 카톡 표현과 DB 품목/거래처 매칭 후보.

## nenovaweb 연동 권장 방식

### 1단계: 읽기 전용 API 추가

`nenovaweb`에 Google Sheet 읽기 전용 API를 추가한다.

예상 API:

- `GET /api/kakao/events`
  - `비즈니스이벤트` 탭 조회.
  - 필터: `week`, `room`, `sender`, `eventType`, `product`, `supplier`, `direction`.
- `GET /api/kakao/summary`
  - 영업담당자들이 카톡으로 추가/취소한 수량 합계.
  - 예: `21차 호주 추가`, `소재2호`, `반커부쉬 5박스`.
- `GET /api/kakao/matching`
  - `품목매칭`, `거래처매칭` 탭 조회.

처음에는 DB에 쓰지 않고 Google Sheet를 읽어서 화면과 챗봇에서만 사용한다.

### 2단계: 수입부 화면 추가

메뉴 예시:

- `수입부 > 카톡방 데이터`

화면 구성:

- 상단 필터: 차수, 카톡방, 발신자, 거래처, 품목, 추가/취소.
- 원문 목록: 카톡 원문, 발신자, 시간, 방.
- 구조화 목록: 차수, 품목, 품종, 수량, 단위, 방향, 거래처.
- 합계 영역: 품목별/거래처별/담당자별 추가 수량 합계.
- 매칭 확인 영역: DB 품목/거래처 후보 표시.

### 3단계: 챗봇 조회 연결

챗봇은 Google Sheet를 직접 읽지 않고 `nenovaweb` API를 조회한다.

예시 질문:

- `21차 호주 추가에서 영업담당자들이 추가한 반커부쉬 총수량 보여줘`
- `수입방에서 소재2호가 추가한 품목 합계 보여줘`
- `이번 주 카톡 추가 요청 중 아직 주문등록 안 된 것 보여줘`

답변에는 항상 근거를 같이 표시한다.

- 집계 수량
- 원문 카톡 라인
- 방 이름
- 발신자
- 시각
- 매칭된 DB 품목/거래처
- 매칭 신뢰도 또는 확인 필요 여부

## 안전 원칙

- 초기 연동은 반드시 읽기 전용.
- 카톡 원문/구글시트 데이터를 바로 주문등록, 출고분배, 재고에 반영하지 않는다.
- 주문등록 후보로 넘길 때도 사용자 확인 버튼을 거친다.
- `auto=true` 매칭은 참고값으로만 사용하고, 과거 fallback 오매칭 후보는 그대로 신뢰하지 않는다.
- 실제 DB 쓰기는 기존 `nenovaweb` 주문등록/출고분배 API를 통해서만 수행한다.
- 히스토리는 매칭 시점이 아니라 실제 저장/분배 성공 후에만 기록한다.

## 필요한 환경값

`nenovakakao`에는 Google Sheet 연동 정보가 있으나, 서비스 계정 JSON은 Git에 포함되지 않는다.

필요:

- `GOOGLE_SHEET_URL`
- Google 서비스 계정 JSON
- Google Sheet를 서비스 계정 이메일에 공유

`nenovaweb` 쪽에는 다음 방식 중 하나를 선택한다.

1. Railway 환경변수에 서비스 계정 JSON 전체를 `GOOGLE_SERVICE_ACCOUNT_JSON`으로 저장.
2. 서비스 계정 JSON 파일을 서버 파일로 두고 `GOOGLE_APPLICATION_CREDENTIALS`로 경로 지정.

운영에서는 1번이 배포/보안 관리상 유리하다.

## 구현 순서

1. `lib/googleSheets.js` 추가.
2. `/api/kakao/summary` 추가.
3. `수입부 > 카톡 수량집계` 페이지 추가.
4. 챗봇 라우터에 카톡 집계 intent 추가.
5. 실제 카톡 샘플로 품목/거래처/단위/차수 매칭 검증.
6. 주문등록 후보 전환은 별도 확인 UI 후 다음 단계에서 연결.

## 현재 판단

지금 바로 연결할 수 있는 최적 접점은 Google Sheet의 `비즈니스이벤트` 탭이다.

이 탭은 이미 차수, 품목, 수량, 단위, 방향, 거래처, 원문 근거를 갖고 있어 수입부 집계와 챗봇 질의에 가장 적합하다. 단, 실제 품목/거래처 DB 반영 전에는 `품목매칭`, `거래처매칭` 탭과 nenovaweb의 기존 자연어 매칭 로직을 함께 사용해 검증해야 한다.

## 2026-05-27 적용

- `GET /api/kakao/summary` 추가.
- `pages/incoming/kakao-summary.js` 추가.
- 화면 기본값은 `수입` 카톡방, `추가만` 기준으로 품목/수량/단위만 표시한다.
- 원문, 발신자, 메시지ID 등은 기본 화면에서 제외한다.
- 운영 반영 전 Railway 환경변수 `GOOGLE_SERVICE_ACCOUNT_JSON`, `KAKAO_SHEET_ID` 설정이 필요하다.
