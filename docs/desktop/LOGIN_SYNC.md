# 로그인 시 웹 메뉴·기능 동기화 계약

작성: 2026-10-07. 실제 bootstrap 구현에 맞춘 계약·인수 기준이다. 테스트·운영 배포 완료 여부는 별도 검증 기록을 따른다.

## 사용자 요청과 현재 근거

사용자가 설치한 Nenova Desktop에서 웹에 배포된 신규 메뉴·기능을 다음 로그인 때 자동으로 이용할 수 있어야 한다. 모든 메뉴는 해당 계정에 웹이 보여주는 전체 메뉴를 뜻한다. 배포된 웹 화면과 메뉴는 설치 파일을 다시 내려받지 않아도 반영한다. Electron 런타임이나 로컬 창 관리 코드 교체는 별도의 앱 배포 대상이다.

기존 1.0은 정적 메뉴만 읽으며 업데이트를 발견하는 코드가 없다. 따라서 이 기능을 받으려면 최초 한 번 1.1 설치가 필요하다. 1.1 이후 웹 메뉴·기능 배포는 로그인과 `업데이트 확인`을 통해 자동 반영된다. 데스크톱 실행 파일·Electron 엔진 자체의 자동 다운로드·설치 기능은 이번 범위에 포함하지 않는다.

현재 `components/Layout.js`의 `MENU_ITEMS`는 84개다. 공통 메뉴는 80개이며 `userIds` 제한 항목은 4개다. `desktop/scripts/generate-menu.cjs`가 제한 항목을 일괄 생략하므로 기존 `desktop/menu.json`의 80개는 모든 계정의 전체 메뉴가 아니다.

| 로그인 계정 | 현재 웹 기준 메뉴 수 | 추가로 보여야 하는 제한 메뉴 |
|---|---:|---|
| `nenovaSS3` | 83 | MOYI Drive 관리, 직원 업무 심화 리포트, 내 작업 데이터 |
| `WORKFLOW_OWNERS`에 등록된 다른 계정 | 81 | 내 업무흐름 확인 (`/my-work?tab=mine`) |
| 그 외 계정 | 80 | 없음 |

위 수치는 기준일 점검값이며 향후 코드에 고정하지 않는다. 메뉴 표시 조건은 현재 웹과 동일한 `!item.userIds || item.userIds.includes(user.userId)`다. 권한 숫자나 관리자 여부로 새 조건을 덧붙이지 않는다. 메뉴 표시 여부는 개별 페이지·API의 접근 권한 검사를 대신하지 않는다.

## 서버 계약

`GET /api/desktop/bootstrap`은 `withAuth`로 인증한다. 사용자가 보낸 userId, localStorage의 사용자 정보, query parameter로 메뉴의 계정을 결정하지 않는다. `req.user.userId`가 유일한 계정 근거다. 인증된 GET 외 메서드는 405로 거절한다.

메뉴 등록 원본은 프로젝트 규칙대로 `components/Layout.js`의 `MENU_ITEMS` 한 곳이다. API는 이 export를 사용해 실제 계산된 `userIds`를 평가한다. 정규식으로 소스에서 제한 메뉴를 제거하는 설치 시 snapshot은 로그인 이후의 메뉴 근거가 될 수 없다. 서버에서 Layout export를 import하는 구성은 Next production build로 검증한다. 필터·직렬화 순수 helper는 별도 모듈로 둘 수 있지만 메뉴 목록을 복제하지 않는다.

응답은 `lib/desktopBootstrap.js`가 생성하며 `desktop/bootstrap.cjs`가 검증한다.

```json
{
  "success": true,
  "schemaVersion": 1,
  "user": { "userId": "authenticated-account" },
  "menuVersion": "64-character-sha256-visible-menu-hash",
  "webVersion": "deployed-web-build-version",
  "menus": [{
    "group": "업무",
    "items": [{ "href": "/orders", "labelKey": "주문관리", "popup": false }]
  }]
}
```

