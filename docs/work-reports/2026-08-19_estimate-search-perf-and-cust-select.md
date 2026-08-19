# 2026-08-19 견적서관리 거래처 선택 오류 · 품목 검색 지연

## 요청

1. 거래처 검색 후 업체를 선택했는데 검색어가 사라지고 다른 업체로 바뀐다 → 원인 확인
2. 영문 입력으로도 한글 검색이 되어 입력 모드는 문제 없음 (조치 불필요)
3. 불량/검역등록, 추가품목등록의 품목 검색 로딩이 매우 오래 걸린다 → 해결
4. 견적서관리 수량·단가 수정이 너무 오래 걸린다 → 원인 파악

## 1. 거래처 선택이 다른 업체로 바뀌는 원인

`pages/estimate.js`의 거래처 검색은 `custSearch`가 바뀔 때마다 300ms 디바운스 후
`/api/customers/search`를 호출한다. 여기에 세 가지 결함이 겹쳐 있었다.

| 결함 | 내용 |
|---|---|
| 선택이 재검색을 유발 | 업체 선택 시 `setCustSearch(c.CustName)`으로 검색어를 업체명으로 바꾸므로 검색 이펙트가 다시 돌았다. |
| 늦은 응답 방어 없음 | 디바운스 타이머만 취소하고 이미 떠난 요청은 취소하지 않아, 이전 검색어의 응답이 최신 목록을 덮어썼다. |
| 응답마다 목록 재개방 | 응답 성공 시 무조건 `setShowCustDrop(true)` — 선택으로 닫은 목록이 다시 열렸다. |
| 닫힌 상태 Enter | `useDropdownNav`는 `idx === -1`이면 `list[0]`을 고른다. 선택 후 `reset()`으로 `idx=-1`이 되므로, 이어진 Enter가 그 시점 목록의 첫 항목을 다시 선택했다. |

재현 경로: 부분 검색어 입력 → 요청 A 출발 → 업체 B 클릭(검색어가 B 업체명으로 바뀜)
→ 요청 A 응답 도착 → 목록이 A 결과로 덮이고 드롭다운 재개방 → Enter → `list[0]`인
다른 업체로 선택 변경.

### 조치

- `lib/customerSearch.js`에 `shouldRunCustomerSearch(query, appliedSelectionName)` 추가.
  선택으로 채워진 검색어는 재검색 대상에서 제외한다.
- 요청 순번(`custReqSeq`)을 도입해 최신 요청의 응답만 목록에 반영한다.
- 선택/초기화를 `pickCustomer` / `resetCustomerSearch`로 통합하고, 선택 시 순번을 올려
  진행 중 응답을 무효화한다.
- 이미 업체를 고른 상태에서는 포커스만으로 목록을 다시 열지 않는다.
- 목록이 닫힌 상태의 Enter는 무시한다.

## 2. 입력 모드

영문 자판 입력이 한글 검색으로 연결되는 것을 확인했으므로 `한글입력`/`영문입력`
토글은 현재 동작을 유지한다.

## 3. 품목 검색 로딩 지연

두 모달 모두 페이지 진입 시 전체 품목 카탈로그를 한 번 받고, 이후 검색은 클라이언트에서
점수를 계산한다. 지연의 실체는 API가 아니라 **키 입력마다 전체 카탈로그를 재계산**하는
것이었다.

| 원인 | 위치 |
|---|---|
| 키 입력마다 전체 카탈로그 점수 재계산, 디바운스 없음 | `SearchableSelect`, `OrderRegisterDistributeModal` |
| `prodOptions`가 매 렌더마다 새 객체 → 캐시 무효화 | `pages/estimate.js` |
| 검색어 없을 때 전체 목록을 DOM에 렌더 | `SearchableSelect` |
| `bestLetterSimilarity`가 품목마다 n-gram 후보를 재생성 | `lib/displayName.js` |
| `letterSimilarity`가 후보 × 후보 조합마다 `compactLetters` 재실행 | `lib/displayName.js` |
| `lcsLength`가 호출마다 2차원 배열 신규 할당 | `lib/displayName.js` |
| `findConcept`(국가·품종)를 품목마다 재판정 | `lib/naturalLanguageProductMatching.js` |
| `tokenizeForMatch`(검색어)를 품목마다 재실행 | `lib/displayName.js`, `lib/productSearchRanking.js` |

### 조치

- 품목명·검색어 단위 메모이제이션(`tokenizeForMatch`, `compactCandidates`,
  `preparedCandidates`, `decomposeHangul`, `getChosung`, 국가·품종 개념 판정).
  상한 5만 건, 초과 시 비움.
- `letterSimilarity` 정규화를 후보별로 한 번만 수행(`preparedCandidates`)해
  후보 × 후보 루프에서 문자열 재가공을 제거.
