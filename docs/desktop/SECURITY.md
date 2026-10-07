# Nenova Desktop 보안·데이터 경계

작성: 2026-10-07. 제품 요구사항은 [PRD.md](PRD.md)를 따른다. 아래 항목은 구현·검증 기준이며 문서 존재만으로 통과를 의미하지 않는다.

## 신뢰 경계

패키지에 포함한 로컬 shell과 main만 데스크톱 권한을 가진다. 승인된 `https://nenovaweb.com`도 서버/페이지 침해 가능성이 있는 원격 콘텐츠로 취급한다. 원격 업무 페이지에는 preload 또는 Node/Electron 객체를 노출하지 않는다. ERP 자격증명·JWT·DB 비밀값을 설치 파일에 포함하지 않는다.

프로젝트 기본값은 원격 renderer의 `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, `webSecurity:true`, `allowRunningInsecureContent:false`다. shell에도 context isolation과 sandbox를 적용하고 필요한 IPC만 이름별로 노출한다. 원격 주소의 허용 판정과 IPC sender 검증은 main에서 수행한다. [Electron 보안 권고](https://www.electronjs.org/docs/latest/tutorial/security)

## URL·창 생성 정책

- production 원격 origin은 정확히 `https://nenovaweb.com`만 허용한다. `URL` 파서로 protocol, hostname, port, username/password를 검증하며 문자열 prefix로 판단하지 않는다.
- `nenovaweb.com.attacker.example`, `nenovaweb.com@attacker.example`, 비표준 port, HTTP downgrade, `javascript:`, `file:`, 임의 `data:` URL을 업무 탭/복원/즐겨찾기에서 거부한다.
- 탐색 시작·redirect·새 창 생성에 같은 정책 함수를 적용한다. 로컬 shell이 원격 URL로 탐색하는 것도 차단한다.
- 외부 HTTP(S) 링크는 목적지가 보이는 사용자 동작으로만 기본 브라우저에 전달한다. 자동 redirect와 원격 스크립트가 외부 앱을 실행하게 하지 않는다. 커스텀 protocol·실행 파일 경로를 전달하지 않는다.
- `window.open`은 기본 거부하고 검증된 같은 origin을 main 소유 탭으로 생성한다. 기존 업무의 opener 관계를 유지하기 위해 `setWindowOpenHandler`의 `createWindow`가 제공하는 webContents를 WebContentsView로 받아들인다. `about:blank`는 승인된 업무 부모가 만든 관리 팝업 탭에서만 허용하고, 일반 URL 입력·복원 대상으로는 허용하지 않는다. `blob:` 예외는 별도 검증 없이는 허용하지 않는다.
- 모든 업무 session에 권한 요청·검사 정책을 등록한다. 카메라·마이크·위치·알림 등은 초기 기본 거부다. 필요한 기능은 사용자 동작과 정확한 origin을 확인한 최소 예외로 추가한다.
- 인증서 오류를 우회하지 않는다. 개발용 localhost 예외는 production 패키지에서 켤 수 없도록 분리한다.

