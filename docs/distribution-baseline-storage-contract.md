# 기준 물량표 서버 보관 — 구현 범위 고정

기존 local preview를 서버의 불변 원본 보관으로 확장한다. ERP 확정과 다른 개념이다.

- API `/api/orders/distribution-baselines`, withAuth, no-store. GET(year,week) 목록, GET(year,week,id) 단건. POST explicit `{year,week,requestId,fileName,fileBase64,coverage}`.
- year=20xx, week=NN-NN. requestId UUID. 파일 최대 512KiB(프록시 JSON 요청 한도 이내), .xlsx만, base64 엄격검사, ZIP magic 검증, XLSX 서버재파싱, 기존 parser와 같은 연도/차수 검증.
- coverage=`single`(01만), `combined`(02 제목의 이미01+02합산된 원본) 또는 `single`(02만, 서버보관은 허용하되 합산 완료 아님). 클라이언트가 명시 선택한다. 원본 시트 값은 분할/합산 추정 금지.
- 인증된 동일 Nenova 서비스 사용자가 목록을 공유한다. 파일 내용과 메타데이터는 public 폴더 밖 `data/distribution-board/baselines/`에 저장한다. 이 경로 전체 gitignore.
- ID는 연도·차수·사용자ID·requestId의 SHA256. 저장 파일 1개에는 원본 base64, SHA256, 서버파싱 결과, coverage, createdBy/At를 포함한다. 파일경로는 서버 해시만 사용한다. tmp + link/exclusive create 또는 동등 atomic no-clobber 방식; 중복 ID의 다른 payload는409, 동일 payload 재시도는 같은결과. 기존파일 overwrite/delete API 없음.
- 파일단위 보관만 수행한다. `erpSnapshot=null`, `reconciliationStatus='NOT_CAPTURED'`를 정직하게 표시. 현시점의 재고/분배를 추정하여 넣지 않는다.
- 코드·fixture에는 고객원본 파일을 포함하지 않는다. 테스트는 임시디렉터리, syntheticworkbook, 동시중복저장, 다른payload충돌, crossyear/pathtraversal/invalidfile 사례.
- 요청 출처 Origin이 있으면 same-origin 검사. 신규 저장이므로 사용자ID와 시간은 서버가 지정한다. client createdBy/status 값을 신뢰하지 않는다.

후속: 운영 read-only 연결 근거 확보 후 전산 기준 스냅샷+현재 비교, 세부차수별 총량 및 출고일/단위 매핑을 별도 연결한다. 이 기능만으로 전산대조 완료라고 표시하지 않는다.
