# Estimate 페이지 버튼 기능 감사 — 2026-08-26

## 최종 결과 — 로컬 수정·검사 완료, 미배포

사용자의 마지막 지시는 **수정작업과 버튼별 검증만**이다. 이번 작업은 원격 업로드·병합·배포를 하지 않았고, 운영 견적/주문/분배/재고의 저장·삭제·확정·확정취소도 실행하지 않았다. 아래 최초 조사 기록은 수정 전 발견사항이며, 현재 상태는 이 표를 우선한다. 최초 조사에 적힌 줄 번호는 수정 전 기준이다.

| 항목 | 최종 상태 | 확인 결과 |
| --- | --- | --- |
| 수국 수정인데 다른 품종까지 확정취소 | 수정·회귀검사 완료 | 실제 변경 ProdKey의 Product.CountryFlower로 범위를 결정한다. 요청마다 한 품종만 처리하며 빈 품종을 전체로 확대하지 않는다. |
| 자동 편집의 취소 단계 일부 실패 | 수정·회귀검사 완료 | 이번 시도에서 성공이 확인된 품종만 복구한다. 원래 미확정인 품종은 확정하지 않으며, 응답이 불명확하면 무조건 반복 실행하지 않는다. |
| F-01 업체가 재조회 후 바뀜 | 공통화 수정·자동검사 완료 | 현재 선택을 유지하고 검색 초안과 적용 업체를 분리한다. 모든 저장/삭제 후 공통 재조회, 늦은 목록/상세/오류/저장 완료 차단. 이전 단계 화면 검사는 성공했으나 후속 공통화 수정본의 브라우저 클릭 검사는 연결 오류로 미완료이며 구분해 기록한다. |
| F-02 확정현황에서 여러 차수 수동 일괄 취소 | **잔여 위험** | `/api/shipment/fix-status`의 여러 대상 순차 처리에 전체 취소 보장이 없다. 자동 편집 품종 한정 경로와 별개이며 이번에 해당 API는 수정하지 않았다. |
| F-03 여러 종류의 수정 한꺼번에 저장 | **잔여 위험** | 수량·Estimate 수량·단가·추가 품목이 별도 요청이다. 앞 요청 성공 뒤 다음 요청 실패 시 부분 저장 가능성이 남는다. |
| F-04 확정 사전검증 조회 실패 | 수정·회귀검사 완료 | 조회 실패를 정상으로 간주하지 않는다. 실패 차수/이유를 표시하고 확정 요청을 보내지 않는다. |
| F-05 인쇄/엑셀에서 조회 실패 업체 누락 | 수정·회귀검사 완료 | 실패 업체명을 안내하고 부분 문서 생성을 중단한다. 정상 조회된 0행은 조회 실패와 구분한다. |
| F-06 추가 품목의 늦은 단가·출고일 후보 | 수정·회귀검사 완료 | 업체/연도/차수/품목/모달 열림 회차를 대조한다. 다른 범위의 후보는 무시하고 기존 수량은 보존한다. |
| F-07 잘못된 수량 입력의 조용한 제외 | **잔여 위험** | 일부 수량 저장 경로에서 음수·숫자가 아닌 값을 걸러내고 나머지만 처리할 수 있다. 전체 입력 오류 표시 개선은 미수행이다. |

### 버튼별 보존 및 검증 범위

- `불량/검역등록`, `불량차감등록`, `판매요청`, `추가 품목등록` 네 버튼과 독립 모달을 로컬 실제 브라우저에서 확인했다. 앞 세 버튼은 Estimate 등록이고 추가 품목은 대기열에 담은 뒤 저장하는 기존 흐름을 유지한다.
- 수량/통합/품목정보/추가 품목에서 자동 확정 사이클이 필요한 경우 변경 품종을 서버에서 재확인한다. **같은 품종의 다른 업체까지 포함하는 EXE 품종 단위 확정 범위는 유지**하며, 거래처 한 곳만의 확정 상태로 바꾸지 않는다.
- 단가만 저장 및 `단가 + 업체 지정단가 함께 저장`은 기존 단가 전용 경로를 유지한다. 이 경우 확정취소/재고계산을 실행하지 않는다.
- 선택 불량·검역차감 삭제의 기존 연도·업체·행 대조와 선택 삭제 계약을 유지하고 관련 검사에 통과했다.
- 확정취소의 “중간 재고합산 생략”은 EXE 저장 프로시저 내부의 개별 재고 이력까지 없앤다는 뜻이 아니다. 마지막 재확정의 합산은 유지한다.

### 실제 근거와 검사 결과

