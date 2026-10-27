# 입고관리 기본 조회기간·태국 EXCEL 중량 재확인 — 2026-10-27

| 항목 | 기록 |
|---|---|
| 세션 ID | incoming-date-default / 2026-10-27 |
| 기간 | 2026-10-27, KST |
| 화면 | 네노바웹 `/incoming` 입고관리 |
| 작업트리 | `C:/Users/USER/nw-incoming-date-default` |
| 브랜치·기준 | `codex/incoming-date-default`, `65635f23` |
| 원장 부작용 | 운영 DB SELECT만. 입고·주문·출고·재고·견적·확정 매출 및 원가 근거 변경 없음 |
| PR·배포 | 진행 중. 이 기록 시점에는 테스트·PR·배포 완료로 판정하지 않음 |
| 다음 채팅 힌트 | 조회 기본기간 변경과 39차 중량 원문 확인을 구분한다. 비용 계산 또는 DB 보정으로 범위를 넓히지 않는다 |

## 이어받을 때 고정된 결정

- 변경 범위는 **입고관리 조회 초기값만** 최근 7일에서 한국 오늘 기준 **달력 3개월 전~오늘**로 확대하는 것이다.
- URL의 명시 `from`/`to` 및 사용자가 바꾼 기간을 보존한다. 월말은 대상 월 말일로 맞추며 90일 차감으로 대체하지 않는다.
- `uploadMeta`의 기존 입력일 기본값과 업로드·삭제·원가·환율 계산은 변경하지 않는다.
- 기본 EXE parity API의 `UploadDtm` 조회를 유지한다. 표시용 `InputDate`와 혼동하지 않는다.
- 39차 EXCEL의 209/270.5는 SQL 수량 필드에 남아 있지만 GW/CW 품목 연결은 NULL이다. 숫자 존재와 원문 라벨 확정은 별개다.
- DB 보정, 익명 행의 품목 임의 연결, 새로운 비용 추정식 도입은 이번 작업에 포함되지 않는다.
- 테스트·PR·배포 및 변경 후 운영 브라우저 검증은 결과가 확보된 뒤 별도로 기록한다.

## 질문과 답변

### 1. 2026-10-27 — 태국 중량은 입고관리의 EXCEL에 있지 않나?

**Q.** “태국 중량은 입고관리에 excel로 나오지않나?” 기존 39차 태국 중량 부족 판정을 다시 확인해 달라는 요청.

**A.** 실제 설치 EXE의 dnSpy CLI와 운영 SQL을 읽기 전용으로 대조했다. **중량 후보 숫자가 없어진 것은 아니다.** 다만 39차 두 행에는 `ProdKey`가 없고, 입고 상세 테이블은 원문 품목명을 별도로 보관하지 않는다.

| 연도·차수 / EXCEL 전표 | WdetailKey / OrderCode | Product 연결 | SteamQuantity | OutQuantity / EstQuantity |
|---|---|---|---:|---|
| 2026/39-01 / 7474 | 42868 / 3 | ProdKey NULL, 이름 없음 | 209 | NULL / NULL |
| 2026/39-01 / 7474 | 42869 / 4 | ProdKey NULL, 이름 없음 | 270.5 | NULL / NULL |
| 2026/40-01 / 7581 | 44201 / 3 | 3100 / Gross weight | 225 | 225 / 225 |
| 2026/40-01 / 7581 | 44202 / 4 | 3101 / Chargeable weight | 345.5 | 345.5 / 345.5 |

추가 근거:

- 39차 운송료 상세 42866은 `BunchQuantity=270.5`, `UPrice=1.65`, `TPrice=446.325`이며 **270.5 × 1.65 = 446.325**다. 과금중량 후보와 실제 운송료 산술이 일치한다.
- 같은 연도·차수·AWB의 상품 전표 7470/7471은 태국 상품을 담고 있어 EXCEL 7474의 국가 연결 근거가 된다.
- 두 EXCEL 헤더 모두 `WarehouseMaster.GrossWeight`, `ChargeableWeight`는 NULL이다. 40차 정상 값도 헤더가 아니라 상세 특수 품목행에 저장돼 있다.
- 실제 `WarehouseDetail` 스키마에는 `ProdName`, 원문명, `Descr` 컬럼이 없다. `Product.Descr`는 있으나 39차 두 행에 Product 연결이 없으므로 그 행의 원문 라벨 근거가 될 수 없다.
- 해당 전표의 `FreightCost`, `TempWarehouseDetail`, 연결된 `WebInvoiceOperation/Line` 근거는 없었다. 2026/39-01·40-01의 `WebInvoiceDocument`도 조회 결과 0건이었다.

