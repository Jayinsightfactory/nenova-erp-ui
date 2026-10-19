# 품목관리 품종 필터·공용 카탈로그 사진

- 화면: /master/products, /catalog
- 기준: origin/master 520cf11e, 독립 worktree nw-product-catalog-hover.
- Q: 품종 버튼 활성/비활성, 품목명 hover 사진, 양쪽 사진 변경 연동.
- A: 사용자가 목록 필터임을 명시. ERP 품종 사용상태는 변경하지 않는다. 선택 품종 OR, 검색과 AND. 빈 선택 전체.
- 사진은 기존 ProdKey 기반 catalog-images 공용 기록과 CatalogImagePicker 재사용. 개별 사진 교체는 동일 ID로 반영. 카탈로그 창 복귀 시 이미지 재조회. 다운로드한 과거 파일은 변경하지 않는다.
- 부작용: 필터/hover는 읽기만. 사용자의 사진 변경은 기존 웹 이미지 JSON/파일만. Product/Flower 및 주문/출고/입고/재고/견적/매출 전체 보존.
- 실제 dnSpy CLI: FormOrderAdd GetDataProduct의 Product.ProdKey/ProdName 연결 확인. 운영 인증 GET에서 활성 품목3350, ProdKey447 CARNATION Moon Light/카네이션, 동일 키 대표사진1 확인(운영 쓰기 없음).
- 검증: verify:erp-change 전체(계약/dnSpy/manifest/write guard/build), test:ui-layout 통과. 로컬 실제 컴포넌트 1920×1080에서 단일/복수 필터, 사진 표시/없음, Enter 관리 열기, Shift+Tab 순환, Escape 닫기와 초점 복귀 확인. 배포 진행 중. 운영 이미지 교체는 미검증(시험 쓰기 하지 않음).
- 메뉴 기준: 기존 shell 유지, 품종 button aria-pressed/방향키, 이름 focus/Enter, 사진 dialog Escape/Tab/focus복귀.
- 이전 장미 업로드 합산 요청은 별도 미완료 작업이며 이번 변경에 포함하지 않는다.
- 검색어: 품목관리 품종 버튼 카탈로그 사진 hover ProductCatalogPhoto

## 후속 Q/A — 품종별 하위 품목
- Q: 복수 필터 대신 품종 버튼 클릭 → 하위 품목 묶음, 검증 후 배포.
- A: 다른 품종 클릭은 기존 선택 교체, 같은 품종 재클릭은 유지. 전체 버튼만 전체 복귀. 선택 품종/표시 건수 제목 추가. 검색·사진·원장 저장 기능 보존.
- 기준/부작용: 기존 Product.FlowerName 읽기만, 단일 선택 React state. Product/Flower/Order/Shipment/Stock/Estimate/WebProfitReport 모두 보존. SQL 및 쓰기 API 변경 없음.
- 근거: 실제 dnSpy FormOrderAdd.GetDataProduct 재확인, 인증 운영 화면 카네이션379/장미814 읽기 확인.
- 메뉴 기준 적용: 기존 shell, 버튼 방향키 및 Enter/Space, 하위 품목 제목과 필터 범위. ERP 저장 선확인/진행률은 해당 없음(조회 UI만). 기존 넓은 표 가로스크롤은 유지.
- 검증: 실제 페이지 SSR 및 버튼 핸들러의 품종 전환/재클릭/전체 복귀 통과. verify:erp-change(빌드 포함), test:ui-layout 통과. 로컬 브라우저 Enter/Space/방향키 및 품종/전체 전환 확인. 배포 진행 중.