1. 실제 `Nenova.exe`를 dnSpy CLI로 확인했다. `FormShipmentDistribution`의 확정/취소는 선택한 `CountryFlower`를 넘긴다. 운영 DB는 SELECT로 프로시저 정의·연도별 상태·관련 조회만 대조했다. 운영 프로시저를 실행하지 않았다.
2. 2025/2026 동일 `34-01`, `34-02`가 분리되는 것을 읽기 전용으로 확인했다. 2026-34-02 수국 범위는 ViewOrder 107행, ViewShipment/ShipmentDetail 확정 96행, 날짜 연결 96행이었다. 농장 행 0건이라는 기존 자료도 확인했으나 보정하지 않았고, 이를 근거로 모든 원장 정합성이 검증됐다고 판단하지 않는다.
3. `test:estimate-edit-safety`, `test:estimate`, `test:estimate-delete`, `test:board`, 전체 `test:erp-contract`, dnSpy 근거 검사, 변경 범위 검사, 쓰기 보호 검사, 운영용 빌드가 통과했다. 변경 범위 검사는 `origin/master`와 비교했다. 신규 회귀 검사는 기본 견적/ERP 검사에 연결했다.
4. 운영 API로 전달하지 않는 로컬 가짜 자료 연결 서버와 실제 브라우저로 업체 B 선택→재조회 유지, 상단 업체 필터, 네 등록 모달, 확정현황 창을 확인했다. 응답 역전은 지연 응답을 직접 제어하는 실행 테스트로 검사했다. 브라우저 화면 시험의 지연만으로 모든 응답 역전을 입증했다고 보지 않는다.
5. 실제 운영 수량·단가·추가품목·차감 등록/삭제는 **실행하지 않았다**. 문서 생성 실패 검사는 가짜 응답 기반 검사다. 따라서 “운영에서 모든 버튼의 저장까지 검증 완료”가 아니다.

### 후속 검토가 필요한 버튼

`수정 저장`의 여러 종류 동시 저장, `확정현황`의 여러 차수 수동 일괄 취소, 잘못된 수량 입력 처리에 위 잔여 위험이 있다. 별도 원자적 저장 계약·실패 복구·격리 시험 설계가 필요하며, 이번 품종 범위 수정과 함께 완료됐다고 표시하지 않는다.

## 최초 정적 조사 기록 — 수정 전

> 후속 요청 기록: 사용자가 일반 조회·수량·단가 저장뿐 아니라 모든 재조회 경로의 선택 유지 통일을 요청했다. 후속 구현·검사 결과는 같은 날 `2026-08-26_estimate-selection-category-design.md`의 후속 절과 세션 기록에서 구분한다. 이 문서 아래의 최초 조사에서 `검색어 편집 시 selectedCust=null`이라고 적힌 내용은 수정 전 동작이다.

현재 `pages/estimate.js`와 호출 컴포넌트/API를 정적 소스 기준으로 전수 추적했다. 이 보고서에서는 구현을 수정하지 않았고, 운영 DB·브라우저·nenova.exe·배포도 실행하지 않았다. 감사 대상은 현재 dirty worktree의 라인이다.

가장 중요한 확인 결과는 다음과 같다.

1. 페이지의 일반 견적 수량·단가 수정, Estimate 수량/등록 수정, 선택 차감 삭제는 각각 별도 API와 연도·거래처·편집 guard를 사용한다. 단가만 수정하는 경로는 확정취소/재고계산 없이 동작하도록 분리되어 있다.
2. 네 가지 등록 버튼 중 세 개는 즉시 `/api/estimate`에 Estimate 행을 쓰고, `＋ 추가 품목등록`은 모달에서 대기열만 만들며 `[수정 저장]` 시 `/api/shipment/adjust`로 출고/분배를 쓴다.
3. 메인 작업에서 처리 중인 stale customer selection 문제의 직접 근거가 있다. 등록 POST는 `selectedShip.CustKey`를 쓰지만 성공 후 재조회는 `selectedCustKey`를 사용한다(`pages/estimate.js:2819-2845`). 선택 범위가 바뀐 직후에는 상세 재조회가 다른 업체 기준이 되거나 빈 결과가 될 수 있다. 이 sidecar에서는 수정하지 않았다.
4. category unfix/recovery에는 부분 성공 위험이 남는다. `/api/shipment/fix-status` POST는 대상별 취소와 재고계산을 순차 처리하고 실패를 누적하여 `207/409`로 반환한다(`pages/api/shipment/fix-status.js:487-584`). 전체 구간 원자성은 소스에서 보장되지 않는다. 이 역시 메인 작업 범위로 남겼다.
5. 혼합 `[수정 저장]`은 수량 → Estimate 수량 → 단가 → 추가 품목을 여러 POST로 순차 실행한다(`pages/estimate.js:2281-2401`). 후속 요청이 실패해도 앞선 성공 요청을 되돌리는 batch transaction은 보이지 않는다.
6. 다중 인쇄/Excel은 업체별 조회 실패를 `console.error`만 남기고 다음 업체를 계속 처리한다(`pages/estimate.js:3265-3307`, `3328-3420`). 일부 업체가 빠진 산출물이 성공처럼 다운로드될 수 있다.

