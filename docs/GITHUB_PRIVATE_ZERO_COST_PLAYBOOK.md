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

### 3-A. 이미 코드로 해결된 것 (Phase 1 #1909/#1913 + Phase 2)

| 의존 | 이전 | 변경 |
| --- | --- | --- |
| Cafe24 서버가 소스 갱신 | 서버 SSH 스크립트가 `git remote set-url origin https://github.com/...` + 무인증 `git fetch origin master` | Actions 러너(체크아웃 인증 완료)가 `git bundle`(서버 HEAD 이후 증분) + `deploy-meta.json` 을 SCP 로 전송. 서버는 **번들 SHA256, 메타(커밋·아카이브 SHA·릴리스 ID) 검증 → `git bundle verify` → 로컬 번들에서 `origin/master` 갱신 → `--ff-only`**. GitHub 접속·토큰 0개 (실서버 `run 44670064193` 검증 완료) |
| 최신 master 확인(STALE_RELEASE) | 서버가 fetch 해 비교 | 러너가 Checkout 직후 1차 조기 스킵(`STALE_RELEASE_EARLY`, 15초 종료) + SCP 직전 2차 최종 검증으로 중복 빌드 7분 소모 차단 |
| 롤백/무중단 | `.next-previous` 원자적 교체·`flock` 대기·변경파일 백업 | **변경 없음**(번들 검증 이후 구간은 그대로, `cancel-in-progress: false` 보존) |
| 데스크톱 앱 업데이트 1차 피드 | 고정 URL `…/releases/latest/download` (Private 전환 시 404) | `desktop/updater.cjs` 1차 `https://nenovaweb.com/desktop-releases` → 2차 GitHub Releases 폴백. Next.js `pages/api/public/desktop-releases/[...path].js` + `next.config.js` rewrite 가 배포 밖 영구 경로(`/var/lib/nenova/desktop-releases`, `~/shared/desktop-releases` 링크)에서 `latest.yml`/`.exe`/`.blockmap`/`SHA256.txt` 를 무인증·Range 스트리밍 서빙 |
| 데스크톱 인스톨러 CI 자동 게시 | Actions 아티팩트만 생성, 수동 업로드 | `.github/workflows/desktop-windows.yml` 의 `publish-cafe24` 잡(`ubuntu-latest`, Windows 분 0)이 `master` 푸시·`release published`·`workflow_dispatch(seed_from_release_tag)` 시 SHA-512 검증 후 Cafe24 영구 디렉터리에 `.exe` 선배치 → `latest.yml` 원자 교체 자동 게시 |
| 웹 다운로드 버튼 | `DesktopDownloadButton.js` 가 GitHub `releases/latest` 직링크 | `/desktop-releases/latest` 로 교체(`latest.yml` 검증된 최신 `.exe` 로 302 리다이렉트 — Private 전환 후에도 무인증 다운로드) |
| Actions 월 2,000분 한도 방어 | PR 중복 실행 미취소, `master` 푸시 중복 `verify`, 비-desktop PR 풀 Windows 패키징 | `erp-contract.yml`·`desktop-windows.yml` PR `concurrency` 즉시 취소(`cancel-in-progress: true`), `erp-contract.yml` 중복 `master` push 제거(필수 PR 체크 `verify` 유지), `desktop/**` 미변경 PR 은 경량 `npm test` fast-pass, `deploy.yml` 조기 `STALE_RELEASE_EARLY` 스킵 |

서버가 번들을 받으려면 서버 HEAD 가 러너 저장소의 조상이어야 한다. 서버에 수동 커밋이 있으면 `SERVER_HEAD_DIVERGED` 로 **배포가 안전하게 중단**된다(운영 앱은 그대로 유지).

### 3-B. 전환 전 확인 및 비상 로컬 배포

1. **Cafe24 `/desktop-releases` 자동 시드 및 HTTP 200 확인**:
   - 기존 GitHub Release(`desktop-v1.3.74` 등)를 Windows 러너 0분 소모로 즉시 시드하려면:
     ```powershell
     gh workflow run "Nenova Desktop Windows" --ref master -f seed_from_release_tag=desktop-v1.3.74
     ```
   - 정상 서빙 확인(`latest.yml` 200 YAML + `latest` 302 리다이렉트 + `.exe` 200):
     ```powershell
     curl.exe -s -o NUL -w "latest.yml HTTP %{http_code}`n" https://nenovaweb.com/desktop-releases/latest.yml
     curl.exe -s https://nenovaweb.com/desktop-releases/latest.yml | Select-Object -First 4
     curl.exe -s -o NUL -w "latest redirect HTTP %{http_code}`n" https://nenovaweb.com/desktop-releases/latest
     ```
2. **이미 설치된 구버전 앱은 GitHub 고정 URL 을 쓴다** — Private 전환 전에 `desktop/updater.cjs` 이중 피드가 탑재된 버전(`1.3.74` 이상)이 직원 PC 에 배포됐는지 확인한다. 미갱신 PC 는 `https://nenovaweb.com/desktop-releases/latest` 에서 1회 수동 설치하면 이후 자동 업데이트된다.
3. **비상 시 로컬 PC 무인증 번들 배포(GitHub Actions 무료 2,000분 소진 대비)**:
   - Actions 무료 한도가 소진돼도 이 PC 에서 Cafe24 로 GitHub 접속·서버 토큰 없이 동일하게 배포할 수 있다:
     ```powershell
     # 1) 안전 드라이런(읽기 전용 점검, 기본값)
     node scripts/local-cafe24-deploy.cjs --dry-run
     # 2) 실제 비상 배포 (clean master 체크아웃 + SSH 접속 가능 상태)
     node scripts/local-cafe24-deploy.cjs --apply
     ```
   - 한도 여유가 부족하면 보조 PC(운영 PC·ECOUNT PC 제외)에 Self-Hosted Runner 를 추가 연결해 무제한 무료 실행도 가능하다:
     ```powershell
     mkdir C:\actions-runner; cd C:\actions-runner
     # Settings → Actions → Runners → New self-hosted runner 토큰 사용
     .\config.cmd --url https://github.com/Jayinsightfactory/nenova-erp-ui --token <일회용 토큰> --labels nenova-win
     .\svc.cmd install; .\svc.cmd start
     ```

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
