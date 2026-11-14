# 카카오 주문정보 수집·분류·주문등록 기획

상태: 기획 초안 (코드/DB 변경 없음)

작성일: 2026-08-07

대상: Nenovaweb 브라우저와 `nenova.exe`가 공유하는 ERP 주문 원장

## 1. 결론

신규 화면은 기존 `/orders/import`를 확장한 **작업 묶음(work batch) 기반 주문 수집 화면**으로 설계한다. 기존 구현의 파일 드롭, Excel/CSV·이미지 파싱, 품목 후보 점수화, 수동 매칭, 임시저장, `/api/orders` 주문등록은 재사용하되 다음 문제를 먼저 분리한다.

- 현재 `/orders/import`는 단일 파일·기본 거래처 중심이고 텍스트/표 붙여넣기, 복수 원본, 원본별 근거가 없다.
- `/api/orders/import-parse`는 파싱 성공 시 품목 매핑과 단위 catalog를 곧바로 저장한다. 초안 검토와 학습 확정을 분리해야 한다.
- `/api/orders` POST는 기존 수량에 항상 가산하는 delta 저장이다. 재시도 시 중복될 수 있으므로 서버 idempotency와 승인 스냅샷이 필요하다.
- 기존 붙여넣기 화면은 주문등록과 분배를 함께 실행하는 경로도 제공한다. 이 신규 화면은 **주문등록만** 수행하며 출고분배는 별도 화면/권한/승인으로 유지한다.

## 2. 현재 동작, 확정 요구, 미확정 요구

| 구분 | 내용 |
|---|---|
| 현재 동작 | `/orders/import`: xlsx/xls/csv/png/jpg/webp 단일 파일, 최대 30MB, 드롭/선택, 품목 자동·수동 매칭, 브라우저 localStorage 임시복원, 양수 품목 합산 후 delta 주문등록 |
| 현재 동작 | `/orders/paste`: 일반 텍스트를 LLM+규칙으로 해석, 차수/거래처/품목 매칭, 저장 매핑, 미매칭 질문, 등록만 또는 등록+분배 |
| 현재 동작 | 라움 이미지: 클립보드 이미지 추출, 원본 이미지 preview, OCR 행 수정, 신뢰도/검토 필요 상태, 가격·단위별 합산, 주문 품목과 손익 항목 분리 |
| 확정 요구 | 모든 후보에 `OrderYear + OrderWeek + CustKey + ProdKey`; 연도/차수 모호 시 등록 금지; 주문등록과 출고분배 분리; 원본별 근거·수정이력·등록 결과 보존 |
| 확정 요구 | 품종(Flower)·전산 품명(Product)·색상/원본 표현을 별도 필드로 유지하고 최종 품목은 `ProdKey`로 확정 |
| 미확정 | 같은 원본/품목 행을 합산할 기본 정책, 음수/취소를 주문 delta로 허용할지, 부분등록 기본값, 승인자 분리 기준, 원본 보존기간 |
| 미확정 | OCR 제공자/리전/보존정책, tenant별 비용 한도, 이미지 원본 암호화 저장 위치, Kakao connector 방식 |

## 3. 조사한 기존 구현과 재사용 판단

| 기존 자산 | 재사용 | 판단/보완 |
|---|---|---|
| `pages/orders/import.js` | 높음 | 드롭존, KPI, 행 편집, 품목 선택, 단위 수정, 초안 복원 UI를 shell로 사용. 좌우 원본/정규화 split view와 복수 source tab 추가 |
| `lib/orderImportParse.js` | 높음 | Excel 헤더 탐지, 라움형 품명+칼라, 수량·단위 분리 재사용. 음수/0, 일반 텍스트, 표 header alias, 날짜/차수/거래처 후보를 반환하도록 확장 |
| `lib/orderImportMatch.js` | 높음 | 국가/품종, 저장 매핑, 사용량/최근 사용, 한영 별칭, mix/freight 오매칭 방지, 후보 점수화 재사용 |
| `lib/orderImportCustomerMatch.js` | 높음 | 저장 거래처 매핑→CustKey→명칭/사용량 후보 순위를 공용 엔진으로 사용 |
| `lib/orderImportUnits.js` | 조건부 | 원본 단위→catalog→mapping→품명추론→ERP 단위 순서는 유용. 검토 전 파일 JSON 자동학습은 금지하고 승인된 correction event만 반영 |
| `/api/orders/import-parse` | 분리 필요 | 업로드/파싱과 매핑 저장이 결합됨. `sources`, `parse`, `match`, `validate` API로 분리하고 파싱은 무쓰기(read-only)로 변경 |
| `/api/orders/parse-paste` | 조건부 | 일반 텍스트 보조 파서와 detectedWeek를 재사용. 원문 전체의 외부 LLM 전송 전 비밀정보 마스킹·동의·tenant 정책 필요 |
| `/api/orders` | 조건부 | EXE 호환 `OrderMaster/OrderDetail` 트랜잭션과 연도 격리는 재사용. delta 전용 동작 위에 승인 스냅샷 hash/idempotency adapter 필요 |
| `components/raum/RaumImageOrderPanel.js`, `lib/raumPnlImage.js` | 높음 | 클립보드 이미지, 원본 preview, OCR 수정/신뢰도, 여러 이미지 합산, 분리행 정책을 일반화 |
| `/shipment/distribute-import` | UI만 | 변경/미매칭/경고 필터, 피벗 비교, 사후검증 UX만 재사용. 분배 API/쓰기 로직은 호출 금지 |