## 감사 범위와 준거

읽은 지침은 저장소 루트 `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/PLAN.md`, `.claude/PROGRESS.md`, 전역 guard skill `C:\Users\USER\.codex\skills\guard-nenova-erp-changes\SKILL.md`, 저장소 guard skill `.claude/skills/nenova-erp-change-guard/SKILL.md`, 그리고 `docs/ERP_FEATURE_CHANGE_CHECKLIST.md`, `docs/ERP_CHANGE_GUARD.md`, `docs/ERP_COMPAT_INVARIANTS_2026-06-04.md`, `docs/DB_STRUCTURE.md`, `docs/WEB_VS_ERP_CONFLICTS.md`, `docs/exe-golden/FormEstimateView.md`, 관련 estimate contract JSON이다.

이 최초 조사를 맡은 하위 작업에서는 `docs/CODEX_SUBTASK_ORCHESTRATION.md`가 배정 작업공간에 없었다. 메인 작업은 정본 `C:\Users\USER\Documents\Codex\2026-07-11\new-chat\work\nenova-erp-ui\docs\CODEX_SUBTASK_ORCHESTRATION.md`를 먼저 읽고 범위·모델·권한·운영 쓰기 금지를 하위 작업에 전달했다.

이 문서는 버튼의 “소스상 handler/API/guard/쓰기 범위” 감사다. 문자열 존재만으로 런타임 성공을 주장하지 않는다. 아래의 테스트 결과도 DB 연결·브라우저 클릭·실제 API 호출이 아니라 기존 local Node source/contract test 결과다.

## 버튼·컨트롤 전수 목록

### 1. 조회·연도/차수·거래처·요일 범위

| UI 기능 | 조건/handler | 호출 및 쓰기 범위 | scope/guard 및 부정 시나리오 |
|---|---|---|---|
| 연도, 이전/다음 차수 | `yearStr`, `weekNum`; `weekPrev/weekNext` (`pages/estimate.js:733-734`, `1023-1024`), 상단 입력 UI (`3850` 부근) | 상태만 변경. 자동조회가 켜져 있으면 `load(true)`가 `/api/estimate` GET (`1478-1485`, `1386-1478`) | GET에 선택 연도를 포함한다. 2025→2026처럼 같은 차수만 바꿀 때 이전 상세가 새 응답 전까지 화면에 남을 수 있으므로, 응답 전 화면을 “새 범위 확정”으로 해석하면 안 된다. 오래된 응답은 selection token으로 적용을 제한한다. |
| 거래처 검색/선택/초기화 | 검색 debounce 및 sequence guard (`1299-1317`); `pickCustomer`, `resetCustomerSearch`, 입력 변경 (`3900-3970`) | `/api/customers/search` GET; 선택 후 자동조회 또는 수동 조회 | 선택 시 검색 응답 sequence를 무효화한다. 입력을 다시 시작하면 `selectedCust`를 null로 만든다. 다만 성공 후 등록 재조회가 `selectedCustKey`를 참조하는 별도 경로는 F-01 참조. |
| 요일 chip 상·하단 | `toggleWD` (`3569`), 상단 chip (`3984-3988`), 하단 chip (`4550` 부근) | 상태만 변경; `load`/인쇄 GET에 `weekDays`가 들어가고 화면 필터도 적용 | 0요일은 조회/인쇄 시 경고 또는 빈 결과가 된다. 요일 변경 중 예전 GET이 돌아와도 selection token이 다른 scope 응답을 차단한다. |
| 자동조회, 미확정 포함 | 토글 (`3990-4012`) | 상태 변경 후 `/api/estimate` GET; DB write 없음 | `includeUnfixed`는 조회 범위다. 미확정 포함을 끄면 목록이 없어도 데이터 삭제로 해석하면 안 된다. |
| `조회 / Buscar` | `load(false)` (`4023-4025`) | `/api/estimate` GET; 선택 연도·차수·거래처·요일 전달 (`1432-1438`) | 차수와 거래처가 모두 없으면 거부한다. 새 응답이 성공한 뒤에만 목록/상세 scope를 교체한다 (`1439-1469`). |
| 비활성 `저장` | disabled 안내 버튼 (`4024-4025`) | 없음 | 실제 저장은 단가/수량/등록별 버튼으로만 진행된다. 이 버튼을 저장 경로로 세지 않았다. |

### 2. 출고 목록·행·불일치·선택

