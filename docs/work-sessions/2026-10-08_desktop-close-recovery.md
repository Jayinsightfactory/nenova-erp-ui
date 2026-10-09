# 2026-10-08 PC 카드 메뉴 즐겨찾기 및 재실행 복구

Q. 표시한 모든 업무 카드의 각 메뉴 오른쪽에 즐겨찾기를 추가할 수 있게 작업해 달라.
A. 메뉴 옆 독립 ☆/★는 1.3.1 소스·배포에 존재하지만 사용자 설치는 1.3.0이라 보이지 않았다. 1.3.2는 같은 메뉴별 별 버튼과 종료 순서 수정을 포함한다.

Q. 앱을 다시 열 수 없다.
A. 창 없는 main/GPU/network 프로세스가 재실행을 막았다. 격리 Electron fixture에서 마지막 BrowserWindow.close → close 이벤트 preventDefault → 동기 app.quit 재진입 시 실제 프로세스가 남음을 재현했다. setImmediate(quit)로 native close 이벤트 완료 뒤 종료를 수행한다.

보존: 기존 암호화 프로필·즐겨찾기 및 ERP 원장. 실제 사용자 installer 테스트는 수행하지 않는다.
검증: exit-probe parent runner가 메뉴 종료/마지막 창 닫기/취소 후 연속 닫기의 실제 child exit0를 확인한다. 성공 경로에서 app.exit 강제종료를 사용하지 않는다.

검증/배포: 로컬 verify:erp-change(빌드 포함), dnSpy evidence, desktop unit/smoke/restore/exit 통과. PR #980 head5571761a, PR CI Windows37741901665/ERP37741901674 통과. master396d71705e3bcd14610a35318d15ed54154565e1 병합. desktop-v1.3.2 공개, ASAR 소스 일치,111698529bytes,SHA256 ad31ad189576ddfa9b01705952bee50d624efcf8f20defaeb2ef7b5c4e791cfb.

실사용 앱: Computer Use로 설치된1.3.0의 앱 업데이트 확인→1.3.2 다운로드 완료. pending 설치파일도 동일 SHA256 확인. 기존 즐겨찾기4개와 열린 업무탭0개 확인. 설치 직전 사용자 확인 대기, 아직 설치 실행하지 않음.
최종 웹배포: Cafe24 37742178146 성공(실브라우저 hydration 포함). master Windows37742178092/ERP37742178116 성공. 운영 웹 1920×1080/800×1080 즐겨찾기 fixture 스모크 통과(실제 쓰기0), 로그인 PC 다운로드1.3.2 확인. 사용자 설치는 최종 확인 대기 상태이며 다운로드 완료와 설치 완료를 구분한다.
