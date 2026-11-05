# 메뉴·탭 사용 가이드 제작 기준

새 메뉴·탭을 추가하거나 기존 업무 순서를 변경할 때는 사용 가이드 제작과 화면 연결을 기본 작업에 포함한다. 직원이 실제 화면에서 무엇을 누르고 무엇을 확인하는지 따라 하는 교육 자료다. 홍보용 영상이나 AI로 만들어낸 UI가 아니다. 사용자가 명시적으로 제외한 경우에는 사유를 PR에 남긴다.

## 제작 순서

1. 사용자 역할과 시나리오를 정한다. 요청자와 최종 확정자가 다르면 영상을 나눈다. 이번 입고 정정은 수입부·영업지원 각 영상에 농장·품목·수량 수정 목차를 넣는다.
2. 기능과 테스트를 먼저 완성한다. 최종 실제 페이지를 로컬 서버로 띄우고 모든 API를 합성 연습 자료로 처리한다. 운영 자료·실명·연락처·계좌·비밀번호·토큰을 촬영하지 않는다. 교육을 위해 운영 입고·분배를 저장하지 않는다.
3. `1920×1080` CSS pixel, deviceScaleFactor `1`, 브라우저 확대 `100%`에서 촬영한다. 메뉴 진입→선택→입력→검토→명시 저장→완료/이력까지 실제 조작한다. 한국어 설명과 클릭 위치를 표시하고, 직원이 읽고 따라 할 시간을 둔다. 빨리 지나가는 타임랩스로 만들지 않는다.
4. `scripts/lib/workflow-guide-recorder.cjs`의 `createWorkflowGuideRecorder(page, options)`로 실제 Chrome 화면을 녹화할 수 있다. Puppeteer의 실제 screencast와 로컬 ffmpeg를 사용한다. 로컬 URL과 `fixtureOnly:true`를 필수로 요구하며 운영 URL은 거절한다. 이 모듈이 fixture 라우팅을 대신하지는 않으므로 호출 스크립트가 모든 API를 차단/모의 처리해야 한다.
5. 최종 MP4(H.264, yuv420p, faststart), 한국어 WebVTT, 촬영 근거 JSON을 `public/guides/<workflow>/`에 둔다. MP4는 각 60MB 이하로 압축하되 1920×1080 글씨를 읽을 수 있어야 한다. 무음 영상도 모든 설명을 자막으로 전달하면 된다. 최종 프레임·중간 프레임과 영상 길이를 직접 확인한다.
6. `config/workflow-guides.json`의 `status`를 `ready`로 바꾸고 녹화에서 반환된 목차를 등록한다. `sourceFiles`는 실제 작업 화면을 구성하는 컴포넌트·페이지를 포함한다. 영상·자막 SHA256, 원본 소스 SHA256, 실제 ffprobe 크기/길이/fps를 촬영 근거로 남긴다. 촬영하지 않은 근거를 만들거나 UI 변경 후 해시만 고쳐서 통과시키지 않는다.
7. 해당 화면의 눈에 띄는 위치에 `<WorkflowGuide workflowId="..." />`를 추가한다. 역할 선택·목차 버튼·native video controls·전체화면·자막·다운로드가 동작하는지 실제 브라우저와 키보드로 확인한다. 가이드 재생은 ERP 쓰기와 연결하지 않는다.

## 코드에서 연결하기

```jsx
import WorkflowGuide from '../components/WorkflowGuide';

<WorkflowGuide workflowId="incoming-approval" initialRole="수입부" />
```

공통 컴포넌트는 등록된 로컬 영상만 읽고 자동 재생하지 않는다. 목차를 누르면 해당 시각으로 이동하며 재생은 사용자가 선택한다. 가이드를 접거나 역할을 바꾸면 기존 영상은 멈춘다. 아직 제작 중인 항목은 완료 영상처럼 보이지 않는다.

## 검증과 배포

입고 정정 가이드의 재현 명령은 다음과 같다. 첫 녹화 전에는 개발 검증용으로 `npx next build --webpack`을 실행할 수 있다. 이것은 가이드 검증을 생략한 배포 허가가 아니다. 화면 수정이 끝난 뒤 dry-run으로 실제 조작을 검증하고, 최종 촬영 후 정식 `npm run build`와 모든 배포 검증을 통과해야 한다.

```powershell
node scripts/record-incoming-approval-guides.cjs --dry-run
node scripts/record-incoming-approval-guides.cjs
npm run build
node scripts/workflow-guide-player-smoke.cjs
```

녹화 스크립트는 로컬 테스트 서버를 직접 띄워 두 역할의 농장·품목·수량 시나리오를 실행한다. `--role import` 또는 `--role sales-support`로 한 역할만 다시 촬영할 수 있다. 화면 소스가 바뀌면 두 역할의 오래된 녹화 근거가 모두 무효가 되므로 해당 가이드를 다시 촬영한다. 창을 캡처한 `.verify/` 원본은 배포 대상이 아니며 검증한 MP4·VTT·근거 JSON만 배포한다.

```powershell
npm run test:workflow-guides
node scripts/check-workflow-guides.cjs --changed-from <기준 SHA>
```

검사는 영상/자막/근거 존재, 파일 크기·형식·해시, 1920×1080/100%, 연습 자료, 역할별 시나리오 목차, 원본 화면 변경 여부를 확인한다. 추가된 `pages/**` 메뉴는 등록된 진입 URL이 없으면 실패한다. **기존 파일 안에 추가한 탭과 업무 변경의 의미를 정적 검사만으로 완전히 판별할 수는 없으므로**, 작성자와 리뷰어가 해당 항목 등록 여부를 체크리스트로 확인한다. `--allow-draft`는 제작 중인 로컬 검사만을 위한 옵션이며 배포 검증에서는 사용하지 않는다.

녹화는 실제 tested UI + synthetic fixture이며 실제 ERP 저장의 성공을 증명하는 자료는 아니다. 원장 반영·롤백 검증은 격리 SQL 테스트로 별도로 남긴다. 배포 후에는 해당 화면에서 영상 URL의 정상 응답, 재생, 목차, 자막을 확인하고 PR·작업 기록에 영상 경로와 확인 결과를 적는다. UI 변경으로 원본 해시가 달라지면 실제 화면으로 다시 촬영한다.