| UI 기능 | 조건/handler | 호출 및 쓰기 범위 | 확인 사항 |
|---|---|---|---|
| 최근 2개/전체, 목록 전체 선택 | `recentOnly` 토글 및 header checkbox (`4050-4085`) | 상태만 변경 | 전체 선택은 보이는 목록과 `visibleSelectedCount` 기준이다 (`2570-2575`). 숨겨진 선택을 전체선택 상태로 잘못 세지 않도록 되어 있다. |
| 업체/차수 행 클릭, 행 checkbox | `selectShipment(groupId, CustKey, ShipmentKeys)` (`1499-1512`, `4126-4138`) | `/api/estimate` 상세 GET 및 mismatch GET (`1376-1384`); write 없음 | year/week/customer/group scope를 새 token으로 활성화하고 기존 items를 비운 뒤 요청한다. 다중 선택은 인쇄 대상이고 우측 상세는 한 group이다. |
| 개별 sub-week `확정취소` | 행의 `unfixOneWeek(wk)` 버튼(출고 목록의 `SubWeeksFix` 분기, `4119` 부근); 초기 handler는 `postShipmentFix` (`842` 부근) | `/api/shipment/fix` POST; Shipment fix cancel/stock calculation 경로 | 선택 거래처와 무관하게 sub-week/연도 범위가 핵심이다. fixed/later-week guard와 server response를 반드시 확인해야 하며, 전체 status modal 경로의 부분 성공 위험은 F-02에 기록했다. |
| 주문 vs 출고 불일치 | mismatch badge/button (`4100` 부근) | `/api/estimate?view=mismatch` GET; read-only 상세 modal | 주문/분배 차이를 표시할 뿐 자동 repair 쓰기는 없다. “수정 가능”으로 오해하지 않도록 별도 write handler가 없음이 확인됐다. |

### 3. 수량·단가·업체 지정단가 저장

| UI 기능 | 조건/handler | 호출 및 business write | guard/scope 및 negative scenario |
|---|---|---|---|
| 표의 정상 출고 수량 수정 | row input과 `[수량 수정 적용]` (`4300-4317`, input `4470` 부근); `applyQtyEdits` | `/api/estimate/update-date-quantity` (`1560-1647`)가 `ShipmentDate.EstQuantity` 및 연결 `ShipmentDetail` 합계를 갱신. fixed가 걸리면 `runEditWithFixCycle`로 취소→저장→재확정 | 연도·거래처·old quantity·editGuard를 전달한다. 음수/NaN은 `applyQtyEdits`에서 해당 항목을 걸러낸다(`1839` 부근). 혼합 입력에서 잘못된 값이 조용히 제외되고 유효한 나머지만 저장될 수 있는 UX risk가 있다(F-07). |
| Estimate 행 수량 수정 | `applyAllEdits` 내부 Estimate 분기 (`2281-2329`) | `/api/estimate/update-quantity`; Estimate Quantity/Amount/Vat만 수정, Shipment/Stock 직접 수정 없음 | Estimate 음수 부호와 `expectedOldQuantity`, `orderYear`, `custKey`, `editGuard`를 보낸다. 일반 출고와 동일한 fix cycle로 취급하지 않는 것이 현재 설계다. |
| 단가 입력/`단가 적용하기` | cost input 및 버튼 (`4200-4219`), `applyCostEdits` (`1963-2133`) | `/api/estimate/update-cost`; 정상 ShipmentDetail/ShipmentDate와 Estimate cost/amount/vat를 갱신. mode에 따라 `CustomerProdCost` 또는 `WeekProdCost`도 갱신 | exact edited key, old cost snapshot, year/week/customer, editGuard를 사용한다. cost-only는 확정취소/재고계산을 하지 않는다. 확정 상태에서 단가만 바꿔도 stock side effect가 없도록 분리되어 있다. |
| 업체 지정단가 함께 저장 | 화면에는 checkbox가 아니라 `costMode` select의 `fixed` option (`4200-4210`) 및 별도 `[단가 + 업체 지정단가 함께 저장]` (`4220-4228`) | `applyCostEdits('fixed')` → `/api/estimate/update-cost` | 정상 행의 업체 지정단가를 저장하고 Estimate(불량/검역/판매요청) 행은 견적 단가만 변경하며 `customerCostSkippedEstimate` 안내를 표시한다(`2164-2181` 부근). 다른 업체/다른 차수 scope는 API에서 제외해야 한다. |
| 차수 즐겨찾기/1회성 | select option `once`, `weekFav` (`4207-4209`) 및 `[단가 적용하기]` | `/api/estimate/update-cost` mode에 따라 현재 견적만, 또는 현재 year+week+customer+product 즐겨찾기 | mode가 UI state에 의존하므로 저장 직전 선택값과 결과 note를 확인해야 한다. 기존 단가 snapshot이 맞지 않으면 stale error로 중단한다. |
| 단가/수량/추가품목 혼합 `[수정 저장]` | (`4190-4196`, `2281-2429`) | 여러 POST를 순차 실행: date qty → Estimate qty → cost → `/api/shipment/adjust` ADD | 각 요청에는 guard가 있으나 전체 작업의 transaction/rollback은 없다. 앞선 단계가 성공하고 뒤 단계가 실패하면 부분 저장이 남을 수 있다(F-03). |
| 수정 취소 | cost/qty pending state reset (`4290-4317`) | 상태만 되돌림. 이미 저장된 DB 변경은 되돌리지 않음 | 저장 완료 후 취소 버튼은 undo가 아니다. 이 점은 사용자 안내/테스트에 명시할 필요가 있다. |

