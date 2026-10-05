# 네덜란드 원본 시트·단가 수정 탭 설계

상태: 구현 전 설계, 2026-10-05. 기준 branch `codex/dutch-sheet-price-tabs`.
이번 변경은 입력·표시·매칭 개선이다. 적용 API/ERP 저장 정책 변경은 범위 밖이다.

## 1. 확인 근거와 목표

- 입력 파일 `.tmp/4002_네덜란드.xlsx`를 읽기 전용으로 확인했다. `네덜란드!A1:Y53`, 3행 헤더는 A 꽃/B 품목명/C 칼라/D:S 업체16개/T 주문/U 입고/V 재고/W 잔량/X 품목명/Y 입고다. `_keymap!A1:D68`은 `type,sheet,label,key`이며 행 위치 키가 아니다.
- 기존 파서는 A를 `product`, B를 `color`로 사용한다. 실제 파일의 B는 문자열, C는 칼라 헤더라 수량 추출 대부분은 동작하지만 C 설명을 잃고 두 형식을 명시적으로 구분하지 않는다. “81건 모두 파싱 실패”로 진단하면 안 된다.
- 메인 읽기 전용 probe `.tmp/inspect-4002.cjs`: 양수 셀81개 중79개 매칭, F36 `LEUCOTHOE DYED RED60cm`, M52 `ARAN Azima` 2개 미매칭. 이 수치는 변경 전 관찰이며 출시 후 결과가 아니다.
- ERP3441 `ARAN Azima (NL)`은 같은 FlowerName/네덜란드 품목이다. 레우코취는 Tinted Red1011/Wal teri Red1013/Absorbed red1014 등 후보가 있어 자동선택 근거가 없다.
- B12 `Royal Princess`와 오래된 키맵 `SnowBallWhite`965가 공존한다. 사용자 편집 파일에서 키맵을 행 순서로 복원하거나 무조건 명시키로 보내면 오매칭이다.
- 기존 `DutchVolumeDistribution.md`, `FormShipmentDistribution.btnSave_Click`/`ClassShipmentDate.UpdateCost` 근거와 메인이 재실행한 dnSpy/SELECT를 저장 정책의 기준으로 유지한다. 설계 담당은 운영 DB에 접속하거나 쓰지 않았다.

목표: 최초 화면은 원본 물량표 행렬이며 바로 옆 `단가 수정` 탭으로 편집한다. 같은 단가 상태를 양쪽에서 즉시 표시하고, 미매칭은 원본 품목명으로 검색을 시작해 사용자가 해결한다.

## 2. 기준·부작용 고정

| 사용자 동작 | 브라우저 초안 | ERP 주문/출고/날짜/농장 | Estimate·손익·재고·마스터 |
|---|---|---|---|
| 파일 업로드/탭 전환/원본 조회 | 파싱·표시, 탭 전환은 값 보존 | 보존 | 보존 |
| 단가·수량·단위·매칭 수정 | 공통 상태 갱신, 검증 토큰 무효화 | 보존 | 보존 |
| 품목 검색/ERP 재검증 | 후보·SELECT 결과 표시 | SELECT only | 보존 |
| 기존 적용 버튼 | 기존 owner-bound plan 사용 | 기존 CATEGORY_REPLACE 트랜잭션만 | 기존 보호 유지 |

- 업무키 `OrderYear + OrderWeek + CustKey + ProdKey`, 선택 연도/차수와 네덜란드 매칭 CountryFlower 전체 최종 SET 유지. 누락쌍→0, 기존 활성 주문(0 포함) 보존, 없는 양수 주문만 생성한다.
- 전부 KRW. 빈 단가=기존값 보존, 명시0=0원 변경. 주광은 개별, 그 외 같은 품목은 균일가라는 기존 정책 유지.
- 확정 차단, farm 수량 차단, Alstro 명시 단위, snapshot/stale/동시수정, native NULL, View/PeriodDay 검증, 감사·rollback 보호를 약화하지 않는다. 자동 fix/unfix·재고 보정·CustomerProdCost/Product.Cost 쓰기 금지.

## 3. 최소 모듈 변경과 데이터 계약

### 파서: `lib/dutchVolumePrice.js::parseDutchPivotWorkbook`

헤더를 검사해 식별 열을 정한다. 신형 `꽃/품목명/칼라`는 고객 시작D, 레거시 2열 식별 양식은 고객 시작C다. 알려진 레거시 헤더를 fixture로 고정하고, 헤더가 모순되거나 `주문` 경계가 없으면 실패 사유를 보여준다. 임의 전체 열 스캔으로 요약/입고/농장 수량을 고객 물량에 넣지 않는다.

공통 entry에는 다음 원본 메타데이터를 보존한다.

