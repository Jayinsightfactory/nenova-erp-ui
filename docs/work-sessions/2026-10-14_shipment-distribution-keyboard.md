# 출고분배 선택·즐겨찾기·키보드·수정이력

| 항목 | 내용 |
|---|---|
| 기간 | 2026-10-14 |
| 화면 | 출고분배 / 붙여넣기 주문등록 작업이력 |
| 원장 부작용 | 기존 명시 분배 저장 정책 유지, 동일 transaction의 비밀값 없는 SystemActionLog 확정 수량 이력 추가 |
| 배포/PR | PR #1057 병합, Cafe24 38532981090 성공, 운영 스모크 통과 |
| 다음 채팅 | 이 문서와 docs/plans/shipment-distribution-keyboard-2026-10-14.md 확인 |

## 고정된 결정

- 차수·품목·거래처 버튼 선택. Ctrl+Alt+1/2/3/4와 Ctrl+Enter 안내, Tab/방향키/Enter/Space/Escape 사용.
- 모든 품목 목록은 ProdName A–Z. 담당자 즐겨찾기는 기존 UserFavorite의 UserID와 shipment-distribute-products로 구분한다.
- 입력 단위는 Product.OutUnit. 변경 전후 비고를 보여주며 verified 성공 응답 뒤에만 저장 완료를 표시한다.
- 절대수량 변경은 DISTRIBUTE로 기록한다. 카톡 추가/취소 또는 전달확인 증거로 위장하지 않는다.
- 같은 연도·전체차수·업체·품목 snapshot을 저장 transaction에서 기록하고 감사 실패는 rollback. 수량0 삭제 뒤에도 이력 유지, 기존0→0 정리는 허용.
- 운영 수량을 테스트 목적으로 바꾸지 않는다. 읽기 전용 probe와 격리 SQL fixture로 검증한다.

## Q&A

### 1. 출고분배 선택과 키보드 작업

**Q.** 차수·품목·업체를 버튼으로 고르고 담당자별 품목 즐겨찾기, 방향키와 Tab, 검색과 수량 단축키를 제공해 달라. 품목은 항상 A–Z다.

**A.** 선택기와 키보드 초점 이동을 추가한다. 오래된 응답은 차수/요청번호로 무시하며 미저장 변경을 버리기 전 확인한다. 저장 중 편집은 잠그고, 팝업은 viewport 안에 표시한다.

### 2. 비고와 붙여넣기 수정이력 연결

**Q.** 출고분배에서 수량을 바꾸면 비고와 붙여넣기 주문등록 수정내역에도 보여야 한다.

**A.** 기존 붙여넣기 이력은 배치 ADD/CANCEL만 읽었고, 상세삭제는 native 이력 연결을 잃었다. 명시 분배 저장에 원자적 snapshot을 추가하고, 같은 이력 조회에 별도 `출고분배 수정` / `이전 → 이후` 표시를 연결했다. 화면 복귀 및 보이는 동안30초마다 갱신한다.

## 근거 및 검증

- 실제 설치 EXE dnSpy FormShipmentDistribution.GetShipmentMaster/btnSave_Click 재확인. 상세/날짜/금액환산 및 농장·확정 정책 보존.
- 운영 읽기 2026/41-02 왕자원예478 Mila2429: 주문32, 출고/날짜48단, 날짜1개, 농장0, MasterFix0, Amount305455/Vat30545. ViewOrder/ViewShipmenttrue, 견적 DetailFix1 조건 GetDetail0의 기존 상태 기록. 전년도 대응행0. 해당 대차수 보고서 확정본/이력0.
- 격리 SQL: 감사 실패 전체rollback, 0삭제 snapshot 유지, 2025 동일차수 수량99 보존 통과.
- 실제 이력 React 컴포넌트: 16→0단, 두 표시모드, 1920/1366/390 폭에서 가로넘침 없음.
- ERP 계약, dnSpy, 변경 manifest/SQL 쓰기 가드, UI layout, production build 통과.
- 실제 분배 화면5개 테스트 통과:1920×1080/1366×768/390×844, 키보드·담당자 즐겨찾기 필터·조회/저장 중 잠금·실패 초안 유지·이전차수 지연 응답 무시·Product.Cost33인 경우도 거래처 Cost700 보존. 직접 화면 이미지도 확인했다.
- 이력 새로고침 실패 시 기존 기록 유지 확인. 추가 이력은 카톡 완료로 처리되지 않는 회귀 검증 통과.
- 메뉴 기준선: 적용—공통 shell/주스크롤/키보드/명시저장/오류표시. 해당 없음—신규메뉴/인쇄. 품목 검색 공용 관련도 랭킹은 최신 사용자의 A–Z 명시 지시로 이 화면에 한해 대체.

## 배포 완료 및 제외

- PR https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1057. 최종 기능 bb3ea3d151d202f707592f3f950d3b8f90f3f64b, master 병합2dd11a7ebee336df4c043edae0bd2dc07e04b35c. GitHub ERP Contract Guard38532459367 성공.
- 동시 master PR #1056의 품목명 줄바꿈/접두어 축약/실제 전차수 잔량을 유지해 통합하고 해당 단위·SSR 및 분배 브라우저 검사, 필수 ERP/빌드를 재통과했다.
- 자동 push 배포 실행이 생성되지 않아 동일 master의 workflow_dispatch38532981090을 명시 실행했다. Cafe24 배포와 hydration smoke가 성공했다.
- 운영1920×1080/1366×768/390×844에서 차수 선택, 실제 Mila 조회, Ctrl+Alt+4 수량 초점, 가로넘침 없음 및 pageerror0 확인. 표시 버전2dd11a7e. 붙여넣기 화면도1920/1366에서 오류·가로넘침 없이 열렸다.
- 배포 후 GET은 ShipmentDescr/OutUnit을 반환하고, 기존 왕자원예48/수경0·단가700 및 전년도0행이 유지됐다. favorites/paste-history도200. 스모크에서 운영 ERP 저장은0건이며 실제 수량 변경의 원자성은 격리 SQL에서 검증했다.
- outputs/와 .next-delivery-smoke/는 로컬 증거·기존 파일이므로 커밋에서 제외한다. 비밀값은 보고서에 포함하지 않는다.

### 3. 후속 요청 — Enter 수량 이동 및 Ctrl+S 저장

**Q.** 수량 입력 후 Enter로 다음 거래처로 이동하고 저장도 단축키로 실행해 달라.

**A.** 현재 표시 순서의 활성 수량 입력으로 이동하고 값을 선택한다. 마지막 입력은 저장 버튼에 초점만 준다. Ctrl+S는 현재 모드의 기존 저장 경로를 사용하며 조회/저장/완료창/IME/반복키는 재저장하지 않는다. 기존 연도별 원장, 검증 및 수정이력 계약은 보존한다.

**검증/배포.** 실브라우저 Enter 이동/두 모드 저장/중복·IME·모달 차단/지연 조회, ERP 계약, dnSpy, manifest/쓰기 가드, UI layout57개, build 통과. 1920x1080 및 작은 화면 확인. 이전 #1057 배포와 구분하며 이번 후속 배포 결과는 완료 후 추가한다.