### 4. 네 가지 등록 버튼과 품목 편집

네 버튼은 동일한 선택 거래처/선택 출고와 `deductionDeleting`, `estimateEditPresence.blocked` 조건을 공유한다(`pages/estimate.js:4326-4344`).

| 버튼 | 모달/handler | 실제 write와 scope |
|---|---|---|
| `＋ 불량/검역등록` | `openEstimateEntry('legacy')` → legacy estimate type 선택 | `handleDefectSave`가 `/api/estimate` POST (`2752-2760`, `2800-2845`). 음수 Estimate, 선택 `ShipmentKey`, `selectedShip.CustKey`, 선택 연도/차수로 저장한다. |
| `＋ 불량차감등록` | `openEstimateEntry('defect')` | 동일 `/api/estimate` POST. defect context GET로 이전 차수 분배단가/EXE sale row를 확인하고 음수 필수 검증을 한다(`2762-2797`, `2800-2814`). |
| `＋ 판매요청` | `openEstimateEntry('sales')` | 동일 `/api/estimate` POST. 판매요청은 음수 해제/양수 규칙을 검증한다. 현재 Shipment/Stock 직접 쓰기가 아니라 Estimate 등록 경로다. |
| `＋ 추가 품목등록` | `setShowAdditionalProduct(true)` → `OrderRegisterDistributeModal` | 모달의 `목록에 담기`는 즉시 DB write가 아니다(`components/estimate/OrderRegisterDistributeModal.js:159-187`, `352-361`). 대기열을 만든 뒤 `[수정 저장]`에서 `/api/shipment/adjust` POST `type:ADD`, `mode:PIVOT_DISTRIBUTION`, `year`, `estimateAdditional:true`로 저장한다(`pages/estimate.js:2364-2401`). 이는 Shipment/Distribution/Stock downstream effect가 있는 business write다. |

`handleDefectSave`의 POST scope는 `selectedShip.CustKey`를 사용하지만, 성공 후 상세 재조회는 `selectShipment(selectedId, selectedCustKey)`를 호출한다(`pages/estimate.js:2819-2845`). 이 불일치가 stale customer selection의 구체적 근거다(F-01). 추가 품목 모달도 상품 context GET이 응답 순서 token 없이 `updateLine`을 적용한다(`components/estimate/OrderRegisterDistributeModal.js:121-136`); 업체를 바꾼 직후 늦은 이전 업체 응답이 가격 context를 덮을 수 있는 related risk다(F-06).

품목명 버튼/`✏️ 품목 정보 수정`은 `openItemEditor`로 열리고(`pages/estimate.js:4345-4349`), Estimate row는 `/api/estimate/update-entry`, 정상 row는 `/api/estimate/update-date-quantity` 또는 `/api/estimate/update-cost`로 분리된다(`2848` 이후). 모달 저장은 `estimateEditPresence`와 old snapshot을 사용한다.

### 5. 선택 차감 삭제

선택 checkbox/전체선택/`선택 차감 삭제`는 현재 표시되는 eligible Estimate deduction만 대상으로 한다(`pages/estimate.js:2615-2626`, table `4370` 부근, delete button `4212-4228` 부근). handler는 다음 순서다.

- 선택 출고, 선택 행, unsaved edit 없음, `ensureEstimateEditAllowed()`를 확인한다(`2628-2645`).
- 연도·부모 차수·`capturedShip.CustKey`·선택 EstimateKey와 snapshot을 payload로 고정한다(`2646-2663`).
- `/api/estimate/delete-deductions` POST를 호출한다(`2681-2690`). 서비스는 exact Estimate snapshot을 잠그고 Estimate 삭제와 deduction ledger/audit 변경을 하나의 transaction으로 처리한다.
- 요청 중 scope가 바뀌면 성공 삭제를 새 범위에 재조회하지 않고, 같은 범위일 때만 보존 선택으로 재조회한다(`2693-2713`).