```text
id = sheetName!cellAddress (기존 셀 주소 유지)
sourceFlower / sourceItem / sourceColor / sourceCustomer
sheetName / cellAddress / sourceRow / sourceColumn / layoutVersion
quantity / unit / product / color / customer / optional manual prodKey,custKey
```

기존 서버 계약을 바꾸지 않도록 업로드 entry의 `product=sourceFlower`, `color=sourceItem`, `customer=sourceCustomer`를 유지한다. `sourceColor`는 C열의 설명으로 따로 표시하고 매칭 품목명을 대신하지 않는다. 원본 필드는 수동 ERP 매칭으로 덮어쓰지 않는다. 레거시 양식의 B가 실제 item label인 경우 `sourceItem=B`, 별도 descriptive color는 공란이다.

양수의 유한한 고객 셀만 기존 entry로 생성한다. 원본 행렬에는 빈칸/0/소계/요약/입고를 그대로 표시하지만 적용 입력으로 새로 넣지 않는다. 수량 텍스트/수식 캐시 오류는 설명하고, 임의 합계 재계산이나 workbook 실행은 하지 않는다.

### 매칭: `lib/shipmentImport.js::matchDutchProductByColor`

- 기존 활성 네덜란드 + FlowerName 일치 + exact/exporter alias + 유일 ProdKey 검사를 유지한다.
- `(NL)` 제거는 끝에 붙은 네덜란드 국가 표식만, Dutch 전용 비교 별칭에 추가한다. 규격·품종 괄호를 일반적으로 제거하지 않는다. 표식 제거 후 둘 이상의 품목이 같아지면 미매칭이다. 일반 Excel import 경로는 변경하지 않는다.
- 목표 파일은 ARAN3441만 추가 자동매칭될 것으로 예상되며, 실행형 fixture/실제 재검증으로 확인하기 전80/81 성공을 주장하지 않는다. LEUCOTHOE는 자동 DYED→Tinted/Absorbed 동의어를 만들지 않고 수동선택으로 남긴다.
- **이번 범위에서는 `_keymap` 자동 적용을 구현하지 않는다.** 79개가 현재 이름만으로 연결되고 키맵은 stale이므로 최소 안전 변경에 불필요하다. 업로드 키를 `prodKey/custKey`로 복사하지 않는다. 향후 도입 시 별도 hint 필드, 동일 sheet/type/정확 label, 중복키 충돌, 현재 활성 master/국가/품종/이름 재검증이 필수다. 수동 사용자 선택만 기존 명시키 계약을 따른다.

### 공유 초안: `lib/dutchVolumeDraft.js`

- v3 parser/draft schema로 분리한다. `{...sourceEntry,...savedEntry}` 전체 덮어쓰기를 없애고 검증된 동일 source identity에서 editable fields만 복원한다.
- 업로드 source identity는 파일명만이 아니라 내용 fingerprint + parser schema + 선택 연도/차수를 포함한다. 같은 이름/주소지만 내용이 달라진 파일은 별개다. LIVE도 선택 연도/차수 + 원본 데이터 fingerprint로 구별한다.
- v2 초안은 자동으로 source labels/ERP keys를 덮어쓰지 않는다. 자동 이전 대신 이전 초안이 적용되지 않았음을 안내하고 저장 데이터 자체는 삭제하지 않는 보수적 방식을 권장한다. KRW 확인 없는 구 EUR/unknown 값은 이전하지 않는다.
- entries/prices/revision은 페이지 한 곳이 소유한다. 탭에 별도 prices 사본을 만들지 않는다. `dutchPriceKey` 한 함수를 sheet badges·단가 입력·preview·export가 공유한다. 원본 셀 위치를 가격값이나 ERP키로 바꾸지 않는다.
- 매칭 변경 시 가격 identity 충돌을 명시적으로 처리한다. `name:`→`prod:` key 변경으로 가격이 조용히 사라지거나 숨은 orphan이 되면 안 된다. 동일 가격으로 안전하게 이전할 수 있으면 보존하고, 대상 균일가 충돌/다른 품목·업체라 이전할 수 없으면 가격 초기화와 재입력 안내를 즉시 표시한다. 주광 변경 시 이전 개별 가격 누출 금지, 균일가 충돌을 임의 마지막 값으로 합치지 않는다. 빈 가격과0은 렌더에서도 구분한다.

### 화면·검색: `pages/stats/dutch-volume-board.js`, `components/dutch/*`