## 4. 목표 페이지 흐름

1. 작업 묶음 생성: 연도, 차수 후보, 기본 거래처, 담당자 설정.
2. 원본 추가: 파일 선택/드롭, 표·일반 텍스트 붙여넣기, 클립보드 이미지 붙여넣기.
3. 형식 판별: Excel/CSV, TSV/HTML table, 거래처 template, 자유 텍스트, 이미지.
4. 원본 preview: 원본 행/셀/이미지 좌표와 추출행을 연결한다.
5. 정규화: 거래처, 품종, 원본 품명, 색상, 수량, 단위, 출고일, 연도/차수 후보를 만든다.
6. DB 매칭: `CustKey`, `ProdKey` 후보와 근거/점수 표시. 자동 확정 threshold를 넘지 못하면 추천 상태.
7. 검토: 미매칭/모호/중복/취소/단위 오류만 수정하고 정상 행은 유지한다.
8. 검증: 원본 총량, 단위별 합계, 교차연도 격리, 현재 주문 충돌, 등록 side effect를 검사한다.
9. 등록 preview: 승인 당시 immutable snapshot과 `nenova.exe` 기준 필드를 표시한다.
10. 승인/실행: 승인자 권한과 idempotency key를 검증한 뒤 주문만 등록한다.
11. 결과: 행별 성공/실패/재시도 가능 여부, OrderMasterKey/OrderDetailKey, 원본 근거, 감사 event를 남긴다.

## 5. 매칭 정책

후보 점수는 설명 가능한 항목의 합으로 만들고 UI에 세부 점수를 노출한다.

`exact alias + normalized token + country + flower family + customer usage + recent usage + accepted correction - ambiguity/mismatch penalty`

- `AUTO_MATCHED`: 명시적 저장 alias 또는 threshold 이상이며 1·2위 점수 차가 충분함.
- `SUGGESTED`: 후보는 있으나 사용자 확정 필요.
- `MANUAL`: 사용자가 후보를 선택/검색해 확정.
- `UNMATCHED`: 유효 후보 없음.
- 거래처를 지정하면 해당 거래처 최근 사용 품목을 올리되 전체 검색 결과를 숨기지 않는다.
- 후보 카드: 국가, 품종(FlowerName), 전산 품명/표시명, 단위, `ProdKey`, 점수와 근거.
- correction은 별도 사전 이벤트에 append하고 Product/Customer 원장을 자동 변경하지 않는다.

## 6. 주문등록 side-effect matrix

| 사용자 동작 | Web 작업/감사 테이블 | OrderMaster | OrderDetail | ShipmentMaster/Detail/Farm/Date | Warehouse/Stock | Estimate/WebProfitReport/매출 |
|---|---|---|---|---|---|---|
| 원본 추가/파싱/OCR | C/I | 보존 | 보존 | 보존 | 보존 | 보존 |
| 정규화/매칭/수정 | C/I | 보존 | 보존 | 보존 | 보존 | 보존 |
| 검증/등록 preview | I | 읽기만 | 읽기만 | 보존 | 보존 | 보존 |
| 승인 | C/I | 보존 | 보존 | 보존 | 보존 | 보존 |
| 주문등록 실행 | I | C 또는 기존 current-year master 재사용 | C/U(delta 정책 확정 시) | **보존** | **보존** | **보존** |
| 재시도 | I | idempotency 결과 재사용 | 중복 delta 금지 | 보존 | 보존 | 보존 |

