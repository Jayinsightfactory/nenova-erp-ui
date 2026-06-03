# n8n 자체호스팅 설치/연동 가이드 (Cafe24 VPS · 경로 /n8n · 공용 1계정)

목표: ERP와 같은 Cafe24 VPS(172.233.89.171)에 docker로 n8n을 띄우고, `https://nenovaweb.com/n8n/` 으로 접속.
네노바웹에는 메뉴 `자동화 > 🔗 업무 자동화(n8n)`(페이지 `/automation`)에서 같은 출처 iframe로 임베드된다.

> ⚠️ 이 작업은 **서버에서 직접 실행**해야 한다(배포 스크립트는 Next 빌드만 함). 아래 명령을 SSH로 실행한다.

---

## 0. 보안 원칙 (먼저 읽기)
- n8n은 **임의 코드 실행 + 임의 HTTP 요청**이 가능한 강력한 도구다. 공용 1계정이므로 접근자 전원이 같은 권한을 갖는다.
- 포트는 **127.0.0.1:5678 에만 바인딩**(외부 직접 접근 차단). 오직 nginx HTTPS로만 노출.
- **ERP MSSQL 관리자 계정/민감 키를 워크플로우·credential에 저장하지 말 것.** ERP 데이터가 필요하면 네노바웹의 토큰 보호 read API(추후 브리지)로 접근.
- 필요 시 nginx에 basic-auth(또는 사내 IP 화이트리스트) 한 겹 더 추가.

## 1. docker 설치 (이미 있으면 건너뜀)
```bash
docker --version || (curl -fsSL https://get.docker.com | sh)
docker compose version
```

## 2. n8n 구성 파일 배치
레포의 `deploy/n8n/docker-compose.yml` 를 서버 `/opt/n8n/` 로 복사하고 `.env` 작성:
```bash
sudo mkdir -p /opt/n8n && cd /opt/n8n
# docker-compose.yml 을 이 경로에 둔다 (scp 또는 git에서 복사)
printf "N8N_ENCRYPTION_KEY=%s\n" "$(openssl rand -hex 24)" | sudo tee /opt/n8n/.env
sudo chmod 600 /opt/n8n/.env
```
> `.env`의 `N8N_ENCRYPTION_KEY` 는 **절대 분실/변경 금지**(저장된 credential 복호화 불가). 안전히 백업.

## 3. n8n 기동
```bash
cd /opt/n8n
sudo docker compose up -d
sudo docker compose logs -f --tail=50    # "Editor is now accessible" 확인 후 Ctrl+C
curl -I http://127.0.0.1:5678/n8n/       # 200/302 면 정상
```

## 4. nginx 리버스 프록시 추가
`deploy/n8n/nginx-n8n-location.conf` 의 location 블록을 **nenovaweb.com 443 server 블록 안**에 추가
(기존 `location / { proxy_pass http://127.0.0.1:3000; }` 와 같은 server 블록).
```bash
sudo nginx -t && sudo systemctl reload nginx
```
확인: 브라우저에서 `https://nenovaweb.com/n8n/` 접속 → n8n 첫 화면.

## 5. 공용 계정(owner) 생성
첫 접속 시 owner 계정 생성 화면이 뜬다. **공용 이메일/강력한 비밀번호**로 1개 생성하고 직원들과 공유.
(직원별 분리가 나중에 필요하면 n8n Community의 사용자 초대 기능으로 전환 가능.)

## 6. 네노바웹에서 확인
네노바웹 로그인 → 좌측 메뉴 `자동화 > 🔗 업무 자동화(n8n)` → `/automation` 페이지에 n8n 임베드.
iframe이 비거나 막히면 페이지 우상단 **새 탭에서 열기 ↗** 사용.

---

## 운영/백업
```bash
# 업그레이드
cd /opt/n8n && sudo docker compose pull && sudo docker compose up -d
# 백업(워크플로우/credential 은 볼륨 n8n_data 의 sqlite)
sudo docker run --rm -v n8n_n8n_data:/data -v /opt/n8n/backup:/b alpine tar czf /b/n8n-$(date +%F).tgz -C /data .
```

## 트러블슈팅
- 화면 깨짐/asset 404 → `N8N_PATH=/n8n/` 와 nginx `proxy_pass http://127.0.0.1:5678;`(끝 슬래시 없음) 일치 확인.
- 에디터가 계속 로딩 → nginx의 WebSocket 헤더(Upgrade/Connection) 누락 확인.
- iframe 안 뜸 → 같은 출처라 기본 허용. 그래도 막히면 새 탭 접속 사용(기능 동일).

## 다음 단계(선택) — ERP 브리지
직원 워크플로우가 ERP 데이터를 쓰려면, 네노바웹에 **토큰 인증 read 전용 API**를 두고 n8n의 HTTP Request 노드로 호출하게 한다(직접 DB 접속 대신). 필요 시 별도 구현.