- 그룹·항목 순서와 query string을 보존하고, 필터 결과가 빈 그룹은 제외한다.
- 서버가 인증 계정의 메뉴를 먼저 필터한 뒤 표시용 필드만 직렬화하며 제한 계정 목록을 전송하지 않는다. 데스크톱은 외부 URL·API URL을 거절하고 라벨을 텍스트로 표시한다. 메뉴 메타데이터는 실행 코드가 아니다.
- `menuVersion`은 해당 계정에 표시하는 메뉴 JSON의 SHA-256으로, 경로·이름·그룹·순서·popup 변경을 반영한다.
- `webVersion`은 `NEXT_PUBLIC_BUILD_VERSION`, 없으면 Next `BUILD_ID`를 사용한다. 둘 다 없으면 `unknown`으로 표시한다. 메뉴 목록이 같아도 기능 코드가 달라질 수 있으므로 메뉴 hash로 웹 배포 변경을 추정하지 않는다. 정상 운영 배포는 버전을 식별할 수 있어야 한다.
- 성공·실패 응답 모두 `Cache-Control: private, no-store`를 적용한다. 인증 실패는 401이다. 응답을 공유 캐시나 로컬 workspace 파일에 저장하지 않는다.

## 데스크톱 인증·동기화 순서

1. 앱 시작과 인증 쿠키 변경 시 기존 `authGeneration`을 증가시키고 잠근다. 잠금 중 계정 메뉴·즐겨찾기는 빈 배열로 shell에 보낸다. 원격 페이지의 업무 쓰기 차단은 기존 동작을 유지한다.
2. 동일 `webSession`의 HttpOnly 인증 쿠키로 `/api/auth/me`, `/api/desktop/bootstrap`을 순서대로 확인한다. 모든 fetch는 `cache: no-store`와 12초 제한 시간을 사용한다. bootstrap의 `user.userId`가 현재 검증된 계정과 같아야 한다.
3. 수신한 응답 본문 길이 최대 262,144자, schemaVersion 1, 그룹 최대 50개, 그룹별 항목 최대 300개, 전체 항목 최대 500개, 그룹명 100자, 라벨 120자, 버전 160자와 타입을 검증한다. 본문 길이 검사는 수신 후 수행되며 네트워크 전송량 제한은 아니다. `href`는 승인된 HTTPS origin 안의 업무 경로만 허용하고 중복 URL을 거절한다. 라벨은 textContent로 렌더링한다. 원격 JSON으로 main 프로세스 코드를 실행하지 않는다.
4. fetch나 캐시 정리처럼 await가 끝날 때마다 generation이 여전히 같은지 확인한다. 새 로그인이 시작된 뒤 도착한 이전 응답은 폐기한다.
5. 새 계정이면 기존 계정의 view와 임시 화면 저장소를 기존 보안 정책대로 정리한다. 같은 계정의 HTTP 캐시를 갱신하더라도 localStorage·IndexedDB·쿠키·DOM을 일괄 삭제하지 않는다.
6. 계정과 메뉴 확인이 끝난 뒤 메뉴·menuVersion·webVersion을 먼저 설정하고 잠금을 해제한다. 해당 계정의 창 구성을 복원하며 모든 창에 같은 결과를 broadcast한다. `locked` 중에는 메뉴를 shell에 노출하지 않는다.
7. `/api/auth/me` 실패는 업무 화면을 잠근다. 인증은 성공했지만 bootstrap이 실패하면 메뉴·menuVersion·webVersion을 비우고 `syncStatus=error`와 최신 메뉴 확인 실패 문구를 표시한다. 사용자는 `업데이트 확인`으로 재시도하거나 인증된 기존 웹 홈에서 업무를 열 수 있다. 이 상태를 최신 업데이트 완료로 표시하지 않으며 이전 계정이나 설치본의 메뉴로 fallback하지 않는다.

수동 `업데이트 확인`은 미저장 입력을 건드리지 않고 동일 흐름으로 최신 메타데이터만 읽는다. 동일 계정 수동 확인 실패도 메뉴를 비우고 오류를 표시하지만 기존 live view는 유지한다.

## 최신 웹 화면과 미저장 입력

웹 기능은 기존 `https://nenovaweb.com` 페이지가 제공한다. 첫 성공 bootstrap 또는 `webVersion` 변경 시 HTTP cache를 정리한 뒤 새 화면·복원 화면을 연다. 캐시 정리 완료 후 generation을 다시 확인한다. 메뉴 JSON만 바꾸고 오래된 문서를 계속 로드하면서 웹 기능 업데이트가 끝났다고 표시해서는 안 된다.

