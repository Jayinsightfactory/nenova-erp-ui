# 붙여넣기 AI 후보 검증 설계

## 기준·부작용

- 원문 업체명/품목명, 수량, 명시 단위, 추가/취소, 연도·차수는 검증 모델이 변경하지 않는다.
- 모델은 서버가 조회한 활성 Customer/ Product 후보 키만 선택한다. 누락·중복·목록 밖 키·낮은 확신은 미매칭으로 남긴다.
- 업체명 완전일치 및 사용자가 저장한 정확 별칭은 결정적 근거다. 부분 별칭과 파서가 추측한 키는 후보일 뿐이다.
- 품목은 기존 국가·화종·규격 후보 제한을 유지하고, 기존 매칭도 AI 비교 후보에 포함한다. 불명확하면 확인 필요로 반환한다.
- 서버 검증 결과(미매칭 포함)를 브라우저 캐시가 덮어쓰지 않는다. 사용자 직접 선택은 기존 검색·매칭 저장 API를 사용한다.
- 분석/재검증: Customer/Product 읽기만. OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, ProductStock/StockHistory, Estimate, Amount/Vat/isFix, WebProfitReport 모두 보존.
- 외부 전송은 기존 Anthropic 연동에 원문과 후보 이름/키/분류만 제공한다. 연락처·주소·단가·전체 원장은 보내지 않는다. 모델 응답은 명령이 아닌 비신뢰 데이터로 검증한다.

## 선확인

2026-09-07 로컬 dnSpy Console `--no-color -t FormOrderAdd`로 설치된 Nenova.exe 확인:
GetCustomer(false) 결과의 CustName 표시/CustKey 값, GetDataProduct의 Product 및 OrderMasterKey 조인 확인.
btnSave_Click은 주문 저장 이벤트다. 이번 분석 기능은 이 이벤트나 SP를 호출하지 않는다.

인증된 읽기 전용 master/customer-mappings API probe:
- 양재동 CustKey686, 남촌양재 CustKey325(CustArea 양재동)는 다른 업체.
- 부산 서부꽃집 CustKey671, 서부청과(주) CustKey405는 다른 업체.
- 서버 정확 별칭 `양재동→686`, `서부꽃집→671`은 정상. `서부청과→671` 별칭도 있으므로 실제 업체명 완전일치를 부분/별칭보다 우선 검증해야 한다.
- Pink Mondial 40/50/60cm는 각각1437/1255/1438. 길이를 무시해 같은 품목으로 처리하지 않는다.

## 검증 계획

양재동 지역명 충돌, 서부꽃집/서부청과, 잘못된 저장 별칭, 후보 밖 키, 모델 누락/중복/낮은 확신/실패, 수량·단위·행 보존, 2025/2026 문맥 보존, 서버 결과에 브라우저 과거 값 덮어쓰기 금지 fixture. 운영 주문등록 실행 없이 분석만 smoke한다.