- `lcsLength`를 행 2개 재사용 방식으로 변경해 할당을 제거.
- 품목 객체 단위 `WeakMap` 캐시(`compactProductText`, `compactDisplayName`).
- 검색어 별칭 그룹을 검색어 단위로 1회만 계산.
- UI: 250ms 디바운스 + `useMemo`, `prodOptions` 메모이제이션,
  드롭다운 렌더 상한 200행(`lib/productSearchLimits.js`).

### 성능 측정 (품목 4,000건, `carnation`까지 9타 입력)

| | 첫 입력 | 전체 타이핑 | 타당 평균 |
|---|---:|---:|---:|
| 변경 전 | 115ms | 2,130ms | 237ms |
| 변경 후 | 67ms | 398ms | 44ms |

**5.4배 개선.** 순위 결과는 동일하다. 변경 전/후 모듈을 나란히 두고 48개 검색어 ×
2회 패스 × 3계층(`rankProductSearchOptions`, `scoreProductSearchOptions`, `scoreMatch`)
총 288건을 대조해 불일치 0을 확인했다.

## 4. 수량·단가 수정 지연 원인 (이번 배포 범위 아님)

확정된 차수(`isFix=1`)의 수량·단가를 고치면 직접 UPDATE가 차단되므로
`확정해제 → 저장 → 재확정` 사이클을 반드시 거친다(`docs/CONFIRMED_WEEK_EDIT_SAFETY_CHECKLIST.md` C-1).

셀 하나를 고칠 때 실제로 일어나는 일:

1. 직접 저장 시도 → `FIXED_WEEK` 409 (버려지는 왕복 1회)
2. 대상 차수 + 뒤따르는 확정 세부차수 전부 확정해제
   — 세부차수마다 `usp_ShipmentFixCancel` + `usp_StockCalculation`(카테고리별)
3. 실제 저장(작은 트랜잭션, 쿼리 5~8개)
4. 같은 범위 재확정 — 음수재고 검사 + `usp_ShipmentFix` + `usp_StockCalculation`
5. 저장 후 `load(true)` + `selectShipment()`로 차수 전체를 두 번 다시 조회

세부차수 2개 · 카테고리 10개 기준 HTTP 왕복 약 8회, SQL 배치 140~200회,
저장 프로시저 40회 이상이며 대부분이 `usp_StockCalculation`이다. UI 타임아웃이
20분(`FIX_UNFIX_FETCH_TIMEOUT_MS`)으로 잡혀 있는 것도 이 때문이다.

### 가장 큰 개선 여지

`pages/api/shipment/fix.js`가 클라이언트가 보내는 `skipStockCalc`를 무시하고
`const skipStockCalc = false`로 고정하고 있다. 단가만 바꿔 수량이 그대로인 경우
`docs/ERP_CHANGE_GUARD.md`에 "기존 수량 미변경 시 재고계산 생략"이 이미 명시돼 있고
클라이언트도 `lightStock: true`를 보내지만, 서버가 이를 버려 확정해제·재확정 매 단계에서
전체 재고계산이 돌아간다. 이 플래그를 살리면 단가 수정은 크게 빨라진다.

다만 재고 원장과 확정 상태에 직접 영향을 주는 변경이므로 이번 배포에 포함하지 않고,
별도 작업으로 `npm run verify:week` 전후 대조와 견적·매출 집계 확인을 함께 수행한다.

## 검증

```
npm run test:estimate        → pass (estimateSearchBehavior 신규 포함)
npm run test:erp-contract    → pass
npm run test:board           → pass
npm run guard:erp-writes     → pass (187 API 파일)
npm run test:ui-layout       → pass (97 page 파일)
npm run build                → pass
```

## 변경 파일

| 파일 | 변경 |
|---|---|
| `pages/estimate.js` | 거래처 선택 경합 차단, 품목 검색 디바운스·메모이제이션 |
| `lib/customerSearch.js` | `shouldRunCustomerSearch` 추가 |
| `lib/displayName.js` | 문자열 메모이제이션, `lcsLength` 할당 제거, 후보 정규화 1회화 |
| `lib/naturalLanguageProductMatching.js` | `compact`·국가·품종 개념 판정 캐시 |
| `lib/productSearchRanking.js` | 품목 단위 `WeakMap` 캐시, 별칭 그룹 1회 계산 |
| `lib/productSearchLimits.js` | 신규 — 디바운스·렌더 상한 공통 상수 |
| `lib/useDebouncedValue.js` | 신규 — 검색 입력 디바운스 훅 |
| `components/estimate/OrderRegisterDistributeModal.js` | 품목 검색 디바운스·메모이제이션 |
| `__tests__/estimateSearchBehavior.test.js` | 신규 — 선택 경합 차단 + 순위 고정 계약 |
| `package.json` | `test:estimate`에 신규 테스트 등록 |