이미 열려 있는 동일 계정의 live view는 메뉴 동기화만으로 reload·destroy하지 않는다. 탭 이동·창 이동·입력값·스크롤을 보존한다. 배포 버전이 바뀌어도 편집 중인 화면을 강제로 새로고침하지 않고, 새 탭에는 새 배포를 적용하며 기존 화면은 저장 후 기존 새로고침 확인 절차로 갱신할 수 있게 안내한다.

삭제·권한 제외된 메뉴는 새 목록에서 사라져야 한다. 기존 즐겨찾기나 직접 URL은 접근 권한을 부여하지 않으며 페이지와 API의 서버 권한 검사를 그대로 통과해야 한다. 검색, query가 다른 동일 경로, popup 정책이 일괄 정규화로 손실되지 않게 검증한다.

## ERP 부작용

| 동작 | 변경 범위 | 보존 대상 |
|---|---|---|
| 인증·메뉴 GET | 기존 인증/접속 로그와 메모리 메뉴 상태 | Order*, Shipment*, ShipmentDate, ShipmentFarm, Stock*, ProductStock, Estimate, WebProfitReport |
| 메뉴 동기화·HTTP 캐시 갱신 | 데스크톱 메뉴 메모리·HTTP 캐시 | 동일 계정 live view의 DOM·입력·스크롤, 인증 쿠키 |
| 계정 전환 | 기존 계정 격리 정책대로 view·로컬 화면 상태 정리 | ERP 원장 전체 |
| 새 업무 메뉴 열기 | 기존 HTTPS 업무 페이지 탐색 | 서버가 요구하지 않은 ERP 자동 저장·재시도 없음 |

이 변경은 메뉴 메타데이터와 웹 진입을 다루며 공유 ERP SQL을 추가·수정하지 않는다. 개별 업무 API 변경이 필요해지면 dnSpy·DB probe·대상 계약의 사전 가드를 별도로 수행한다.

## 필수 인수 테스트

- 현재 canonical 전체 항목과 각 계정 응답을 비교한다. `nenovaSS3`, 등록된 일반 직원, 미등록 계정, 비로그인 fixture를 모두 검증한다. 제한 목록 계산 표현식도 실제 평가되어야 한다.
- 새 메뉴를 canonical fixture에 추가했을 때 설치 snapshot 변경 없이 다음 로그인 응답과 shell에 나타난다. 변경·삭제·순서·popup·query도 비교한다.
- 401, timeout, 500, invalid JSON, schema 불일치, 다른 userId 응답, 외부 URL, 과도한 항목 수에서 안전한 오류·재시도를 검증한다.
- A 로그인 요청을 지연한 뒤 B로 바꾸어 A의 늦은 메뉴가 B에 나타나지 않는지 확인한다. 쿠키 변경과 캐시 정리 중 generation 교체도 포함한다.
- 메뉴 갱신 전후 같은 계정의 탭 webContents ID, fixture 입력, 스크롤, 탭 순서·창 위치가 같다. 새로운 문서는 변경된 웹 배포 marker를 읽는다.
- 같은 계정 재로그인, 다른 계정 로그인, 저장된 로그인으로 앱 재실행, 서버에 API가 아직 없는 404 배포 순서를 확인한다. 서버 API를 먼저 배포한 후 해당 클라이언트를 배포한다.
- 1920 × 1080 CSS pixel/100%에서 메뉴 검색·스크롤·Tab/Shift+Tab·방향키·Enter/Space·Escape·초점 복귀와 오류 재시도를 확인한다.
- 기존 `npm run test:ui-layout`와 desktop 테스트·smoke, production build를 실행한다. 웹 수정 배포는 프로젝트의 필수 ERP guard가 요구하는 검증도 함께 수행한다.

필수 참조 `docs/CODEX_SUBTASK_ORCHESTRATION.md`는 기준일 현재 작업 checkout에 없다. 이번 설계는 사용자 AGENTS와 메인 작업의 명시적 문서 소유 범위를 따른다.