기존 `pages/sales/registration-history.js`, `pages/ecount/reconcile.js`는 빈 창을 연 뒤 `document.write`한다. `pages/stats/dutch-volume-match.js`, `pages/sales/defect-deduction-register-review.js`는 opener 메시지를 사용한다. 이 창들을 `deny` 후 별도 URL 탭으로 열면 반환 창 핸들과 opener 관계가 깨질 수 있다. 관리 팝업은 승인된 부모의 session과 제한된 권한을 상속하고, 탐색/권한 정책을 첫 로드 전에 등록하며, 전체 창 인증 전환·종료에도 포함한다. Electron은 `about:blank`에서 부모의 webPreferences를 상속하므로 부모 자체가 무권한 원격 renderer여야 한다. [Electron renderer 창 생성 규칙](https://www.electronjs.org/docs/latest/api/window-open)

## 로컬 shell IPC 계약

shell preload는 `newTab`, `activateTab`, `closeTab`, `moveTab`, `bookmark`, `getState`처럼 제한한 기능만 제공한다. 임의 채널 `send/invoke`, 파일 경로 열기, shell 명령, 임의 JavaScript 실행, 임의 fetch proxy를 노출하지 않는다.

각 IPC는 등록된 shell webContents의 main frame에서 왔는지 확인한다. URL만 같은 다른 frame/webContents는 거부한다. 탭 ID·창 ID 소유권, URL, 문자열 길이, 순서 배열 중복, 창 좌표·크기 범위를 검증한다. 메뉴 제목·웹 페이지 제목은 text로 렌더링하고 HTML로 삽입하지 않는다. 오래된 탭 ID 및 이동 도중 중복 요청은 부작용 없이 거부한다.

로컬 문서를 custom protocol로 제공하면 패키지 allowlist의 정적 자산만 매핑한다. 요청 경로를 OS 경로로 단순 연결하지 않고 `..`, URL 인코딩 우회, 드라이브·UNC 경로를 거부한다. 파일 URL을 쓰는 초기 구현도 단일 packaged shell 경로 외 탐색은 금지하고 범용 file 접근을 제공하지 않는다. shell CSP는 로컬 script/style만 사용하고 원격 코드와 inline script 실행을 허용하지 않는 것을 목표로 한다.

## 인증과 계정 경계

현재 웹은 `nenovaToken` HttpOnly 쿠키, 서버 `/api/auth/me`, 표시용 `localStorage.nenovaUser`를 사용한다. 로그인·권한은 웹 서버가 판정한다. main이 쿠키 값을 로깅하거나 renderer에 전달하거나 JWT를 임의 생성하지 않는다.

하나의 활성 ERP 계정에 속한 탭만 같은 session partition을 공유한다. Electron의 같은 persistent partition을 쓰는 페이지는 세션을 공유하므로 탭별 다른 로그인으로 오해하게 만들지 않는다. 브라우저 Chrome의 기본 프로필을 읽거나 복사하지 않는다. [Electron session API](https://www.electronjs.org/docs/latest/api/session)

로그아웃/쿠키 만료/토큰 교체는 전체 창의 인증 경계다. 프로젝트 정책은 다음과 같다.

1. 계정 전환 전 미저장 상태 안내를 한다. 로그아웃이 이미 서버에서 처리됐다면 서버 쓰기가 차단된 상태를 유지한다.
2. main은 인증 쿠키 변경을 계기로 기존 업무 view를 중지·숨기고 제목/URL/즐겨찾기를 가린다. session 요청 필터는 잠금 중 인증 API 외의 POST/PUT/PATCH/DELETE 등 비조회 요청을 차단한다. GET/HEAD/OPTIONS는 차단하지 않으므로 모든 네트워크 활동이 중단됐다고 표시하지 않는다. 이는 기존 조회 API가 쓰기 부작용을 만들지 않는다는 웹 계약을 전제로 한다.
3. 같은 session의 서버 `/api/auth/me` 결과로 현재 계정을 확인한다. 쿠키를 직접 decode한 값이나 localStorage만으로 계정을 신뢰하지 않는다. 실패/timeout에는 업무 화면 재활성화를 보류한다.
4. 이전 계정 view는 새 계정으로 재사용하지 않는다. 원격 상태가 다른 계정에서 남지 않게 닫거나 초기화한 뒤 새 업무 view를 만든다.
5. 다른 계정일 때 localStorage/IndexedDB/serviceworker/cache storage 등 비쿠키 저장소와 cache를 정리한 후 업무 화면을 연다. 새 인증 쿠키를 지우지 않도록 저장 종류를 구분한다. 인증 조회와 비동기 정리 이후 인증 세대를 재확인하고 최신 요청만 잠금을 해제한다. 정리 실패 시 잠금을 유지하고 재시도 가능한 오류를 표시해야 한다.
6. 복원 항목과 즐겨찾기는 새 권한의 접근 허용을 의미하지 않는다. 서버가 재검증하고, 이전 계정의 고객명/검색값/화면 제목은 보여주지 않는다.

이 동작을 구현하지 못한 초기 빌드는 계정 전환 안전성 검증 미완료로 표시한다. 안전한 최소 대안은 계정 전환 때 모든 업무 탭을 폐기하고 일반 시작 화면으로 돌아가는 것이다. 다중 계정 동시 로그인은 별도 profile 설계 없이는 지원하지 않는다.

요청 필터는 새 요청을 제어하며 이미 서버에 도착한 저장 트랜잭션을 취소하지 않는다. 로그아웃/연결 끊김으로 앞선 업무 저장이 롤백됐다고 추정하지 않고 기존 조회·감사 흐름에서 결과를 확인한다.

## 닫기·복원·오프라인

탭 이동과 분리는 기존 webContents를 유지한다. 개별 탭 닫기·새로고침·탐색은 미저장 상태 손실 가능성을 알리고 페이지의 `beforeunload` 차단을 확인한다. 창 전체 닫기·앱 종료는 모든 대상 탭의 미저장 입력을 버린다고 명시한 전역 확인을 사용한다. 기본 선택은 계속 작업이며, 사용자가 일괄 폐기를 선택한 뒤에는 각 페이지의 unload 대화상자를 반복하지 않고 정리한다. 메모리 절약을 위해 배경 탭을 자동 destroy하거나 주기적으로 reload하지 않는다.

앱이 crash한 뒤 복원하는 것은 URL·창 배치다. ERP 쓰기 payload, fetch 요청, 업로드, 결제/확정, 다운로드를 replay하지 않는다. 서버 응답이 끊긴 작업은 저장 성공/실패를 추정하지 않고 기존 웹 확인 흐름을 사용한다. 로컬 JSON에 저장 성공을 추론할 값을 기록하지 않는다.

## 로컬 보관 데이터

허용: schema version, 검증된 계정 ID, 범위가 검증된 창 좌표·크기, 탭 순서, 업무 경로, 허용 query 문맥, 사용자 지정 비민감 탭/즐겨찾기 이름, 표시 설정. 현재 snapshot query 허용 목록에는 연도·차수·고객/품목키·날짜 등이 포함된다. 같은 검증 계정에만 복원하고 PC 저장 파일을 암호화한다.

금지: 비밀번호, JWT, cookie dump, DB 연결 문자열, SQL 결과, 고객별 거래 내용, 입력 DOM snapshot, ERP POST body. URL query/fragment는 기본 제거하고 명시적 문맥 허용 목록이 있을 때만 보관한다. 임의 전체 URL을 저장하지 않는다. 저장 가능한 탭 이름도 비밀값·거래 메모를 기록하는 용도로 사용하지 않는다.

설정 파일은 Windows 사용자별 app data에 보관하며 임시 파일 후 atomic rename과 크기 제한을 사용한다. 메타데이터를 safeStorage로 암호화해도 ERP 원장/비밀값을 넣지 않는 원칙은 유지한다. 암호화 사용 불가·복호화 실패 시 평문으로 조용히 내려가지 않고 복원 실패를 안내한다. 파일이 손상되면 기본 상태로 복구하고 원격/OS 경로를 실행하지 않는다. 중복 앱 실행은 단일 인스턴스 정책으로 합치거나 충돌 없는 쓰기 규칙을 갖춘다. 로그는 비밀값과 전체 업무 URL을 제외하고 오류 종류·앱 버전·내부 탭 ID 정도로 제한한다.

## 다운로드·인쇄·배포

파일 저장은 사용자가 시작한 기존 웹 다운로드에서 시스템 저장 대화상자로 진행한다. 파일명 경로 문자를 정리하고 서버 응답의 경로를 그대로 로컬 저장 경로로 사용하지 않는다. 실행 파일/스크립트 자동 실행, 임의 `shell.openPath`, 다운로드 완료 시 실행은 제공하지 않는다. 인쇄는 대상과 프린터를 확인할 수 있는 대화상자를 우선한다.

설치 패키지는 앱 자산·고정 의존성만 포함하고 개발 `.env`, DB 파일, 운영 인증, 작업 세션 기록을 포함하지 않는다. 배포 아티팩트의 해시와 서명 상태를 기록한다. Electron 또는 설치기 업데이트를 임의 원격 URL에서 다운로드·실행하는 기능을 만들지 않는다. 자동 업데이트는 신뢰할 배포 origin·서명·롤백 절차가 마련된 별도 단계로 둔다.

패키징 보강 권고는 `electronFuses`의 `runAsNode:false`, `enableNodeOptionsEnvironmentVariable:false`, `enableNodeCliInspectArguments:false`, `grantFileProtocolExtraPrivileges:false`, `enableCookieEncryption:true`, `onlyLoadAppFromAsar:true`다. ASAR 무결성 검증도 Windows 지원 범위에서 활성화하고 패키지 실행을 확인한다. Cookie 암호화 fuse는 메타데이터 safeStorage와 별개이며, 활성화 후 이전 비암호화 모드로 되돌리는 배포를 하지 않는다. 실제 적용 여부는 최종 EXE의 fuse 읽기 결과로 판단한다. [Electron Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)

## 필수 보안 인수 목록

| 검증 | 기대 결과 |
|---|---|
| 업무 탭에서 require/process/desktop bridge 접근 | 접근 불가 |
| 위조 IPC, iframe IPC, 존재하지 않는 탭 이동 | 거부, 기존 상태 보존 |
| URL hostname suffix/userinfo/port/redirect 우회 | 탐색·복원·새 창 모두 거부 |
| 악성 제목 `<img onerror=...>` | 텍스트 표시, 실행 없음 |
| 비허용 protocol 외부 열기 | 거부 |
| 인증서 오류 | 접속 거부·명확한 실패 안내 |
| 2개 창에서 A 로그아웃 후 B 로그인 | A의 stale 페이지·초안으로 B 계정 쓰기 불가 |
| 인증 조회 timeout | 업무 화면 잠금 유지, 재시도 가능 |
| `beforeunload`가 막은 개별 탭 닫기 취소 | webContents와 입력값 유지 |
| 창/앱 전체 폐기 확인 취소 | 대상 창·탭 유지; 진행을 선택했을 때만 일괄 폐기 |
| 손상/과대/수정된 설정 파일 | 허용 경로만 복원 또는 기본값 사용 |
| crash 후 복원 | 쓰기 요청 재전송 없음 |
| 패키지 및 로그 비밀값 검사 | 인증/DB 비밀값 없음 |

이 목록은 위험 기반 데스크톱 검증이다. 기존 ERP API나 업무 UI를 변경했다면 저장소의 dnSpy·계약·교차연도·downstream·빌드 검증을 별도로 모두 수행한다.
