# 거래처관리 EXE 대조 개편

## 요청과 범위
- NENOVA.EXE dnSpy 근거로 웹 거래처관리 목록·신규·수정 화면을 개편.
- 별도 worktree `codex/customer-dnspy-layout`에서 작업. 다른 작업의 수정은 보존.
- EXE의 삭제·일괄 업로드 기능은 이번 변경에 추가하지 않음.

## 확인 및 수정
- FormCustomerInfo, FormCustomerAdd, ClassCustomer 및 실제 dnSpy CLI 결과 대조.
- 운영 DB SELECT로 활성 거래처 674개, CustKey IDENTITY, 입력 길이를 확인. 운영 쓰기 없음.
- 12개 목록 열, 개별 열 필터·정렬, 실제 거래처 키, 자유입력 지역·담당자 반영.
- ProductType과 UseType을 분리하고 빈 문자열·기본출고일 0 저장을 지원.
- 기존 수정 화면이 INSERT API를 호출하던 경로를 전용 create/update API로 분리.
- CustKey 단위 트랜잭션·원본 비교, 중복 클릭 방지, 실패 시 입력 보존 적용.
- 주문·분배·재고·기존 숨김 필드는 변경하지 않음.

## 검증
- customerEditor.test.js: 신규/수정 분리, 원본 충돌, 삭제된 행, 잘못된 키, 빈 값, 허용 길이, 필터·정렬 통과.
- test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest, guard:erp-writes 통과.
- Next production build 및 git diff --check 통과.
- Playwright fixture smoke: 1920×1080 CSS px 및 800×800, 필터·편집·409 입력 보존·모달 경계·브라우저 오류 검사 통과.
- `scripts/customer-layout-smoke.cjs`는 API fixture만 사용하며 실제 거래처를 저장하지 않음.
- 화면 캡처: outputs/customer-layout/list-1920.png, editor-1920.png.

## 배포 상태
- 로컬 구현·검증 완료. 현재 Codex 실행 계정의 GitHub 인증 401로 원격 게시·배포는 미완료.
- 사용자 PowerShell의 GitHub keyring과 Codex sandbox 계정이 다름. 재로그인 반복 요청 대신 검증된 브랜치를 사용자 계정에서 게시하면 됨.
- 운영 저장 및 운영 브라우저 smoke는 배포 후 별도 확인 필요.
