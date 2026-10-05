# 붙여넣기 확인 상태 하이라이트·수량 이력 자동 확인

## 사용자 요청

영업방 원문에서 확인처리를 눌렀는데 카드가 강조되지 않고, 전산 수량변경 이력이 요청과 일치하면 자동 확인되어야 하는데 동작하지 않는다고 했다.

## 원인

좌우 원문/적용 항목 UI로 바뀌면서 `확인취소` 버튼 상태는 계산했지만, 행에서 완료용 `history-completed` CSS 클래스를 제거했다. 따라서 확인 상태가 저장돼도 초록 배경·테두리가 나타나지 않았다. 수량변경 후보는 보조 상세에만 표시되고 우측 적용 항목/자동 확인 계산에는 연결되지 않았다.

## 변경

- 수동 확인 또는 자동 확인된 원문 행에 `history-completed`를 적용해 초록 테두리와 배경으로 강조한다.
- 정확한 원문 라인 ID로 연결된 단일 numeric shipment-history 후보에 대해, ADD/CANCEL 방향과 정규화 수량이 전후 변화량과 일치하면 해당 품목 카드를 `수량확인` 초록 상태로 표시한다.
- 원문 요청 전체가 수량변경 이력 또는 검증된 저장 작업으로 각각 확인된 경우에만 원문 전체를 자동 확인한다. 일부만 일치하면 일치한 품목 카드만 강조하고 나머지는 미확인으로 둔다.
- 수동 확인은 기존 append-only 웹 검토 이력에 저장한다. 이 기능은 조회·표시만 바꾸며 Order/Shipment/Stock/Estimate/매출 원장을 변경하지 않는다.
- `distribution-sales-inbox.json` 계약과 테스트를 갱신했다.

## 검증

- `distributionMessageApplicationStatus`, `distributionCompactMatchUi`, `pasteFourColumnLayout`, 수동 적용 저장소/API 테스트 통과.
- `test:ui-layout`, `test:erp-contract`, 변경 manifest, `guard:erp-writes`, dnSpy 근거 검사 및 production build 통과. ERP 쓰기 범위 변경은 0건.
- PR #864 병합 후 Cafe24 배포와 배포 hydration smoke 통과. 배포 실행: `37251506108`.
- 로컬 전용 inbox 브라우저 smoke는 fixture가 초기 조회 기간과 고정 기간을 불일치시켜 완료되지 않았다. 체크인을 막는 회귀는 아니며 전체 자동 수량 매칭과 혼합 근거 coverage 회귀를 단위/UI 테스트로 검증했다.
- 후속 검토에서 서로 다른 근거(수량 이력+검증된 저장 작업)가 한 원문 안에 섞인 전체 일치도 자동 확인으로 처리되도록 보완했다.

## 사용자의 화면 재확인 및 추가 원인

배포 후 사용자는 오른쪽 최근 작업 이력의 초록색 완료 항목과 왼쪽 영업방 원문에 같은 처리가 있는데도 원문에 하이라이트가 없다고 다시 지적했다. 코드를 재확인한 결과 작업 이력 연결이 `sourceIdentity`까지 같아야 해서, 카톡 원문 ID가 달라진 다른 화면/전송 건의 완료 작업은 업체·품목·방향·수량이 같아도 연결되지 않았다.

추가 수정은 정확 원문 ID 연결을 우선 유지하고, ID가 다를 때만 검증된 성공 작업 로그의 같은 연도·차수, CustKey, ProdKey, ADD/CANCEL, 입력 수량·단위가 일대일로 유일하게 일치하며 작업 시각이 원문 이후인 경우에만 적용 표시를 허용한다. 같은 처리 로그를 두 메시지에 재사용하거나, 중복 후보·미검증/취소 작업·단위/수량 불일치로 자동 확인하지 않는다. 전체 요청이 모두 매칭될 때만 원문 전체를 초록 하이라이트하고 부분은 해당 품목만 표시한다. 기존 분배/재고/주문 원장 변경은 없다.

## 추가 검증

- 서로 다른 sourceIdentity의 정확 일치 작업, 중복 원문에 대한 로그 재사용 금지, 중복 후보/차수/시간/단위/수량/검증 부정 fixture를 `distributionMessageApplicationStatus.test.js`에 추가했다.
- `distributionMessageApplicationStatus`, `pasteOperationHistory`, inbox/read-refresh 회귀 통과.
- `test:erp-contract`, `test:erp-manifest -- --changed-from HEAD^`, `guard:erp-writes -- --changed-from HEAD^`, `test:nenova-dnspy-evidence`, `test:ui-layout`, `build`, `git diff --check` 통과. 변경 API는 0개이며 ERP 원장 쓰기 범위는 바뀌지 않았다.
- 아직 PR 생성 및 Cafe24 재배포 전이다.
