# 오픈소스 UI 조사·거래처관리 시범 구현

요청: 기존 업무에 거부감 없는 UI를 오픈소스 기반으로 기획·구현.

결정: shadcn/ui·Mantine·Radix 공식 문서와 라이선스 비교 후 Radix Dialog 1.1.23 MIT 채택. 전체 프레임워크 전환 대신 거래처관리 CSS Modules와 모달에만 적용. 기획은 `docs/UI_OPEN_SOURCE_PILOT.md`.

구현: 제목/검색/버튼 정리, 선택 거래처 요약 상단 배치, 행 줄무늬와 촘촘히 보기, 모달 포커스 순환·복귀 및 Escape 취소 확인. 기존 API와 SQL, 저장 payload, 검색 helper 변경 없음.

검증: customerEditor, 전체 test:erp-contract, manifest, dnSpy evidence, write guard(변경 API 0), production build 통과. fixture 브라우저에서 1920×1080 및 800×800: 한글 신규 저장 성공·409 입력 보존·빈 값/0·필터·행 높이 전환·포커스 순환/복귀·Escape·viewport 이탈 검사 통과. 운영 데이터 쓰기 없음.

캡처를 검토해 표의 가로 폭과 모달 경계를 확인. 이미지 `outputs/customer-layout/list-1920.png`, `editor-1920.png`는 테스트 데이터만 포함.

권한: 로컬 구현 P0, 공식 문서 조회 P1. 사용 가능 하위 모델 도구가 없어 메인이 수행. 현재 GitHub API 인증 401로 게시/배포 미완료. 검증을 건너뛴 배포 없음.