`C/U/I`는 create/update/append history를 뜻한다. 신규 화면은 `ensureShipmentMaster`, `/api/shipment/adjust`, `/api/shipment/distribute`를 호출하지 않는다. 실행 결과에 `shipmentMutationCount=0`, `stockMutationCount=0`, `estimateMutationCount=0`을 명시한다.

## 7. 추가 API 초안

| API | 목적 | 쓰기 범위 |
|---|---|---|
| `POST /api/order-capture/batches` | 작업 묶음 생성 | Web batch only |
| `POST /api/order-capture/batches/:id/sources` | 복수 원본 업로드/붙여넣기 | Web source/blob only |
| `POST /api/order-capture/batches/:id/parse` | 형식 판별/추출/OCR job 생성 | Web events only |
| `POST /api/order-capture/batches/:id/match` | DB read-only 후보 계산 | 후보 snapshot only |
| `PATCH /api/order-capture/batches/:id/rows/:rowId` | 사용자 수정 | append-only correction |
| `POST /api/order-capture/batches/:id/validate` | 합계/키/충돌/side-effect 검증 | validation snapshot |
| `POST /api/order-capture/batches/:id/approve` | 승인 snapshot 고정 | approval only |
| `POST /api/order-capture/batches/:id/register` | 주문만 등록 | OrderMaster/OrderDetail + result/audit |
| `GET /api/order-capture/batches/:id` | 다시 열기/결과 조회 | read-only |
| `POST /api/order-capture/batches/:id/clone` | 새 batch에 근거 복제 | Web tables only |

등록 API는 `Idempotency-Key = sha256(tenantId + batchId + approvalRevision + action)`을 받고 DB unique constraint로 중복 실행을 막는다. 같은 key의 재호출은 최초 결과를 반환한다.

## 8. 데이터 모델 초안

- `WebOrderCaptureBatch`: tenant, status, target year/week, default CustKey, creator/assignee/approver, revision.
- `WebOrderCaptureSource`: source type, original filename/display label, encrypted blob pointer, content hash, mime/signature, uploader, received time.
- `WebOrderCaptureSourceVersion`: 원본/전처리/OCR text hash와 parser version. 원문을 일반 로그에 넣지 않는다.
- `WebOrderCaptureRow`: source/version/locator, 원본 필드 snapshot, 정규화 값, candidates, final CustKey/ProdKey, quantity/unit/date/week.
- `WebOrderCaptureCorrection`: field, before/after, reason, actor/time; append-only.
- `WebOrderCaptureValidation`: revision, totals, errors/warnings, DB conflict snapshot hash.
- `WebOrderCaptureApproval`: approved revision/hash, approver/time, partial policy.
- `WebOrderCaptureExecution`: idempotency key, start/end/status, result summary.
- `WebOrderCaptureExecutionRow`: OrderYear/Week/CustKey/ProdKey/qty/unit, OrderMasterKey/DetailKey, source locator, error.
- `WebOrderMatchDictionary`: tenant/customer scope, source alias, target ID, accepted count/last used; Product/Customer와 분리.

## 9. 권한·보안

| 역할 | 원본 추가 | 매칭 수정 | 승인 | 주문등록 | 원본 전체 열람 |
|---|---:|---:|---:|---:|---:|
| 담당자 | O | O | 조건부/불가 | 불가 | 본인/배정 batch |
| 영업지원 | O | O | O | O | 담당 범위 |
| 수입부 | 조회/보조 | 품목 보조 | 불가 | 불가 | 필요한 행만 |
| 관리자 | O | O | O | O | 감사 목적 |

