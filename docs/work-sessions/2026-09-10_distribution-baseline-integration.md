# 붙여넣기 물량표 연결 1차

## 사용자 요청
기준 물량표에 01/02 합산과 현장 전달 후 변경을 표시. 기존 붙여넣기 주문등록과 연결하고 버튼 작업 순서를 제공. 1920×1080에서 캡처 검토. '다음'으로 실제 화면 연결 작업 요청.

## 구현 범위
- 최신 origin/master fce7eba에서 별도 작업공간 생성. 기존 다른 작업 변경 보존.
- pages/orders/paste.js에 DistributionBaselinePanel 삽입. 기존 save/parse 함수를 호출하거나 수정하지 않고 기존 입력·검토·저장·결과 위치로 이동.
- 브라우저에서 파일 읽기. 원본파일 업로드/서버전송 없음. 10MB 한도, 명시 연도/차수, 시트한도, 요약열/반복품목열/선출고 구분.
- 로컬 메모리 기준 보관. 새로고침 시 사라진다는 문구. 운영 기준 확정/ERP 확정 아님.
- 02 합산 분해 미확인 상태는 보관 차단. 자료 없는 값을 추정하지 않음.
- UI/API/SQL 의도: ERP 모든 테이블 보존. 서버 API 변경 없음. 실제 기존 저장 경로는 그대로.

## 검사
- parser 테스트: 0/빈값/문자 유지, 선출고/요일 열, exact keymap row2, 합계 제외, 2025/2026 범위 차단.
- 실제 제공 37-01 파일 읽기: 카네이션85품목55열, 장미55품목39열, 수국23품목55열. 수량 해석 경고0. ERP 일치 의미 아님.
- UI layout/menu 검사 통과. ERP contract 전체 검사 통과. dnSpy 근거 guard 통과. 48개 manifest 검사 통과. 변경 SQL0개 guard통과.
- production build 통과 후 최종 소규모 수정/임시검사페이지 제거 재빌드 수행.
- 독립 local harness에서 React 패널 file input에 실제 xlsx 선택. 1920×1080/100%, 카네이션85행57헤더(품목/잔량포함), documentWidth1920, pageerror0. 캡처 직접 확인.
- local harness는 제거했으며 API를 stub한 화면검사이므로 인증/운영 통합 검증이 아님. 테스트 브라우저/로컬 서버 종료.
- dev mode는 기존 instrumentation의 crypto browser resolution 오류; production build/start로 검증. 기존 instrumentation 수정하지 않음.

## 미완료
서버 기준본 불변 보관, 실제 전산행과 기준셀 연결, 01/02 합산 분해, 카톡묶음/EXE변경 이력 대조, 미반영 검출, 새품목업체 실시간 추가, 단계별 승인 및 저장결과 연결은 미구현.
실제 운영사용 완료/전산자료 일치/배포완료로 보고하지 않는다. 현재 source patch는 검토 단계이며 운영 배포 없음.

## 역할
Main 사전준비/컴포넌트/통합/검토. gpt-5.6-terra medium parser와 fixture. 하위작업 P0_LOCAL만. Git 최신조회 승인은 메인 수행. 외부쓰기/DB쓰기 없음.
