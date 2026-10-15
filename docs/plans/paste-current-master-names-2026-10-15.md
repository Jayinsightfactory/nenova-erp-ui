# 붙여넣기 저장매칭 이름 최신화

## 기준과 근거
- 사용자 요청: 기존 CustKey/ProdKey 연결을 유지하고 업체명·품목명만 최신 DB 기준으로 표시한다.
- 실제 로컬 dnSpy FormOrderAdd(2026-10-15): GetCustomer는 CustName 표시/CustKey 값, GetDataProduct는 Product.ProdKey/ProdName 사용. 저장은 별도 btnSave_Click. 출력 outputs/paste-current-names-native.txt.
- 운영 인증 GET 읽기 대조: 업체 매칭36, 품목501, 유효 업체675/품목3346. 저장된 키 누락0. 매일538과 미우456의 저장 이름만 DB 이름과 다름. outputs/paste-mapping-read-audit-2026-10-15.json. 운영 쓰기 없음.
- docs/CODEX_SUBTASK_ORCHESTRATION.md는 현재 저장소에 없음. 제공된 AGENTS 역할분담에 따라 메인이 근거·계약·외부쓰기, 구현 하위작업과 고성능 검토를 분리한다.

## 동작 및 보존표
| 동작 | 읽기 | 변경 | 보존 |
|---|---|---|---|
| 매칭 GET | 기존 별칭 파일, 활성 Customer/Product | 응답의 이름만 | 파일 키/연결번호/수동여부/시각/단위 |
| 현재·복원 작업 이름 갱신 | 최신 기준정보와 정확한 키 | 화면의 최신 이름 | 원문, 수량, 단가, 단위, 선택, 완료/전달상태, 처리 이력 |
| 조회 실패/키 누락 | 확인 가능한 기존 상태 | 실패 안내 또는 기존 표시 보존 | 재매칭/삭제/자동저장 금지 |

모든 연도 OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, Estimate, StockHistory/ProductStock, WebProfitReport는 읽기 표시 변경의 쓰기 대상이 아니다. 금액/Vat/isFix 및 견적 노출과 확정매출 계산은 그대로다.

## 구현 기준
- 양의 동일 CustKey/ProdKey로만 이름을 대조한다. 이름 유사도로 다른 번호를 선택하지 않는다.
- ProdName/DisplayName의 명시 빈값/null도 반영한다. 단위/환산수/단가/수량/분배 여부는 갱신 대상이 아니다.
- 서버 파일을 GET에서 수정하지 않고 응답만 최신화한다. POST 저장 계약은 보존한다.
- 페이지 최초 진입, 복원·저장 분석 도착, 창 복귀에서 최신 카탈로그 표시를 적용한다. 요청 중복/오래된 응답/실패를 보호한다.
- 이름만 바뀌어도 작업 완료 fingerprint를 잃거나 재분배가 허용되면 안 된다. 저장된 과거 완료 상태와 현재 미완 상태를 구분해 보존한다.
- 원문 품목명과 기초/적용재고 복사용 원문명, 과거 감사이력은 재작성하지 않는다.

## 검증 및 메뉴 기준선
- 정확키 이름변경, 같은 이름 다른키, 누락/삭제, null/빈 이름, 2025/2026 동일차수에서 키·수량·완료상태 보존 fixture.
- 실제 브라우저 1920x1080 CSS100%, 작은 화면에서 복원/포커스 갱신, 오류 안내, 매칭/ERP 자동 POST 없음 확인.
- 적용: 기존 shell/키보드/주스크롤/원문과 연결 구분/처리상태 보존. 해당 없음: 신규 메뉴/인쇄/새 원장 쓰기. 예외 없음.
- ERP 계약/dnSpy/manifest/쓰기 가드/build 후 PR/master/Cafe24 및 운영 읽기 검증.
