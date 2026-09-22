# 영업방 변경요청 압축 표시

사용자 요청: 글자를 작게 하지 않고 여백·중복·불필요한 줄바꿈을 없애 요청과 비교 결과를 많이 표시.

변경: 물량표 설정은 기본 접힘, 대화 목록은 해당 열 전체 폭. 연속된 동일 차수·업체는 한번 표시하고 품목 요청을 이어 표시. 원문·긴 품목별 근거는 명시 펼침. 수량 합산/매칭/저장 함수 변경 없음.

부작용: 펼침/접힘과 그룹 표시는 브라우저 표시만 변경. Order/Shipment/Stock/Estimate/WebProfitReport 및 모든 원장 보존. 확인처리·AI 분석 버튼의 기존 명시 동작 유지. 조회 실패 처리/판정 로직은 이번 변경에 포함하지 않음.

기준: 선택 연도·차수, 원문 문자열, 단위·수량·방향·메시지 identity는 기존 그대로. grouped display가 메시지나 요청을 삭제/중복 적용하지 않음.

검증: distribution connection 23개 테스트 통과. fixture smoke는 1920x1080/1366x768, 동일업체 취소3개 묶음, 원문 보존, 설정 접힘, 가로넘침, 운영 쓰기 없음 검사. 상세 실행결과는 작업 보고 참조.

모델 운영: 하위 에이전트 도구 없음으로 메인이 설계/구현/검증. P0_LOCAL, fixture API만 사용, 운영DB 연결/쓰기 없음.

실행 결과: npm build, ERP contract 전체, dnSpy evidence guard, changed API write guard 통과. 브라우저 fixture에서 3품목 카드 높이93px, 대화폭633.8px, 원문 보존 및 가로 넘침 없음. writes/errors 모두0. 캡처 outputs/inbox-density/1920.png 및1366.png. GitHub API 인증401로 게시 대기.
