# 전산 피벗 전체 페이지 세로 스크롤

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-09-16 |
| 화면 | /stats/pivot 전산 피벗 |
| 원장 부작용 | 없음: API/SQL/집계/엑셀 계산 변경 없음 |
| 상태 | PR #659 병합·배포 성공 |
| 배포 | 35080160512, merge 4a18e9a6, 자동 hydration smoke 통과 |

## 고정된 결정

- 표 내부 세로 스크롤을 없애고 문서 전체를 내려 모든 행을 본다.
- 가로 스크롤과 기존 필터/정렬/즐겨찾기는 보존한다.
- 5,000셀 초과 시 가상 렌더링은 유지하되 화면 좌표는 페이지 기준으로 계산한다.
- 상단 가로 이동바는 페이지 스크롤 중에도 접근 가능하게 고정한다.
- 열 제목은 별도 고정 헤더로 유지하며 본문·상단 가로바와 같은 위치로 동기화한다.
- 설계/ERP 영향 판단/통합은 메인, 순수 좌표 helper와 테스트는 P0_LOCAL 하위 작업. 모델 별도 지정 권한이 없어 상속 모델 사용.

## Q&A

Q. 별도 표 스크롤 대신 페이지 전체를 내려 다 볼 수 있게 해줘.

A. 표 높이 제한 제거, 문서 scroll/resize 구독, 화면에 보이는 본문 구간 계산 및 spacer 유지로 구현한다. 수량과 거래처/품목 업무키는 변경하지 않는다.

## 검증 및 인계

- 기준 viewport: 1920×1080 / 100%, 작은 화면 1280×800.
- 통과: test:pivot, test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest, guard:erp-writes, production build, diff --check.
- 실제 브라우저: 합성 원본 12,000건 → 1,003 표시 행. 1920×1080 문서 높이 24,617px, 페이지 Y=23,537에서 마지막 row index=1002 및 총계 6,006,000 표시. 표 내부 scrollTop=0, scrollHeight=clientHeight.
- 1280×800: 페이지 가로 넘침 없음(문서 너비 1266), 가로바/본문/고정 헤더 scrollLeft 모두696. 헤더 top16px 유지, console error 없음.
- 모두 접기 2행/비가상화 및 다시 펼치기 회귀 통과. 가상화 중 DOM 셀은 화면 구간만 유지.
- 독립 검토에서 열 제목이 사라지는 문제를 확인해 동기 고정 헤더로 보완했다.
- PR: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/659
- 배포: https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/35080160512 (3m9s, success).
- 운영 URL 기본 화면 표시 확인. In-app 브라우저 미로그인으로 운영 실데이터 수동 스크롤 검증은 불가; 합성 fixture 실제 브라우저 검증과 운영 자동 hydration smoke를 완료했다.
- 이 배포 결과 추가 기록은 후속 배포를 불필요하게 실행하지 않도록 로컬에 보관하고 PR 완료 코멘트에도 남긴다.
- outputs/ 및 다른 농장 피드백 세션 문서의 기존 수정은 커밋에서 제외.
