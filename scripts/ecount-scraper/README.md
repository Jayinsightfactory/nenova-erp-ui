# ECOUNT 자동수집 스크래퍼 (owner PC 백그라운드)

ECOUNT OAPI 로 못 가져오는 4종(입출금계좌·거래처채권·거래처채무·판매현황)을
**로그인된 브라우저**에서 긁어 nenovaweb `/api/ecount/ingest` 로 보낸다.
서버 cron 으로는 ECOUNT 세션이 없어 불가 → **owner PC(DESKTOP-S4S2HMU)** 에서 실행.

## 설치 (owner PC, 최초 1회)
```powershell
cd C:\Users\USER\nenova-erp-ui\scripts\ecount-scraper
npm init -y
npm i playwright
npx playwright install chromium
```

## 인증 (반영구 세션 저장 — 비번 코드에 안 넣음)
```powershell
node login-save.mjs      # 브라우저 뜨면 사람이 직접 로그인 → storageState.json 저장
```
- ECOUNT 세션은 만료되므로, 만료 시 이 명령을 다시 1회 실행(사람이 로그인).
- storageState.json 은 **git 에 절대 커밋 금지**(.gitignore 확인).

## 실행 (수동 / 스케줄)
```powershell
$env:NENOVA_URL="https://nenovaweb.com"; $env:NENOVA_COOKIE="<로그인쿠키>"  # 또는 토큰
node run.mjs sales   ar   ap   cash        # 인자로 데이터셋 지정, 없으면 4종 전부
```
- 스케줄: Windows 작업 스케줄러로 매일 원하는 시각 `node run.mjs` 등록(Orbit NSSM 방식 참고).

## 동작
1. storageState 로 ECOUNT 로그인 상태 복원
2. 데이터셋별 화면 이동(prgId) → 기간 설정 → 검색(F8) → 그리드 파싱(+화면 합계/행수)
3. nenovaweb POST `/api/ecount/ingest` → 서버가 4중 검증 후 신뢰도와 함께 저장
4. RED(거부) 나오면 로그 남기고 재시도

## 검증(서버측, lib/ecountIngest.js)
- 자기검증: 화면 합계 ⟷ 파싱 합계, 화면 행수 ⟷ 파싱 행수
- 내부 산술: ap 잔액=기초+매입−지급−차액 / sales 합계=공급+부가 (ar 은 기초 컬럼 없어 제외)
- 시계열: 직전 수집 대비 ±50% 급변 경고
- 교차: sales ⟷ nenovaweb ShipmentDetail 기간 매출 대조
→ GREEN/YELLOW/RED + 신뢰도 점수. `/ecount` 대시보드에서 시각 확인.
