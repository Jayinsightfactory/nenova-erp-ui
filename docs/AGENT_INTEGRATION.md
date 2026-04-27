# 외부 에이전트(봇) 연동 가이드

> 카카오워크 봇 / Slack 봇 등 외부 시스템에서 nenovaweb 의 사진 업로드/공개 URL 을
> 사용하기 위한 통합 절차. 2026-04-24 기준 master 에 모두 배포됨.

---

## 1. 인증

**POST `/api/auth/login`** — JWT 발급

요청 본문 (JSON, 다음 alias 모두 허용):
```json
{ "userId": "nenovaSS3", "password": "***" }
{ "username": "nenovaSS3", "password": "***" }
{ "id": "nenovaSS3", "password": "***" }
```

성공 응답 (200):
```json
{
  "success": true,
  "token": "eyJhbGciOi...",
  "user": { "userId": "...", "userName": "...", "authority": "...", "deptName": "..." }
}
```
- `Set-Cookie: nenovaToken=<JWT>; HttpOnly; Path=/; Max-Age=28800` 도 함께 내려옴
- 토큰 유효기간: **8시간**
- 응답 body 의 `token` 또는 쿠키 둘 중 하나 사용

실패 응답:
- 400: `{success:false, error, hint}` — 필드 누락
- 401: `{success:false, error: '존재하지 않는 계정입니다.'}` — UserID 없음
- 401: `{success:false, error: '비밀번호가 올바르지 않습니다.'}`
- 500: `DB 연결 오류` 텍스트 포함 — 일시적 DB 장애 가능

---

## 2. 사진 업로드

**POST `/api/agent/photo-upload`** — multipart/form-data

헤더 (둘 중 하나):
```
Cookie: nenovaToken=<JWT>
Authorization: Bearer <JWT>
```

폼 필드:
- `file` (필수): 이미지 바이너리
- `room` (선택): 카톡방/Slack 채널 등 출처 식별자 (서버 로그용)

제한:
- 최대 20MB
- MIME `image/*` 만
- 허용 확장자: `.jpg .jpeg .png .gif .webp`

성공 응답 (200):
```json
{ "url": "https://nenovaweb.com/uploads/photos/2026/04/24/<uuid>.jpg" }
```

실패 응답:
- 400: 잘못된 파일 / 비이미지 MIME / 파싱 실패
- 401: `WWW-Authenticate: Bearer realm="nenovaweb"` 헤더 + `hint` 안내
- 405: GET/PUT 등 (POST 만 허용)

저장 경로: `<프로젝트>/public/uploads/photos/YYYY/MM/DD/<uuid>.<ext>`
보존 기간: 30일 (업로드마다 1시간 디바운스로 자동 정리)

---

## 3. 공개 URL 접근

**GET `/uploads/photos/YYYY/MM/DD/<uuid>.<ext>`** — 인증 없음, 누구나 접근 가능

내부적으로 `/api/public/photo/[...path]` 로 rewrite 되어 파일시스템에서 스트리밍.
- `Content-Type` 자동 추론 (jpg/png/gif/webp)
- `Cache-Control: public, max-age=2592000, immutable` (30일)
- 경로 이탈 차단 (`..` 등 거부 → 400)
- 존재하지 않으면 404

> Next.js 16 production 은 `public/` 을 빌드 시점 스냅샷하므로, 런타임 업로드된
> 파일은 직접 서빙되지 않음. rewrite + API 라우트가 그 역할을 대신함.

---

## 4. 봇 측 흐름 예시 (Python)

```python
import os, requests

USER  = os.environ['NENOVAWEB_USERNAME']
PWD   = os.environ['NENOVAWEB_PASSWORD']
BASE  = 'https://nenovaweb.com'

# 1) 로그인 (JWT 토큰)
r = requests.post(f'{BASE}/api/auth/login', json={'username': USER, 'password': PWD})
r.raise_for_status()
token = r.json()['token']

# 2) 사진 업로드
with open('image.jpg', 'rb') as f:
    r = requests.post(
        f'{BASE}/api/agent/photo-upload',
        headers={'Authorization': f'Bearer {token}'},
        files={'file': f},
        data={'room': '꽃길 주문방'},
    )
r.raise_for_status()
public_url = r.json()['url']
print(public_url)  # → https://nenovaweb.com/uploads/photos/2026/04/24/<uuid>.jpg
```

---

## 5. 자가 진단 체크리스트

봇이 401/400/404 받을 때 순서대로 확인:

1. **`/api/ping`** GET → 200 인지 (서버 살아있는지)
2. **`/api/auth/login`** GET → 405 인지 (정상 — POST 전용)
3. **`/api/agent/photo-upload`** GET → 401 + `WWW-Authenticate` 헤더 인지 (정상)
4. **로그인 직접**: curl 로 `userId` / `password` 또는 `username` / `password` 보내서 200 + token 받는지
5. **토큰 사용**: 받은 토큰을 `Authorization: Bearer ...` 로 photo-upload 호출 시 200/400 (≠ 401) 인지

curl 한 줄 테스트:
```bash
TOKEN=$(curl -sS -X POST https://nenovaweb.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<id>","password":"<pwd>"}' | jq -r .token)

curl -sS -X POST https://nenovaweb.com/api/agent/photo-upload \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@sample.jpg -F room=test
```

---

## 6. 권한/계정

봇 전용 UserID 를 `UserInfo` 테이블에 만들어 사용 권장 (예: `bot_kakaowork`).
일반 사용자 계정과 분리하면 자격증명 유출 시 봇만 비활성화 가능.

```sql
INSERT INTO UserInfo (UserID, UserName, Password, Authority, DeptName, isDeleted)
VALUES (N'bot_kakaowork', N'카카오워크 봇', N'<pwd>', N'bot', N'전산', 0);
```

---

## 7. 수정 이력

- 2026-04-22 `65dbbc5` `b6189d0` — 엔드포인트 + 공개 URL 서빙 (rewrite)
- 2026-04-24 — `username` alias + 401 hint + 통합 가이드 추가