- 기본 `원본 시트` / 바로 옆 `단가 수정` 두 탭. 소스 변경은 원본 탭으로 시작, 단순 탭 전환은 편집값·검증 상태를 유지한다.
- 원본은 workbook 사용 범위·병합·행열 순서·헤더·요약/입고 열을 읽기 전용 matrix로 보여준다. 셀 번호 또는 원본 주소로 편집 entry와 연결한다. 원본 수량과 편집 후 최종수량이 달라졌으면 둘을 구분하며 원본 요약값을 최종 합계처럼 표시하지 않는다.
- 단가는 수량 셀의 명확히 구분된 badge/보조표시로 즉시 나타난다. 수량 숫자/셀/formula 자체를 가격으로 대체하지 않는다. 주광 개별·비주광 균일가 모두 즉시 반영한다. 수동 추가행은 원본 셀에 억지 삽입하지 않고 별도 초안임을 표시한다.
- 단가 수정 탭은 기존 매칭/수량/단위/단가 편집 기능을 보존한다. 원본 시트 셀의 ‘수정’ 선택은 해당 entry의 편집행으로 이동할 수 있다.
- picker에 `initialQuery=sourceItem || 원본 product`를 전달한다. 열 때 원본 품목명으로 seed하고 검색어는 사용자가 지울 수 있다. 원본이 없는 수동행은 빈 검색. 렌더마다 사용자가 입력한 query를 재설정하지 않는다. 기존 `/api/products/search` 랭킹을 재사용하고 후보 자동선택 금지, 네덜란드/품종/단위/키를 보여준다.
- 검색 응답의 요청 순서/닫힘/entry 변경을 검사한다. 매칭 선택은 명시 단위를 덮지 않고 재검증을 요구한다.
- 검증·오류·전체교체 미리보기·적용 확인·로그는 두 탭 어디서든 찾을 수 있는 공통 영역으로 유지한다. 현재 차단 결과와 이전 결과 표시는 분리하고 token 없는 결과는 적용 불가다.
- 1920×1080 CSS px/100% 우선. 원본은 가로/세로 scroll, 상단 헤더와 식별열 sticky를 사용하되 z-index 겹침을 검증한다. 페이지 너비1920 고정 금지. 좁은 화면에서 picker/modal·버튼이 잘리지 않게 한다. HTML/XML 업로드 내용을 raw HTML로 삽입하지 않는다.

## 4. 수용·회귀 검증

1. 실제 파일 파서:81양수 entry,16고객, D:S만 사용; T:Y 숫자·수식은 entry 아님. A/B/C 원본 필드와 셀 주소 보존. legacy2열 fixture도 동일 수량/주소로 통과.
2. `_keymap` stale SnowBallWhite965는 Royal Princess 행을965로 바꾸지 않음. 키맵 삭제/변조/중복/순서변경이 자동명시키를 만들지 않음.
3. ARAN Azima→3441: same-flower/NL positive; 다른 국가/품종, 접미가 아닌NL, 규격 괄호, 중복 normalized label negative. LEUCOTHOE는 미매칭 유지, 검색 seed=원본 이름, 후보 수동선택 후 재검증.
4. 이전80/81 등 결과를 단정하지 말고 실제 full preview의 matched/unmatched reason을 기록. 미매칭0과 적용가능은 다름: fixed/farm/Alstro/기타 guard가 있으면 token 없음.
5. 탭 왕복으로 state/revision 유지; 단가 수정 즉시 원본 표시. 공란/0/양수, 주광 개별/비주광 균일가, 재매칭/다른 파일/연도·차수 변경, 빠른 비동기 응답, v2 초안 복원 회귀.
6. 다운로드 원본 range/수량/formula/merge/열순서 보존, existing price drawing/export 동작 회귀. 원본 미리보기는 ERP 저장하지 않으며 단가 입력에도 write API 호출 없음.
7. `test:erp-contract`, `test:nenova-dnspy-evidence`, 변경기준 manifest/write guard, `test:pivot`, Dutch parser/UI/policy fixtures, `build`; 저장 코어 불변 확인 및 기존 격리SQL 회귀를 메인이 실행한다.
8. 1920×1080/100% 실브라우저: 원본 기본탭, 단가 즉시표시, 스크롤/sticky/picker 겹침, 막힌 검증 안내, 키보드 이동, 일반 shell1개/popup 간소화 확인. 운영에서는 읽기 전용 업로드·검색·preview만 수행한다.

## 5. 알려진 위험·완료 경계

- 자동매칭률을 올리려는 fuzzy 확장은 category-wide SET에서 잘못된0을 만들 수 있다. 모호한 한 품목을 남기는 것이 정상이며 수동선택 UX로 해결한다.
- 고객별 원본 수량 단위와 단가 EstUnit은 다를 수 있다. 원본 수량×단가를 금액으로 표시하지 않는다. 알스트로의 기존 단위 차단 유지.
- 저장 초안/HTML matrix가 원본 workbook을 변형하거나 가격을 수량으로 내보내는 회귀를 우선 검사한다.
- 메인이 dnSpy·읽기 근거·의존성을 준비했다. 이 설계 문서 자체는 구현·테스트·배포 완료 또는 운영 적용 승인이 아니다. 이 작업에서 파일 이외 ERP 원장·외부 시스템은 변경하지 않았다.
