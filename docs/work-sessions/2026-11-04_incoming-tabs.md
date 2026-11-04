# 입고 정정 업무 탭과 양쪽 진입 버튼

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-11-04 KST |
| 기준 | origin/master 933c678a, codex/incoming-tabs-1104 |
| 화면 | 입고관리, 수입부 업무도구 |
| 원장 부작용 | 신규 쓰기/저장 로직 변경 없음, 기존 correction 화면 재사용 |
| 상태 | PR1486 병합·Cafe24 배포·운영 브라우저 확인 완료 |

**Q.** 네노바웹 탭 구성을 기획하고 기존 입고관리와 수입부 업무도구 양쪽에 버튼 추가.

**A.** 승인 업무는 수정 요청/매칭·확정/처리 이력 3탭으로 기획. 이번 화면에는 기존 수정 기능을 실제로 쓸 수 있는 입고 조회·수정 탭과 양쪽 입고 정정 업무 버튼 추가. 선택 입고·검색조건·팝업을 전달하며 숨긴 탭도 선택을 유지. 미구현 승인기능을 실행 가능한 것으로 표시하지 않음.

설계: `docs/plans/incoming-correction-tabs-2026-11-04.md`, 이전 승인정책 정본도 함께 포함.

검증/배포 결과는 완료 후 아래에 기록한다. `.verify/`는 로컬 브라우저 및 로그 산출물, 인증정보 저장 금지. source/runtime 변경은 두 페이지와 URL helper이며 SQL/API 수정 없음.

## 로컬 검증
- URL 교차연도·선택·인코딩 검사 PASS. UI layout/dnSpy PASS, manifest191/write scope0 API PASS.
- 최종 webpack build PASS. 실제 Next 빌드+Chrome 격리 API smoke PASS: 입고관리 버튼→업무도구 탭, 선택7970/필터 전달, 탭 복귀 상태 유지, 수정창/Escape/초점 복귀, Enter·Space·방향키·Tab, 일반/팝업 shell, 1920/390. API 쓰기0. 스크린샷 시각 검사.
- PR1486, 전체ERP 및 CI/배포 진행 중.

## 최종 결과
- 기존 incomingQueryDateRange의 effect 실행 fixture에 신규 setPopup/linkedWarehouse 의존성이 누락돼 최초CI 실패. 실제 팝업/선택 URL 케이스를 추가하여 보완; 런타임 우회 없이 표적 검사 및 전체 ERP 재실행 PASS(exit0).
- CI41776478438 전체 성공, PR1486 squash0790ef860f50e52b494ea66967344460e5338ac0. Deploy41777260006 SUCCESS.
- 운영 v1.0.2·0790ef86, ping200/DB 정상. 실제 Chrome에서 입고관리→업무도구, 상단 버튼/입고조회수정탭, 원장7970 전달·탭 복귀 선택유지, 일반 sidebar1/팝업0, 모바일 수정창 확인. correction GET200 두 번, pageerror0, ERP쓰기0. 검증용 부가 POST2 차단.
- 운영 스크린샷 .verify/production-entry-desktop.png 및 production-entry-mobile.png 시각 확인. 새 승인엔진(수입부요청/영업지원확정)은 미구현이며 이번 완료는 탭 기획과 기존 기능 진입점 통합이다.