**화면과 조회 경로.** 실제 dnSpy `FormWarehouseView.grdViewMaster_FocusedRowChanged`는 `WarehouseDetail JOIN Product`로 상세를 읽는다. 네노바웹도 `pages/incoming.js`의 `apiGetExe` → `useExeParityFlag(undefined)=true` → `lib/exeWarehouseViewSql.js`의 동일 INNER JOIN이 기본이므로 NULL 두 행을 제외한다. `exeParity=0`을 명시한 레거시 분기만 LEFT JOIN으로 빈 품목명과 숫자를 반환한다. 조사 중 “웹에는 빈 품목명으로 보인다”라는 설명은 레거시 분기에만 해당하며 기본 화면 설명으로 사용하면 안 된다.

**운영 브라우저 확인.** 메인 에이전트가 실제 Chrome의 운영 버전 `65635f23`에서 확인했다. `/incoming` 최초 조회기간은 2026-10-20~10-27이었다. URL 기간을 07-27~10-27, 농장 EXCEL, 차수 39-01로 지정하면 **1/1,112건**이 표시되고 GW/CW는 `–`, 상세는 운송료 2행뿐이었다. 이는 SQL의 NULL 품목행이 기본 화면에서 제외되는 결과와 일치한다.

**한계.** 209=GW, 270.5=CW라는 해석은 정상 전표의 같은 순서·필드 및 운임 산술과 부합하지만, 39차 원문 라벨을 직접 확보한 것은 아니다. 이번 조사로 “중량 숫자 자체가 없다”는 설명은 정정할 수 있으나, 원문 확인 없이 제품 연결 또는 비용 계산값을 확정·수정하지 않는다.

**결과.** SELECT-only 진단 `.verify/review-thai-weight.mjs`, `.verify/review-thai-weight.json`. DB 변경 없음.

### 2. 2026-10-27 — 이전 입고가 기본 조회에서 보이도록 기간 확대

**Q.** 입고관리 조회 기본기간을 오늘 기준 최근 달력 3개월로 확대한다. URL 지정기간과 수동 선택은 유지한다.

**A.** 최초 조회 날짜만 변경하는 범위로 고정했다. 실제 EXE의 `FormWarehouseView_Load`는 `DateTime.Now.AddMonths(-3)`~`DateTime.Now`를 사용하며, 목록은 `CONVERT(DATE, wm.UploadDtm) BETWEEN`으로 조회한다. 한국 날짜와 달력 월 계산을 적용하되 업로드 입력일 기본값은 보존한다.

사전 SQL 확인:

- 활성 `WarehouseMaster`에서 업로드일 2026-07-27~2026-10-27 포함 범위는 **1,112건**이다. 실제 목록의 상세 존재 JOIN 조건을 적용해도 1,112건이다.
- EXCEL 7474의 업로드일은 2026-09-28, 7581은 2026-10-05이므로 모두 포함된다.
- 날짜 기준은 `UploadDtm`이다. 이번 작업으로 `InputDate` 또는 원장 날짜를 수정하지 않는다.

**결과.** 구현 기준과 회귀 계획은 `docs/plans/incoming-date-default-2026-10-27.md`에 기록했다. 날짜 helper·화면 연결·회귀 및 최종 검증/릴리스는 메인 에이전트가 진행 중이다. 사전 운영 확인을 변경 후 스모크 통과로 간주하지 않는다.

## 미완 / 다음 세션 후보

통합검증 완료: `verify:erp-change`(전체계약·manifest·쓰기guard·webpack build) 종료0, dnSpy evidence 및 기준65635f23 변경범위 검사 통과, UI layout57건 통과. 운영 환경 없이 실행하여 업무 DB 쓰기 없음. 아래 릴리스 단계는 아직 진행 중이다.

1. KST 자정, 월말·윤년·연도 경계, URL 양쪽/한쪽/빈값/과거값 보존 회귀를 확인한다.
2. 전체 ERP 계약·dnSpy·manifest·쓰기 가드·build 및 PR CI 결과를 기록한다.
3. CI 통과 후 squash 병합, Cafe24 코드 배포, 운영 `/incoming` 최초 3개월과 URL 복원 스모크를 검증하고 실제 PR/커밋/run 근거를 추가한다.
4. 39차 원문 GW/CW 라벨 확인과 품목 연결 보정은 별도 범위다. 이 조회 UI 작업을 명분으로 DB를 수정하지 않는다.

## 커밋하지 말 파일

- `.verify/`의 운영 SQL probe·JSON 및 임시 로그. 자격증명·개인정보·전체 대화 로그는 세션 문서에 넣지 않는다.

## 새 문맥 이어받기

`docs/work-sessions/INDEX.md`, 이 파일, `docs/plans/incoming-date-default-2026-10-27.md`를 읽고 이어서. 작업트리는 `C:/Users/USER/nw-incoming-date-default`. 조회 날짜 기본값만 KST 달력 3개월로 바꾸고 URL·수동값·uploadMeta는 보존한다. DB는 변경하지 않는다. 39차 EXCEL 중량 숫자는 있지만 ProdKey 연결이 없다는 진단과 조회 UI 변경을 분리하며, 테스트·PR·배포 완료 여부는 새 실행 근거로 확인한다.