부정 시나리오: 저장하지 않은 단가/수량/추가품목이 있으면 삭제를 막는다. 삭제 성공 후 재조회가 실패하면 삭제 자체와 목록 refresh 실패를 별도로 알린다. 이 경로는 “주문·분배·재고 수량은 변경하지 않음”이라는 UI 안내와 현재 서비스 write scope가 일치한다.

### 6. 확정 현황·확정·확정취소·recovery

| 버튼/모달 | handler/API | side effect 및 범위 |
|---|---|---|
| `🔎 확정 현황 확인` | `checkFixStatus` (`4013-4021`, `916` 부근) | `/api/shipment/fix-status` GET. 선택 연도와 from/to week의 status, 음수, category를 읽는다. write 없음. |
| 차수 확정 | `fixWeekAllSubs` → 사전검증 `/api/shipment/fix` GET → `doFixAll` (`1737-1833`) | `/api/shipment/fix` POST를 하위 차수 순서로 실행. Shipment fix 및 stock calculation business write. negative/ghost/duplicate/noIncoming issue가 있으면 모달에서 force/보정 여부를 선택한다. |
| fix-status 모달의 선택 확정취소 | `unfixSelectedFixStatusWeeks` (`3688-3756`) | 선택 범위를 높은 차수부터 `/api/shipment/fix-status` POST로 순차 처리하고, 실패/stock warning을 표시한 뒤 status와 목록을 reload한다. |
| fix-status 모달의 선택 확정 | `fixSelectedFixStatusWeeks` (`3758` 이후) | 부분확정이면 미확정 category를 병합하는 `resolveFixCountryFlowersForRows` (`3655-3663`) 후 `doFixAll`로 낮은 차수부터 처리한다. |
| 오류 모달의 보정 후 확정/강제 진행/재시도/닫기 | fix modal (`5044` 이후, `5357` 이후) | 사용자의 force/auto-stock 선택에 따라 동일 fix POST를 재시도한다. progress가 끝나기 전 닫기 버튼은 없고, 서버 응답이 ambiguous일 때 reconcile 로직을 거친다(`1833` 이후). |

연도는 GET/POST 모두 전달되며 뒤 차수 fixed guard도 존재한다. 다만 fix-status POST 구현에는 `withAuth`만 보이고 `assertErpEditGuard`/lease 검사가 보이지 않는다(`pages/api/shipment/fix-status.js:434`, `487-503`). 일반 편집 cycle의 `postShipmentFix`는 `editGuard`를 포함하지만(`pages/estimate.js:1678-1699`), status modal의 직접 POST (`3715-3720`)는 그 body를 포함하지 않는다. status modal의 동시 편집 충돌 보호는 추가 확인 대상이다.

## 발견사항 및 negative scenarios

### F-01 [P1] 등록 성공 후 stale customer key로 상세 재조회 가능 — 메인 수정 대상

- 근거: 저장 POST는 `custKey: selectedShip.CustKey` (`pages/estimate.js:2819-2825`)인데, 성공 후 `selectShipment(selectedId, selectedCustKey)` (`2836-2845`)를 호출한다.
- 재현 가능한 소스 시나리오: A 업체를 선택한 상태에서 검색 입력/선택 scope가 바뀌어 `selectedCustKey`가 비어 있거나 B 업체 값이 된 순간 A의 등록 저장이 성공한다. DB write는 A로 성공하지만 후속 상세 GET은 stale key와 group 조합을 사용한다.
- 영향: 저장된 Estimate가 화면에 즉시 보이지 않거나 다른 업체 상세를 읽을 수 있다. API POST 자체가 잘못된 업체에 쓰인다고 단정할 근거는 없다.
- 조치 상태: 사용자가 지정한 메인 구현 범위다. 이 sidecar에서는 수정하지 않았다.

### F-02 [P1] category/range unfix는 대상별 부분 성공과 재고 재계산 partial을 허용

- 근거: `fix-status` POST는 `callTargets`를 순회하며 취소와 stock calculation을 수행하고 오류를 누적한다(`pages/api/shipment/fix-status.js:503-551`). 이후 reconcile도 주차별로 수행하고 `207/409`를 반환한다(`553-584`). DB transaction으로 전체 범위를 rollback하는 구조는 소스상 보이지 않는다.
- negative scenario: 17-02 category 취소와 재고계산은 성공했지만 17-01에서 procedure/stock calculation이 실패하면, 화면은 일부 실패를 알리지만 앞선 범위의 상태는 이미 바뀌어 있다. 재시도 시 category filter와 later-fixed guard가 동일하게 복원되지 않으면 category가 남을 수 있다.
- 추가 근거: PARTIAL fix에는 unfixed category를 병합하는 보정이 fix path에만 명시되어 있고(`pages/estimate.js:3655-3663`, `3766-3769`), unfix direct path는 `getFixStatusCountryFlowers()` 값을 사용한다(`3688-3720`). category recovery parity는 메인 작업에서 반드시 확인할 부분이다.
- 조치 상태: 사용자가 지정한 category unfix/recovery 메인 범위와 중복 구현하지 않았다.