- 파일은 확장자 allowlist, MIME과 magic signature 교차검증, 크기/행수/압축해제 한도, 임의 UUID 이름, webroot 밖 격리 저장, 악성코드 검사, CSRF와 권한검사를 적용한다. [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- File API는 사용자가 input 또는 drag/drop으로 명시적으로 제공한 파일만 읽는 모델이다. [MDN File API](https://developer.mozilla.org/en-US/docs/Web/API/File_API)
- 클립보드 자동 읽기는 secure context, 사용자 활성화, 브라우저별 permission 차이가 있으므로 기본 입력은 `paste` event를 사용하고 “클립보드에서 읽기” 버튼은 progressive enhancement로 둔다. [MDN Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API), [MDN DataTransfer](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer)
- 원본 카카오 내용·개인정보·가격조건은 구조화 application log/LLM prompt log에 넣지 않는다. source ID/hash/크기/상태만 기록하고 열람은 별도 감사 대상이다.
- OCR 외부 전송은 tenant별 opt-in, 제공자/리전/보존기간 고지, 전송 전 crop/redaction, 재처리 비용 상한을 둔다.

## 10. 단계별 구현

### Phase 1 — TSV/일반 텍스트/Excel

- 범위: 단일·복수 text/Excel/CSV, 규칙 기반 판별, 좌우 preview, 수동 매칭, 검증, 주문만 등록.
- 제한: 이미지/OCR 없음, 거래처 template 수동 선택, batch 저장은 필수.
- 복구: parse 재실행은 새 source version; 등록 재시도는 idempotent.
- 테스트: header 변형, 탭/공백/줄바꿈, 단위, 중복/음수, 2025/2026 동일 차수, 부분 실패.

### Phase 2 — 거래처 template/추천/작업 저장

- 범위: tenant/customer template, 최근 패턴, correction 사전, 작업 복제/재처리.
- 위험: 잘못된 학습이 반복될 수 있어 자동매칭 threshold와 사전 rollback/versioning 필요.

### Phase 3 — 이미지/복수 원본 OCR

- 범위: 클립보드/드롭 이미지, 원본-OCR-수정 전후, confidence/좌표, 저신뢰 검토.
- 비용/보안: 픽셀/요청/토큰 예산, 외부 전송 opt-in, PII redaction, 이미지 보존기간.
- 실패복구: OCR provider timeout은 batch를 보존하고 재시도; 일부 이미지 실패가 다른 source를 지우지 않음.

### Phase 4 — MOYI/Kakao connector/승인 자동화

- 범위: tenant별 connector, 수신 dedupe, 승인정책, 감사 export.
- 제한: connector 수신은 자동 등록이 아니라 source 추가까지만. 승인 없는 ERP write 금지.

## 11. 테스트 시나리오

1. TSV/HTML table/공백 텍스트가 동일 정규화 행을 만든다.
2. `67박스(2010대)`, `10단`, `120 stems/스팀`을 수량/단위로 분리한다.
3. 품종 `장미`, 품명 `Mondial`, 색상 `White`가 서로 덮어쓰이지 않고 최종 `ProdKey`로 귀결된다.
4. 거래처별 최근 품목이 우선되지만 전체 후보 검색이 가능하다.
5. 2025 `29-02`가 있어도 2026 `29-02` preview/등록은 2026 master만 사용한다.
6. 차수/연도가 모호하면 register가 409 `AMBIGUOUS_PERIOD`로 차단된다.
7. 같은 idempotency key를 동시에 두 번 보내도 수량은 한 번만 증가한다.
8. 정상/오류 혼합 batch에서 부분등록 OFF는 전체 차단, ON은 승인된 행만 등록한다.
9. 등록 전후 Shipment/Stock/Estimate/Profit 행 hash/count가 보존된다.
10. OCR 저신뢰 행은 승인 불가이고, 수정 후 원본/OCR/수정 event가 모두 남는다.
11. 악성 확장자/위조 MIME/과대 파일/수식 폭탄 CSV가 차단된다.
12. 로그에는 원본 카카오 문구/이미지/개인정보가 노출되지 않는다.

## 12. 사용자 결정 필요사항

1. 음수/“취소”는 이 화면에서 주문 수량 감소로 허용할지, 별도 취소 workflow로 보낼지.
2. 같은 `CustKey + ProdKey + unit` 행의 기본 합산 범위: source 내부/전체 batch/합산 안 함.
3. 부분등록 기본값과 승인자 분리(4-eyes) 적용 기준.
4. 원본/OCR/correction/감사 보존기간과 삭제·법적보존 정책.
5. 외부 OCR 제공자, 데이터 리전, tenant opt-in, 월 비용 한도.
6. 기존 `/orders/import`를 in-place 전환할지 `/orders/capture`로 병행 출시할지.

## 13. 구현 착수 전 필수 증거

이번 산출물은 기획이므로 운영 DB probe와 원장 write를 수행하지 않았다. 실제 구현 전에는 `FormOrderAdd`/`ClassOrderMaster`/`ClassOrderDetail`의 조회·저장 순서를 로컬 dnSpy CLI로 재확인하고 `docs/exe-golden` 근거, 동일 업무키 read-only probe, 계약 JSON, 교차연도 fixture를 추가해야 한다. 주문등록 후 `ViewOrder`에는 보이고 `ViewShipment`, `ShipmentDate`, `ShipmentFarm`, Stock, Estimate, WebProfitReport는 변하지 않는다는 사후 검증을 실행 가능한 테스트로 고정한다.
