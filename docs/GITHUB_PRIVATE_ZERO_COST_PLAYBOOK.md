# GitHub Private 전환 — 무사고·무과금 실행 절차서 (목표 g18)

> 대상 저장소(2026-11-20 실측, 전부 **PUBLIC**): `ai-trainer-hub`, `ai-lecture`, `nenovakakao`, `nenova-erp-ui`, `mindmap-viewer`
> 원칙: **추가 과금 0원 · 운영 중단 0분 · 서버/직원 PC에 GitHub 토큰 심기 금지.**
> 한 번에 한 저장소씩, 아래 순서대로. 각 단계는 *사전확인 → 전환 → 사후확인 → 롤백* 으로 구성된다.

## 0. 공통 규칙

| 항목 | 내용 |
| --- | --- |
| 전환 명령 | `gh repo edit Jayinsightfactory/<repo> --visibility private --accept-visibility-change-consequences` |
| 즉시 롤백 | `gh repo edit Jayinsightfactory/<repo> --visibility public --accept-visibility-change-consequences` (코드·이슈·Actions 설정은 그대로 유지, 별도 복구 작업 없음) |
| 부작용 | Private 전환 시 **Star·Watcher·Fork 관계가 사라지고**, 무인증 `git clone/fetch`, `raw.githubusercontent.com`, Releases 무인증 다운로드가 즉시 404가 된다. |
| Actions 한도 | Free 플랜 Private 저장소는 호스티드 러너 **월 2,000분**(Windows 러너는 2배 소모). 초과 시 과금이 아니라 **작업 중단**이므로 `nenova-erp-ui`는 Self-Hosted Runner(무료·무제한)로 이관한다. |
| 사전 백업 | `git clone --mirror https://github.com/Jayinsightfactory/<repo>.git E:\backup\<repo>.git` (전환 직전 1회) |
| 전환 전 소비자 조사 | `git grep -nE "github\.com/Jayinsightfactory\|raw\.githubusercontent\.com/Jayinsightfactory\|api\.github\.com/repos/Jayinsightfactory"` 를 저장소마다 실행하고, 무인증 사용처를 먼저 제거한다. |
| 금지 | 서버·직원 PC에 PAT/Deploy Key 배포, 전환 후 확인 없이 다음 저장소 진행, 운영 PC 매크로·ECOUNT 쓰기 변경 |

공통 사후확인(어느 저장소든): 로그아웃 상태 브라우저/`curl -sI https://github.com/Jayinsightfactory/<repo>` 가 **404** 이고,
`gh repo view Jayinsightfactory/<repo> --json visibility -q .visibility` 가 `PRIVATE` 이다.

---

## 1단계 — `ai-trainer-hub`, `ai-lecture` (즉시 전환)

운영 서버/앱이 GitHub 에서 직접 받아가는 경로가 없는 저장소부터 전환한다.

```powershell
# 사전확인: 무인증 소비자 없음 (Pages/Railway/Vercel 연동이 있다면 아래 결과에 나타난다)
foreach ($r in 'ai-trainer-hub','ai-lecture') {
  gh api repos/Jayinsightfactory/$r --jq '{pages:.has_pages,visibility:.visibility}'
  gh api repos/Jayinsightfactory/$r/pages 2>$null
  gh api repos/Jayinsightfactory/$r/hooks --jq '.[].config.url' 2>$null
}
# 전환
foreach ($r in 'ai-trainer-hub','ai-lecture') {
  gh repo edit Jayinsightfactory/$r --visibility private --accept-visibility-change-consequences
}
# 사후확인
foreach ($r in 'ai-trainer-hub','ai-lecture') { gh repo view Jayinsightfactory/$r --json visibility -q .visibility }
```

- `has_pages=true` 이면 GitHub Pages 가 Free 플랜 Private 에서 중단되므로 **그 저장소는 보류**하고 보고한다.
- 롤백: 위 공통 롤백 명령.

## 2단계 — `nenovakakao` (GitHub Pro $4/월 + 운영 PC GCM 확인)

