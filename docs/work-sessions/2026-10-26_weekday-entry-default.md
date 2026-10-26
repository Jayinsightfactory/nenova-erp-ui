# 2026-10-26 주광 웹앱 첫 차수 ▲▼

Q.웹앱 첫 차수 선택화면의▲▼가 안움직인다.
A.Native Nenova Desktop에서새로진입한빈칸(예:43)→▼1을재현했다.앞선44직접입력후만검증했던경로와다르다.실제기본차수를달력GET1회로채워서바로44→43이되게수정.빈값/조회실패는1로추정하지않는다.
분배표는조회버튼을누른후에만불러온다.지연된기본값은직접입력/선택을덮어쓰지않는다.ERP수량/확정/재고/금액/견적 변경없음.
근거:docs/plans/weekday-entry-default-2026-10-26.md;PeriodDay202643=10/22,202644=10/29,설치FormEstimateView CLI 확인.
검증:entry+default calendar9건통과.전체gate/배포/실제웹앱재검증진행중.
메뉴기준선:명시조회·키보드·페이지스크롤적용.초기무조회계약은기본차수달력GET1회만예외.신규메뉴/출력/DB쓰기해당없음.
검색어: 첫진입 ▲▼ placeholder defaultNext 44 43 빈칸1 Nenova Desktop
검증완료:전체ERP계약/dnSpy근거/manifest/writeguard/UIlayout/build통과.배포후Native웹앱첫진입검증예정.
배포 재시도도 Killed로 실패. 빌드에만 1536MiB 힙 제한을 적용하는 후속 수정 진행. ERP 원장 변경 없음.
사용자 최종 결정: GitHub에서 빌드, Cafe24에는 완성 파일 전달. Railway 이전 아님. docs/plans/github-build-cafe24-release-2026-10-26.md 참조.
