# NENOVAKAKAO 비행기 이슈 정합성

- 날짜: 2026-11-18, 작업: c027/nenova-erp-ui/flight-fix
- 요청: 운영 원문부터 확인하고 완료된 이슈는 제거, 실제 처리할 것만 비행기별 표시, 테스트와 실제 앱 반영까지.
- 사용자 결정: 카톡 자료는 NENOVAKAKAO. 지도와 옆 항공편 연결 유지. 큰 이슈표 제외. 가이드 영상 제외. 매일 09/12/15/18시 한국 시간 확인은 기존 automation-2 유지. 앱 작업 저장·재시작 준비 확인 받음.

## 요청과 조치
1. 최신화 안 된 이슈 원인 분석 요청 → 운영 PostgreSQL NENOVAKAKAO 3방을 읽기 전용 조회. 복수 항공편 공지의 재공유와 서류 수령 목록을 놓치는 판정, 전날 동일 편명 오연결 확인.
2. 완료 제거와 항공편별 미해결만 표시 요청 → 명확한 AWB/날짜·차수·나라·품목 근거로 완료 판정. 모호한 연결·사진·질문·부정문은 자동 완료 제외. 새 요청은 재개. 과거 변경은 이력으로 분리.
3. 실제 앱 반영 요청 → 로컬 필수검사·빌드, PR CI 통과 후 #1834 squash 병합. Desktop 1.3.39 설치본 CI 및 무결성 검증 완료. 아래 후속 기록에서 실제 배포/설치 상태 확인.

## 근거와 산출물
- PR: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1834
- 병합: d197fd68e0bdccf22c95b22ece03c06f1ae5cadd
- 계약: docs/contracts/import-flight-board.json
- 분석: docs/plans/import-flight-resolution-2026-11-18.md
- 회귀: __tests__/importFlightResolution.test.js
- PR CI: 44249975926 / Windows 44249976017, 성공.
- 웹 배포: 44250766863 성공. 지도 보완 후 최종 배포 44254481216 성공 (c30ad26f, #1836 포함).
- 운영 원문 재검증: 404건, 최신 원문 13:35 KST, 최신 저장 14:28:33 KST. K4254 서류 수령 완료, 미해결은 수량 대조와 적하 구분 2건. AC063 서류 수령 완료. 원문은 메모리 처리만, 원본 대화 저장 없음.
- 설치파일: 111955102 bytes, SHA256 e6b0f015d327a7f56ad7086ef9ccc5a00c05df8c30a1e9c842b886fca001ae5b. SHA512 메타데이터 일치.

## 경계 및 후속 확인
ERP SQL/API 쓰기 변경 없음. 원문시각/저장시각은 수집기 마지막 정상 확인 시각이 아니다. 사진·모호한 답글은 완료로 확정하지 않는다. 3시간 이상 공항 시각 차이는 다른 운항일 오연결을 피하려고 연결하지 않는다.

후속 작업자는 WORK_MEMORY 마지막 기록과 이 문서 추가 기록에서 배포/설치 완료 여부를 확인한다. 미완료면 웹 배포 성공 → 1.3.39 공개 → 설치 앱 업데이트 → 운영 화면에서 K4254 두 업무, 완료 서류 제거, 지도 연결, 원문시각 표시를 검증한다. 기존 사용자 작업트리와 NENOVAKAKAO 수집기는 건드리지 않는다.

## 최종 인계 · 2026-11-18 16:08 KST
- #1836 https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1836 지도 마커 겹침 보완도 병합·배포 완료. 공통 placeMarkers 배치와 실제 예측 좌표 연결선 적용.
- Desktop 1.3.39 공개 및 설치 확인: 앱 화면에 현재/배포 1.3.39, 새 업데이트 없음. 사용자 직접 업데이트 완료.
- 운영 웹 실제 마우스로 K4254와 AC063 각각 선택 → 해당 지도 pressed 및 해당 상세 expanded 확인, 서류 전달 완료 표시 확인. Native 홈 버튼 정렬·메뉴·3건 이슈·새 버전은 화면 확인. 최종 Native 클릭은 사용자 입력 감지로 막혀 미검증; 동일 Desktop 렌더러 합성 브라우저 양방향 마우스 검증은 통과.
- 16:05 운영 이슈: K4254 수량/적하 2건, AC063 도착 시각 1건. Native 원문 시각 선율방 15:30 / 저장 15:58로 후속 갱신 확인. KE048 서류 전달은 다음 업무로 표시.
- 필수 ERP 계약/dnSpy/manifest/write guard/build, 회귀검사, 최종 PR CI 및 Windows 빌드 통과. 최신 Cafe24 배포 44254481216 및 hydration smoke 성공. 이전 배포 44254327140은 최신 master 보호로 중단, 최신 배포에 변경 포함 확인.
- release: https://github.com/Jayinsightfactory/nenova-erp-ui/releases/tag/desktop-v1.3.39
- 남은 개발/배포 없음. Native 클릭 재검증만 제한됨. 기존 정기확인 automation-2 유지, 영상 제작 없음. 원문 대화/개인정보 저장 없음.
- 이어받기: 새 요청이 생기면 origin/master 새 worktree에서 시작하고 NENOVAKAKAO 원문 완료 근거와 항공편 연결 범위를 유지. 현재 자료 시각을 수집기 건강 상태로 해석하지 말 것.
