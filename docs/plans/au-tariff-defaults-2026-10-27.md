# 호주 원가자료 관세율 자동입력

기준: 38-1 PREMIUM GREENS 원가자료.xlsx SHA256 7cb66ca12afce9ff937ea8bd6fda597c4ce411174961638fa276ed6713dfd320, 39-1 B/I열 실물 확인. Banker14,EmuFeather15,EmuGrass16,Koala17,CopperGlow18,SeaStar19,Steel20,Stenocarpus21,Umbrella23,GreenTip24. Copper만0.069, 나머지 명시수식0. RedTip0은 2026-10-27 사용자 승인. 법정세율 조회/인증이 아닌 기존 업무자료 기본값.

기준 ledger: 2026/39-01 이상 AU AIR, 활성 전산 ProdKey+정확ProdName 일치에만 적용. 다른 연도/미지품목/삭제품목/이름변경/타국은 미입력 유지. 명시 수기0/유효값 및 잘못된 입력도 자동덮어쓰기하지 않음. 품목변경 후 원가 재준비시 새 품목 근거만 복원하고 기존 미리보기는 무효화.

| 동작 | Product | 주문/출고/입고/재고/견적/손익/승인원가 |
|---|---|---|
| 기본율 준비 | 기존 SELECT | 모두 보존 |
| 품목 변경/수기율/미리보기/다운로드 | 기존 SELECT | 모두 보존, 계산본만 생성 |

dnSpy ExcelLoadingPackingList 재실행·기존 FormWarehouseUpload 근거 적용. 운영 Product AU 활성목록 SELECT 확인: 2999 CopperGlow(원문 Leptospermum),2997 Green,2998 Red. 운영 WebArrivalCostLine 호주 현재본0건으로 로컬 원본을 사용. EXE writer/SP/금액/단위 불변.
메뉴기준: 기존 모달·페이지 스크롤·키보드·수기입력 유지, 원천 표시 추가, 새로운 메뉴/권한/저장 해당없음.
