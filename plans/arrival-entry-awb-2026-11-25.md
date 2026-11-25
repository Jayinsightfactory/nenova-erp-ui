# 2026-11-25 국가별 원가 진입과 AWB 초안 복구
연결 g17/g19. 최신9144e1d5e, 기존 계산 공식9국가(CN/CO/NL/US/VN/AU/NZ/EC/TH) 보존, 신규 국가 공식 없음.
기준: 개별 국가 경로는 기존 NativeReceiptCost, 통합은 기존 CN Cloud/CO. AWB PDF는 기존 readAwbPdf/parseAwbFields로 로컬 읽기. 자동 추출은 힌트, 명시 대조 적용. AWB 없이 환율·통관 초안 입력 허용, 최종 계산/다운로드는 기존 유효AWB·전체 범위·비용 증빙·동일 비용 중복 보호를 유지한다. AWB 누락 입고끼리 동일 비용으로 합치지 않는다.
부작용: 목록조회/원가작성/PDF읽기/미리보기/다운로드 모두 Warehouse/Order/Shipment/Stock/Estimate/Profit 보존. PDF는 외부 전송 없음. 저장 AWB 덮어쓰기 금지, 명시 배정은 원가 요청 안에서만.
운영 읽기: Apollo는 운임 자료 입고도 존재(8255/48-02 등), 농장명만으로 콜롬비아라고 추정하지 않는다. 설치 EXE ExcelLoadingPackingList dnSpy 재실행 완료. 원장 직접 수정 없음.
검증: 기존9국가 선택 진입, AWB 미제공 비용 입력, 업로드/스캔/한도/늦은 응답/직접근거, AWB 유효 원장 보존, 전체 같은AWB 포함, 교차연도/범위/중복 비용 차단. 해당 가이드만 갱신. 원복은 PR revert.
