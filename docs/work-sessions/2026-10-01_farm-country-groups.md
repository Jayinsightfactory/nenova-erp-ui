# 차수별 농장표 국가 묶음 및 농장명 줄바꿈

- 요청: 품종을 국가별로 묶고 농장 이름은 줄바꿈하여 전부 표시.
- 구현: 국가 제목 + 품종 버튼, 선택 국가 강조. country+flower 선택키 보존. 표 머리글은 자동 높이와 긴 단어 줄바꿈 지원.
- 영향: 화면 표시만 수정. 기존 계약의 연도/차수 범위, 수량 집계, 조회 API, ERP 테이블 및 견적/매출 원장 모두 보존. 기존 dnSpy/probe 근거는 farm-week-board-design 문서 참조.
- 로컬 브라우저: 1920×1080 CSS pixel. 중국/콜롬비아 동일 장미 별도 선택, 자료 없음 상태 및 원래 선택 복귀 확인. 머리글 white-space normal / overflow-wrap anywhere 확인.
- 로컬 ERP 계약 / dnSpy 근거 / manifest / ERP 쓰기 가드 / build 통과. PR #837 CI 통과 후 f9480a85로 master 병합.
- 긴 농장명 fixture: 125px 열에서 헤더 높이 89px로 자동 확장, scrollWidth=clientWidth. 115px 축소에도 잘림 없음. 700px viewport에서 페이지 가로 초과 없음.
- Cafe24 run 36805480103 성공(4m36s), hydration smoke 포함 통과.
- 운영 f9480a85 확인. 국가 13개 그룹, 39-02 콜롬비아 카네이션 실제 농장 9개 헤더에서 줄바꿈 및 scrollWidth=clientWidth 확인. 콘솔 error 없음. 운영 캡처는 CDP timeout으로 실패하여 로컬 1920×1080 fixture 캡처를 보관.
