# 메뉴별 기능 개발 히스토리

| 항목 | 내용 |
|---|---|
| 기간 | 2026-10-07~08 KST |
| 화면 | 개발 히스토리 `/dev/history` |
| 원장 부작용 | 없음. 새 API는 Git 스냅샷 GET이며 ERP DB/EXE에 접근하지 않음 |
| 배포 | 검증·최종 검토 후 PR/병합/배포 예정 |
| 다음 채팅 힌트 | 아래 결정과 검증 결과 확인 후 이어가기 |

## 고정 결정

- 메뉴별로 기능·변경 내역·변경 횟수, 기능 최초 추가 이후 수정 횟수를 표시한다.
- 실제 Git first-parent 고유 커밋 수이며 사용자 대화 수·개인 작업시간이 아니다.
- 파일 경로 기반 분류를 명시한다. 최초 추가는 기준 파일의 실제 A 기록만 인정하며 없으면 확인 불가다.
- 메뉴/기능 여러 개에 해당하는 같은 커밋은 전체 합계와 타임라인에서 중복하지 않는다.
- 빌드 시 정적 스냅샷 생성, 인증 GET만 허용, 기존 네 탭 보존.
- 1920×1080 CSS px/100% 및 작은 화면 검증. 일반 shell은 `_app.js`만 소유.

### 1. 메뉴별 개발 이력 요청

**Q.** 각 메뉴별 기능 추가·수정 사항과 수정 횟수, 기능 하나를 만드는 데 얼마나 수정했는지 보고 싶다.

**A.** 메뉴별 기능 탭, 검색/정렬, 메뉴·기능 선택, 변경 타임라인/파일 펼치기를 구현했다. 85개 메뉴를 추출하며 주요 기능은 명시적 경로 catalog로 연결한다. Git 커밋에 없는 구두 요청은 세지 않는다.

### 2. 디스크 공간 부족 이후 재개

**Q.** 다시 작업 이어서.

**A.** 2026-10-07 로컬 ENOSPC로 빌드·회귀가 중단돼 배포하지 않았다. 10-08 약 39GB 여유 공간을 확인했고 손상된 테스트 파일을 복구하여 10/10 통과했다. 전체 필수 검증을 다시 실행한다.

## 모델/권한 및 검증

- 설계: gpt-5.6-sol xhigh. 확정 구현: 지정 terra 사용 불가로 gpt-6-sol medium 대체. 최종 검토: gpt-5.6-sol high.
- 하위 작업 P0_LOCAL; 외부 쓰기/DB/배포는 금지. 메인이 통합과 외부 작업 담당.
- 새 계약: `docs/contracts/menu-development-history.json`. 웹 전용으로 실제 dnSpy 저장 순서/ERP 업무키 probe는 N/A이며 거짓 증거를 만들지 않는다.
- 새 테스트 12건 통과. 최초 전체 필수 회귀·빌드 통과 후 최종 검토의 shallow 경계 가짜 A/메타데이터 없는 빌드 fallback 두 항목을 보완했고 필수 검증을 재실행한다.
- shallow 경계 해시는 최초 추가·횟수 집계에서 모두 제외한다. ENOENT/git 메타데이터 부재만 tracked fallback이며 파싱·Git 손상 오류는 빌드를 실패시킨다.
- 임시 `.next`, node_modules junction, 로컬 캡처는 커밋 제외.

## 미완

최종 검토에서 추가 blocking 없음. 전체 과거 이력을 확보하여 shallow=false, 스냅샷 85개 메뉴/1,289개 고유 변경(이 시점 기준)을 생성했다.

- `npm run test:menu-development-history`: 12/12 통과.
- `npm run test:erp-contract`: 전체 pre/main/post 통과(UI layout와 신규 테스트 포함).
- `npm run test:nenova-dnspy-evidence`: 통과.
- `npm run test:erp-manifest -- --changed-from origin/master`: 통과.
- `npm run guard:erp-writes -- --changed-from origin/master`: 통과.
- `npm run build`: 보완 후 재빌드 통과.

남은 단계: PR/병합 → Cafe24 배포 → 운영 화면 스모크.
