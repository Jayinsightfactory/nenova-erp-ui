# 2026-10-08 PC 카드 메뉴 즐겨찾기 및 재실행 복구

Q. 표시한 모든 업무 카드의 각 메뉴 오른쪽에 즐겨찾기를 추가할 수 있게 작업해 달라.
A. 메뉴 옆 독립 ☆/★는 1.3.1 소스·배포에 존재하지만 사용자 설치는 1.3.0이라 보이지 않았다. 1.3.2는 같은 메뉴별 별 버튼과 종료 순서 수정을 포함한다.

Q. 앱을 다시 열 수 없다.
A. 창 없는 main/GPU/network 프로세스가 재실행을 막았다. 격리 Electron fixture에서 마지막 BrowserWindow.close → close 이벤트 preventDefault → 동기 app.quit 재진입 시 실제 프로세스가 남음을 재현했다. setImmediate(quit)로 native close 이벤트 완료 뒤 종료를 수행한다.

보존: 기존 암호화 프로필·즐겨찾기 및 ERP 원장. 실제 사용자 installer 테스트는 수행하지 않는다.
검증: exit-probe parent runner가 메뉴 종료/마지막 창 닫기/취소 후 연속 닫기의 실제 child exit0를 확인한다. 성공 경로에서 app.exit 강제종료를 사용하지 않는다.