> 운영 PC(카카오 수집)는 이 저장소를 `git pull` 한다. Private 이 되면 **자격 증명이 있는 PC만** 동작한다. 운영 PC 매크로 분리(PR #50)는 별도 승인 사항이므로 이 절차에서 건드리지 않는다.

1. **GitHub Pro 가입** — 개인 계정 Settings → Billing → *GitHub Pro* ($4/월). 필요한 이유: Free 플랜 Private 저장소는 보호 브랜치 규칙 등 일부 기능이 제한된다. (Pro 없이 Free Private 만으로도 pull/push 자체는 가능하므로 비용이 부담이면 Pro 는 생략할 수 있다.)
2. **운영 PC Git Credential Manager(GCM) 확인** — 운영 PC 에서:
   ```powershell
   git --version
   git credential-manager --version        # 설치돼 있어야 함
   git config --global credential.helper   # manager 로 나와야 함
   cd C:\Users\USER\nenovakakao
   git ls-remote origin HEAD               # 지금(Public)은 무인증 성공 — 전환 전 인증 경로를 확인하려면 아래 한 줄
   cmdkey /list | findstr /i github        # 저장된 GitHub 자격 증명 유무
   ```
   저장된 자격 증명이 없으면 **전환 전에** 운영 PC 에서 `git fetch origin` 을 한 번 실행해 브라우저 로그인으로 GCM 에 저장한다(토큰 파일 생성 금지).
3. **전환**
   ```powershell
   gh repo edit Jayinsightfactory/nenovakakao --visibility private --accept-visibility-change-consequences
   ```
4. **사후확인(운영 PC)**: `git -C C:\Users\USER\nenovakakao fetch origin` 이 비밀번호 입력 없이 성공하고 다음 수집 주기에 정상 동작.
5. **롤백**: 운영 PC fetch 가 인증 창/오류를 내면 즉시 공통 롤백 명령으로 Public 복귀 후 GCM 재설정.

## 3단계 — `nenova-erp-ui` (Cafe24 배포·데스크톱 업데이트 무인증 의존 제거)

> 코드 선행 조건 — **이 PR(`feat/zero-cost-private-repo-prep`)이 master 에 머지되고 `Deploy to Cafe24` 가 1회 성공한 뒤에만** 전환한다.

### 3-A. 이미 코드로 해결된 것 (이 PR)

| 의존 | 이전 | 변경 |
| --- | --- | --- |
| Cafe24 서버가 소스 갱신 | 서버 SSH 스크립트가 `git remote set-url origin https://github.com/...` + 무인증 `git fetch origin master` | Actions 러너(체크아웃 인증 완료)가 `git bundle`(서버 HEAD 이후 증분) + `deploy-meta.json` 을 SCP 로 전송. 서버는 **번들 SHA256, 메타(커밋·아카이브 SHA·릴리스 ID) 검증 → `git bundle verify` → 로컬 번들에서 `origin/master` 갱신 → `--ff-only`**. GitHub 접속·토큰 0개 |
| 최신 master 확인(STALE_RELEASE) | 서버가 fetch 해 비교 | 러너가 `git fetch origin master` 로 `GITHUB_SHA` 와 비교 |
| 롤백/무중단 | `.next-previous` 원자적 교체·`flock` 대기·변경파일 백업 | **변경 없음**(번들 검증 이후 구간은 그대로) |
| 데스크톱 앱 업데이트 | 고정 URL `…/releases/latest/download` | `desktop/updater.cjs` 가 `https://nenovaweb.com/desktop-releases`(1차) → 실패/404/비정상 메타 시 GitHub Releases(2차) 순으로 자동 폴백 |

서버가 번들을 받으려면 서버 HEAD 가 러너 저장소의 조상이어야 한다. 서버에 수동 커밋이 있으면 `SERVER_HEAD_DIVERGED` 로 **배포가 안전하게 중단**된다(운영 앱은 그대로 유지).

### 3-B. 전환 전 필수 작업

1. **데스크톱 업데이트 피드 준비(Cafe24 정적 파일)** — 새 앱 버전을 `https://nenovaweb.com/desktop-releases/` 에 올린다.
   ```powershell
   # 1) 설치 파일 빌드 산출물(Actions 아티팩트 Nenova-Desktop-Windows-x64 또는 로컬 npm --prefix desktop run dist)
   $v = (Get-Content desktop\package.json | ConvertFrom-Json).version
   # 2) 서버 정적 디렉터리(저장소 밖이라 배포가 건드리지 않음)에 업로드
   scp desktop\dist\Nenova-Desktop-Setup-$v-x64.exe desktop\dist\latest.yml root@172.233.89.171:/var/www/nenova-desktop-releases/
   ```
   서버에서 한 번만 nginx 에 정적 경로 추가(인증 미들웨어와 무관하게 서빙):
   ```nginx
   location /desktop-releases/ { alias /var/www/nenova-desktop-releases/; add_header Cache-Control "no-cache"; }
   ```
   확인(둘 다 200 이고 본문이 `version:` 으로 시작해야 한다. HTML 로그인 화면이 오면 실패):
   ```powershell
   curl.exe -s -o NUL -w "%{http_code}`n" https://nenovaweb.com/desktop-releases/latest.yml
   curl.exe -s https://nenovaweb.com/desktop-releases/latest.yml | Select-Object -First 3
   curl.exe -sI https://nenovaweb.com/desktop-releases/Nenova-Desktop-Setup-$v-x64.exe | Select-String "200|Content-Length"
   ```
   > 매 릴리스마다 `latest.yml` 과 설치 파일을 **같은 방식으로 업로드**해야 한다. 업로드를 빼먹으면 1차 피드가 옛 버전을 가리켜 직원 앱이 갱신되지 않는다(2차 폴백은 1차가 *실패*할 때만 동작).
2. **이미 설치된 구버전 앱은 GitHub 고정 URL 을 쓴다** — Private 전환 전에 **새 버전 앱이 직원 PC 에 전부 배포**됐는지(앱 설정의 버전 확인) 확인한다. 미갱신 PC 는 전환 후 수동 설치가 필요하다.
3. **웹 다운로드 버튼** `components/DesktopDownloadButton.js` 의 `releases/latest` 링크는 Private 전환 후 로그아웃 사용자에게 404 이므로, 1차 피드 업로드 확인 후 `https://nenovaweb.com/desktop-releases/Nenova-Desktop-Setup-<버전>-x64.exe` 로 교체하는 후속 PR 을 낸다(이 PR 범위 밖).
4. **Actions 러너 결정** — 월 2,000분(Windows 2배) 한도 대비:
   `Deploy to Cafe24`(ubuntu, 빌드 포함 약 15~20분/회) + `Nenova Desktop Windows`(windows, 약 20분×2배) + `verify` 를 합산해 한도를 넘기면 **Self-Hosted Runner** 로 전환한다.
   ```powershell
   # 저장소 Settings → Actions → Runners → New self-hosted runner (Windows x64) 의 토큰을 사용해 운영 보조 PC 에 설치
   mkdir C:\actions-runner; cd C:\actions-runner
   # (GitHub 화면에 표시되는 다운로드/구성 명령 실행)  .\config.cmd --url https://github.com/Jayinsightfactory/nenova-erp-ui --token <일회용 토큰> --labels nenova-win
   .\run.cmd   # 확인 후 서비스 등록: .\svc.cmd install; .\svc.cmd start
   ```
   러너 라벨 연결은 워크플로의 `runs-on: [self-hosted, nenova-win]` 변경 PR 로 별도 진행하며, **운영 PC·ECOUNT PC 에는 설치하지 않는다.** 한도가 충분하면 이 항목은 생략 가능.

### 3-C. 전환과 확인

```powershell
gh repo edit Jayinsightfactory/nenova-erp-ui --visibility private --accept-visibility-change-consequences
gh workflow run "Deploy to Cafe24" --ref master -f diagnose_checkout_only=true   # 읽기 전용 점검
# 더미 변경 없이 실제 배포 확인은 다음 정상 master 머지 때 Deploy to Cafe24 성공 로그로 확인
```
확인 항목: ① Deploy to Cafe24 `SSH Deploy` 로그에 `verify transferred release` 가 출력되고 `git fetch https://github.com` 흔적이 없음 ② 직원 앱 업데이트 확인이 1차 피드로 동작 ③ 운영 사이트 헬스 정상.

### 3-D. 롤백

1. 증상 발생 즉시 `gh repo edit Jayinsightfactory/nenova-erp-ui --visibility public --accept-visibility-change-consequences`.
2. 배포 실패 시 서버는 `.next-previous` 와 기존 체크아웃을 유지한 채 중단되므로 재조치 불필요(필요 시 `/var/lib/nenova/deploy-backups` 참고).
3. 코드 롤백: 이 PR 의 squash 커밋을 `git revert` (서버 `git remote origin` 설정은 이 PR 이 지우지 않으므로 Public 상태에서는 이전 방식으로도 즉시 복귀 가능).

## 4단계 — `mindmap-viewer` (데몬 번들 배포 전환)

> `mindmap-viewer` 는 직원 PC 데몬/Railway 가 소스를 받아가는 경로가 있을 수 있다. **2~3단계가 안정된 뒤** 마지막에 진행한다. 이 저장소의 작업 브랜치(`fix/railway-ram-diet-pg-cleanup` 등)를 다른 워커가 사용 중인지 `git -C C:\Users\USER\mindmap-viewer status` 로 먼저 확인하고, 이 절차에서는 코드를 수정하지 않는다.

1. 무인증 소비자 조사: `git -C C:\Users\USER\mindmap-viewer grep -nE "github\.com/Jayinsightfactory|raw\.githubusercontent|npm install .*github:"` 와 Railway/직원 PC 자동 업데이트 스크립트(`git pull`, `curl .../archive/...`)를 모두 목록화.
2. 데몬 배포를 **번들 방식(3-A 와 동일 개념)** 으로 전환: 인증된 환경(러너 또는 이 PC)에서 `git bundle create daemon.bundle <브랜치> ^<배포중SHA>` → 해시 검증 가능한 전송(SCP/정적 `/desktop-releases` 유사 경로) → 수신측은 `git bundle verify` + `git fetch <bundle>` 만 수행.
3. 전환: `gh repo edit Jayinsightfactory/mindmap-viewer --visibility private --accept-visibility-change-consequences`
4. 사후확인: 데몬 1회 업데이트 사이클 성공, Railway 빌드(GitHub 연동 방식이면 Railway 의 GitHub 앱 권한은 Private 접근 허용 상태인지) 확인.
5. 롤백: 공통 롤백 명령.

## 5. 완료 기록

| 단계 | 저장소 | 전환일 | 확인자 | 비고 |
| --- | --- | --- | --- | --- |
| 1 | ai-trainer-hub / ai-lecture | | | |
| 2 | nenovakakao | | | |
| 3 | nenova-erp-ui | | | |
| 4 | mindmap-viewer | | | |
