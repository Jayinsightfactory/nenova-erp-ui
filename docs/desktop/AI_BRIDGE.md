# Nenova Desktop AI 브리지 (MCP 연결)

작성: 2026-11-05. Claude(또는 다른 MCP 클라이언트)가 Nenova Desktop에 연결해 업무 화면을 열고·읽고·조작하고·스크린샷으로 검증하는 로컬 전용 통로다. [PRD.md](PRD.md)·[SECURITY.md](SECURITY.md)의 보안 원칙(샌드박스 WebContentsView, 원격 preload 없음, ERP 쓰기 재생 금지)을 유지한다.

## 켜는 법 (기본은 꺼짐)

```powershell
# 개발 실행
cd desktop; npx electron . --ai-bridge
# 또는 환경변수
$env:NENOVA_AI_BRIDGE = '1'; npx electron .
```

켜지면 127.0.0.1 전용 HTTP 서버가 임의 포트로 열리고, 포트·토큰이
`%APPDATA%\Nenova Desktop\ai-bridge-token.json` (사용자 전용 ACL, 종료 시 삭제)에 기록된다.
모든 요청은 `Authorization: Bearer <token>` 필수. 외부 인터페이스에는 절대 바인딩하지 않는다.

## 도구 (HTTP `POST /rpc` body `{method, params}` / MCP 도구명)

| method | MCP 도구 | 기능 | 쓰기성 |
|---|---|---|---|
| `tabs/list` | `tabs_list` | 열린 탭 id·URL·제목·활성·잠금 상태 | 읽기 |
| `tabs/open` | `tabs_open` | 업무 경로 새 탭. **bootstrap 메뉴 allowlist + /dashboard·/login만** | 감사 로그 |
| `page/text` | `page_text` | 탭 본문 innerText (최대 200KB) | 읽기 |
| `page/query` | `page_query` | CSS 셀렉터로 텍스트/속성 읽기 (`page/eval` 대체, 임의 JS 없음) | 읽기 |
| `page/click` | `page_click` | 셀렉터 클릭 | **차단 목록 + 감사 로그** |
| `page/fill` | `page_fill` | input/textarea 값 입력(+input/change 이벤트) | **차단 목록 + 감사 로그** |
| `page/scroll` | `page_scroll` | 탭 스크롤(검증용): `selector` → 요소로 scrollIntoView, `y` → 절대 위치(px). 둘 중 하나 필수 | 읽기 |
| `page/screenshot` | `page_screenshot` | 탭 PNG 캡처 → 파일 경로 반환 (`%APPDATA%\Nenova Desktop\ai-bridge-shots\`) | 읽기 |
| `console/logs` | `console_logs` | 탭 최근 콘솔 로그(최대 200건 링버퍼) | 읽기 |

`tabId` 생략 시 포커스 창의 활성 탭. 로그인 잠금 중에는 open/click/fill이 거부되고 탭 URL·제목이 가려진다.

## 안전 장치

- **쓰기성 차단 목록**: `page/click`·`page/fill`은 ERP 쓰기(erp-contract) 계열 경로에서 기본 차단 —
  `/orders /shipment /stock /warehouse /incoming /incoming-price /estimate /master /admin /purchase /sales /ecount /mgmt /finance /api` (`desktop/ai-bridge.cjs`의 `WRITE_BLOCKED_PREFIXES`).
  읽기 도구는 제한 없음. 차단을 풀려면 코드 수정 + 새 설치본이 필요하다(원격으로 못 바꿈).
- **감사 로그**: open/click/fill의 허용·거부 전부 `%APPDATA%\Nenova Desktop\ai-bridge-audit.jsonl`에 JSONL로 기록.
- **임의 JS 실행 없음**: `page/eval`은 제공하지 않는다. main이 고정된 쿼리/클릭/입력 스니펫만 만든다. 원격 페이지에는 preload를 넣지 않는다.
- 토큰은 실행마다 새로 생성(32바이트 랜덤), 비교는 timingSafeEqual, 본문 256KB 제한.

## Claude Code에 MCP로 등록 (등록은 사용자가 직접)

`desktop/ai-bridge-mcp.cjs`가 stdio MCP 서버로 위 HTTP를 감싼다. 프로젝트 `.mcp.json` 예시:

```json
{
  "mcpServers": {
    "nenova-desktop": {
      "command": "node",
      "args": ["C:\\Users\\USER\\nenova-erp-ui\\desktop\\ai-bridge-mcp.cjs"]
    }
  }
}
```

토큰 파일 위치가 다르면 env로 지정: `"env": { "NENOVA_AI_BRIDGE_TOKEN_FILE": "..." }`.

## 사용 순서

1. Nenova Desktop을 `--ai-bridge`로 실행하고 평소처럼 로그인한다.
2. MCP 클라이언트(Claude Code)에서 `tabs_list` → `tabs_open` → `page_text`/`page_query`로 확인, 필요한 비차단 화면에서 `page_click`/`page_fill`, `page_screenshot`으로 검증한다.
3. 끝나면 앱을 닫으면 토큰 파일이 삭제되어 통로가 닫힌다.

## 수동 점검 (curl)

```powershell
$info = Get-Content "$env:APPDATA\Nenova Desktop\ai-bridge-token.json" | ConvertFrom-Json
curl.exe -s -X POST "http://127.0.0.1:$($info.port)/rpc" -H "Authorization: Bearer $($info.token)" -H "Content-Type: application/json" -d '{"method":"tabs/list"}'
```
