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
