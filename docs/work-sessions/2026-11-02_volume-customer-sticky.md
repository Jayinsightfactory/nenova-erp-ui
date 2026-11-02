# 2026-11-02 물량표 업체명 상단 고정

- 요청: 네덜란드·중국 물량표 세로 스크롤 시 업체명 유지, 업체명 위쪽 정렬.
- 기준: origin/master 21d48b3e5, 별도 codex/volume-customer-sticky 작업트리. 시작 시 변경 없음.
- 분류: DOM/CSS 표시 전용. 기존 자연 높이/페이지 세로 스크롤과 가로 이동 유지.
- 공통 useVolumePageHeader는 원래 헤더 셀을 함께 이동한다. 복제 헤더나 별도 입력 필드를 만들지 않으며 지역/요일/매칭 버튼을 보존한다. 표 끝에서 이동 제한, 인쇄 시 해제, 모바일 및 외부 스크롤 컨테이너 지원.
- 네덜란드는 dutchDataStart 이전 3/4행, 중국은 thead 3행을 고정한다. customer-heading은 vertical-align:top.

| 사용자 동작 | Order/Shipment/Warehouse/Stock | ShipmentDate/Farm | Estimate/Amount/Vat/isFix/WebProfitReport |
|---|---|---|---|
| 스크롤/업체명 정렬 | 보존 | 보존 | 보존 |

기존 API/SQL/업무키/단위/수량/엑셀/저장 정책 변경 없음. 기존 FormQuantityPivot 및 FormShipmentDistribution golden/계약을 확인했다. 새 ERP 연동이나 쓰기 변경이 없으므로 이번 표시 수정에 대한 별도 dnSpy 재추출·운영 DB probe는 실행하지 않음. 기존 계약 교차연도 fixture 유지, 2025/2026에 동일한 표시 동작 적용.

검증: 진행 중. 운영 반영/실브라우저 확인은 완료 후 기록.
검색어: volume-customer-sticky 업체명 위쪽정렬 네덜란드 중국 useVolumePageHeader
## 로컬 검증 결과
- `npm run build` PASS (공용 node_modules 누락으로 첫 빌드 실패 후 전용 npm ci 환경에서 재실행).
- `npm run test:pivot` PASS. Dutch 기존/새 헤더·수량·단가·업체 추가·XLSX 교차연도 fixture 포함.
- `test:nenova-dnspy-evidence` PASS, `test:erp-manifest -- --changed-from 21d48b3e5` PASS (179개), `guard:erp-writes` PASS (변경 API 0).
- 실제 production build + 격리 API/100품목/24업체 Chrome 검증: 1366/760px, 일반/팝업, 레거시3행 및 CL분리4행. 상단좌표 일반37px/팝업28px, 가로 이동 일치, 위쪽정렬 top, 컨트롤 수 보존, 맨위 복귀 offset0, print transform none. 브라우저 JS 오류0.
- CUA에서도 표 중간(50번째 품목) 스크롤 후 업체명 상단 유지/긴·짧은 업체명 위쪽정렬 육안 확인.
- 전체 ERP 회귀/CI/배포는 진행 중.

전체 test:erp-contract PASS (exit 0). CI/운영배포 확인 예정.
