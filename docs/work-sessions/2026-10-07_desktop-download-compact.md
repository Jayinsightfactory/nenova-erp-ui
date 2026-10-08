# PC 다운로드 버튼과 작업 공간 확대

| 항목 | 내용 |
|---|---|
| 기간 | 2026-10-07 |
| 화면 | 웹 로그인·상단바, PC 업무 창 |
| 원장 부작용 | 없음; 링크/표시만 변경 |
| 이어받기 | desktop 1.2, 로그인 메뉴 동기화 유지 |

## 고정 결정

- 사용자 선택: 작업 탭 한 줄 유지, 다른 UI는 숨김.
- 기본 작업 영역은 상단 44px 탭 외 전체 사용. 도구 펼침은 기존 PC·웹 조작을 복원하며 입력은 유지.
- 웹의 업무 필터·저장·등록 기능과 인쇄 양식을 숨기지 않는다.
- 웹 로그인/상단바 다운로드 링크는 공개 GitHub release의 고정 버전 설치기다.

### 질문과 답변

Q. 네노바웹에 PC 버전 다운로드 버튼을 만들어 달라.
A. 로그인 전후 접근 가능한 링크를 추가하고 검증한 설치 파일을 공개 release에 배포한다. 인증정보나 ERP 데이터가 포함되지 않는 설치기다.

Q. PC에서 메뉴 이름 등의 공간을 없애고 작업 공간을 최대로 써 달라.
A. 작업 탭 한 줄 유지로 확정. Ctrl+K 메뉴, Ctrl+Shift+B 도구 복원. 네이티브 창 버튼과 드래그 이동 유지. 웹 바의 언어/로그아웃/업무뒤로가기는 도구 펼침 때 복원한다.

## 검증 근거

설치기·ERP guard·실브라우저 검증 및 운영 배포 결과는 PR/Actions 기록과 Downloads의 검증기록에 남긴다. 작업 중 임시 probe 스크립트/로그 및 인증 프로필은 커밋하지 않는다.

## 완료

- PR: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/957
- 운영 반영: 6134d3d044fd50c1a4166830ac987844db6b7ddb
- Cafe24 및 hydration smoke 성공: https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/37588703405
- Windows CI: https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/37588703416
- ERP CI: https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/37588703495

## 확인 결과

- 단위 12개, 별도 프로세스 복원, compact/expanded/favorites/notice Electron smoke 통과.
- 키보드 검사에서 renderer 자동초점 이전 검사 race를 수정했고, focus/rename assertions를 유지한 채 로컬 3회 및 Windows CI 통과.
- ERP contract, dnSpy evidence, manifest 83개, write guard, UI layout, production build 통과.
- 웹 로그인 1920×1080 및 390×844, 일반 상단바 1920/800폭 다운로드 버튼 확인. PC UA 전용 웹바 숨김/복원, 입력 보존, 인쇄 CSS 범위 확인.
- 실제 운영 로그인에서 syncStatus=ready, 웹 버전 v1.0.2·6134d3d0, 계정 메뉴80개 일치. 주문붙여넣기·불량차감·호텔손익·견적 로드 성공.
- PC shell1920×1080, 업무 콘텐츠1920×1036. 도구 펼침 시1920×924, 같은WebContents/입력 유지, 즐겨찾기 추가확인.
- 운영 UI probe는 인증 후 비읽기 요청 차단, ERP업무 쓰기0건. 모든 업무 저장·확정의 전수검증을 의미하지 않는다.
- 공개 URL 익명다운로드 및 운영 로그인 버튼 키보드 Enter 다운로드 완료. 원래로그인페이지 유지, 실제파일SHA256 일치.
- 설치기111,372,563bytes, SHA256 58BCDE9BB04F93828568668ADFCEC6DDA26A9C215A6CB6CD315DD9B0D6EBCB8E, 게시자 서명없음.

## 설치 검증 사고와 복구

기존 설치 확인이 DisplayName 정확일치와 일부레지스트리만 검사하여 버전이붙은 all-users 기존설치를 놓쳤다. 동일appId NSIS설치기는 /D 임시경로여도 기존버전 제거를 수행하므로 기존 Program Files 경로가 변경되었다. 사용자에게 알린 후 C:/Program Files/Nenova Desktop을1.2로복구(설치기exit0), 등록경로·바로가기 및 설치된app.asar와 검증패키지해시 일치를확인했다. workspace.encrypted 설정파일은기존수정시간2026-10-07 16:10:21로남아있다. 미저장입력 복원여부는확인하지못했다. 기존 nenova.exe 원장은수정하지않았다.

앞으로 사용자PC에 같은제품이있으면설치기를실행하지않고별도userData의win-unpacked실행으로검증한다. 설치/제거시험은격리VM에서만한다. 이름에버전이붙는경우와HKCU/HKLM·32/64비트레지스트리모두확인한다.