### F-03 [P1] 혼합 수정 저장은 전체 원자성이 없음

- 근거: `runCombinedUpdate`가 date quantity, Estimate quantity, cost, pending addition을 차례로 별도 호출한다(`pages/estimate.js:2281-2401`). `runCombinedFixCycle`는 앞뒤 fix 상태를 조절하지만 이미 성공한 API write의 rollback은 제공하지 않는다.
- negative scenario: 정상 수량 저장 성공 → 단가 저장 실패, 또는 단가 저장 성공 → 두 번째 추가 품목 `adjust` 실패. 사용자는 실패 메시지를 보지만 첫 변경은 남는다. 네트워크 응답 유실 뒤 재시도하면 추가 품목 idempotency를 이 페이지 코드가 보장하지 않는다.
- 현재 확인: 각 API의 guard/old snapshot은 개별 요청 보호이지, 이 여러 요청을 하나의 transaction으로 묶는 증거는 아니다.

### F-04 [P2] 확정 사전검증 실패를 무시하고 fix를 시도

- 근거: `fixWeekAllSubs`의 `/api/shipment/fix` GET 사전검증 catch가 `/* 검증 실패 시 무시하고 fix 시도 */`로 비어 있다(`pages/estimate.js:1788-1808`). 이후 issue가 0건으로 판단되면 바로 `doFixAll` (`1824-1825`)이다.
- negative scenario: 사전검증 endpoint가 timeout/500이어서 음수·ghost issue를 받지 못하면, 사용자 preview 없이 fix POST를 시도한다. 서버가 다시 차단할 수도 있지만 “검증 실패”가 “문제 없음”으로 취급되는 fail-open이다.

### F-05 [P2] 다중 인쇄/Excel의 일부 업체 실패가 조용한 부분 산출물로 끝남

- 근거: 다중 print loop는 업체별 fetch exception을 `console.error`하고 계속 진행한다(`pages/estimate.js:3265-3285`). Excel도 동일하게 업체별 실패를 console에만 남긴다(`3328-3350`, `3380-3391`).
- negative scenario: 5개 업체 중 1개가 500/네트워크 오류면 4개만 묶인 인쇄물/Excel이 만들어지고, 전체 선택 결과인지 부분 결과인지 사용자에게 명시되지 않는다. 모든 업체가 실패한 경우에만 빈 데이터 alert가 난다.
- side effect: read-only이므로 DB 손상은 없지만, 거래 문서 누락이라는 업무 리스크가 있다.

### F-06 [P2] 추가 품목 가격 context 응답에 업체/상품 request token 없음

- 근거: 모달의 `pickProduct`는 업체·상품 context GET을 await한 뒤 line id만 확인하고 `updateLine(lineId, { context: d })` 한다(`components/estimate/OrderRegisterDistributeModal.js:121-136`). 업체 input 변경은 `cust`만 null로 만든다(`222-228`).
- negative scenario: A 업체 상품 context 요청이 진행 중일 때 업체를 B로 변경하거나 line 상품을 다시 고르면, 늦게 온 A 응답이 현재 line의 context/가격 source로 남을 수 있다. `submit`은 현재 cust와 `context.shipmentDate`/cost를 조합해 queue한다(`159-187`).
- 조치 상태: stale customer selection 메인 수정과 연관되므로 여기서는 수정하지 않았다.

### F-07 [P3] 대량 수량 입력에서 잘못된 값이 조용히 제외될 수 있음

- 근거: 수량 적용은 numeric/nonnegative 검사에서 invalid row를 결과 대상에서 제외한다(`1839` 부근). 입력 UI는 숫자 input이지만 모든 브라우저/붙여넣기 값의 의미 검증을 대신하지 않는다(`4470` 부근).
- negative scenario: 여러 행 중 한 행에 `-1` 또는 빈/비수치 값이 들어가면 다른 유효 행은 저장되고 invalid row는 별도 실패로 남지 않을 수 있다. 사용자는 버튼 count와 실제 변경 count를 혼동할 수 있다.

## 쓰기 범위 요약

