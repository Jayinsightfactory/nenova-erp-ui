# 호텔 원본 이미지와 품목·수량 검토

Q. 이미지 업로드 바로 옆에 품목매칭·수량매칭, 저장버튼으로 요청수량1에 저장.

A. 업로드 원본 왼쪽/편집 표 오른쪽, 명시 저장 전에는 pending 검토로 서버에 보관하고 합산에서 제외한다. 요청수량1·2 및 발주수량1·2로 나눠 저장하고 다시 펼쳐서 수정할 수 있다. 기존 데이터는1로 보존. 이미지 원본은 로그인 사용자별 서버 파일, 초안은 연도·차수별 CAS 버전으로 이어하기. 실제 주문은 기존 별도 확인/등록 절차 유지.

- 기준·부작용: [계획](../plans/hotel-review-2026-10-28.md), hotel-miu-intake 계약. SQL/ERP 쓰기 변경 없음. FormOrderAdd golden의 실제 dnSpy/읽기 probe 재사용.
- 로컬 실제 컴포넌트 Chrome: synthetic PNG 오른쪽 매칭표(원본 오른쪽 x725.6, 표 왼쪽 x758.6), 303→305 수정. 서버503 실패 후 pending 유지/합산0 → 재시도→요청수량1. 두 번째103→요청수량2, 합산408. 새로고침/서버목록 불러오기 후 이미지와305/103 복원. ERP 요청0. 이미지 원본은 테스트 합성자료만 사용.
- 자동검증: 이미지 restart/dedup/다른owner404/path·SVG·15MB초과 거부, 실제API 인증주체/stream한도/header; pending 제외/번호증가/중복방지/legacy/2025·2026 동일차수 보존; frozen/CAS 보호. ERP 전체 검사·dnSpy·manifest169·write guard(신규API1) 통과. 원본 대조 함수의 styled-jsx 스코프를 별도 확인·수정했으며 최종 build/CI/배포 결과는 완료 후 추가.
- 미검증: 새 운영 이미지 OCR 품질(기존 파서 그대로), 실제 업무 주문등록(의도적 미실행).
- 검색어: 호텔 이미지 대조 요청수량1 pending batches hotel-order-images server review