| API/서비스 | 현재 페이지에서의 사용 | 예상 ERP 영향 |
|---|---|---|
| `/api/estimate` POST | legacy/defect/sales 등록 (`2819-2835`) | Estimate row, amount/vat 및 audit/guard. Shipment/Stock 직접 변경 없음. |
| `/api/estimate/update-entry` | Estimate 상세 정보 수정 | Estimate-only. |
| `/api/estimate/update-quantity` | Estimate 수량 또는 정상 detail 수량의 일부 | Estimate branch는 Estimate-only; normal branch는 ShipmentDetail/ShipmentDate와 이력에 영향. |
| `/api/estimate/update-date-quantity` | 정상 출고일별 견적 수량 | ShipmentDate.EstQuantity 및 연결 detail 합계/이력. |
| `/api/estimate/update-cost` | 견적/정상 단가와 once/fixed/weekFav | ShipmentDetail/ShipmentDate/Estimate 금액 및 선택 mode의 CustomerProdCost/WeekProdCost. stock/fix 직접 호출 없음. |
| `/api/estimate/delete-deductions` | 선택 차감 삭제 | Estimate와 deduction ledger/audit transaction; 주문·분배·재고 수량은 유지. |
| `/api/shipment/adjust` | queued additional product | Shipment/분배/재고 downstream. `estimateAdditional:true`, year, editGuard 포함. |
| `/api/shipment/fix`, `/api/shipment/fix-status` POST | 확정/확정취소/recovery | Shipment fix state와 stock calculation. 전역 year/week/category 범위이며 선택 customer UI와 별개일 수 있음. |
| GET `/api/estimate`, mismatch, print detail, order-statement rows, customers/products | 조회/미리보기/다운로드 | 확인한 소스는 GET/SELECT 경로다. 파일 다운로드는 브라우저 메모리/iframe 동작이며 DB write가 아니다. |

현재 `pages/estimate.js`에는 `MOYI`/`moyi` 버튼 또는 호출이 발견되지 않았다. 보이는 외부 전송/다운로드 관련 버튼은 `주문→거래명세표 Excel`, `이카운트 Excel`, `인쇄·엑셀`, 일반/담당자별/거래명세표 인쇄다(`pages/estimate.js:4026-4035`). 따라서 MOYI 기능을 “검증 완료”라고 주장하지 않고 “이 Estimate 페이지에는 감사할 MOYI 버튼이 없음”으로 기록한다.

## 기존 테스트 및 실행 결과

### 실행했고 통과한 읽기 전용 테스트

모두 worktree에서 실행했고 종료 코드 0이었다.

```text
npm run test:estimate
npm run test:estimate-delete
node __tests__/estimateSelectionState.test.js
node __tests__/fixStatusCategories.test.js
node __tests__/shipmentFixCancelGuard.test.js
node __tests__/erpEditPresenceUiContract.test.js
```

`npm run test:estimate`에는 estimate invariants, EXE SQL/parity, print/Excel, search, additional product, defect/quarantine, amount/VAT, manager print, selected-year fix status, year-scoped edit, fix/cost call graph, cost-only UI/snapshot 검사가 포함된다. `test:estimate-delete`는 deduction delete/selection/read snapshot을 검사한다. 별도 Node tests는 selection token, category cycle/guard, shipment fix cancel guard, edit presence UI contract를 검사한다.

### 실제로 가능한 추가 검증 명령

저장소에 정의된 범위에서 다음은 다음 단계에 실행할 수 있는 명령이다. 이번 sidecar에서는 브라우저/DB/운영 상태를 건드리지 않기 위해 실행하지 않았다.

```text
npm run test:estimate-edit-safety
npm run test:erp-edit-presence
npm run test:erp-edit-audit
npm run guard:erp-writes
npm run build
npm run test:smoke:estimate
```

특히 F-01/F-03/F-05/F-06은 mounted browser interaction 또는 stubbed API sequencing test가 필요하다. F-02는 실제 SQL procedure의 category별 부분 실패와 재고 재계산 결과를 격리된 fixture/DB에서 검증해야 한다. `build`와 contract test가 통과해도 그 네 가지 런타임 시나리오를 증명하지 않는다.

### 실행하지 않은 것

- Next dev server, 브라우저 클릭/화면 캡처, 실제 HTTP API 호출
- MSSQL/운영 DB write, `usp_ShipmentFix`, `usp_ShipmentFixCancel`, `usp_StockCalculation` 실행
- nenova.exe/dnSpy/EXE parity 실행
- print dialog 실제 출력, Excel 파일 열기, MOYI/외부 서비스 전송
- secrets, `.env`, 다른 worktree, 배포/병합

## 최초 조사 시 전달사항 — 현재 상태는 상단 최종 결과 참조

이 감사에서 발견한 즉시 확인할 우선순위는 F-01 stale customer refresh, F-02 category unfix/recovery partial state, F-03 mixed-save atomicity, F-04 fail-open preflight다. 구현 파일은 메인 작업이 소유하므로 수정하지 않았고, 이 sidecar 보고서만 새로 작성했다.
